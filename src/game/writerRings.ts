import type { AlignedRead, GrainRate, RingBufferStatus } from '../types';
import { grainDurationMs, grainIndexToRingBufferIndex, grainIndexToTimestampMs, sampleIndexAt, timestampToGrainIndex } from '../engine/mxlGrainIndex';
import { READ_BEHIND_WRITE_GRAINS } from '../engine/ringBufferEngine';
import type { GraphBufferState, InputReading, Track } from './graphLatency';

/** One reader's position in a writer's ring. */
export interface WriterReader {
  /** `${readerNodeId}:${inputIndex}` — stable across frames, used for keys and lane order. */
  key: string;
  readerNodeId: string;
  inputIndex: number;
  status: RingBufferStatus;
  requestedGrainIndex: number;
  requestedSlot: number;
  /** Whole grains between the writer's published head and this reader's request. */
  behindHeadGrains: number;
  /** Whole grains between "now" and this reader's request. */
  behindNowGrains: number;
  /**
   * 0-based lane among readers that share this reader's slot, so several
   * readers on one slot fan out instead of overprinting each other.
   */
  lane: number;
  /**
   * Where the reader sits in the ring, in grains behind the write head
   * (1 = newest readable). Shared by the linear strip and the circular ring so
   * both draw the reader on the same grain. `null` when too late: the grain it
   * asked for has been overwritten, so it has no slot. A too-early reader waits
   * at age 1.
   */
  ringAge: number | null;
  /** Physical slot at `ringAge`, or `null` when too late. */
  ringSlot: number | null;
  /**
   * How many grains (commit batches) the reader consumes per read, ending at its
   * read index. For an MXL continuous (audio) flow a read is an arbitrary window
   * of samples, so this is drawn as a span. It is the aligned video grain's worth
   * of audio at a sync point, otherwise one batch.
   */
  windowGrains: number;
  /**
   * An audio read aligned to a video grain (`AlignedRead`): its exact samples,
   * as fractional ages behind the write head (`from` = older edge, `to` =
   * newer edge; a batch at age `a` spans `a` to `a - 1`).
   */
  exactWindow?: { fromAge: number; toAge: number };
  /** A video reader whose grain an audio sibling reads alongside, by timestamp. */
  pairedWithAudio: boolean;
  reading: InputReading;
}

/** One writer flow's ring, with every reader that consumes it. */
export interface WriterRing {
  /** See `flowKeyOf` in graphLatency. */
  key: string;
  writerNodeId: string;
  track: Track;
  /** The writer's output handle that feeds this ring. */
  handleId: string;
  grainRate: GrainRate;
  grainDurationMs: number;
  grainCount: number;
  retainedGrains: number;
  /** Oldest readable age behind the head; ages beyond it (up to `grainCount - 1`) are writer-reserved. */
  readableOldestAge: number;
  publishedGrainIndex: number;
  publishedSlot: number;
  nowGrainIndex: number;
  nowSlot: number;
  /** `nowGrainIndex - publishedGrainIndex`: the flow's accumulated latency, in grains. */
  lagGrains: number;
  lagMs: number;
  readers: WriterReader[];
}

/**
 * Where video grains begin on an audio ring, as fractional batch indices, while a
 * reader is time-aligned to video. Each boundary is the video grain's timestamp
 * converted to a sample index (`sampleIndexAt`), so at 1001-based frame rates
 * the spacing follows the real 1602/1601-sample cadence.
 */
export function videoBoundaryGrains(ring: WriterRing): number[] {
  const read = alignedReadOf(ring);
  if (!read) return [];
  const perBatch = (read.sampleRate * ring.grainDurationMs) / 1000;
  const frameMs = grainDurationMs(read.videoRate);
  const oldestMs = grainIndexToTimestampMs(ring.publishedGrainIndex - ring.grainCount, ring.grainRate);
  const newestMs = grainIndexToTimestampMs(ring.publishedGrainIndex + 1, ring.grainRate);
  const out: number[] = [];
  for (let j = Math.ceil(oldestMs / frameMs); j * frameMs <= newestMs; j += 1) {
    out.push(sampleIndexAt(grainIndexToTimestampMs(j, read.videoRate), read.sampleRate) / perBatch);
  }
  return out;
}

function alignedReadOf(ring: WriterRing): AlignedRead | undefined {
  if (ring.track !== 'audio') return undefined;
  return ring.readers.find((r) => r.reading.buffer.alignedRead)?.reading.buffer.alignedRead;
}

export function readableOldestAgeOf(grainCount: number, retainedGrains: number): number {
  return Math.min(Math.max(grainCount - 1, 0), retainedGrains + READ_BEHIND_WRITE_GRAINS);
}

function windowGrainsOf(reading: InputReading, batchMs: number): number {
  const read = reading.buffer.alignedRead;
  if (!read) return 1;
  const perBatch = (read.sampleRate * batchMs) / 1000;
  return Math.floor(read.lastSample / perBatch) - Math.floor(read.firstSample / perBatch) + 1;
}

function exactWindowOf(reading: InputReading, batchMs: number): WriterReader['exactWindow'] {
  const read = reading.buffer.alignedRead;
  if (!read) return undefined;
  const perBatch = (read.sampleRate * batchMs) / 1000;
  const head = reading.buffer.publishedGrainIndex;
  return { fromAge: head - read.firstSample / perBatch, toAge: head - (read.lastSample + 1) / perBatch };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Regroups the per-input readings by the writer flow they read, so one ring
 * can show every reader of that writer. Output order follows first appearance
 * in `graph.inputsByNodeId`; readers are sorted by key so lanes are stable.
 */
export function groupReadingsByWriter(graph: GraphBufferState): WriterRing[] {
  const byWriter = new Map<string, InputReading[]>();
  for (const readings of graph.inputsByNodeId.values()) {
    for (const reading of readings) {
      const key = reading.flowKey;
      const list = byWriter.get(key);
      if (list) list.push(reading);
      else byWriter.set(key, [reading]);
    }
  }

  const rings: WriterRing[] = [];
  for (const [key, readings] of byWriter) {
    const { buffer } = readings[0];
    const nowGrainIndex = timestampToGrainIndex(graph.timestampMs, buffer.grainRate);
    const sorted = [...readings].sort((a, b) =>
      readerKey(a) < readerKey(b) ? -1 : readerKey(a) > readerKey(b) ? 1 : 0,
    );
    const laneCount = new Map<number, number>();
    const readers = sorted.map((reading): WriterReader => {
      const status = reading.evaluation.status;
      const ringAge =
        status === 'TOO_LATE'
          ? null
          : Math.min(Math.max(reading.evaluation.deltaGrains + READ_BEHIND_WRITE_GRAINS, 1), Math.max(buffer.grainCount - 1, 1));
      const laneKey = ringAge === null ? -1 : ringAge;
      const lane = laneCount.get(laneKey) ?? 0;
      laneCount.set(laneKey, lane + 1);
      return {
        key: readerKey(reading),
        readerNodeId: reading.readerNodeId,
        inputIndex: reading.inputIndex,
        status: reading.evaluation.status,
        requestedGrainIndex: reading.buffer.requestedGrainIndex,
        requestedSlot: reading.buffer.requestedRingBufferIndex,
        behindHeadGrains: reading.evaluation.deltaGrains,
        behindNowGrains: nowGrainIndex - reading.buffer.requestedGrainIndex,
        lane,
        ringAge,
        windowGrains: windowGrainsOf(reading, buffer.grainDurationMs),
        ...(reading.buffer.alignedRead ? { exactWindow: exactWindowOf(reading, buffer.grainDurationMs) } : {}),
        pairedWithAudio: reading.track === 'video' && reading.alignmentSpanMs !== undefined,
        ringSlot: ringAge === null ? null : mod(buffer.publishedRingBufferIndex - ringAge, buffer.grainCount),
        reading,
      };
    });
    const lagGrains = nowGrainIndex - buffer.publishedGrainIndex;
    rings.push({
      key,
      writerNodeId: buffer.sourceNodeId,
      track: readings[0].track,
      handleId: graph.writerFlows.find((f) => f.flowKey === key)?.handleId ?? 'out-0',
      grainRate: buffer.grainRate,
      grainDurationMs: buffer.grainDurationMs,
      grainCount: buffer.grainCount,
      retainedGrains: buffer.retainedGrains,
      readableOldestAge: readableOldestAgeOf(buffer.grainCount, buffer.retainedGrains),
      publishedGrainIndex: buffer.publishedGrainIndex,
      publishedSlot: buffer.publishedRingBufferIndex,
      nowGrainIndex,
      nowSlot: grainIndexToRingBufferIndex(nowGrainIndex, buffer.grainCount),
      lagGrains,
      lagMs: buffer.branchLagMs,
      readers,
    });
  }

  // Every flow has a ring, even with no readers: the writer fills it regardless.
  for (const flow of graph.writerFlows) {
    const key = flow.flowKey;
    if (byWriter.has(key)) continue;
    const nowGrainIndex = timestampToGrainIndex(graph.timestampMs, flow.grainRate);
    rings.push({
      key,
      writerNodeId: flow.writerNodeId,
      track: flow.track,
      handleId: flow.handleId,
      grainRate: flow.grainRate,
      grainDurationMs: flow.grainDurationMs,
      grainCount: flow.grainCount,
      retainedGrains: flow.retainedGrains,
      readableOldestAge: readableOldestAgeOf(flow.grainCount, flow.retainedGrains),
      publishedGrainIndex: flow.publishedGrainIndex,
      publishedSlot: flow.publishedSlot,
      nowGrainIndex,
      nowSlot: grainIndexToRingBufferIndex(nowGrainIndex, flow.grainCount),
      lagGrains: nowGrainIndex - flow.publishedGrainIndex,
      lagMs: flow.lagMs,
      readers: [],
    });
  }

  // Keep each writer's rings in output order (video, then audio), not reader-first.
  const order = new Map(graph.writerFlows.map((f, i) => [f.flowKey, i]));
  return rings.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

function readerKey(r: InputReading): string {
  return `${r.readerNodeId}:${r.inputIndex}`;
}

const STATUS_TEXT: Record<RingBufferStatus, string> = { OK: 'OK', TOO_EARLY: 'waiting', TOO_LATE: 'too late' };

/** Tooltip text describing where one reader sits relative to its writer's head and "now". */
export function readerTitle(reader: WriterReader, labelByNodeId: Map<string, string>): string {
  const name = labelByNodeId.get(reader.readerNodeId) ?? reader.readerNodeId;
  return `${name} · input ${reader.inputIndex} · reads grain ${reader.requestedGrainIndex} (slot ${reader.requestedSlot + 1}) · ${reader.behindHeadGrains} behind head, ${reader.behindNowGrains} behind now · ${STATUS_TEXT[reader.status]}`;
}
