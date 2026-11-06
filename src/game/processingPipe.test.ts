import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { groupReadingsByWriter } from './writerRings';
import { advanceDisplayClock, computeProcessingPipe, extrapolatePipe, PIPE_MAX_CHIPS, processingPipesByNode, STEP_REPLAY_MS_PER_GRAIN } from './processingPipe';

const fps50 = { numerator: 50, denominator: 1 };
const node = (id: string, kind: MediaFunctionNodeData['kind'], latencyMs: number, inputCount: number, outputCount: number): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, kind, latencyMs, inputCount, outputCount, videoOnly: kind === 'input' ? true : undefined },
});
const edge = (source: string, target: string, th = 0): Edge => ({
  id: `${source}-${target}-${th}`,
  source,
  target,
  sourceHandle: 'out-0',
  targetHandle: `in-${th}`,
});

function pipeAt(nodes: Node<MediaFunctionNodeData>[], edges: Edge[], id: string, clockMs: number) {
  const rings = groupReadingsByWriter(computeGraphLatency(nodes, edges, 200, clockMs));
  return processingPipesByNode(nodes, rings, clockMs).get(id)!;
}

describe('processing pipe', () => {
  it('shows the grains in flight between the read index and the output head', () => {
    // 20 ms grains, 30 ms latency: read 120 at t=0, write it at t=30.
    const pipe = computeProcessingPipe({
      readIndex: 120, writeIndex: 118, clockMs: 2420, outputLagMs: 50, latencyMs: 30, grainRate: fps50, track: 'video',
    });
    expect(pipe.chips.map((c) => c.index)).toEqual([120, 119]);
    expect(pipe.chips[0].progress).toBeCloseTo(0); // just read
    expect(pipe.chips[1].progress).toBeCloseTo(20 / 30); // read 20 ms ago, written in 10 ms
  });

  it('writes each grain with the index it read, after its latency', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('f', 'technical', 30, 1, 1), node('out', 'output', 0, 1, 0)];
    const edges = [edge('in', 'f'), edge('f', 'out')];
    const start = 1_000_000;
    // Find the moment the function starts reading some grain k...
    let t = start;
    const k = pipeAt(nodes, edges, 'f', t).readIndex + 1;
    while (pipeAt(nodes, edges, 'f', t).readIndex < k) t += 1;
    expect(pipeAt(nodes, edges, 'f', t).chips[0]).toMatchObject({ index: k, progress: 0 });
    // ...it is still in flight just before its latency is up...
    expect(pipeAt(nodes, edges, 'f', t + 29).writeIndex).toBe(k - 1);
    expect(pipeAt(nodes, edges, 'f', t + 29).chips.some((c) => c.index === k)).toBe(true);
    // ...and is written as k, not renumbered, once it is.
    expect(pipeAt(nodes, edges, 'f', t + 30).writeIndex).toBe(k);
    expect(pipeAt(nodes, edges, 'f', t + 30).chips.some((c) => c.index === k)).toBe(false);
  });

  it('reads and writes the same index at once with no latency', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('f', 'technical', 0, 1, 1), node('out', 'output', 0, 1, 0)];
    const pipe = pipeAt(nodes, [edge('in', 'f'), edge('f', 'out')], 'f', 1_000_010);
    expect(pipe.readIndex).toBe(pipe.writeIndex);
    expect(pipe.chips).toEqual([]);
  });

  it('draws the newest and the oldest grain and counts the rest for long latencies', () => {
    const pipe = computeProcessingPipe({
      readIndex: 130, writeIndex: 119, clockMs: 2620, outputLagMs: 240, latencyMs: 220, grainRate: fps50, track: 'video',
    });
    expect(pipe.chips).toHaveLength(PIPE_MAX_CHIPS);
    expect(pipe.chips.map((c) => c.index)).toEqual([130, 129, 128, 127, 126, 120]);
    expect(pipe.hiddenCount).toBe(11 - PIPE_MAX_CHIPS);
  });

  it('has no pipe for a Profanity Delay or a Grain Repeater', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('pd', 'delay', 1500, 1, 1), node('out', 'output', 0, 1, 0)];
    const rings = groupReadingsByWriter(computeGraphLatency(nodes, [edge('in', 'pd'), edge('pd', 'out')], 200, 1_000_000));
    expect(processingPipesByNode(nodes, rings, 1_000_000).has('pd')).toBe(false);
  });

  it('moves on smoothly between ticks and lands where the next snapshot is', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('f', 'editorial', 90, 1, 1), node('out', 'output', 0, 1, 0)];
    const edges = [edge('in', 'f'), edge('f', 'out')];
    const t = 1_000_003;
    const snap = pipeAt(nodes, edges, 'f', t);
    expect(extrapolatePipe(snap, t)).toBe(snap);
    for (let dt = 1; dt <= 50; dt++) {
      const moved = extrapolatePipe(snap, t + dt);
      const next = pipeAt(nodes, edges, 'f', t + dt);
      expect([moved.readIndex, moved.writeIndex]).toEqual([next.readIndex, next.writeIndex]);
      expect(moved.chips.map((c) => [c.index, c.progress])).toEqual(next.chips.map((c) => [c.index, c.progress]));
    }
    // A chip still in flight advances by elapsed / latency.
    const chip = snap.chips[0];
    const later = extrapolatePipe(snap, t + 9).chips.find((c) => c.index === chip.index)!;
    expect(later.progress - chip.progress).toBeCloseTo(9 / 90);
  });
});

describe('display clock', () => {
  const grain = 20;
  it('follows the clock while it runs', () => {
    let d = advanceDisplayClock(undefined, 1000, 0, grain, false);
    d = advanceDisplayClock(d, 1033, 33, grain, false);
    expect(d).toEqual({ shownMs: 1033 });
  });

  it('holds still in Manual mode between steps', () => {
    let d = advanceDisplayClock(undefined, 1016, 0, grain, true);
    d = advanceDisplayClock(d, 1016, 500, grain, true);
    expect(d).toEqual({ shownMs: 1016 });
  });

  it('replays a Manual step slowly and ends on the new time', () => {
    let d = advanceDisplayClock(undefined, 1000, 0, grain, true);
    d = advanceDisplayClock(d, 1020, 100, grain, true); // step: one grain
    expect(d.shownMs).toBe(1000);
    d = advanceDisplayClock(d, 1020, 100 + STEP_REPLAY_MS_PER_GRAIN / 2, grain, true);
    expect(d.shownMs).toBeCloseTo(1010);
    d = advanceDisplayClock(d, 1020, 100 + STEP_REPLAY_MS_PER_GRAIN, grain, true);
    expect(d).toEqual({ shownMs: 1020 });
  });

  it('continues from where it is when stepped again mid-replay', () => {
    let d = advanceDisplayClock(undefined, 1000, 0, grain, true);
    d = advanceDisplayClock(d, 1020, 0, grain, true);
    d = advanceDisplayClock(d, 1020, STEP_REPLAY_MS_PER_GRAIN / 2, grain, true); // at 1010
    d = advanceDisplayClock(d, 1040, STEP_REPLAY_MS_PER_GRAIN / 2, grain, true); // step again
    expect(d.shownMs).toBeCloseTo(1010);
    expect(d.replay?.toMs).toBe(1040);
  });

  it('snaps on a step back', () => {
    let d = advanceDisplayClock(undefined, 1000, 0, grain, true);
    d = advanceDisplayClock(d, 980, 10, grain, true);
    expect(d).toEqual({ shownMs: 980 });
  });
});
