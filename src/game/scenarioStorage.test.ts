import { describe, expect, it } from 'vitest';
import {
  loadSavedScenarios,
  loadWorkingGraph,
  persistSavedScenarios,
  persistWorkingGraph,
  upsertScenario,
  WORKING_GRAPH_KEY,
} from './scenarioStorage';
import { initialEdges, initialNodes } from './scenarios';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('scenarioStorage', () => {
  it('saves, replaces by case-insensitive name, and round-trips', () => {
    const storage = memoryStorage();
    const a = upsertScenario([], { title: 'My Test', domainSizeMs: 80, nodes: initialNodes, edges: initialEdges }, 1);
    const b = upsertScenario(a.list, { title: 'my test', description: 'x', domainSizeMs: 40, nodes: initialNodes, edges: [] }, 2);
    expect(b.list).toHaveLength(1);
    expect(b.saved.id).toBe(a.saved.id);
    expect(persistSavedScenarios(storage, b.list)).toBe(true);
    const loaded = loadSavedScenarios(storage);
    expect(loaded[0].domainSizeMs).toBe(40);
    expect(loaded[0].nodes).toHaveLength(initialNodes.length);
  });

  it('survives corrupt data and drops invalid nodes/dangling edges', () => {
    expect(loadSavedScenarios(memoryStorage({ 'dmf-sync-viz:scenarios:v1': '{nope' }))).toEqual([]);
    const storage = memoryStorage({
      [WORKING_GRAPH_KEY]: JSON.stringify({
        scenarioId: 's',
        domainSizeMs: 80,
        nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { kind: 'input', label: 'A', latencyMs: 0, inputCount: 0, outputCount: 1 } }, { id: 'bad' }],
        edges: [{ id: 'e', source: 'a', target: 'bad' }],
      }),
    });
    const w = loadWorkingGraph(storage);
    expect(w?.nodes).toHaveLength(1);
    expect(w?.edges).toHaveLength(0);
  });

  it('rejects an empty working graph', () => {
    const storage = memoryStorage();
    persistWorkingGraph(storage, { scenarioId: 's', domainSizeMs: 80, nodes: [], edges: [] });
    expect(loadWorkingGraph(storage)).toBeNull();
  });
});
