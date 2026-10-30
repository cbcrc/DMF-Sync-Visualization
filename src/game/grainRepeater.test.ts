import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';

const node = (id: string, kind: MediaFunctionNodeData['kind'], latencyMs: number, inputCount: number, outputCount: number): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, kind, latencyMs, inputCount, outputCount },
});
const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  sourceHandle: 'out-0',
  targetHandle: 'in-0',
});

describe('grain repeater', () => {
  it('re-writes into a fresh ring: lag resets, workload keeps counting', () => {
    const nodes = [
      node('in', 'input', 0, 0, 1),
      node('slow', 'editorial', 60, 1, 1),
      node('rep', 'repeater', 0, 1, 1),
      node('out', 'output', 0, 1, 0),
    ];
    const edges = [edge('e1', 'in', 'slow'), edge('e2', 'slow', 'rep'), edge('e3', 'rep', 'out')];
    const g = computeGraphLatency(nodes, edges, 100, 0);
    const repFlow = g.writerFlows.filter((f) => f.writerNodeId === 'rep');
    expect(repFlow.length).toBeGreaterThan(0);
    expect(repFlow.every((f) => f.lagMs === 0)).toBe(true);
    // The repeater reads the oldest retained grain, so that history counts as latency.
    const read = g.inputsByNodeId.get('rep')![0];
    expect(read.buffer.readsTail).toBe(true);
    expect(read.evaluation.status).toBe('OK');
    expect(read.buffer.stalenessMs).toBe(read.buffer.retainedMs);
    expect(g.totalWorkloadLatencyMs).toBe(60 + read.buffer.retainedMs);
  });
});
