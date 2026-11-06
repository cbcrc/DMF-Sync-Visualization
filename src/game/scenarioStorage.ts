// Persistence for user-saved scenarios and the autosaved working graph.
// Everything is defensive about what comes back out of localStorage: it may be
// missing, corrupt, or from a different version, and must never crash the app.

import type { Edge, Node } from 'reactflow';
import type { MediaFunctionKind } from '../types';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { MediaConfig } from '../engine/mxlGrainIndex';
import { mediaFromJson, mediaToJson, type MediaJson } from './mediaConfig';
import type { Scenario } from './scenarios';
import { DELAY_MAX_MS, LATENCY_RANGE } from '../components/canvas/nodeDefaults';
import { withoutCycles } from './connectionRules';

export const SAVED_SCENARIOS_KEY = 'dmf-sync-viz:scenarios:v1';
export const WORKING_GRAPH_KEY = 'dmf-sync-viz:working:v1';

/** `setItem` may report failure by returning false (see `safeStorage`) or by throwing (plain `Storage`). */
type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): unknown };

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

/** Most connectors any function has (the palette's largest is 4); guards against absurd counts in files. */
export const MAX_PORTS = 8;
const isPortCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_PORTS;

/** Clamps a stored latency to what the function's own slider allows (never negative). */
function clampLatency(kind: MediaFunctionKind, ms: number): number {
  if (kind === 'repeater') return 0; // Grain Repeaters are fixed at 0ms, including in scenarios saved earlier.
  const range = LATENCY_RANGE[kind];
  return Math.min(range?.max ?? DELAY_MAX_MS, Math.max(range?.min ?? 0, ms));
}

/** Reads per-input sync groups, upgrading the older `ignoreSyncInputs` list (those inputs were live). */
function sanitizeInputGroups(d: Record<string, unknown>, inputCount: number): { inputGroups?: number[] } {
  const groups = Array.from({ length: inputCount }, (_, i) => {
    const g = Array.isArray(d.inputGroups) ? d.inputGroups[i] : undefined;
    if (Number.isInteger(g) && (g as number) >= 0) return Math.min(g as number, 2);
    return Array.isArray(d.ignoreSyncInputs) && d.ignoreSyncInputs.includes(i) ? 0 : 1;
  });
  return groups.every((g) => g === 1) ? {} : { inputGroups: groups };
}

/** Keeps only the persistent fields of a node (drops live zone/processing state). */
export function sanitizeNode(raw: unknown): Node<MediaFunctionNodeData> | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.data) || !isRecord(raw.position)) return null;
  const d = raw.data;
  if (!KINDS.includes(d.kind as MediaFunctionKind) || typeof d.label !== 'string') return null;
  if (!isNum(d.latencyMs) || !isPortCount(d.inputCount) || !isPortCount(d.outputCount)) return null;
  if (!isNum(raw.position.x) || !isNum(raw.position.y)) return null;
  return {
    id: raw.id,
    type: 'mediaFunction',
    position: { x: raw.position.x, y: raw.position.y },
    data: {
      kind: d.kind as MediaFunctionKind,
      label: d.label,
      latencyMs: clampLatency(d.kind as MediaFunctionKind, d.latencyMs),
      inputCount: d.inputCount,
      outputCount: d.outputCount,
      ...(d.audioOnly === true ? { audioOnly: true } : {}),
      ...(d.videoOnly === true ? { videoOnly: true } : {}),
      ...(d.syncOutputs === true ? { syncOutputs: true } : {}),
      ...sanitizeInputGroups(d, d.inputCount as number),
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

/**
 * Sanitizes a graph: drops nodes that repeat an earlier id, edges whose
 * endpoints are missing, and edges that would close a loop.
 */
export function sanitizeGraph(
  rawNodes: unknown,
  rawEdges: unknown,
): { nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] } | null {
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  const ids = new Set<string>();
  const nodes = rawNodes
    .map(sanitizeNode)
    .filter((n): n is Node<MediaFunctionNodeData> => n !== null && !ids.has(n.id) && Boolean(ids.add(n.id)));
  const edges = withoutCycles(
    rawEdges.map(sanitizeEdge).filter((e): e is Edge => e !== null && ids.has(e.source) && ids.has(e.target)),
  );
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
    return storage.setItem(key, JSON.stringify(value)) !== false;
  } catch {
    return false; // storage full or unavailable
  }
}

/** `{ media }` when the raw value is a valid media object, else nothing (so the key is omitted). */
const mediaField = (raw: unknown): { media?: MediaConfig } => {
  const media = mediaFromJson(raw);
  return media ? { media } : {};
};

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
      ...mediaField(item.media),
      builtIn: false,
      savedAt: isNum(item.savedAt) ? item.savedAt : 0,
    });
  }
  return out;
}

export function persistSavedScenarios(storage: StorageLike, scenarios: SavedScenario[]): boolean {
  return writeJson(
    storage,
    SAVED_SCENARIOS_KEY,
    scenarios.map(({ media, ...rest }) => (media ? { ...rest, media: mediaToJson(media) } : rest)),
  );
}

/**
 * Builds a saved scenario from the live canvas. A non-blank name matching an
 * existing saved scenario (case-insensitive) replaces it; otherwise it is new.
 */
export function upsertScenario(
  existing: SavedScenario[],
  input: { title: string; description?: string; domainSizeMs: number; media?: MediaConfig; nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] },
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
    ...(input.media ? { media: input.media } : {}),
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
  if (!graph) return null;
  return { scenarioId: raw.scenarioId, domainSizeMs: raw.domainSizeMs, ...graph };
}

export function persistWorkingGraph(storage: StorageLike, working: WorkingGraph): boolean {
  const graph = sanitizeGraph(working.nodes, working.edges) ?? { nodes: [], edges: [] };
  return writeJson(storage, WORKING_GRAPH_KEY, { ...working, ...graph });
}

// ---- Sharing: export / import as a versioned JSON file ----

export const SCENARIO_FILE_FORMAT = 'dmf-sync-viz.scenarios';
/** Bump only for changes older readers can't handle; additive fields don't need it. */
export const SCENARIO_FILE_VERSION = 1;

export interface ScenarioFile {
  format: typeof SCENARIO_FILE_FORMAT;
  version: number;
  exportedAt: string;
  scenarios: {
    title: string;
    description: string;
    domainSizeMs: number;
    media?: MediaJson;
    nodes: Node<MediaFunctionNodeData>[];
    edges: Edge[];
  }[];
}

/** A scenario as read from a file: the same, but with media already parsed. */
export type ImportedScenario = Omit<ScenarioFile['scenarios'][number], 'media'> & { media?: MediaConfig };

/** Builds the shareable file contents. Always a list, so one scenario or many use one shape. */
export function buildScenarioFile(scenarios: SavedScenario[], now: Date = new Date()): ScenarioFile {
  return {
    format: SCENARIO_FILE_FORMAT,
    version: SCENARIO_FILE_VERSION,
    exportedAt: now.toISOString(),
    scenarios: scenarios.map(({ title, description, domainSizeMs, media, nodes, edges }) => ({
      title,
      description,
      domainSizeMs,
      ...(media ? { media: mediaToJson(media) } : {}),
      nodes,
      edges,
    })),
  };
}

export type ParsedScenarioFile = { ok: true; scenarios: ImportedScenario[] } | { ok: false; error: string };

/** Validates untrusted file text. Unknown fields are ignored so newer files still load. */
export function parseScenarioFile(text: string): ParsedScenarioFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isRecord(raw) || raw.format !== SCENARIO_FILE_FORMAT || !Array.isArray(raw.scenarios)) {
    return { ok: false, error: 'That file is not a DMF Sync Visualizer scenario export.' };
  }
  if (!isNum(raw.version) || raw.version > SCENARIO_FILE_VERSION) {
    return { ok: false, error: 'That file was made by a newer version of this tool. Update and try again.' };
  }
  const scenarios: ImportedScenario[] = [];
  for (const item of raw.scenarios) {
    if (!isRecord(item) || !isNum(item.domainSizeMs)) continue;
    const graph = sanitizeGraph(item.nodes, item.edges);
    if (!graph) continue;
    scenarios.push({
      title: (typeof item.title === 'string' ? item.title.trim().slice(0, 80) : '') || 'Imported scenario',
      description: typeof item.description === 'string' ? item.description.slice(0, 400) : '',
      domainSizeMs: Math.min(1000, Math.max(10, item.domainSizeMs)),
      ...mediaField(item.media),
      ...graph,
    });
  }
  return scenarios.length > 0 ? { ok: true, scenarios } : { ok: false, error: 'No usable scenarios found in that file.' };
}

/** Adds imported scenarios as new entries; a clashing name gets " (2)", " (3)"… so nothing is overwritten. */
export function mergeImported(
  existing: SavedScenario[],
  imported: ImportedScenario[],
  now: number = Date.now(),
): SavedScenario[] {
  const taken = new Set(existing.map((s) => s.title.toLowerCase()));
  const added = imported.map((s, i) => {
    let title = s.title;
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${s.title} (${n})`;
    taken.add(title.toLowerCase());
    return {
      ...s,
      title,
      id: `saved-${now}-${i}-${Math.floor(Math.random() * 1e6)}`,
      builtIn: false as const,
      savedAt: now,
    };
  });
  return [...existing, ...added];
}
