import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { timestampToGrainIndex } from '../engine/mxlGrainIndex';

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
  it('writes the oldest grain it read, with the same index, at its new head', () => {
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
    const read = g.inputsByNodeId.get('rep')![0];
    // The grain it consumed is the one at its new write head.
    for (const f of repFlow) {
      expect(timestampToGrainIndex(0 - f.lagMs)).toBe(read.buffer.requestedGrainIndex);
    }
    // The age it read (retained history + the grain being written) counts as latency.
    expect(read.buffer.readsTail).toBe(true);
    expect(read.evaluation.status).toBe('OK');
    expect(read.buffer.stalenessMs).toBe(read.buffer.retainedMs);
    expect(g.totalWorkloadLatencyMs).toBe(60 + read.buffer.retainedMs + read.buffer.grainDurationMs);
    expect(g.inputsByNodeId.get('out')![0].evaluation.status).toBe('OK');
  });
});
