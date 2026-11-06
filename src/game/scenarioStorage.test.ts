import { describe, expect, it } from 'vitest';
import {
  buildScenarioFile,
  loadSavedScenarios,
  mergeImported,
  parseScenarioFile,
  loadWorkingGraph,
  persistSavedScenarios,
  persistWorkingGraph,
  upsertScenario,
  WORKING_GRAPH_KEY,
} from './scenarioStorage';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';

const initialNodes: Node<MediaFunctionNodeData>[] = [
  { id: 'a', type: 'mediaFunction', position: { x: 0, y: 0 }, data: { kind: 'input', label: 'A', latencyMs: 0, inputCount: 0, outputCount: 1 } },
  { id: 'b', type: 'mediaFunction', position: { x: 200, y: 0 }, data: { kind: 'output', label: 'B', latencyMs: 0, inputCount: 1, outputCount: 0 } },
];
const initialEdges: Edge[] = [{ id: 'a-b', source: 'a', sourceHandle: 'out-0', target: 'b', targetHandle: 'in-0' }];

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

  it('restores an emptied working graph instead of an older one', () => {
    const storage = memoryStorage();
    persistWorkingGraph(storage, { scenarioId: 's', domainSizeMs: 80, nodes: initialNodes, edges: initialEdges });
    persistWorkingGraph(storage, { scenarioId: 's', domainSizeMs: 80, nodes: [], edges: [] });
    expect(loadWorkingGraph(storage)).toEqual({ scenarioId: 's', domainSizeMs: 80, nodes: [], edges: [] });
  });

  it('upgrades the older ignoreSyncInputs list to live sync groups', () => {
    const mixer = (extra: object) => ({ id: 'm', position: { x: 0, y: 0 }, data: { kind: 'editorial', label: 'M', latencyMs: 0, inputCount: 2, outputCount: 1, ...extra } });
    const load = (extra: object) =>
      loadWorkingGraph(memoryStorage({ [WORKING_GRAPH_KEY]: JSON.stringify({ scenarioId: 's', domainSizeMs: 80, nodes: [mixer(extra)], edges: [] }) }))?.nodes[0].data.inputGroups;
    expect(load({ ignoreSyncInputs: [1] })).toEqual([1, 0]);
    expect(load({ inputGroups: [1, 2] })).toEqual([1, 2]);
    expect(load({})).toBeUndefined();
  });
});

describe('scenario export/import', () => {
  it('round-trips through the file format without overwriting same-named scenarios', () => {
    const { list } = upsertScenario([], { title: 'Mine', domainSizeMs: 80, nodes: initialNodes, edges: initialEdges }, 1);
    const parsed = parseScenarioFile(JSON.stringify(buildScenarioFile(list)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const merged = mergeImported(list, parsed.scenarios, 2);
    expect(merged.map((s) => s.title)).toEqual(['Mine', 'Mine (2)']);
    expect(new Set(merged.map((s) => s.id)).size).toBe(2);
    expect(merged[1].edges).toHaveLength(1);
  });

  it('rejects foreign or newer files and ignores unknown fields', () => {
    expect(parseScenarioFile('nope').ok).toBe(false);
    expect(parseScenarioFile('{"format":"other"}').ok).toBe(false);
    expect(parseScenarioFile(JSON.stringify({ format: 'dmf-sync-viz.scenarios', version: 99, scenarios: [] })).ok).toBe(false);
    const ok = parseScenarioFile(
      JSON.stringify({
        format: 'dmf-sync-viz.scenarios',
        version: 1,
        future: true,
        scenarios: [{ title: 'X', domainSizeMs: 50, nodes: initialNodes, edges: initialEdges, extra: 1 }],
      }),
    );
    expect(ok.ok).toBe(true);
  });
});

describe('scenario media format', () => {
  const media = { videoRate: { numerator: 60000, denominator: 1001 }, resolution: '3840x2160', audioSampleRate: 96000 };

  it('travels through storage, export and import', () => {
    const { list } = upsertScenario([], { title: 'UHD', domainSizeMs: 80, media, nodes: initialNodes, edges: initialEdges }, 1);
    const storage = memoryStorage();
    persistSavedScenarios(storage, list);
    expect(loadSavedScenarios(storage)[0].media).toEqual(media);

    const file = buildScenarioFile(list);
    expect(file.scenarios[0].media).toEqual({ frameRate: '60000/1001', resolution: '3840x2160', audioSampleRate: 96000 });
    const parsed = parseScenarioFile(JSON.stringify(file));
    expect(parsed.ok && parsed.scenarios[0].media).toEqual(media);
  });

  it('leaves media unset for older files without it', () => {
    const { list } = upsertScenario([], { title: 'Old', domainSizeMs: 80, nodes: initialNodes, edges: initialEdges }, 1);
    const parsed = parseScenarioFile(JSON.stringify(buildScenarioFile(list)));
    expect(parsed.ok && parsed.scenarios[0].media).toBeUndefined();
  });
});

describe('shared-scenarios folder', () => {
  it('only contains files that import cleanly', () => {
    const files = import.meta.glob('../../shared-scenarios/*.dmfsync.json', { query: '?raw', import: 'default', eager: true });
    for (const [name, text] of Object.entries(files)) {
      const parsed = parseScenarioFile(text as string);
      expect(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.error}`).toBe(true);
    }
  });
});

describe('import hardening', () => {
  const node = (id: string, extra: object = {}) => ({
    id,
    position: { x: 0, y: 0 },
    data: { kind: 'technical', label: id, latencyMs: 10, inputCount: 1, outputCount: 1, ...extra },
  });
  const file = (nodes: object[], edges: object[]) =>
    JSON.stringify({ format: 'dmf-sync-viz.scenarios', version: 1, scenarios: [{ title: 't', domainSizeMs: 200, nodes, edges }] });
  const importOne = (nodes: object[], edges: object[] = []) => {
    const parsed = parseScenarioFile(file(nodes, edges));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.scenarios[0];
  };

  it('drops the link that would close a loop', () => {
    const s = importOne(
      [node('a'), node('b')],
      [
        { id: 'ab', source: 'a', target: 'b', targetHandle: 'in-0' },
        { id: 'ba', source: 'b', target: 'a', targetHandle: 'in-0' },
      ],
    );
    expect(s.edges.map((e) => e.id)).toEqual(['ab']);
  });

  it('rejects nodes with fractional, negative or absurd connector counts', () => {
    const s = importOne([node('frac', { inputCount: 1.5 }), node('neg', { outputCount: -1 }), node('huge', { inputCount: 1e9 }), node('ok')]);
    expect(s.nodes.map((n) => n.id)).toEqual(['ok']);
  });

  it('clamps latency to the function slider range', () => {
    const s = importOne([node('low', { latencyMs: -500 }), node('high', { latencyMs: 1e6 }), node('out', { kind: 'output', latencyMs: -5, outputCount: 0 })]);
    expect(s.nodes.map((n) => n.data.latencyMs)).toEqual([1, 30, 0]);
  });

  it('keeps only the first node with a given id', () => {
    const s = importOne([node('a', { label: 'first' }), node('a', { label: 'second' })]);
    expect(s.nodes.map((n) => n.data.label)).toEqual(['first']);
  });
});
