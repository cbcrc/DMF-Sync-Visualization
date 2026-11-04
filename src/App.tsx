import type { ReactNode } from 'react';
import { DockItem } from './components/ui/DockItem';
import { COLLAPSED_DOCKS_KEY, DEFAULT_LAYOUT, DOCKS_KEY, MINIMIZED_KEY, loadCollapsedDocks, loadLayout, loadMinimized, movePane, type DockItemId, type DockSide } from './game/docks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import type { MediaFunctionNodeData } from './components/canvas/MediaFunctionNode';
import type { RingBufferStatus } from './types';
import { gaugeZone } from './engine/ringBufferEngine';
import { RingBufferPanel } from './components/ui/RingBufferPanel';
import { GameHud } from './components/ui/GameHud';
import { PaneToolbar, type PaneId } from './components/ui/PaneToolbar';
import { InfoPanel } from './components/ui/InfoPanel';
import { EndToEndTimeline } from './components/ui/EndToEndTimeline';
import { useGameLoop } from './game/useGameLoop';
import { useSimClock } from './game/useSimClock';
import { ScenariosPage } from './components/ui/ScenariosPage';
import { BUILTIN_SCENARIOS, DEFAULT_SCENARIO_ID, type Scenario } from './game/scenarios';
import {
  loadSavedScenarios,
  mergeImported,
  parseScenarioFile,
  loadWorkingGraph,
  persistSavedScenarios,
  persistWorkingGraph,
  upsertScenario,
  type SavedScenario,
} from './game/scenarioStorage';
import { useHashRoute } from './game/useHashRoute';
import { groupReadingsByWriter } from './game/writerRings';
import { PlaybackPane } from './components/ui/PlaybackPane';
import { WorkloadPane } from './components/ui/WorkloadPane';
import { ToolbarMenus } from './components/ui/ToolbarMenus';
import { ThemeToggle } from './components/ui/ThemeToggle';
import { MediaConfigContext, loadMediaConfig, persistMediaConfig } from './game/mediaConfig';
import './App.css';

/** [expanded, collapsed] chevrons pointing toward where the dock goes / comes from. */
const DOCK_CHEVRON: Record<DockSide, [string, string]> = {
  left: ['«', '»'],
  right: ['»', '«'],
  bottom: ['⌄', '⌃'],
};

const PANE_NAMES: Record<DockItemId, string> = {
  palette: 'Add Function',
  playback: 'Playback',
  workload: 'Workload Config',
  controls: 'Status',
  clock: 'Clock',
  rings: 'Ring Buffers',
  timeline: 'Timeline',
  help: 'Help',
};

function App() {
  const [layout, setLayout] = useState(() => loadLayout(localStorage));
  const dockPane = useCallback(
    (id: DockItemId, side: DockSide, beforeId: DockItemId | null = null) => setLayout((l) => movePane(l, id, side, beforeId)),
    [],
  );
  useEffect(() => localStorage.setItem(DOCKS_KEY, JSON.stringify(layout)), [layout]);
  const [dragId, setDragId] = useState<DockItemId | null>(null);
  const [paletteHost, setPaletteHost] = useState<HTMLElement | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [minimizedPanes, setMinimizedPanes] = useState<Set<PaneId>>(() => loadMinimized(localStorage, ALL_PANES, DEFAULT_MINIMIZED));
  useEffect(() => localStorage.setItem(MINIMIZED_KEY, JSON.stringify([...minimizedPanes])), [minimizedPanes]);
  const togglePane = useCallback((id: PaneId) => {
    setMinimizedPanes((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const [collapsedDocks, setCollapsedDocks] = useState<Set<DockSide>>(() => loadCollapsedDocks(localStorage));
  useEffect(() => localStorage.setItem(COLLAPSED_DOCKS_KEY, JSON.stringify([...collapsedDocks])), [collapsedDocks]);
  const toggleDock = useCallback((side: DockSide) => {
    setCollapsedDocks((prev) => {
      const next = new Set(prev);
      if (!next.delete(side)) next.add(side);
      return next;
    });
  }, []);
  const toggleAllDocks = useCallback(() => {
    setCollapsedDocks((prev) => (prev.size >= 3 ? new Set() : new Set<DockSide>(['left', 'bottom', 'right'])));
  }, []);
  const resetLayout = useCallback(() => {
    setCollapsedDocks(new Set());
    setLayout(DEFAULT_LAYOUT);
    setMinimizedPanes(new Set(DEFAULT_MINIMIZED));
  }, []);
  const minimize = (id: PaneId) => () => togglePane(id);
  const [graphNodes, setGraphNodes] = useState<Node<MediaFunctionNodeData>[]>([]);
  const [graphEdges, setGraphEdges] = useState<Edge[]>([]);
  const [route, navigate] = useHashRoute();
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(() => loadSavedScenarios(localStorage));
  const scenarios = useMemo<Scenario[]>(() => [...BUILTIN_SCENARIOS, ...savedScenarios], [savedScenarios]);
  // The autosaved canvas from the last session, if any, so a refresh keeps edits.
  const [restored] = useState(() => loadWorkingGraph(localStorage));
  const [levelId, setLevelId] = useState(restored?.scenarioId ?? DEFAULT_SCENARIO_ID);
  const level = useMemo(
    () => scenarios.find((s) => s.id === levelId) ?? BUILTIN_SCENARIOS[0],
    [scenarios, levelId],
  );
  const [domainSizeMs, setDomainSizeMs] = useState(restored?.domainSizeMs ?? level.domainSizeMs);
  const [initialGraph, setInitialGraph] = useState<{ nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] }>(() => restored ?? level);
  const [media, setMedia] = useState(() => loadMediaConfig(localStorage));
  useEffect(() => persistMediaConfig(localStorage, media), [media]);
  const [graphLoadKey, setGraphLoadKey] = useState(0);
  const [showOriginTimestamps, setShowOriginTimestamps] = useState(false);
  // Grain index mode: simplified count from 100 (default) vs. the real MXL index —
  // see `mxlGrainIndex.ts`'s `grainIndexForDisplay`.
  const [showRealGrainIndex, setShowRealGrainIndex] = useState(false);
  // Keyed `${nodeId}:${inputIndex}`, same keying as `statusByInputKey` — which reader
  // inputs currently have a grain parked on canvas waiting for a sync sibling, so the
  // Ring Buffer Telemetry panel can highlight the matching row (the two views of one event).
  const [parkedInputKeys, setParkedInputKeys] = useState<Set<string>>(new Set());
  // Reader function the player clicked (on the canvas, a ring pointer, or the side panel).
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  // Item #9: single shared simulated clock driving grain-flow animation, ring
  // buffer evaluation, and the stability fail-timer in lockstep.
  const clock = useSimClock();
  // FlowCanvas owns the grain-flow state that Manual mode's Step ▶ / ◀ Back
  // act on, so it hands this component those functions.
  const manualStepRef = useRef<() => void>(() => {});
  const manualBackRef = useRef<() => void>(() => {});
  const registerManualStep = useCallback((fn: () => void, back: () => void) => {
    manualStepRef.current = fn;
    manualBackRef.current = back;
  }, []);

  const onGraphChange = useCallback((nodes: Node<MediaFunctionNodeData>[], edges: Edge[]) => {
    setGraphNodes(nodes);
    setGraphEdges(edges);
  }, []);

  const { graph, stability, resetStability } = useGameLoop(graphNodes, graphEdges, domainSizeMs, clock.getNow, media);

  const zoneByNodeId = useMemo(() => {
    const map = new Map<string, 'green' | 'yellow' | 'red'>();
    for (const [id, { evaluation }] of graph.evaluations) {
      map.set(id, gaugeZone(evaluation));
    }
    return map;
  }, [graph]);

  // Keyed per input (`${nodeId}:${inputIndex}`) so only the offending branch's
  // grains shatter — at a sync node the slow branch is still reading fine.
  const statusByInputKey = useMemo(() => {
    const map = new Map<string, RingBufferStatus>();
    for (const readings of graph.inputsByNodeId.values()) {
      for (const reading of readings) {
        map.set(`${reading.readerNodeId}:${reading.inputIndex}`, reading.evaluation.status);
      }
    }
    return map;
  }, [graph]);

  const writerRings = useMemo(() => groupReadingsByWriter(graph), [graph]);

  const lateInputs = useMemo(
    () =>
      Array.from(graph.inputsByNodeId.values())
        .flat()
        .filter((reading) => reading.evaluation.status === 'TOO_LATE'),
    [graph],
  );
  const nodeLabelById = useMemo(
    () => new Map(graphNodes.map((n) => [n.id, n.data.label])),
    [graphNodes],
  );

  const [waveResetKey, setWaveResetKey] = useState(0);
  const handleRestartWave = useCallback(() => {
    setWaveResetKey((k) => k + 1);
  }, []);
  const handleSelectLevel = useCallback(
    (id: string) => {
      const selected = scenarios.find((s) => s.id === id);
      if (!selected) return;
      setLevelId(id);
      setDomainSizeMs(selected.domainSizeMs);
      if (selected.media) setMedia(selected.media);
      setInitialGraph({ nodes: selected.nodes, edges: selected.edges });
      setGraphLoadKey((k) => k + 1);
      resetStability();
      handleRestartWave();
      navigate('canvas');
    },
    [scenarios, resetStability, handleRestartWave, navigate],
  );

  const handleSaveScenario = useCallback(
    (title: string, description: string) => {
      const { list, saved } = upsertScenario(savedScenarios, {
        title,
        description,
        domainSizeMs,
        media,
        nodes: graphNodes,
        edges: graphEdges,
      });
      if (!persistSavedScenarios(localStorage, list)) return false;
      setSavedScenarios(list);
      setLevelId(saved.id);
      return true;
    },
    [savedScenarios, domainSizeMs, media, graphNodes, graphEdges],
  );

  const promptSaveScenario = () => {
    const title = window.prompt('Save scenario as (an existing name replaces it):');
    if (title === null) return;
    if (!title.trim()) return window.alert('Please enter a name.');
    if (!handleSaveScenario(title, '')) window.alert('Could not save: browser storage is full or unavailable.');
  };

  const handleDeleteScenario = useCallback(
    (id: string) => {
      const list = savedScenarios.filter((s) => s.id !== id);
      if (persistSavedScenarios(localStorage, list)) setSavedScenarios(list);
    },
    [savedScenarios],
  );

  const handleImportScenarios = useCallback(
    (text: string): { ok: boolean; text: string } => {
      const parsed = parseScenarioFile(text);
      if (!parsed.ok) return { ok: false, text: parsed.error };
      const list = mergeImported(savedScenarios, parsed.scenarios);
      if (!persistSavedScenarios(localStorage, list)) {
        return { ok: false, text: 'Could not import: browser storage is full or unavailable.' };
      }
      setSavedScenarios(list);
      const n = parsed.scenarios.length;
      return { ok: true, text: `Imported ${n} scenario${n === 1 ? '' : 's'}.` };
    },
    [savedScenarios],
  );

  // Autosave the working canvas (debounced) so new functions survive a refresh.
  useEffect(() => {
    if (graphNodes.length === 0) return;
    const timer = window.setTimeout(() => {
      persistWorkingGraph(localStorage, {
        scenarioId: levelId,
        domainSizeMs,
        nodes: graphNodes,
        edges: graphEdges,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [graphNodes, graphEdges, levelId, domainSizeMs]);

  const handleReset = useCallback(() => {
    resetStability();
    handleRestartWave();
  }, [resetStability, handleRestartWave]);

  const paneNodes: Record<DockItemId, ReactNode> = {
    palette: minimizedPanes.has('palette') ? null : <></>,
    playback: minimizedPanes.has('playback') ? null : (
        <PlaybackPane
          onMinimize={minimize('playback')}
          playbackMode={clock.mode}
          onSetPlaybackMode={clock.setMode}
          onStep={() => manualStepRef.current()}
          onStepBack={() => manualBackRef.current()}
          showRealGrainIndex={showRealGrainIndex}
          onToggleRealGrainIndex={setShowRealGrainIndex}
        />
    ),
    workload: minimizedPanes.has('workload') ? null : (
      <WorkloadPane
        onMinimize={minimize('workload')}
        domainSizeMs={domainSizeMs}
        onDomainSizeChange={setDomainSizeMs}
        media={media}
        onMediaChange={setMedia}
      />
    ),
    controls: minimizedPanes.has('controls') ? null : (
      <GameHud
        onMinimize={minimize('controls')}
        level={level}
        totalWorkloadLatencyMs={graph.totalWorkloadLatencyMs}
        stabilityMarginMs={graph.stabilityMarginMs}
        stability={stability}
        onReset={handleReset}
        onRestartWave={handleRestartWave}
        lateInputs={lateInputs}
        nodeLabelById={nodeLabelById}
      />
    ),
    clock: minimizedPanes.has('clock') ? null : (
      <RingBufferPanel
        nodes={graphNodes}
        graph={graph}
        domainSizeMs={domainSizeMs}
        showRealGrainIndex={showRealGrainIndex}
        parkedInputKeys={parkedInputKeys}
        focusedNodeId={focusedNodeId}
        onFocusNode={setFocusedNodeId}
        showClock
        showRings={false}
        onMinimizeClock={minimize('clock')}
        onMinimizeRings={minimize('rings')}
        getNow={clock.getNow}
      />
    ),
    rings: minimizedPanes.has('rings') ? null : (
      <RingBufferPanel
        nodes={graphNodes}
        graph={graph}
        domainSizeMs={domainSizeMs}
        showRealGrainIndex={showRealGrainIndex}
        parkedInputKeys={parkedInputKeys}
        focusedNodeId={focusedNodeId}
        onFocusNode={setFocusedNodeId}
        showClock={false}
        showRings
        onMinimizeClock={minimize('clock')}
        onMinimizeRings={minimize('rings')}
        getNow={clock.getNow}
      />
    ),
    timeline: minimizedPanes.has('timeline') ? null : (
      <EndToEndTimeline
        graph={graph}
        nodes={graphNodes}
        edges={graphEdges}
        focusedNodeId={focusedNodeId}
        onFocusNode={setFocusedNodeId}
        onMinimize={minimize('timeline')}
      />
    ),
    help: minimizedPanes.has('help') ? null : <InfoPanel onMinimize={minimize('help')} />,
  };

  const renderDock = (side: DockSide) => {
    // Falls back to defaults for panes missing from an older in-memory layout (e.g. after a hot reload).
    const order = [...layout.order, ...DEFAULT_LAYOUT.order.filter((id) => !layout.order.includes(id))];
    const ids = order.filter((id) => (layout.docks[id] ?? DEFAULT_LAYOUT.docks[id]) === side && paneNodes[id]);
    const collapsed = collapsedDocks.has(side);
    return (
      <div
        className={`dock dock--${side}${collapsed ? ' dock--collapsed' : ''}${dragId ? ' dock--droppable' : ''}`}
        title={ids.length === 0 ? `${side[0].toUpperCase()}${side.slice(1)} dock (empty): drag a pane here` : undefined}
        onDragOver={(e) => dragId && e.preventDefault()}
        onDrop={(e) => {
          if (!dragId) return;
          e.preventDefault();
          dockPane(dragId, side);
          setDragId(null);
          setCollapsedDocks((prev) => {
            if (!prev.has(side)) return prev;
            const next = new Set(prev);
            next.delete(side);
            return next;
          });
        }}
      >
        {ids.length > 0 && (
          <button
            type="button"
            className="dock__toggle"
            onClick={() => toggleDock(side)}
            aria-expanded={!collapsed}
            title={`${collapsed ? 'Expand' : 'Collapse'} ${side} panes`}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${side} panes`}
          >
            {DOCK_CHEVRON[side][collapsed ? 1 : 0]}
          </button>
        )}
        {collapsed && ids.length > 0 && (
          <div className="dock__rail">
            {ids.map((id) => (
              <button key={id} type="button" className="dock__rail-name" onClick={() => toggleDock(side)} title={`Expand ${side} panes`}>
                {PANE_NAMES[id]}
              </button>
            ))}
          </div>
        )}
        {ids.map((id, i) => (
          <DockItem
            key={id}
            id={id}
            side={side}
            nextId={ids[i + 1] ?? null}
            onDock={(to) => dockPane(id, to)}
            dragId={dragId}
            onDragId={setDragId}
            onDropBefore={(from, before) => dockPane(from, side, before)}
            title={PANE_NAMES[id]}
            grow={id === 'timeline'}
            bodyRef={id === 'palette' ? setPaletteHost : undefined}
          >
            {paneNodes[id]}
          </DockItem>
        ))}
      </div>
    );
  };

  return (
    <MediaConfigContext.Provider value={media}>
    <div className="app-root">
      <div className="app-toolbar" ref={setToolbarHost} />
      <div className="app-body">
      {renderDock('left')}
      <div className="app-center">
        <div className="app-canvas">
      <FlowCanvas
        onGraphChange={onGraphChange}
        zoneByNodeId={zoneByNodeId}
        statusByInputKey={statusByInputKey}
        inputsByNodeId={graph.inputsByNodeId}
        writerRings={writerRings}
        focusedNodeId={focusedNodeId}
        menus={
          <>
          <ThemeToggle />
          <ToolbarMenus
            level={level}
            onSelectLevel={handleSelectLevel}
            onOpenScenarios={() => navigate('scenarios')}
            onSaveScenario={promptSaveScenario}
            showOriginTimestamps={showOriginTimestamps}
            onToggleOriginTimestamps={setShowOriginTimestamps}
          />
          </>
        }
        paneToolbar={<PaneToolbar minimized={minimizedPanes} onToggle={togglePane} onResetLayout={resetLayout} allDocksCollapsed={collapsedDocks.size >= 3} onToggleAllDocks={toggleAllDocks} />}
        toolbarHost={toolbarHost}
        paletteHost={minimizedPanes.has('palette') ? null : paletteHost}
        onMinimizePalette={minimize('palette')}
        onFocusNode={setFocusedNodeId}
        initialGraph={initialGraph}
        graphLoadKey={graphLoadKey}
        waveResetKey={waveResetKey}
        showOriginTimestamps={showOriginTimestamps}
        showRealGrainIndex={showRealGrainIndex}
        domainSizeMs={domainSizeMs}
        getNow={clock.getNow}
        onParkedInputsChange={setParkedInputKeys}
        stepClockBy={clock.step}
        onManualStepReady={registerManualStep}
      />
        </div>
        {renderDock('bottom')}
      </div>
      {renderDock('right')}
      </div>
      {route === 'scenarios' && (
        <ScenariosPage
          scenarios={scenarios}
          activeScenarioId={level.id}
          onOpen={handleSelectLevel}
          onSave={handleSaveScenario}
          onDelete={handleDeleteScenario}
          onImport={handleImportScenarios}
          onClose={() => navigate('canvas')}
        />
      )}
    </div>
    </MediaConfigContext.Provider>
  );
}

/** Panes shown on first visit: Add functions, Playback, Clock and Rings; the rest start minimized. Later visits restore the saved state. */
const DEFAULT_MINIMIZED: PaneId[] = ['workload', 'controls', 'timeline', 'help'];
const ALL_PANES: PaneId[] = ['palette', 'playback', 'workload', 'controls', 'clock', 'rings', 'timeline', 'help'];

export default App;
