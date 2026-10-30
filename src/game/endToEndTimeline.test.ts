import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { buildEndToEndTimeline } from './endToEndTimeline';

const node = (id: string, kind: MediaFunctionNodeData['kind'], latencyMs: number, inputCount: number, outputCount: number): Node<MediaFunctionNodeData> => ({
  id,
  type: 'mediaFunction',
  position: { x: 0, y: 0 },
  data: { label: id, kind, latencyMs, inputCount, outputCount },
});
const edge = (source: string, target: string, th = 0): Edge => ({
  id: `${source}-${target}-${th}`,
  source,
  target,
  sourceHandle: 'out-0',
  targetHandle: `in-${th}`,
});

function timeline(nodes: Node<MediaFunctionNodeData>[], edges: Edge[], options?: Parameters<typeof buildEndToEndTimeline>[3]) {
  return buildEndToEndTimeline(computeGraphLatency(nodes, edges, 100, 0), nodes, edges, options);
}

describe('end-to-end timeline', () => {
  it('lays a serial chain end to end with each read position', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('a', 'editorial', 30, 1, 1), node('b', 'technical', 20, 1, 1), node('out', 'output', 0, 1, 0)];
    const [row] = timeline(nodes, [edge('in', 'a'), edge('a', 'b'), edge('b', 'out')]);
    expect(row.steps.map((s) => [s.nodeId, s.startMs, s.endMs, s.readAtMs])).toEqual([
      ['in', 0, 0, 0],
      ['a', 0, 50, 0],
      ['b', 50, 90, 50],
      ['out', 90, 90, 90],
    ]);
    // Each function also reads one 20ms grain behind its input's write head.
    expect(row.totalMs).toBe(90);
    expect(row.leadInMs).toBe(0);
  });

  it('follows the slowest branch into a mixer', () => {
    const nodes = [
      node('in', 'input', 0, 0, 1),
      node('slow', 'editorial', 60, 1, 1),
      node('mix', 'editorial', 10, 2, 1),
      node('out', 'output', 0, 1, 0),
    ];
    const [row] = timeline(nodes, [edge('in', 'mix', 0), edge('in', 'slow'), edge('slow', 'mix', 1), edge('mix', 'out')]);
    expect(row.steps.map((s) => s.nodeId)).toEqual(['in', 'slow', 'mix', 'out']);
    expect(row.totalMs).toBe(110);
  });

  it('keeps counting through a Profanity Delay, which resets the MXL read lag', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('pd', 'delay', 1500, 1, 1), node('out', 'output', 0, 1, 0)];
    const [row] = timeline(nodes, [edge('in', 'pd'), edge('pd', 'out')]);
    expect(row.totalMs).toBe(1500);
    expect(row.steps[2].readAtMs).toBe(0);
  });

  it('shifts the axis by an OTS lead-in when one is supplied', () => {
    const nodes = [node('in', 'input', 0, 0, 1), node('a', 'editorial', 30, 1, 1), node('out', 'output', 0, 1, 0)];
    const edges = [edge('in', 'a'), edge('a', 'out')];
    const [row] = timeline(nodes, edges, { leadInMsBySourceId: new Map([['in', 25]]) });
    expect(row.leadInMs).toBe(25);
    expect(row.steps[1]).toMatchObject({ startMs: 25, endMs: 75 });
    expect(row.totalMs).toBe(75);
  });
});
