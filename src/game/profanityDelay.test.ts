import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { stepGrains } from './grainFlow';

const node = (id: string, data: Pick<MediaFunctionNodeData, 'kind' | 'latencyMs' | 'inputCount' | 'outputCount'>): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (id: string, source: string, sh: number, target: string, th: number): Edge => ({
  id,
  source,
  target,
  sourceHandle: `out-${sh}`,
  targetHandle: `in-${th}`,
});

const nodes = [
  node('in', { kind: 'input', latencyMs: 0, inputCount: 0, outputCount: 2 }),
  node('delay', { kind: 'delay', latencyMs: 2000, inputCount: 2, outputCount: 2 }),
  node('out', { kind: 'output', latencyMs: 0, inputCount: 2, outputCount: 0 }),
];
const edges = [
  edge('v1', 'in', 0, 'delay', 0),
  edge('a1', 'in', 1, 'delay', 1),
  edge('v2', 'delay', 0, 'out', 0),
  edge('a2', 'delay', 1, 'out', 1),
];

describe('profanity delay', () => {
  it('rewrites video and audio as fresh flows but still counts the delay as latency', () => {
    const g = computeGraphLatency(nodes, edges, 100, 0);
    const flows = g.writerFlows.filter((f) => f.writerNodeId === 'delay');
    expect(flows.map((f) => f.track).sort()).toEqual(['audio', 'video']);
    expect(flows.every((f) => f.lagMs === 0)).toBe(true);
    expect(g.inputsByNodeId.get('out')!.every((r) => r.evaluation.status === 'OK')).toBe(true);
    expect(g.totalWorkloadLatencyMs).toBe(2000);
  });

  it('keeps video on out-0 and audio on out-1, restamping the grains', () => {
    const spawns = new Map<string, number>();
    let grains = stepGrains([], 0, nodes, edges, spawns);
    const seen: { edgeId?: string; originTs?: number }[] = [];
    for (let t = 1; t < 6000; t += 25) {
      grains = stepGrains(grains, t, nodes, edges, spawns);
      for (const g of grains) {
        if (g.phase === 'traveling' && g.fromId === 'delay') seen.push({ edgeId: g.edgeId, originTs: g.originTs });
      }
      if (seen.length >= 2) break;
    }
    expect(new Set(seen.map((s) => s.edgeId))).toEqual(new Set(['v2', 'a2']));
    expect(seen.every((s) => (s.originTs ?? 0) > 0)).toBe(true);
  });
});
