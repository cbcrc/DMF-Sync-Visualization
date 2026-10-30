import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import type { MediaFunctionNodeData } from './components/canvas/MediaFunctionNode';
import type { RingBufferStatus } from './types';
import { gaugeZone } from './engine/ringBufferEngine';
import { RingBufferPanel } from './components/ui/RingBufferPanel';
import { GameHud } from './components/ui/GameHud';
import { InfoPanel } from './components/ui/InfoPanel';
import { EndToEndTimeline } from './components/ui/EndToEndTimeline';
import { useGameLoop } from './game/useGameLoop';
import { useSimClock } from './game/useSimClock';
import { ScenariosPage } from './components/ui/ScenariosPage';
import { BUILTIN_SCENARIOS, DEFAULT_SCENARIO_ID, type Scenario } from './game/scenarios';
import {
  loadSavedScenarios,
  loadWorkingGraph,
  persistSavedScenarios,
  persistWorkingGraph,
  upsertScenario,
  type SavedScenario,
} from './game/scenarioStorage';
import { useHashRoute } from './game/useHashRoute';
import { groupReadingsByWriter } from './game/writerRings';
import './App.css';

function App() {
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

  const { graph, stability, resetStability } = useGameLoop(graphNodes, graphEdges, domainSizeMs, clock.getNow);

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
        nodes: graphNodes,
        edges: graphEdges,
      });
      if (!persistSavedScenarios(localStorage, list)) return false;
      setSavedScenarios(list);
      setLevelId(saved.id);
      return true;
    },
    [savedScenarios, domainSizeMs, graphNodes, graphEdges],
  );

  const handleDeleteScenario = useCallback(
    (id: string) => {
      const list = savedScenarios.filter((s) => s.id !== id);
      if (persistSavedScenarios(localStorage, list)) setSavedScenarios(list);
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

  return (
    <div className="app-root">
      <FlowCanvas
        onGraphChange={onGraphChange}
        zoneByNodeId={zoneByNodeId}
        statusByInputKey={statusByInputKey}
        inputsByNodeId={graph.inputsByNodeId}
        writerRings={writerRings}
        focusedNodeId={focusedNodeId}
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
        onSaveScenario={(title) => handleSaveScenario(title, '')}
      />
      <RingBufferPanel
        nodes={graphNodes}
        graph={graph}
        domainSizeMs={domainSizeMs}
        showRealGrainIndex={showRealGrainIndex}
        parkedInputKeys={parkedInputKeys}
        focusedNodeId={focusedNodeId}
        onFocusNode={setFocusedNodeId}
      />
      <GameHud
        level={level}
        onSelectLevel={handleSelectLevel}
        onOpenScenarios={() => navigate('scenarios')}
        domainSizeMs={domainSizeMs}
        onDomainSizeChange={setDomainSizeMs}
        totalWorkloadLatencyMs={graph.totalWorkloadLatencyMs}
        stabilityMarginMs={graph.stabilityMarginMs}
        stability={stability}
        onReset={handleReset}
        onRestartWave={handleRestartWave}
        lateInputs={lateInputs}
        nodeLabelById={nodeLabelById}
        showOriginTimestamps={showOriginTimestamps}
        onToggleOriginTimestamps={setShowOriginTimestamps}
        showRealGrainIndex={showRealGrainIndex}
        onToggleRealGrainIndex={setShowRealGrainIndex}
        playbackMode={clock.mode}
        onSetPlaybackMode={clock.setMode}
        onStep={() => manualStepRef.current()}
        onStepBack={() => manualBackRef.current()}
      />
      <EndToEndTimeline
        graph={graph}
        nodes={graphNodes}
        edges={graphEdges}
        focusedNodeId={focusedNodeId}
        onFocusNode={setFocusedNodeId}
      />
      <InfoPanel />
      {route === 'scenarios' && (
        <ScenariosPage
          scenarios={scenarios}
          activeScenarioId={level.id}
          onOpen={handleSelectLevel}
          onSave={handleSaveScenario}
          onDelete={handleDeleteScenario}
          onClose={() => navigate('canvas')}
        />
      )}
    </div>
  );
}

export default App;
