// Derives per-input MXL ring buffer state directly from the live canvas graph
// (nodes + edges). See SPEC.md §2.A/§2.D/§3.
//
// Timing model (matches the MXL reference semantics):
//
// * Grain indices are preserved end to end. A Media Function that reads grain
//   index T writes its processed result back at index T, into slot
//   `T mod grainCount` of its own output flow. Processing never renumbers
//   grains — it makes a flow's published head *lag real time* by the path's
//   accumulated latency (`lagMs` below).
// * A reader with several inputs must present them together, so it fetches the
//   same absolute grain index from every input: the one the slowest branch has
//   published (`alignedLagMs`). On a faster branch that index is already
//   `stalenessMs` behind that flow's own head.
// * If that staleness exceeds the retained history, the slot was overwritten
//   long ago -> TOO_LATE. This is why a *serial* chain never overruns, while
//   an audio branch waiting on a long video path does.
//
// * Audio and video are NOT the same grain size (item #10.i): each reader
//   input's grain rate is resolved per-branch (`trackForEdge`/`Track`) by
//   tracing back to the originating producer's output handle (by convention,
//   handle 0 = video, handle 1 = audio, propagated forward through any
//   single-input chain unchanged — see `grainRateForTrack`), so an audio
//   branch gets its own (much finer) grain duration/ring-buffer geometry
//   instead of inheriting the video domain's.

import type { Edge, Node } from 'reactflow';
import type {
  AlignedRead,
  GrainRate,
  MediaFunctionKind,
  RingBuffer,
  RingBufferEvaluation,
} from '../types';
import { alignedReadSlack, continuousGeometry, evaluateRingBuffer, READ_BEHIND_WRITE_GRAINS, retainedGrainsFor, statusSeverity } from '../engine/ringBufferEngine';
import {
  DEFAULT_MEDIA_CONFIG,
  type MediaConfig,
  grainDurationMs,
  grainIndexToRingBufferIndex,
  grainIndexToTimestampMs,
  continuousBufferSamples,
  grainRateForTrack,
  ringBufferLength,
  sampleIndexAt,
  samplesPerAudioBatch,
  timestampToGrainIndex,
} from '../engine/mxlGrainIndex';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { LIVE_GROUP, inputGroupsFor, rewritesAsNewSource } from './syncInputs';

/** MXL data-format track a flow carries — determines its grain rate (item #10.i). */
export type Track = 'video' | 'audio' | 'data';

/** One reader input: the flow it reads and how that read is going. */
export interface InputReading {
  readerNodeId: string;
  sourceNodeId: string;
  /** The flow this input reads; see `flowKeyOf`. */
  flowKey: string;
  inputIndex: number;
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
  /** MXL track this input's upstream flow carries — determines its grain rate. */
  track: Track;
  /**
   * For an audio input at a true sync point (a node with a video sibling
   * input), the absolute time span `[startMs, endMs)` of the video grain
   * this node is reading "at the same instant" — i.e. which slice of
   * audio's much finer grains corresponds to one video frame (item #10.ii).
   * Undefined when there's no video sibling to align against.
   */
  alignmentSpanMs?: { startMs: number; endMs: number };
}

/** Per-node accumulated latency, before/after this node's own processing delay. */
export interface NodeLatencyInfo {
  nodeId: string;
  /** Lag (ms) of the aligned grain index this node reads — its slowest branch (across sync groups, the latest group). */
  inputLatencyMs: number;
  /** Aligned lag of each sync group (group number → ms); live inputs are not in any group. */
  groupLagMs: Map<number, number>;
  /** Lag (ms) of this node's own published output flow head. */
  outputLatencyMs: number;
  /** What this node itself adds to the end-to-end latency: its own latency, a repeater's tail read, and the grain it reads behind its input's head. */
  ownLatencyMs: number;
  /**
   * End-to-end latency from capture to this node's output. Equals
   * `outputLatencyMs` except downstream of a Profanity Delay, which re-writes
   * its flows as a new source (head lag back to 0) but still delayed the show.
   */
  workloadLatencyMs: number;
  /** True if this node's inputs arrive with different lags and had to be aligned (§2.D). */
  wasSynced: boolean;
  /** Worst differential this node has to absorb across its inputs (ms). */
  maxStalenessMs: number;
}

/**
 * A flow a node writes into its own ring buffer. Every output of every
 * producing node has one, whether or not anything is reading it: an MXL writer
 * commits grains to the shared-memory ring regardless of its readers.
 */
/**
 * Identifies one published flow. Normally a node writes one flow per track, so
 * the key is node + track; a source with several outputs of the same track
 * (the CG's two video outputs) writes one flow per output handle.
 */
export function flowKeyOf(nodeId: string, track: Track, handleId: string, multiOutput: boolean): string {
  return multiOutput ? `${nodeId}:${track}:${handleId}` : `${nodeId}:${track}`;
}

export interface WriterFlow {
  writerNodeId: string;
  /** See `flowKeyOf`. */
  flowKey: string;
  track: Track;
  /** The writer's output handle this flow leaves from. */
  handleId: string;
  grainRate: GrainRate;
  grainDurationMs: number;
  grainCount: number;
  retainedGrains: number;
  lagMs: number;
  publishedGrainIndex: number;
  publishedSlot: number;
}

export interface GraphBufferState {
  /** Wall-clock timestamp standing in for the domain's TAI/PTP clock. */
  timestampMs: number;
  grainRate: GrainRate;
  grainDurationMs: number;
  /** Physical grain slots in one domain window. */
  grainCount: number;
  /** Every output flow in the graph, including ones nobody reads. */
  writerFlows: WriterFlow[];
  /** Every connected reader input, keyed by reader node id. */
  inputsByNodeId: Map<string, InputReading[]>;
  /** Worst input per node — drives node borders, badges, grain drops and the fail timer. */
  evaluations: Map<string, { buffer: RingBuffer; evaluation: RingBufferEvaluation }>;
  latencyByNodeId: Map<string, NodeLatencyInfo>;
  /** Total Workload Latency (§3): max end-to-end lag reaching any Output/Recording node. */
  totalWorkloadLatencyMs: number;
  /** Stability Margin (§3): smallest remaining retained history across all inputs, in ms. */
  stabilityMarginMs: number;
}

interface GraphNodeLike {
  id: string;
  kind: MediaFunctionKind;
  latencyMs: number;
  inputSourceIds: (string | null)[];
  /** Audio-only / video-only functions read and write that track regardless of wiring. */
  fixedTrack?: Track;
  /** Mixer sync group per input; 0 = live (see `inputGroupsFor`). */
  inputGroups?: number[];
  inputCount: number;
  /** A source whose outputs are all the same track, each its own flow (e.g. the CG's two video outputs). */
  multiOutput: boolean;
}

/** A published flow: how far its head lags real time, and its end-to-end latency. */
interface BranchInfo {
  lagMs: number;
  /** End-to-end latency; differs from `lagMs` once a Profanity Delay or Grain Repeater has reset the head lag. */
  workloadMs: number;
}

/** Build node lookups with resolved upstream source ids from React Flow edges. */
function buildGraphNodes(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
): Map<string, GraphNodeLike> {
  const byId = new Map<string, GraphNodeLike>();
  for (const n of nodes) {
    byId.set(n.id, {
      id: n.id,
      kind: n.data.kind,
      latencyMs: n.data.latencyMs,
      inputCount: n.data.inputCount,
      multiOutput: n.data.inputCount === 0 && n.data.outputCount > 1 && (n.data.videoOnly ?? false),
      ...(n.data.inputGroups ? { inputGroups: n.data.inputGroups } : {}),
      inputSourceIds: new Array(n.data.inputCount).fill(null),
      ...(n.data.audioOnly ? { fixedTrack: 'audio' as const } : n.data.videoOnly ? { fixedTrack: 'video' as const } : {}),
    });
  }
  for (const e of edges) {
    const target = byId.get(e.target);
    if (!target) continue;
    const inIndex = e.targetHandle ? Number(e.targetHandle.replace('in-', '')) : 0;
    if (Number.isInteger(inIndex) && inIndex >= 0 && inIndex < target.inputSourceIds.length) {
      target.inputSourceIds[inIndex] = e.source;
    }
  }
  return byId;
}

function parseHandleIndex(handle: string | null | undefined, prefix: string): number {
  if (!handle) return 0;
  const n = Number(handle.replace(prefix, ''));
  return Number.isInteger(n) ? n : 0;
}

/** Convention shared with `grainFlow.ts`'s `streamIndex`: a producer's output handle 0 = video, 1 = audio, else data. */
function indexToTrack(index: number): Track {
  if (index === 0) return 'video';
  if (index === 1) return 'audio';
  return 'data';
}

/**
 * Resolve the MXL track (and therefore grain rate) of whatever flow arrives
 * on `edge`, by walking back to the producer that originated it.
 *
 * Every non-producer, non-sync node in this app has exactly one input and
 * one output, so it simply re-emits the track it received; only a producer
 * (no inputs) actually originates a track, by convention of which output
 * handle it was written to (matching the starter topology's Ingress
 * out-0=video/out-1=audio and `grainFlow.ts`'s `streamIndex`). A multi-input
 * node reached this way (e.g. an Editorial switcher mixing two inputs into
 * one output) falls back to its first (lowest-index) input's track.
 */
function trackForEdge(
  edge: Edge,
  byId: Map<string, GraphNodeLike>,
  inboundEdgesByTarget: Map<string, Edge[]>,
  memo: Map<string, Track>,
): Track {
  const cached = memo.get(edge.id);
  if (cached) return cached;

  const srcNode = byId.get(edge.source);
  let track: Track;
  if (srcNode?.fixedTrack && srcNode.inputSourceIds.length > 0) {
    track = srcNode.fixedTrack;
  } else if (srcNode && srcNode.inputSourceIds.length === 0 && srcNode.fixedTrack) {
    track = srcNode.fixedTrack;
  } else if (srcNode?.kind === 'delay') {
    // A Profanity Delay re-writes video on out-0 and audio on out-1.
    track = indexToTrack(parseHandleIndex(edge.sourceHandle, 'out-'));
  } else if (!srcNode || srcNode.inputSourceIds.length === 0) {
    // Producer (Input/Synthetic): the track originates here, keyed by which
    // output handle this specific edge left from.
    track = indexToTrack(parseHandleIndex(edge.sourceHandle, 'out-'));
  } else {
    // Placeholder first, so a loop in the graph ends here instead of recursing forever.
    memo.set(edge.id, 'data');
    const inbound = (inboundEdgesByTarget.get(edge.source) ?? [])
      .slice()
      .sort((a, b) => parseHandleIndex(a.targetHandle, 'in-') - parseHandleIndex(b.targetHandle, 'in-'))[0];
    track = inbound ? trackForEdge(inbound, byId, inboundEdgesByTarget, memo) : 'data';
  }
  memo.set(edge.id, track);
  return track;
}

/**
 * Compute every flow's head lag and every reader input's ring buffer state.
 *
 * - A node's output flow lags real time by its aligned input lag plus its own
 *   processing latency.
 * - A Grain Repeater reads the oldest retained grain and writes it, with the
 *   same grain index, into a fresh ring buffer at its head. Its output head
 *   therefore lags by the extra age it read, which also counts as workload.
 * - A Profanity Delay instead re-stamps its output as a new source (lag 0).
 */
export function computeGraphLatency(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  domainSizeMs: number,
  timestampMs = Date.now(),
  media: MediaConfig = DEFAULT_MEDIA_CONFIG,
): GraphBufferState {
  const byId = buildGraphNodes(nodes, edges);
  const branchByNodeId = new Map<string, BranchInfo>();
  const latencyByNodeId = new Map<string, NodeLatencyInfo>();
  const visiting = new Set<string>();

  // Reported at the top level as the domain's reference (video) grain clock —
  // individual reader inputs use their own track's grain rate (see below).
  const grainRate = media.videoRate;
  const durationMs = grainDurationMs(grainRate);
  const grainCount = ringBufferLength(domainSizeMs, grainRate);

  // Edge lookups used to resolve each input's track (item #10.i): every
  // inbound edge grouped by its target node, and by `${target}:${inputIndex}`
  // so a specific reader input can find the edge that feeds it.
  const inboundEdgesByTarget = new Map<string, Edge[]>();
  const edgeByTargetIndex = new Map<string, Edge>();
  for (const e of edges) {
    if (!inboundEdgesByTarget.has(e.target)) inboundEdgesByTarget.set(e.target, []);
    inboundEdgesByTarget.get(e.target)!.push(e);
    edgeByTargetIndex.set(`${e.target}:${parseHandleIndex(e.targetHandle, 'in-')}`, e);
  }
  const trackMemo = new Map<string, Track>();

  /**
   * The ring a reader of `track` reads from. Video (and data) rings are
   * discrete: MXL reserves two slots. Audio rings are continuous: MXL allocates
   * twice the history and a read must fit its window inside the newer half
   * (`continuousGeometry`); here a one-batch read. A read aligned to video is
   * judged per sample instead (`AlignedRead`).
   */
  function ringGeometry(track: Track) {
    const rate = grainRateForTrack(track, media);
    const durationMs = grainDurationMs(rate);
    if (track === 'audio') {
      const c = continuousGeometry(domainSizeMs, media);
      return { rate, durationMs, grainCount: c.grainCount, retainedGrains: c.retainedGrains };
    }
    const count = ringBufferLength(domainSizeMs, rate);
    return { rate, durationMs, grainCount: count, retainedGrains: retainedGrainsFor(count) };
  }

  function resolveBranch(id: string): BranchInfo {
    const cached = branchByNodeId.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || visiting.has(id)) return { lagMs: 0, workloadMs: 0 }; // missing node or cycle guard

    visiting.add(id);
    const wired = node.inputSourceIds
      .map((p, index) => ({ p, index }))
      .filter((w): w is { p: string; index: number } => w.p !== null);
    const allParents = wired.map((w) => resolveBranch(w.p));
    visiting.delete(id);

    // Live inputs are read at their own write head, so they neither set an
    // aligned index nor hold this node back. The rest are split into sync
    // groups (like MXL flow synchronization groups): each group is read at its
    // own slowest member, and the node can only write once every group is ready.
    const groupOf = inputGroupsFor(node, wired.map((w) => w.index));
    const lagsByGroup = new Map<number, number[]>();
    const parents: BranchInfo[] = [];
    wired.forEach((w, i) => {
      const g = groupOf.get(w.index)!;
      if (g === LIVE_GROUP) return;
      parents.push(allParents[i]);
      if (!lagsByGroup.has(g)) lagsByGroup.set(g, []);
      lagsByGroup.get(g)!.push(allParents[i].lagMs);
    });
    const groupLagMs = new Map([...lagsByGroup].map(([g, lags]) => [g, Math.max(...lags)]));
    const alignedLagMs = groupLagMs.size > 0 ? Math.max(...groupLagMs.values()) : 0;
    let maxStalenessMs = 0;
    let wasSynced = false;
    for (const [g, lags] of lagsByGroup) {
      maxStalenessMs = Math.max(maxStalenessMs, groupLagMs.get(g)! - Math.min(...lags));
      if (lags.length > 1 && new Set(lags).size > 1) wasSynced = true;
    }

    const alignedWorkloadMs = parents.length > 0 ? Math.max(...parents.map((p) => p.workloadMs)) : 0;
    // Track this node reads (its lowest-index input), which sets the grain size
    // of the ring it reads from.
    const firstInbound = (inboundEdgesByTarget.get(node.id) ?? [])
      .slice()
      .sort((a, b) => parseHandleIndex(a.targetHandle, 'in-') - parseHandleIndex(b.targetHandle, 'in-'))[0];
    const inputTrack: Track = node.fixedTrack ?? (firstInbound ? trackForEdge(firstInbound, byId, inboundEdgesByTarget, trackMemo) : 'video');
    const inputRing = ringGeometry(inputTrack);
    // A Grain Repeater reads the oldest grain still retained (the far end of
    // the ring from the write head) and writes it into a fresh ring with the
    // same grain index, so its output head sits that far behind its input's.
    // Measured in the ring it reads: discrete for video, continuous for audio.
    const tailReadMs =
      node.kind === 'repeater' && parents.length > 0 ? (inputRing.retainedGrains + READ_BEHIND_WRITE_GRAINS) * inputRing.durationMs : 0;
    // A reader can only consume the grain behind its input's write head, so a
    // function (other than a repeater, which already counts it in `tailReadMs`,
    // or a delay, which restarts; sinks write nothing) writes that same grain index one grain
    // later: its head carries the index it read.
    let readBehindMs = 0;
    if (wired.length > 0 && node.kind !== 'repeater' && node.kind !== 'delay' && node.kind !== 'output' && node.kind !== 'recording') {
      readBehindMs = READ_BEHIND_WRITE_GRAINS * inputRing.durationMs;
    }
    const workloadMs = alignedWorkloadMs + node.latencyMs + tailReadMs + readBehindMs;

    // A Profanity Delay writes into a fresh ring of its own, stamped at the
    // current time, like a synthetic source: the head restarts with no upstream
    // lag. The workload latency still keeps counting.
    const lagMs = rewritesAsNewSource(node.kind) ? 0 : alignedLagMs + node.latencyMs + tailReadMs + readBehindMs;

    latencyByNodeId.set(id, {
      nodeId: id,
      inputLatencyMs: alignedLagMs,
      groupLagMs,
      outputLatencyMs: lagMs,
      ownLatencyMs: node.latencyMs + tailReadMs + readBehindMs,
      workloadLatencyMs: workloadMs,
      wasSynced,
      maxStalenessMs,
    });
    const branch: BranchInfo = { lagMs, workloadMs };
    branchByNodeId.set(id, branch);
    return branch;
  }

  for (const node of nodes) resolveBranch(node.id);

  // Synced outputs (several Output functions released together): every one of
  // them reads at the slowest of their aligned indices, like inputs of a single
  // sync node. Outputs are sinks, so nothing downstream depends on the change.
  const syncedOutputs = nodes.filter(
    (n) => n.data.kind === 'output' && n.data.syncOutputs && (byId.get(n.id)?.inputSourceIds.some((p) => p !== null) ?? false),
  );
  if (syncedOutputs.length > 1) {
    const groupLagMs = Math.max(...syncedOutputs.map((n) => latencyByNodeId.get(n.id)?.inputLatencyMs ?? 0));
    for (const n of syncedOutputs) {
      const info = latencyByNodeId.get(n.id);
      if (!info) continue;
      const parentLags = byId.get(n.id)!.inputSourceIds.filter((p): p is string => p !== null).map((p) => resolveBranch(p).lagMs);
      latencyByNodeId.set(n.id, {
        ...info,
        inputLatencyMs: groupLagMs,
        groupLagMs: new Map([[1, groupLagMs]]),
        outputLatencyMs: groupLagMs + n.data.latencyMs,
        workloadLatencyMs: info.workloadLatencyMs + (groupLagMs - info.inputLatencyMs),
        maxStalenessMs: Math.max(...parentLags.map((l) => groupLagMs - l)),
        wasSynced: info.wasSynced || parentLags.some((l) => l !== groupLagMs),
      });
    }
  }

  const inputsByNodeId = new Map<string, InputReading[]>();
  const evaluations = new Map<string, { buffer: RingBuffer; evaluation: RingBufferEvaluation }>();
  let stabilityMarginMs = Infinity;
  let totalWorkloadLatencyMs = 0;

  for (const node of nodes) {
    const graphNode = byId.get(node.id);
    const info = latencyByNodeId.get(node.id);
    if (!graphNode || !info) continue;

    const readings: InputReading[] = [];
    const groupOf = inputGroupsFor(
      graphNode,
      graphNode.inputSourceIds.flatMap((p, i) => (p ? [i] : [])),
    );
    // Track of each wired input, and the first synced video input: audio in its
    // sync group is read by timestamp alongside it, one video grain at a time.
    const trackOfInput = new Map<number, Track>();
    graphNode.inputSourceIds.forEach((sourceId, i) => {
      if (!sourceId) return;
      const e = edgeByTargetIndex.get(`${node.id}:${i}`);
      trackOfInput.set(i, graphNode.fixedTrack ?? (e ? trackForEdge(e, byId, inboundEdgesByTarget, trackMemo) : 'video'));
    });
    const videoInput = [...trackOfInput].find(([i, t]) => t === 'video' && groupOf.get(i) !== LIVE_GROUP)?.[0];
    const alignedToVideo = (i: number) =>
      videoInput !== undefined && trackOfInput.get(i) === 'audio' && groupOf.get(i) === groupOf.get(videoInput);

    const alignedAudioInputs = [...trackOfInput.keys()].filter(alignedToVideo);

    /** Reads one wired input; `videoReading` is the synced video input's reading, read first. */
    const readInput = (sourceId: string, inputIndex: number, videoReading?: InputReading): InputReading => {
      const branch = resolveBranch(sourceId);

      // The flow's published head carries the newest grain index it has
      // written; this reader asks for the aligned (slowest-branch) index.
      const group = groupOf.get(inputIndex) ?? 1;
      const alignedLagMs = group === LIVE_GROUP ? branch.lagMs : (info.groupLagMs.get(group) ?? info.inputLatencyMs);
      let stalenessMs = alignedLagMs - branch.lagMs;

      // This input's own track and ring (item #10.i): audio is counted in
      // commit batches and judged by MXL's continuous rule (`ringGeometry`).
      const inputEdge = edgeByTargetIndex.get(`${node.id}:${inputIndex}`);
      const track = trackOfInput.get(inputIndex) ?? 'video';
      const ring = ringGeometry(track);
      const trackRate = ring.rate;
      const trackDurationMs = ring.durationMs;
      const trackGrainCount = ring.grainCount;

      const readsTail = graphNode.kind === 'repeater';
      let retainedGrains = ring.retainedGrains;
      const deltaGrains = readsTail ? retainedGrains : Math.round(stalenessMs / trackDurationMs);
      const publishedGrainIndex = timestampToGrainIndex(timestampMs - branch.lagMs, trackRate);
      // MXL readers can't read the grain being written, so a zero-lag read
      // lands one grain behind the write head.
      let requestedGrainIndex = publishedGrainIndex - READ_BEHIND_WRITE_GRAINS - deltaGrains;
      let requestedTimestampMs = readsTail
        ? timestampMs - branch.lagMs - (retainedGrains + READ_BEHIND_WRITE_GRAINS) * trackDurationMs
        : timestampMs - alignedLagMs;
      let alignedRead: AlignedRead | undefined;

      if (!readsTail && inputIndex === videoInput && alignedAudioInputs.length > 0) {
        // A sync group releases a video grain only once its audio is in too:
        // the grain must end (T_k+1) by the time every synced audio flow has
        // committed. When audio is the slower flow, that is an earlier grain.
        const committedMs = Math.min(
          ...alignedAudioInputs.map((i) => {
            const lag = resolveBranch(graphNode.inputSourceIds[i]!).lagMs;
            const audioRate = grainRateForTrack('audio', media);
            return grainIndexToTimestampMs(timestampToGrainIndex(timestampMs - lag, audioRate), audioRate);
          }),
        );
        const latestComplete = timestampToGrainIndex(committedMs, trackRate) - 1;
        if (latestComplete < requestedGrainIndex) {
          requestedGrainIndex = latestComplete;
          stalenessMs = (publishedGrainIndex - READ_BEHIND_WRITE_GRAINS - requestedGrainIndex) * trackDurationMs;
          requestedTimestampMs = grainIndexToTimestampMs(requestedGrainIndex, trackRate);
        }
      }

      if (!readsTail && videoReading && alignedToVideo(inputIndex)) {
        // MXL aligns by timestamp: the video grain k read alongside has
        // timestamp T_k; its audio is every sample from S(T_k) up to S(T_k+1) - 1.
        const k = videoReading.buffer.requestedGrainIndex;
        const videoRate = videoReading.buffer.grainRate;
        const fs = media.audioSampleRate;
        const startMs = grainIndexToTimestampMs(k, videoRate);
        const endMs = grainIndexToTimestampMs(k + 1, videoRate);
        const firstSample = sampleIndexAt(startMs, fs);
        const lastSample = sampleIndexAt(endMs, fs) - 1;
        const sampleCount = lastSample - firstSample + 1;
        const perBatch = samplesPerAudioBatch(media);
        alignedRead = {
          videoGrainIndex: k,
          videoRate,
          timestampMs: startMs,
          endTimestampMs: endMs,
          sampleRate: fs,
          firstSample,
          lastSample,
          sampleCount,
          // Everything before the batch being written is committed.
          headSample: publishedGrainIndex * perBatch - 1,
          bufferSamples: continuousBufferSamples(domainSizeMs, fs),
        };
        requestedGrainIndex = Math.floor(lastSample / perBatch);
        retainedGrains = continuousGeometry(domainSizeMs, media, sampleCount).retainedGrains;
        stalenessMs = ((alignedRead.headSample - lastSample) * 1000) / fs;
        requestedTimestampMs = startMs;
      }

      const buffer: RingBuffer = {
        id: `${node.id}:${inputIndex}`,
        readerNodeId: node.id,
        sourceNodeId: sourceId,
        inputIndex,
        sizeMs: domainSizeMs,
        grainRate: trackRate,
        grainDurationMs: trackDurationMs,
        grainCount: trackGrainCount,
        retainedGrains,
        retainedMs: retainedGrains * trackDurationMs,
        branchLagMs: branch.lagMs,
        alignedLagMs,
        stalenessMs: readsTail ? retainedGrains * trackDurationMs : stalenessMs,
        readsTail,
        publishedTimestampMs: timestampMs - branch.lagMs,
        requestedTimestampMs,
        publishedGrainIndex,
        requestedGrainIndex,
        publishedRingBufferIndex: grainIndexToRingBufferIndex(publishedGrainIndex, trackGrainCount),
        requestedRingBufferIndex: grainIndexToRingBufferIndex(requestedGrainIndex, trackGrainCount),
        retainedFromGrainIndex: publishedGrainIndex - retainedGrains,
        ...(alignedRead ? { alignedRead } : {}),
      };

      const evaluation = evaluateRingBuffer(buffer);
      const sourceHandleId = inputEdge?.sourceHandle ?? 'out-0';
      const flowKey = flowKeyOf(sourceId, track, sourceHandleId, byId.get(sourceId)?.multiOutput ?? false);
      // Measured so the margin flips negative exactly when a read flips to
      // TOO_LATE, instead of disagreeing with the status.
      if (alignedRead) {
        const { behind, room } = alignedReadSlack(alignedRead);
        stabilityMarginMs = Math.min(stabilityMarginMs, ((room - behind) * 1000) / alignedRead.sampleRate);
      } else if (!readsTail) {
        stabilityMarginMs = Math.min(stabilityMarginMs, (retainedGrains - evaluation.deltaGrains) * trackDurationMs);
      }
      return { readerNodeId: node.id, sourceNodeId: sourceId, flowKey, inputIndex, buffer, evaluation, track };
    };

    // The synced video input first, so aligned audio can read the grain it read.
    const wiredInputs = graphNode.inputSourceIds.flatMap((sourceId, i) => (sourceId ? [{ sourceId, i }] : []));
    const videoFirst = [...wiredInputs].sort((a, b) => Number(b.i === videoInput) - Number(a.i === videoInput));
    let videoReading: InputReading | undefined;
    for (const { sourceId, i } of videoFirst) {
      const reading = readInput(sourceId, i, videoReading);
      if (i === videoInput) videoReading = reading;
      readings.push(reading);
    }
    readings.sort((a, b) => a.inputIndex - b.inputIndex);

    if (readings.length > 0) {
      // Alignment highlight (item #10.ii): at a sync point reading both video
      // and audio, both readings carry the span of the video grain read, by
      // its MXL timestamp, so each view can show the pair. Only inputs in the
      // same sync group line up with each other.
      const aligned = readings.filter((r) => r.buffer.alignedRead);
      if (videoReading && aligned.length > 0) {
        const { timestampMs: startMs, endTimestampMs: endMs } = aligned[0].buffer.alignedRead!;
        for (const r of [videoReading, ...aligned]) r.alignmentSpanMs = { startMs, endMs };
      }

      inputsByNodeId.set(node.id, readings);
      const worst = readings.reduce((a, b) =>
        statusSeverity(b.evaluation.status) > statusSeverity(a.evaluation.status) ||
        (statusSeverity(b.evaluation.status) === statusSeverity(a.evaluation.status) &&
          b.evaluation.occupancyRatio > a.evaluation.occupancyRatio)
          ? b
          : a,
      );
      evaluations.set(node.id, { buffer: worst.buffer, evaluation: worst.evaluation });
    }

    if (node.data.kind === 'output' || node.data.kind === 'recording') {
      totalWorkloadLatencyMs = Math.max(totalWorkloadLatencyMs, info.workloadLatencyMs);
    }
  }
  if (!Number.isFinite(stabilityMarginMs)) stabilityMarginMs = domainSizeMs;

  const writerFlows: WriterFlow[] = [];
  const seenFlows = new Set<string>();
  for (const node of nodes) {
    const graphNode = byId.get(node.id);
    if (!graphNode) continue;
    // Sinks (no outputs) write no flow, even when flagged audio-only.
    const handles = node.data.outputCount === 0
      ? []
      : node.data.audioOnly
      ? [1]
      : Array.from({ length: node.data.outputCount }, (_, i) => i);
    const firstInbound = (inboundEdgesByTarget.get(node.id) ?? [])
      .slice()
      .sort((a, b) => parseHandleIndex(a.targetHandle, 'in-') - parseHandleIndex(b.targetHandle, 'in-'))[0];
    const branch = resolveBranch(node.id);
    for (const index of handles) {
      const track: Track =
        graphNode.inputSourceIds.length === 0 || graphNode.kind === 'delay'
          ? graphNode.fixedTrack ?? indexToTrack(index)
          : graphNode.fixedTrack
            ? graphNode.fixedTrack
            : firstInbound
            ? trackForEdge(firstInbound, byId, inboundEdgesByTarget, trackMemo)
            : 'video';
      const flowKey = flowKeyOf(node.id, track, `out-${index}`, graphNode.multiOutput);
      if (seenFlows.has(flowKey)) continue;
      seenFlows.add(flowKey);
      const ring = ringGeometry(track);
      const trackRate = ring.rate;
      const trackDurationMs = ring.durationMs;
      const trackGrainCount = ring.grainCount;
      const publishedGrainIndex = timestampToGrainIndex(timestampMs - branch.lagMs, trackRate);
      writerFlows.push({
        writerNodeId: node.id,
        flowKey,
        track,
        handleId: `out-${index}`,
        grainRate: trackRate,
        grainDurationMs: trackDurationMs,
        grainCount: trackGrainCount,
        retainedGrains: ring.retainedGrains,
        lagMs: branch.lagMs,
        publishedGrainIndex,
        publishedSlot: grainIndexToRingBufferIndex(publishedGrainIndex, trackGrainCount),
      });
    }
  }

  return {
    timestampMs,
    grainRate,
    grainDurationMs: durationMs,
    grainCount,
    writerFlows,
    inputsByNodeId,
    evaluations,
    latencyByNodeId,
    totalWorkloadLatencyMs,
    stabilityMarginMs,
  };
}
