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
  GrainRate,
  MediaFunctionKind,
  RingBuffer,
  RingBufferEvaluation,
} from '../types';
import { evaluateRingBuffer, READ_BEHIND_WRITE_GRAINS, retainedGrainsFor, oldestReadableAgeMs, statusSeverity } from '../engine/ringBufferEngine';
import {
  DEFAULT_GRAIN_RATE,
  grainDurationMs,
  grainIndexToRingBufferIndex,
  grainRateForTrack,
  ringBufferLength,
  timestampToGrainIndex,
} from '../engine/mxlGrainIndex';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { freeRunningInputs, rewritesAsNewSource } from './syncInputs';

/** MXL data-format track a flow carries — determines its grain rate (item #10.i). */
export type Track = 'video' | 'audio' | 'data';

/** One reader input: the flow it reads and how that read is going. */
export interface InputReading {
  readerNodeId: string;
  sourceNodeId: string;
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
  /** Lag (ms) of the aligned grain index this node reads — its slowest branch. */
  inputLatencyMs: number;
  /** Lag (ms) of this node's own published output flow head. */
  outputLatencyMs: number;
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
export interface WriterFlow {
  writerNodeId: string;
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
  /** Mixer inputs set to read free of the sync point (see `freeRunningInputs`). */
  ignoreSyncInputs?: number[];
  inputCount: number;
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
      ...(n.data.ignoreSyncInputs ? { ignoreSyncInputs: n.data.ignoreSyncInputs } : {}),
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
  } else if (srcNode?.kind === 'delay') {
    // A Profanity Delay re-writes video on out-0 and audio on out-1.
    track = indexToTrack(parseHandleIndex(edge.sourceHandle, 'out-'));
  } else if (!srcNode || srcNode.inputSourceIds.length === 0) {
    // Producer (Input/Synthetic): the track originates here, keyed by which
    // output handle this specific edge left from.
    track = indexToTrack(parseHandleIndex(edge.sourceHandle, 'out-'));
  } else {
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
): GraphBufferState {
  const byId = buildGraphNodes(nodes, edges);
  const branchByNodeId = new Map<string, BranchInfo>();
  const latencyByNodeId = new Map<string, NodeLatencyInfo>();
  const visiting = new Set<string>();

  // Reported at the top level as the domain's reference (video) grain clock —
  // individual reader inputs use their own track's grain rate (see below).
  const grainRate = DEFAULT_GRAIN_RATE;
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

    // Inputs set to ignore sync are read at their own write head, so they
    // neither set the aligned index nor hold this node back.
    const free = freeRunningInputs(node, wired.map((w) => w.index));
    const parents = allParents.filter((_, i) => !free.has(wired[i].index));

    // Sync Group alignment (§2.D): all inputs are read at the slowest branch's
    // grain index, so this node's own output inherits that lag.
    const alignedLagMs = parents.length > 0 ? Math.max(...parents.map((p) => p.lagMs)) : 0;
    const maxStalenessMs = parents.reduce((worst, p) => Math.max(worst, alignedLagMs - p.lagMs), 0);
    const wasSynced = parents.length > 1 && new Set(parents.map((p) => p.lagMs)).size > 1;

    const alignedWorkloadMs = parents.length > 0 ? Math.max(...parents.map((p) => p.workloadMs)) : 0;
    // A Grain Repeater reads the oldest grain still retained (the far end of
    // the ring from the write head) and writes it into a fresh ring with the
    // same grain index, so its output head sits that far behind its input's.
    const tailReadMs = node.kind === 'repeater' && parents.length > 0 ? oldestReadableAgeMs(domainSizeMs) : 0;
    const workloadMs = alignedWorkloadMs + node.latencyMs + tailReadMs;

    // A Profanity Delay writes into a fresh ring of its own, stamped at the
    // current time, like a synthetic source: the head restarts with no upstream
    // lag. The workload latency still keeps counting.
    const lagMs = rewritesAsNewSource(node.kind) ? 0 : alignedLagMs + node.latencyMs + tailReadMs;

    latencyByNodeId.set(id, {
      nodeId: id,
      inputLatencyMs: alignedLagMs,
      outputLatencyMs: lagMs,
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
    const freeInputs = freeRunningInputs(
      graphNode,
      graphNode.inputSourceIds.flatMap((p, i) => (p ? [i] : [])),
    );
    graphNode.inputSourceIds.forEach((sourceId, inputIndex) => {
      if (!sourceId) return;
      const branch = resolveBranch(sourceId);

      // The flow's published head carries the newest grain index it has
      // written; this reader asks for the aligned (slowest-branch) index.
      const isFree = freeInputs.has(inputIndex);
      const alignedLagMs = isFree ? branch.lagMs : info.inputLatencyMs;
      const stalenessMs = alignedLagMs - branch.lagMs;

      // This input's own track/grain rate (item #10.i): audio gets a much
      // finer grain duration than video, derived from the same timing math
      // (`mxlGrainIndex.ts`) but with its own geometry.
      const inputEdge = edgeByTargetIndex.get(`${node.id}:${inputIndex}`);
      const track: Track = graphNode.fixedTrack ?? (inputEdge ? trackForEdge(inputEdge, byId, inboundEdgesByTarget, trackMemo) : 'video');
      const trackRate = grainRateForTrack(track);
      const trackDurationMs = grainDurationMs(trackRate);
      const trackGrainCount = ringBufferLength(domainSizeMs, trackRate);

      const readsTail = graphNode.kind === 'repeater';
      const retainedGrains = retainedGrainsFor(trackGrainCount, trackDurationMs);
      const deltaGrains = readsTail ? retainedGrains : Math.round(stalenessMs / trackDurationMs);
      const publishedGrainIndex = timestampToGrainIndex(timestampMs - branch.lagMs, trackRate);
      // MXL readers can't read the grain being written, so a zero-lag read
      // lands one grain behind the write head.
      const requestedGrainIndex = publishedGrainIndex - READ_BEHIND_WRITE_GRAINS - deltaGrains;

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
        requestedTimestampMs: readsTail ? timestampMs - branch.lagMs - (retainedGrains + READ_BEHIND_WRITE_GRAINS) * trackDurationMs : timestampMs - alignedLagMs,
        publishedGrainIndex,
        requestedGrainIndex,
        publishedRingBufferIndex: grainIndexToRingBufferIndex(publishedGrainIndex, trackGrainCount),
        requestedRingBufferIndex: grainIndexToRingBufferIndex(requestedGrainIndex, trackGrainCount),
        retainedFromGrainIndex: publishedGrainIndex - retainedGrains,
      };

      const evaluation = evaluateRingBuffer(buffer);
      readings.push({ readerNodeId: node.id, sourceNodeId: sourceId, inputIndex, buffer, evaluation, track });
      // Measured in whole grains so the margin flips negative exactly when a
      // read flips to TOO_LATE, instead of disagreeing with the status.
      if (!readsTail) {
        stabilityMarginMs = Math.min(
          stabilityMarginMs,
          (retainedGrains - evaluation.deltaGrains) * trackDurationMs,
        );
      }
    });

    if (readings.length > 0) {
      // Alignment highlight (item #10.ii): at a true sync point — a node
      // reading both a video and an audio sibling — the audio input's view
      // should show *which slice* of its much finer grains lines up with
      // the one video grain being read at the same aligned instant.
      const videoSibling = readings.find((r) => r.track === 'video');
      if (videoSibling) {
        const videoGrainMs = videoSibling.buffer.grainDurationMs;
        const alignedInstantMs = videoSibling.buffer.requestedTimestampMs;
        const startMs = Math.floor(alignedInstantMs / videoGrainMs) * videoGrainMs;
        readings.forEach((r) => {
          if (r.track === 'audio' && !freeInputs.has(r.inputIndex)) {
            r.alignmentSpanMs = { startMs, endMs: startMs + videoGrainMs };
          }
        });
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
          ? indexToTrack(index)
          : graphNode.fixedTrack
            ? graphNode.fixedTrack
            : firstInbound
            ? trackForEdge(firstInbound, byId, inboundEdgesByTarget, trackMemo)
            : 'video';
      const flowKey = `${node.id}:${track}`;
      if (seenFlows.has(flowKey)) continue;
      seenFlows.add(flowKey);
      const trackRate = grainRateForTrack(track);
      const trackDurationMs = grainDurationMs(trackRate);
      const trackGrainCount = ringBufferLength(domainSizeMs, trackRate);
      const publishedGrainIndex = timestampToGrainIndex(timestampMs - branch.lagMs, trackRate);
      writerFlows.push({
        writerNodeId: node.id,
        track,
        handleId: `out-${index}`,
        grainRate: trackRate,
        grainDurationMs: trackDurationMs,
        grainCount: trackGrainCount,
        retainedGrains: retainedGrainsFor(trackGrainCount, trackDurationMs),
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
