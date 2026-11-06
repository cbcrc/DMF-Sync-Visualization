import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';

describe('computeGraphLatency with a loop', () => {
  it('does not recurse forever when a graph already contains a loop', () => {
    const fn = (id: string): Node<MediaFunctionNodeData> => ({
      id,
      type: 'mediaFunction',
      position: { x: 0, y: 0 },
      data: { kind: 'technical', label: id, latencyMs: 10, inputCount: 1, outputCount: 1 },
    });
    const edges: Edge[] = [
      { id: 'ab', source: 'a', target: 'b', targetHandle: 'in-0' },
      { id: 'ba', source: 'b', target: 'a', targetHandle: 'in-0' },
    ];
    expect(() => computeGraphLatency([fn('a'), fn('b')], edges, 200, 1_000_000)).not.toThrow();
  });
});
