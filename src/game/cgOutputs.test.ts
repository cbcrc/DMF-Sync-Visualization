import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { groupReadingsByWriter } from './writerRings';

const node = (id: string, kind: MediaFunctionNodeData['kind'], inputCount: number, outputCount: number, videoOnly = false): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, kind, latencyMs: 0, inputCount, outputCount, ...(videoOnly ? { videoOnly: true } : {}) },
});
const edge = (id: string, handle: number, target: string): Edge => ({
  id,
  source: 'cg',
  target,
  sourceHandle: `out-${handle}`,
  targetHandle: 'in-0',
});

describe('CG with two video outputs', () => {
  it('writes two video flows at the same index and time', () => {
    const nodes = [node('cg', 'synthetic', 0, 2, true), node('a', 'output', 1, 0), node('b', 'output', 1, 0)];
    const g = computeGraphLatency(nodes, [edge('e0', 0, 'a'), edge('e1', 1, 'b')], 100, 123_456);
    const flows = g.writerFlows.filter((f) => f.writerNodeId === 'cg');
    expect(flows.map((f) => f.track)).toEqual(['video', 'video']);
    expect(new Set(flows.map((f) => f.flowKey)).size).toBe(2);
    expect(flows[0].publishedGrainIndex).toBe(flows[1].publishedGrainIndex);
    expect(flows[0].lagMs).toBe(flows[1].lagMs);
    expect(groupReadingsByWriter(g).filter((r) => r.writerNodeId === 'cg').map((r) => r.handleId).sort()).toEqual(['out-0', 'out-1']);
  });
});
