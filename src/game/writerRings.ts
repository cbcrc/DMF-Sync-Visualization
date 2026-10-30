import type { GrainRate, RingBufferStatus } from '../types';
import { grainIndexToRingBufferIndex, timestampToGrainIndex } from '../engine/mxlGrainIndex';
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
  reading: InputReading;
}

/** One writer flow's ring, with every reader that consumes it. */
export interface WriterRing {
  /** `${writerNodeId}:${track}`. */
  key: string;
  writerNodeId: string;
  track: Track;
  /** The writer's output handle that feeds this ring. */
  handleId: string;
  grainRate: GrainRate;
  grainDurationMs: number;
  grainCount: number;
  retainedGrains: number;
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
 * Regroups the per-input readings by the writer flow they read, so one ring
 * can show every reader of that writer. Output order follows first appearance
 * in `graph.inputsByNodeId`; readers are sorted by key so lanes are stable.
 */
export function groupReadingsByWriter(graph: GraphBufferState): WriterRing[] {
  const byWriter = new Map<string, InputReading[]>();
  for (const readings of graph.inputsByNodeId.values()) {
    for (const reading of readings) {
      const key = `${reading.sourceNodeId}:${reading.track}`;
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
      const slot = reading.buffer.requestedRingBufferIndex;
      const lane = laneCount.get(slot) ?? 0;
      laneCount.set(slot, lane + 1);
      return {
        key: readerKey(reading),
        readerNodeId: reading.readerNodeId,
        inputIndex: reading.inputIndex,
        status: reading.evaluation.status,
        requestedGrainIndex: reading.buffer.requestedGrainIndex,
        requestedSlot: slot,
        behindHeadGrains: reading.evaluation.deltaGrains,
        behindNowGrains: nowGrainIndex - reading.buffer.requestedGrainIndex,
        lane,
        reading,
      };
    });
    const lagGrains = nowGrainIndex - buffer.publishedGrainIndex;
    rings.push({
      key,
      writerNodeId: buffer.sourceNodeId,
      track: readings[0].track,
      handleId: graph.writerFlows.find((f) => `${f.writerNodeId}:${f.track}` === key)?.handleId ?? 'out-0',
      grainRate: buffer.grainRate,
      grainDurationMs: buffer.grainDurationMs,
      grainCount: buffer.grainCount,
      retainedGrains: buffer.retainedGrains,
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
    const key = `${flow.writerNodeId}:${flow.track}`;
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
  const order = new Map(graph.writerFlows.map((f, i) => [`${f.writerNodeId}:${f.track}`, i]));
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
