import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from './graphLatency';
import { groupReadingsByWriter } from './writerRings';

const node = (id: string, kind: MediaFunctionNodeData['kind'], inputCount: number, outputCount: number, latencyMs: number) =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { kind, label: id, latencyMs, inputCount, outputCount },
  }) as Node<MediaFunctionNodeData>;

const edge = (source: string, target: string, targetInput = 0): Edge => ({
  id: `${source}-${target}-${targetInput}`,
  source,
  sourceHandle: 'out-0',
  target,
  targetHandle: `in-${targetInput}`,
});

describe('groupReadingsByWriter', () => {
  it('draws one ring per writer with every reader on it, fanned into lanes', () => {
    const nodes = [
      node('src', 'input', 0, 1, 0),
      node('a', 'technical', 1, 1, 0),
      node('b', 'recording', 1, 0, 0),
    ];
    const edges = [edge('src', 'a'), edge('src', 'b')];
    const graph = computeGraphLatency(nodes, edges, 100, 1_000_000);
    const rings = groupReadingsByWriter(graph);

    const ring = rings.find((r) => r.writerNodeId === 'src')!;
    expect(ring.readers.map((r) => r.readerNodeId)).toEqual(['a', 'b']);
    // identical timing -> same slot -> distinct lanes
    expect(ring.readers[0].requestedSlot).toBe(ring.readers[1].requestedSlot);
    expect(ring.readers.map((r) => r.lane)).toEqual([0, 1]);
  });

  it('computes the now slot from the clock and the lag to the head', () => {
    const nodes = [node('src', 'input', 0, 1, 0), node('a', 'technical', 1, 1, 0), node('b', 'recording', 1, 0, 40)];
    const edges = [edge('src', 'a'), edge('a', 'b')];
    const graph = computeGraphLatency(nodes, edges, 100, 1_000_020);
    const ringA = groupReadingsByWriter(graph).find((r) => r.writerNodeId === 'a')!;
    expect(ringA.nowGrainIndex).toBe(Math.floor(1_000_020 / 20));
    expect(ringA.nowSlot).toBe(ringA.nowGrainIndex % ringA.grainCount);
    expect(ringA.lagGrains).toBe(ringA.nowGrainIndex - ringA.publishedGrainIndex);
  });

  it('gives every output a ring even when nothing reads it', () => {
    const nodes = [node('src', 'input', 0, 2, 0), node('a', 'technical', 1, 1, 0)];
    const rings = groupReadingsByWriter(computeGraphLatency(nodes, [edge('src', 'a')], 100, 1_000_000));

    const unread = rings.filter((r) => r.readers.length === 0);
    expect(unread.map((r) => `${r.writerNodeId}:${r.track}`).sort()).toEqual(['a:video', 'src:audio']);
    expect(unread.find((r) => r.writerNodeId === 'src')!.handleId).toBe('out-1');
  });
});
