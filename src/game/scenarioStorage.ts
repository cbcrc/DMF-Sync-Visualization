// Persistence for user-saved scenarios and the autosaved working graph.
// Everything is defensive about what comes back out of localStorage: it may be
// missing, corrupt, or from a different version, and must never crash the app.

import type { Edge, Node } from 'reactflow';
import type { MediaFunctionKind } from '../types';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { Scenario } from './scenarios';

export const SAVED_SCENARIOS_KEY = 'dmf-sync-viz:scenarios:v1';
export const WORKING_GRAPH_KEY = 'dmf-sync-viz:working:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface SavedScenario extends Omit<Scenario, 'builtIn'> {
  builtIn: false;
  savedAt: number;
}

/** The autosaved canvas, so refreshing the page doesn't lose edits. */
export interface WorkingGraph {
  scenarioId: string;
  domainSizeMs: number;
  nodes: Node<MediaFunctionNodeData>[];
  edges: Edge[];
}

const KINDS: MediaFunctionKind[] = ['input', 'synthetic', 'editorial', 'technical', 'recording', 'repeater', 'delay', 'output'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Keeps only the persistent fields of a node (drops live zone/processing state). */
export function sanitizeNode(raw: unknown): Node<MediaFunctionNodeData> | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.data) || !isRecord(raw.position)) return null;
  const d = raw.data;
  if (!KINDS.includes(d.kind as MediaFunctionKind) || typeof d.label !== 'string') return null;
  if (!isNum(d.latencyMs) || !isNum(d.inputCount) || !isNum(d.outputCount)) return null;
  if (!isNum(raw.position.x) || !isNum(raw.position.y)) return null;
  return {
    id: raw.id,
    type: 'mediaFunction',
    position: { x: raw.position.x, y: raw.position.y },
    data: {
      kind: d.kind as MediaFunctionKind,
      label: d.label,
      // Grain Repeaters are fixed at 0ms, including in scenarios saved earlier.
      latencyMs: d.kind === 'repeater' ? 0 : d.latencyMs,
      inputCount: d.inputCount,
      outputCount: d.outputCount,
      ...(d.audioOnly === true ? { audioOnly: true } : {}),
      ...(d.videoOnly === true ? { videoOnly: true } : {}),
      ...(d.syncOutputs === true ? { syncOutputs: true } : {}),
      ...(Array.isArray(d.ignoreSyncInputs) && d.ignoreSyncInputs.some((i) => Number.isInteger(i))
        ? { ignoreSyncInputs: d.ignoreSyncInputs.filter((i): i is number => Number.isInteger(i)) }
        : {}),
    },
  };
}

export function sanitizeEdge(raw: unknown): Edge | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.source !== 'string' || typeof raw.target !== 'string') {
    return null;
  }
  const edge: Edge = { id: raw.id, source: raw.source, target: raw.target };
  if (typeof raw.sourceHandle === 'string') edge.sourceHandle = raw.sourceHandle;
  if (typeof raw.targetHandle === 'string') edge.targetHandle = raw.targetHandle;
  if (typeof raw.label === 'string') edge.label = raw.label;
  return edge;
}

/** Sanitizes a graph and drops edges whose endpoints are missing. */
export function sanitizeGraph(
  rawNodes: unknown,
  rawEdges: unknown,
): { nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] } | null {
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  const nodes = rawNodes.map(sanitizeNode).filter((n): n is Node<MediaFunctionNodeData> => n !== null);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = rawEdges
    .map(sanitizeEdge)
    .filter((e): e is Edge => e !== null && ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const text = storage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or unavailable
  }
}

export function loadSavedScenarios(storage: StorageLike): SavedScenario[] {
  const raw = readJson(storage, SAVED_SCENARIOS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: SavedScenario[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') continue;
    if (!isNum(item.domainSizeMs)) continue;
    const graph = sanitizeGraph(item.nodes, item.edges);
    if (!graph) continue;
    out.push({
      id: item.id,
      title: item.title,
      description: typeof item.description === 'string' ? item.description : '',
      domainSizeMs: item.domainSizeMs,
      ...graph,
      builtIn: false,
      savedAt: isNum(item.savedAt) ? item.savedAt : 0,
    });
  }
  return out;
}

export function persistSavedScenarios(storage: StorageLike, scenarios: SavedScenario[]): boolean {
  return writeJson(storage, SAVED_SCENARIOS_KEY, scenarios);
}

/**
 * Builds a saved scenario from the live canvas. A non-blank name matching an
 * existing saved scenario (case-insensitive) replaces it; otherwise it is new.
 */
export function upsertScenario(
  existing: SavedScenario[],
  input: { title: string; description?: string; domainSizeMs: number; nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] },
  now: number = Date.now(),
): { list: SavedScenario[]; saved: SavedScenario } {
  const title = input.title.trim() || 'Untitled scenario';
  const graph = sanitizeGraph(input.nodes, input.edges) ?? { nodes: [], edges: [] };
  const match = existing.find((s) => s.title.toLowerCase() === title.toLowerCase());
  const saved: SavedScenario = {
    id: match?.id ?? `saved-${now}-${Math.floor(Math.random() * 1e6)}`,
    title,
    description: input.description?.trim() ?? match?.description ?? '',
    domainSizeMs: input.domainSizeMs,
    ...graph,
    builtIn: false,
    savedAt: now,
  };
  const list = match ? existing.map((s) => (s.id === match.id ? saved : s)) : [...existing, saved];
  return { list, saved };
}

export function loadWorkingGraph(storage: StorageLike): WorkingGraph | null {
  const raw = readJson(storage, WORKING_GRAPH_KEY);
  if (!isRecord(raw) || typeof raw.scenarioId !== 'string' || !isNum(raw.domainSizeMs)) return null;
  const graph = sanitizeGraph(raw.nodes, raw.edges);
  if (!graph || graph.nodes.length === 0) return null;
  return { scenarioId: raw.scenarioId, domainSizeMs: raw.domainSizeMs, ...graph };
}

export function persistWorkingGraph(storage: StorageLike, working: WorkingGraph): boolean {
  const graph = sanitizeGraph(working.nodes, working.edges) ?? { nodes: [], edges: [] };
  return writeJson(storage, WORKING_GRAPH_KEY, { ...working, ...graph });
}
