// Scenario catalogue: the built-in scenarios (level metadata + starting graph)
// plus the shape shared with user-saved scenarios (see `scenarioStorage.ts`).

import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { LEVELS, type Level } from './levels';

/**
 * Starter pipeline — the minimal MXL workload, matching the reference
 * ingress/egress flowchart. One paced external stream enters an Ingress
 * Function, which writes two flows into the domain: V1 (video) and A1 (audio).
 * Video takes a longer processing path than audio, and an Egress Function
 * re-pairs them for output.
 *
 * Deliberately small and healthy: at a 100ms domain the video branch lags 30ms
 * and audio 2ms, so the Egress absorbs a 28ms differential well inside the
 * retained history. Build outward from here — add Media Functions to the video
 * path and watch the differential grow until the audio input goes red.
 */
export const initialNodes: Node<MediaFunctionNodeData>[] = [
  {
    id: 'ingress',
    type: 'mediaFunction',
    position: { x: 0, y: 230 },
    // Two outputs: one paced external stream becomes flows V1 and A1.
    data: { kind: 'input', label: 'Ingress Function', latencyMs: 0, inputCount: 0, outputCount: 2 },
  },
  {
    id: 'video-fast',
    type: 'mediaFunction',
    position: { x: 320, y: 90 },
    data: { kind: 'technical', label: 'Fast Video Function', latencyMs: 10, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'video-slow',
    type: 'mediaFunction',
    position: { x: 590, y: 80 },
    data: { kind: 'editorial', label: 'Slow Video Function', latencyMs: 20, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'audio-fast',
    type: 'mediaFunction',
    position: { x: 340, y: 430 },
    data: { kind: 'technical', label: 'Ultra-Fast Audio Function', latencyMs: 2, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'egress',
    type: 'mediaFunction',
    position: { x: 900, y: 240 },
    // Two inputs: re-pairs V1b and A1a at a common grain index before output.
    data: { kind: 'output', label: 'Egress Function', latencyMs: 5, inputCount: 2, outputCount: 0 },
  },
];

/** Flow names ride on the edges so the preserved-index story is readable. */
export const initialEdges: Edge[] = [
  { id: 'ing-video', source: 'ingress', sourceHandle: 'out-0', target: 'video-fast', targetHandle: 'in-0', label: 'V1' },
  { id: 'video-fast-slow', source: 'video-fast', sourceHandle: 'out-0', target: 'video-slow', targetHandle: 'in-0', label: 'V1a' },
  { id: 'video-slow-egress', source: 'video-slow', sourceHandle: 'out-0', target: 'egress', targetHandle: 'in-0', label: 'V1b' },
  { id: 'ing-audio', source: 'ingress', sourceHandle: 'out-1', target: 'audio-fast', targetHandle: 'in-0', label: 'A1' },
  { id: 'audio-egress', source: 'audio-fast', sourceHandle: 'out-0', target: 'egress', targetHandle: 'in-1', label: 'A1a' },
];

/**
 * Level 4 challenge graph — the classic MXL A/V sync overrun.
 *
 * A single Ingress Function takes one paced external stream and writes two
 * flows into the domain: V1 (video) and A1 (audio). They share a timestamp
 * origin, which is exactly why the Egress Function must later re-pair them.
 *
 * Video is processed twice (V1 -> V1a -> V1b), audio once (A1 -> A1a). Every
 * Media Function preserves the original grain index: V1b grain T *is* V1 grain
 * T, just published 82ms later. So the Egress can only emit grain T once the
 * slow video branch has published it — and by then the audio flow, running
 * only 2ms behind real time, has moved 80ms (4 grains) past T and recycled
 * that slot. Result: READ TOO LATE on the audio input, while the video input
 * reads happily at its own head.
 */
export const avSyncNodes: Node<MediaFunctionNodeData>[] = [
  {
    id: 'av-ingress',
    type: 'mediaFunction',
    position: { x: 0, y: 250 },
    // Two outputs: one paced external stream becomes flows V1 and A1.
    data: { kind: 'input', label: 'Ingress Function', latencyMs: 0, inputCount: 0, outputCount: 2 },
  },
  {
    id: 'av-vfast',
    type: 'mediaFunction',
    position: { x: 300, y: 70 },
    data: { kind: 'technical', label: 'Fast Video Function', latencyMs: 10, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'av-vslow',
    type: 'mediaFunction',
    position: { x: 570, y: 50 },
    data: { kind: 'editorial', label: 'Slow Video Function', latencyMs: 72, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'av-afast',
    type: 'mediaFunction',
    position: { x: 320, y: 480 },
    data: { kind: 'technical', label: 'Ultra-Fast Audio Function', latencyMs: 2, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'av-egress',
    type: 'mediaFunction',
    position: { x: 930, y: 250 },
    // Two inputs: re-pairs V1b and A1a at a common grain index before output.
    data: { kind: 'output', label: 'Egress Function', latencyMs: 5, inputCount: 2, outputCount: 0 },
  },
];

/** Flow names ride on the edges so the preserved-index story is readable. */
export const avSyncEdges: Edge[] = [
  { id: 'av-ing-vfast', source: 'av-ingress', sourceHandle: 'out-0', target: 'av-vfast', targetHandle: 'in-0', label: 'V1' },
  { id: 'av-vfast-vslow', source: 'av-vfast', sourceHandle: 'out-0', target: 'av-vslow', targetHandle: 'in-0', label: 'V1a' },
  { id: 'av-vslow-egress', source: 'av-vslow', sourceHandle: 'out-0', target: 'av-egress', targetHandle: 'in-0', label: 'V1b' },
  { id: 'av-ing-afast', source: 'av-ingress', sourceHandle: 'out-1', target: 'av-afast', targetHandle: 'in-0', label: 'A1' },
  { id: 'av-afast-egress', source: 'av-afast', sourceHandle: 'out-0', target: 'av-egress', targetHandle: 'in-1', label: 'A1a' },
];

/**
 * Level 5: one writer (V1), five readers at different points in time. The
 * recorder and the two branch functions read V1's head; each mixer also reads
 * V1 on its second input, but must wait for its slower branch, so it asks for
 * an older grain (Mix A ~25ms back, Mix B ~50ms back).
 */
export const manyNodes: Node<MediaFunctionNodeData>[] = [
  {
    id: 'many-ingress',
    type: 'mediaFunction',
    position: { x: 0, y: 260 },
    data: { kind: 'input', label: 'Ingress Function', latencyMs: 0, inputCount: 0, outputCount: 1 },
  },
  {
    id: 'many-proxy',
    type: 'mediaFunction',
    position: { x: 320, y: 480 },
    data: { kind: 'recording', label: 'Proxy Recorder', latencyMs: 0, inputCount: 1, outputCount: 0 },
  },
  {
    id: 'many-mid',
    type: 'mediaFunction',
    position: { x: 320, y: 60 },
    data: { kind: 'technical', label: 'Mid Function', latencyMs: 25, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'many-slow',
    type: 'mediaFunction',
    position: { x: 320, y: 270 },
    data: { kind: 'editorial', label: 'Slow Function', latencyMs: 50, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'many-mixa',
    type: 'mediaFunction',
    position: { x: 640, y: 90 },
    data: { kind: 'editorial', label: 'Mix A', latencyMs: 5, inputCount: 2, outputCount: 1 },
  },
  {
    id: 'many-mixb',
    type: 'mediaFunction',
    position: { x: 640, y: 330 },
    data: { kind: 'editorial', label: 'Mix B', latencyMs: 5, inputCount: 2, outputCount: 1 },
  },
  {
    id: 'many-egress',
    type: 'mediaFunction',
    position: { x: 960, y: 220 },
    data: { kind: 'output', label: 'Egress Function', latencyMs: 5, inputCount: 2, outputCount: 0 },
  },
];

export const manyEdges: Edge[] = [
  { id: 'many-ing-proxy', source: 'many-ingress', sourceHandle: 'out-0', target: 'many-proxy', targetHandle: 'in-0', label: 'V1' },
  { id: 'many-ing-mid', source: 'many-ingress', sourceHandle: 'out-0', target: 'many-mid', targetHandle: 'in-0', label: 'V1' },
  { id: 'many-ing-slow', source: 'many-ingress', sourceHandle: 'out-0', target: 'many-slow', targetHandle: 'in-0', label: 'V1' },
  { id: 'many-ing-mixa', source: 'many-ingress', sourceHandle: 'out-0', target: 'many-mixa', targetHandle: 'in-1', label: 'V1' },
  { id: 'many-ing-mixb', source: 'many-ingress', sourceHandle: 'out-0', target: 'many-mixb', targetHandle: 'in-1', label: 'V1' },
  { id: 'many-mid-mixa', source: 'many-mid', sourceHandle: 'out-0', target: 'many-mixa', targetHandle: 'in-0', label: 'V1a' },
  { id: 'many-slow-mixb', source: 'many-slow', sourceHandle: 'out-0', target: 'many-mixb', targetHandle: 'in-0', label: 'V1b' },
  { id: 'many-mixa-egress', source: 'many-mixa', sourceHandle: 'out-0', target: 'many-egress', targetHandle: 'in-0', label: 'MA' },
  { id: 'many-mixb-egress', source: 'many-mixb', sourceHandle: 'out-0', target: 'many-egress', targetHandle: 'in-1', label: 'MB' },
];

/** A scenario is a level's metadata plus the graph it starts from. */
export interface Scenario extends Level {
  nodes: Node<MediaFunctionNodeData>[];
  edges: Edge[];
  /** Built-in scenarios ship with the app; saved ones live in localStorage. */
  builtIn: boolean;
}

/** Starting graph per built-in level id; levels not listed start from the starter pipeline. */
const BUILTIN_GRAPHS: Record<string, { nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] }> = {
  'av-sync-overrun': { nodes: avSyncNodes, edges: avSyncEdges },
  'many-readers': { nodes: manyNodes, edges: manyEdges },
  'blank-canvas': { nodes: [], edges: [] },
};

/** Each writer now has a ring buffer node beside it, so the authored layouts need more horizontal room. */
const RING_SPREAD_X = 1.5;
const spreadForRings = (nodes: Node<MediaFunctionNodeData>[]): Node<MediaFunctionNodeData>[] =>
  nodes.map((n) => ({ ...n, position: { ...n.position, x: n.position.x * RING_SPREAD_X } }));

export const BUILTIN_SCENARIOS: Scenario[] = LEVELS.map((level) => {
  const graph = BUILTIN_GRAPHS[level.id] ?? { nodes: initialNodes, edges: initialEdges };
  return { ...level, nodes: spreadForRings(graph.nodes), edges: graph.edges, builtIn: true };
});

export const DEFAULT_SCENARIO_ID = BUILTIN_SCENARIOS[0].id;
