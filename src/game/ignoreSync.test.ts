import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { stepGrains } from './grainFlow';

const node = (id: string, data: Pick<MediaFunctionNodeData, 'kind' | 'latencyMs' | 'inputCount' | 'outputCount'> & Partial<MediaFunctionNodeData>): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (id: string, source: string, target: string, th: number): Edge => ({
  id,
  source,
  target,
  sourceHandle: 'out-0',
  targetHandle: `in-${th}`,
});

// `in` feeds mixer input 0 directly and input 1 through a 60ms function.
function build(ignore?: number[]) {
  const nodes = [
    node('in', { kind: 'input', latencyMs: 0, inputCount: 0, outputCount: 1 }),
    node('slow', { kind: 'editorial', latencyMs: 60, inputCount: 1, outputCount: 1 }),
    node('mix', { kind: 'editorial', latencyMs: 0, inputCount: 2, outputCount: 1, inputGroups: ignore }),
    node('out', { kind: 'output', latencyMs: 0, inputCount: 1, outputCount: 0 }),
  ];
  const edges = [edge('e1', 'in', 'mix', 0), edge('e2', 'in', 'slow', 0), edge('e3', 'slow', 'mix', 1), edge('e4', 'mix', 'out', 0)];
  return { nodes, edges };
}

describe('mixer live inputs (sync group 0)', () => {
  it('reads a synced input at the aligned position and an ignored one at its write head', () => {
    const lagOf = (ignore?: number[]) => {
      const { nodes, edges } = build(ignore);
      const readings = computeGraphLatency(nodes, edges, 100, 0).inputsByNodeId.get('mix')!;
      return readings.map((r) => r.buffer.alignedLagMs);
    };
    // A 60ms function also reads one grain (20ms) behind its input's head.
    expect(lagOf()).toEqual([80, 80]);
    expect(lagOf([0, 1])).toEqual([0, 80]); // input 0 reads its own head; input 1 is the only sync point
    const { nodes, edges } = build([1, 0]);
    const g = computeGraphLatency(nodes, edges, 100, 0);
    const [fast, slow] = g.inputsByNodeId.get('mix')!;
    expect(fast.buffer.alignedLagMs).toBe(0);
    expect(fast.buffer.stalenessMs).toBe(0);
    expect(slow.buffer.stalenessMs).toBe(0);
    expect(g.latencyByNodeId.get('mix')!.outputLatencyMs).toBe(20); // only the grain it reads behind
  });

  it('does not park a grain at an ignored input', () => {
    const { nodes, edges } = build([1, 0]);
    const spawns = new Map<string, number>();
    let grains = stepGrains([], 0, nodes, edges, spawns);
    for (let t = 1; t < 3000; t += 25) {
      grains = stepGrains(grains, t, nodes, edges, spawns);
      expect(grains.some((g) => g.phase === 'holding' && g.fromId === 'mix' && g.targetHandleIndex === 1)).toBe(false);
    }
  });

  it('aligns each sync group on its own', () => {
    const { nodes, edges } = build([1, 2]);
    const g = computeGraphLatency(nodes, edges, 100, 0);
    const [a, b] = g.inputsByNodeId.get('mix')!;
    // Alone in its group, each input reads at its own source's head.
    expect([a.buffer.alignedLagMs, b.buffer.alignedLagMs]).toEqual([0, 80]);
    expect(a.buffer.stalenessMs).toBe(0);
    expect(b.buffer.stalenessMs).toBe(0);
    expect(g.latencyByNodeId.get('mix')!.maxStalenessMs).toBe(0);
    // The node still can't write until its slowest group is ready.
    expect(g.latencyByNodeId.get('mix')!.outputLatencyMs).toBe(100);
  });

  it('releases a group without waiting for another group', () => {
    const releasedEarly = (groups?: number[]) => {
      const { nodes, edges } = build(groups);
      const spawns = new Map<string, number>();
      let grains = stepGrains([], 0, nodes, edges, spawns);
      for (let t = 1; t < 3000; t += 5) {
        grains = stepGrains(grains, t, nodes, edges, spawns);
        const aging = grains.some((x) => x.phase === 'holding' && x.fromId === 'mix' && x.targetHandleIndex === 0 && !x.parked);
        const otherArrived = grains.some((x) => x.phase === 'holding' && x.fromId === 'mix' && x.targetHandleIndex === 1);
        if (aging && !otherArrived) return true;
      }
      return false;
    };
    expect(releasedEarly()).toBe(false);
    expect(releasedEarly([1, 2])).toBe(true);
  });
});
