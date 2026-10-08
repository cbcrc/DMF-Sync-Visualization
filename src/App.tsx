import { useCallback, useMemo, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import type { MediaFunctionNodeData } from './components/canvas/MediaFunctionNode';
import type { RingBufferStatus } from './types';
import { gaugeZone } from './engine/ringBufferEngine';
import { RingBufferPanel } from './components/ui/RingBufferPanel';
import { GameHud } from './components/ui/GameHud';
import { InfoPanel } from './components/ui/InfoPanel';
import { useGameLoop } from './game/useGameLoop';
import { LEVELS, DEFAULT_LEVEL_ID } from './game/levels';
import './App.css';

function App() {
  const [graphNodes, setGraphNodes] = useState<Node<MediaFunctionNodeData>[]>([]);
  const [graphEdges, setGraphEdges] = useState<Edge[]>([]);
  const [levelId, setLevelId] = useState(DEFAULT_LEVEL_ID);
  const level = useMemo(() => LEVELS.find((l) => l.id === levelId) ?? LEVELS[0], [levelId]);
  const [domainSizeMs, setDomainSizeMs] = useState(level.domainSizeMs);
  const [showOriginTimestamps, setShowOriginTimestamps] = useState(false);
  // Keyed `${nodeId}:${inputIndex}`, same keying as `statusByInputKey` — which reader
  // inputs currently have a grain parked on canvas waiting for a sync sibling, so the
  // Ring Buffer Telemetry panel can highlight the matching row (the two views of one event).
  const [parkedInputKeys, setParkedInputKeys] = useState<Set<string>>(new Set());

  const onGraphChange = useCallback((nodes: Node<MediaFunctionNodeData>[], edges: Edge[]) => {
    setGraphNodes(nodes);
    setGraphEdges(edges);
  }, []);

  const { graph, stability, resetStability } = useGameLoop(graphNodes, graphEdges, domainSizeMs);

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
      setLevelId(id);
      const selected = LEVELS.find((l) => l.id === id);
      if (selected) setDomainSizeMs(selected.domainSizeMs);
      resetStability();
      handleRestartWave();
    },
    [resetStability, handleRestartWave],
  );

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
        levelId={level.id}
        waveResetKey={waveResetKey}
        showOriginTimestamps={showOriginTimestamps}
        onParkedInputsChange={setParkedInputKeys}
      />
      <RingBufferPanel nodes={graphNodes} graph={graph} parkedInputKeys={parkedInputKeys} />
      <GameHud
        level={level}
        onSelectLevel={handleSelectLevel}
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
      />
      <InfoPanel />
    </div>
  );
}

export default App;
