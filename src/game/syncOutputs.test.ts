import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { stepGrains } from './grainFlow';

const node = (id: string, data: Partial<MediaFunctionNodeData> & Pick<MediaFunctionNodeData, 'kind' | 'latencyMs' | 'inputCount' | 'outputCount'>): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target, sourceHandle: 'out-0', targetHandle: 'in-0' });

function graph(sync: boolean) {
  const nodes = [
    node('in', { kind: 'input', latencyMs: 0, inputCount: 0, outputCount: 1 }),
    node('slow', { kind: 'editorial', latencyMs: 60, inputCount: 1, outputCount: 1 }),
    node('out-fast', { kind: 'output', latencyMs: 0, inputCount: 1, outputCount: 0, syncOutputs: sync || undefined }),
    node('out-slow', { kind: 'output', latencyMs: 0, inputCount: 1, outputCount: 0, syncOutputs: sync || undefined }),
  ];
  const edges = [edge('e1', 'in', 'out-fast'), edge('e2', 'in', 'slow'), edge('e3', 'slow', 'out-slow')];
  return { nodes, edges };
}

describe('synced outputs', () => {
  it('aligns every synced output to the slowest one', () => {
    const lag = (sync: boolean) => {
      const { nodes, edges } = graph(sync);
      return computeGraphLatency(nodes, edges, 100, 0).inputsByNodeId.get('out-fast')![0].buffer.alignedLagMs;
    };
    expect(lag(false)).toBe(0);
    expect(lag(true)).toBe(80); // 60ms plus the grain it reads behind
  });

  it('holds a fast output parked until the synced slow output has arrived', () => {
    const run = (sync: boolean) => {
      const { nodes, edges } = graph(sync);
      const spawns = new Map<string, number>();
      let grains = stepGrains([], 0, nodes, edges, spawns);
      for (let t = 1; t < 5000; t += 50) {
        grains = stepGrains(grains, t, nodes, edges, spawns);
        const fast = grains.find((g) => g.phase === 'holding' && g.fromId === 'out-fast');
        const slow = grains.find((g) => g.phase === 'holding' && g.fromId === 'out-slow');
        if (fast && !slow) return fast.parked;
      }
      return undefined;
    };
    expect(run(false)).toBe(false);
    expect(run(true)).toBe(true);
  });
});

describe('audio/video-only functions keep their media type', () => {
  it('writes and reads the fixed track even without a wired input', () => {
    const nodes = [
      node('proc', { kind: 'technical', latencyMs: 2, inputCount: 1, outputCount: 1, audioOnly: true }),
      node('vid', { kind: 'editorial', latencyMs: 30, inputCount: 3, outputCount: 1, videoOnly: true }),
      node('sink', { kind: 'output', latencyMs: 0, inputCount: 1, outputCount: 0, audioOnly: true }),
    ];
    const state = computeGraphLatency(nodes, [edge('e', 'proc', 'sink')], 100, 0);
    const track = (id: string) => state.writerFlows.find((f) => f.writerNodeId === id)?.track;
    expect(track('proc')).toBe('audio');
    expect(track('vid')).toBe('video');
    expect(state.inputsByNodeId.get('sink')![0].track).toBe('audio');
  });
});
