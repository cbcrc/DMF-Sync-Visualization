import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  updateEdge,
  useEdgesState,
  useNodesState,
  useStoreApi,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { nextCopyLabel } from '../../game/copyLabel';
import type { RingBufferStatus } from '../../types';
import { MediaFunctionNode, type MediaFunctionNodeData } from './MediaFunctionNode';
import { GrainOverlay } from './GrainOverlay';
import { LinearBoundaryOverlay } from './LinearBoundaryOverlay';
import type { WriterRing } from '../../game/writerRings';
import { type OutputMode } from './MediaFunctionNode';
import { requiredTrack } from '../../game/connectionRules';
import { LATENCY_RANGE, PALETTE_GROUPS, PALETTE_PRESETS, type PalettePreset } from './nodeDefaults';
import { useGrainFlow } from '../../game/useGrainFlow';
import type { InputReading } from '../../game/graphLatency';
import './FlowCanvas.css';

const nodeTypes: NodeTypes = { mediaFunction: MediaFunctionNode };

/** How long (ms) an edge's "just carried a grain" highlight stays visible (item #9 follow-up). */
const EDGE_PULSE_MS = 300;
const MAX_HISTORY = 100;

export interface FlowCanvasProps {
  /** Reports the live node/edge graph up so App can drive the game loop from it (Task 4). */
  onGraphChange: (nodes: Node<MediaFunctionNodeData>[], edges: Edge[]) => void;
  /** Live Ring Buffer zone per node id, merged into each node's data for border coloring. */
  zoneByNodeId: Map<string, 'green' | 'yellow' | 'red'>;
  /**
   * Live status per reader *input*, keyed `${nodeId}:${inputIndex}` — drives grain
   * drop (TOO_LATE) / wait (TOO_EARLY) visuals on the specific branch at fault.
   */
  statusByInputKey: Map<string, RingBufferStatus>;
  /** Live per-input readings, rendered as compact status bars directly under each reader node. */
  inputsByNodeId: Map<string, InputReading[]>;
  /** Every writer flow's ring with its readers, drawn as a linear strip above each writer node. */
  writerRings: WriterRing[];
  /** Reader function whose node, inbound links and ring pointers are highlighted (null = none). */
  focusedNodeId: string | null;
  /** Called when a node or a ring pointer is clicked (id), or the empty canvas is (null). */
  onFocusNode: (nodeId: string | null) => void;
  /** Graph to load onto the canvas whenever `graphLoadKey` changes (scenario switch, restore). */
  initialGraph: { nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] };
  /** Incremented to load `initialGraph` again; edits in between are the canvas's own. */
  graphLoadKey: number;
  /** Key incremented to force a wave restart (e.g. from HUD restart button or level change). */
  waveResetKey?: number;
  /** Show each grain's MXL origin-timestamp index/offset and node write flashes (item #10.ii). */
  showOriginTimestamps?: boolean;
  /** Show the raw epoch-scaled MXL grain index instead of the small ring-relative one (item #11). */
  showRealGrainIndex?: boolean;
  /** Current MXL Domain size, needed to compute the ring-relative grain index (item #11). */
  domainSizeMs: number;
  /** Shared simulated clock (item #9) — threaded into grain timing + the overlay
   *  instead of each reading performance.now()/Date.now() independently. */
  getNow?: () => number;
  /**
   * Reports which reader inputs (keyed `${nodeId}:${inputIndex}`, same keying as
   * `statusByInputKey`) currently have a grain parked on canvas waiting for a sync
   * sibling, so the Ring Buffer Telemetry panel below can highlight the matching
   * reader row — the same "waiting" event shown as two correlated views.
   */
  onParkedInputsChange?: (keys: Set<string>) => void;
  /** Advances the shared simulated clock by a delta (`SimClock.step`) —
   *  forwarded into `useGrainFlow` so Manual mode's Step / Back move the clock in
   *  lockstep with the grains they simulate. */
  stepClockBy?: (incrementMs: number) => void;
  /**
   * Hands the parent the Step ▶ and ◀ Back functions (one grain forward, or
   * undo the last step) — this component owns the grain-flow state they act on.
   */
  onManualStepReady?: (stepToNextRead: () => void, stepBack: () => void) => void;
  /** Saves the current canvas under the given name; returns false if storage failed. */
  onSaveScenario?: (title: string) => boolean;
}

function FlowCanvasInner({
  onGraphChange,
  zoneByNodeId,
  statusByInputKey,
  inputsByNodeId,
  writerRings,
  focusedNodeId,
  onFocusNode,
  initialGraph,
  graphLoadKey,
  waveResetKey,
  showOriginTimestamps,
  showRealGrainIndex,
  domainSizeMs,
  getNow,
  onParkedInputsChange,
  stepClockBy,
  onManualStepReady,
  onSaveScenario,
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<MediaFunctionNodeData>(initialGraph.nodes);
  const storeApi = useStoreApi();
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const addedCount = useRef(0);

  // Undo history: snapshots of the graph taken just before each edit.
  const graphRef = useRef({ nodes, edges });
  graphRef.current = { nodes, edges };
  const historyRef = useRef<{ nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] }[]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [showNow, setShowNow] = useState(false);
  const pushHistory = useCallback(() => {
    const h = historyRef.current;
    const last = h[h.length - 1];
    if (last && last.nodes === graphRef.current.nodes && last.edges === graphRef.current.edges) return;
    h.push(graphRef.current);
    if (h.length > MAX_HISTORY) h.shift();
    setHistoryDepth(h.length);
  }, []);
  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    setHistoryDepth(historyRef.current.length);
    if (!prev) return;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [setNodes, setEdges]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.key.toLowerCase() !== 'z') return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      ev.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  // Intentionally keyed only on `graphLoadKey`: `initialGraph` is a snapshot to
  // load, and must not clobber the player's edits when its identity changes.
  const initialGraphRef = useRef(initialGraph);
  initialGraphRef.current = initialGraph;
  useEffect(() => {
    setNodes(structuredClone(initialGraphRef.current.nodes));
    setEdges(structuredClone(initialGraphRef.current.edges));
    historyRef.current = [];
    setHistoryDepth(0);
  }, [graphLoadKey, setEdges, setNodes]);

  // React Flow doesn't auto-remove edges attached to a deleted node; clean them up ourselves.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removedIds.length > 0) {
        setEdges((eds) => eds.filter((e) => !removedIds.includes(e.source) && !removedIds.includes(e.target)));
      }
    },
    [onNodesChangeBase, setEdges],
  );

  // An input connector takes exactly one link; connecting or moving a link onto
  // an occupied input replaces the old one. Outputs may fan out to many readers.
  const withoutLinksTo = (eds: Edge[], c: { target: string | null; targetHandle: string | null }, keepId?: string) =>
    eds.filter(
      (e) =>
        e.id === keepId || !(e.target === c.target && (e.targetHandle ?? null) === (c.targetHandle ?? null)),
    );

  // Track carried by the ring a link leaves from (undefined if unknown).
  const trackOfSource = useCallback(
    (source: string | null, sourceHandle: string | null | undefined) =>
      writerRings.find((r) => r.writerNodeId === source && r.handleId === (sourceHandle ?? 'out-0'))?.track,
    [writerRings],
  );

  // Audio readers take only audio sources and video readers only video; see `requiredTrack`.
  const linkAllowed = useCallback(
    (node: Node<MediaFunctionNodeData> | undefined, inputIndex: number, edgesIn: Edge[], source: Edge | Connection) => {
      const sourceTrack = trackOfSource(source.source, source.sourceHandle);
      if (!node || !sourceTrack) return true;
      const others = edgesIn
        .map((e) => trackOfSource(e.source, e.sourceHandle))
        .filter((t): t is NonNullable<typeof t> => t !== undefined);
      const need = requiredTrack(node.data, inputIndex, others);
      return need === undefined || need === sourceTrack;
    },
    [trackOfSource],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const node = nodes.find((n) => n.id === c.target);
      const inputIndex = Number((c.targetHandle ?? 'in-0').replace('in-', '')) || 0;
      // Links already feeding this node's *other* inputs (an occupied target is replaced).
      const others = edges.filter(
        (e) => e.target === c.target && (e.targetHandle ?? 'in-0') !== (c.targetHandle ?? 'in-0'),
      );
      return linkAllowed(node, inputIndex, others, c);
    },
    [nodes, edges, linkAllowed],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      pushHistory();
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}-${Date.now()}`,
          },
          withoutLinksTo(eds, connection),
        ),
      );
    },
    [setEdges, pushHistory],
  );

  // Drag either end of an existing link to move it to another connector.
  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      pushHistory();
      setEdges((eds) => updateEdge(oldEdge, connection, withoutLinksTo(eds, connection, oldEdge.id)));
    },
    [setEdges, pushHistory],
  );

  // New nodes land in the middle of what the user is looking at (pan/zoom
  // aware), nudged diagonally so consecutive adds don't stack exactly.
  const viewCenterPosition = useCallback(
    (n: number) => {
      const { width, height, transform } = storeApi.getState();
      const [tx, ty, zoom] = transform;
      const nudge = ((n - 1) % 6) * 28;
      return {
        x: (width / 2 - tx) / zoom - 100 + nudge,
        y: (height / 2 - ty) / zoom - 50 + nudge,
      };
    },
    [storeApi],
  );

  const addNode = useCallback(
    (preset: PalettePreset) => {
      const { kind, defaults } = preset;
      const n = ++addedCount.current;
      const id = `${preset.id}-${Date.now()}-${n}`;
      const newNode: Node<MediaFunctionNodeData> = {
        id,
        type: 'mediaFunction',
        position: viewCenterPosition(n),
        data: {
          ...defaults,
          kind,
          label: `${defaults.label} ${n}`,
          ...(preset.audioOnly ? { audioOnly: true } : {}),
          ...(preset.videoOnly ? { videoOnly: true } : {}),
        },
      };
      pushHistory();
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes, pushHistory, viewCenterPosition],
  );

  /**
   * Retune a Media Function's processing latency (the player's "efficiency"
   * control). Clamped to the kind's range so a node can't be driven to a
   * nonsensical value; the game loop re-derives ring buffer state from this
   * on the next tick.
   */
  const handleLatencyChange = useCallback(
    (nodeId: string, latencyMs: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const range = LATENCY_RANGE[n.data.kind];
          const clamped = range
            ? Math.min(range.max, Math.max(range.min, latencyMs))
            : Math.max(0, latencyMs);
          return { ...n, data: { ...n.data, latencyMs: clamped } };
        }),
      );
    },
    [setNodes],
  );

  const clipboardRef = useRef<Node<MediaFunctionNodeData>[]>([]);
  const pasteCount = useRef(0);
  const [canPaste, setCanPaste] = useState(false);

  const copySelected = useCallback(() => {
    const picked = graphRef.current.nodes.filter((n) => n.selected);
    if (picked.length === 0) return;
    clipboardRef.current = structuredClone(picked.map(({ id, type, position, data }) => ({ id, type, position, data })));
    pasteCount.current = 0;
    setCanPaste(true);
  }, []);

  const pasteCopied = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const shift = 40 * ++pasteCount.current;
    const labels = graphRef.current.nodes.map((n) => n.data.label);
    const copies = clipboardRef.current.map((src, i) => {
      const label = nextCopyLabel(src.data.label, labels);
      labels.push(label);
      return {
        ...structuredClone(src),
        id: `${src.id.replace(/-copy-.*$/, '')}-copy-${Date.now()}-${i}`,
        position: { x: src.position.x + shift, y: src.position.y + shift },
        selected: true,
        data: { ...structuredClone(src.data), label },
      };
    });
    pushHistory();
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...copies]);
  }, [pushHistory, setNodes]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey) return;
      const key = ev.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      ev.preventDefault();
      if (key === 'c') copySelected();
      else pasteCopied();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copySelected, pasteCopied]);

  const hasSelection = nodes.some((n) => n.selected) || edges.some((e) => e.selected);
  const deleteSelected = useCallback(() => {
    const { nodes: ns, edges: es } = graphRef.current;
    const gone = new Set(ns.filter((n) => n.selected).map((n) => n.id));
    if (gone.size === 0 && !es.some((e) => e.selected)) return;
    pushHistory();
    setNodes(ns.filter((n) => !gone.has(n.id)));
    setEdges(es.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)));
    if (focusedNodeId !== null && gone.has(focusedNodeId)) onFocusNode(null);
  }, [setNodes, setEdges, pushHistory, focusedNodeId, onFocusNode]);

  const handleLabelChange = useCallback(
    (nodeId: string, label: string) => {
      pushHistory();
      setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)));
    },
    [setNodes, pushHistory],
  );

  const handleSyncOutputsChange = useCallback(
    (nodeId: string, synced: boolean) => {
      pushHistory();
      setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, syncOutputs: synced || undefined } } : n)));
    },
    [setNodes, pushHistory],
  );

  const handleSyncInputChange = useCallback(
    (nodeId: string, inputIndex: number, ignoreSync: boolean) => {
      pushHistory();
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const rest = (n.data.ignoreSyncInputs ?? []).filter((i) => i !== inputIndex);
          const next = ignoreSync ? [...rest, inputIndex].sort((a, b) => a - b) : rest;
          return { ...n, data: { ...n.data, ignoreSyncInputs: next.length > 0 ? next : undefined } };
        }),
      );
    },
    [setNodes, pushHistory],
  );

  const handleSaveScenario = useCallback(() => {
    if (!onSaveScenario) return;
    const title = window.prompt('Save scenario as (an existing name replaces it):');
    if (title === null) return;
    if (!title.trim()) return window.alert('Please enter a name.');
    if (!onSaveScenario(title)) window.alert('Could not save: browser storage is full or unavailable.');
  }, [onSaveScenario]);

  /** Switch a producer between video only, audio only, or both flows. */
  const handleOutputModeChange = useCallback(
    (nodeId: string, mode: OutputMode) => {
      pushHistory();
      const count = mode === 'both' ? 2 : 1;
      const isSink = graphRef.current.nodes.find((n) => n.id === nodeId)?.data.outputCount === 0;
      const handles = mode === 'audio' ? ['out-1'] : mode === 'video' ? ['out-0'] : ['out-0', 'out-1'];
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  audioOnly: mode === 'audio' ? true : undefined,
                  ...(isSink ? { inputCount: count } : { outputCount: count }),
                },
              }
            : n,
        ),
      );
      // Drop links on a connector that no longer exists, or that no longer carries the right track.
      const updated = graphRef.current.nodes.find((n) => n.id === nodeId);
      const nextData = updated && {
        ...updated.data,
        audioOnly: mode === 'audio' ? true : undefined,
        ...(isSink ? { inputCount: count } : {}),
      };
      setEdges((eds) =>
        eds.filter((e) => {
          if (!isSink) return e.source !== nodeId || handles.includes(e.sourceHandle ?? 'out-0');
          if (e.target !== nodeId) return true;
          const index = Number((e.targetHandle ?? 'in-0').replace('in-', '')) || 0;
          if (index >= count) return false;
          const track = trackOfSource(e.source, e.sourceHandle);
          const need = nextData ? requiredTrack(nextData, index, []) : undefined;
          return !track || !need || track === need;
        }),
      );
    },
    [setNodes, setEdges, pushHistory, trackOfSource],
  );

  // Report the live graph up to App for game-loop derivation whenever it changes.
  useEffect(() => {
    onGraphChange(nodes, edges);
  }, [nodes, edges, onGraphChange]);

  const { grains, edgeActivity, stepToNextRead, stepBack } = useGrainFlow(
    nodes,
    edges,
    statusByInputKey,
    waveResetKey,
    getNow,
    stepClockBy,
  );

  useEffect(() => {
    onManualStepReady?.(stepToNextRead, stepBack);
  }, [stepToNextRead, stepBack, onManualStepReady]);

  // Same keying (`${nodeId}:${inputIndex}`) as `statusByInputKey` — lets App correlate a
  // grain parked on canvas with its matching reader row in the Ring Buffer Telemetry panel.
  const parkedInputKeys = useMemo(() => {
    const set = new Set<string>();
    for (const g of grains) {
      if (g.phase === 'holding' && g.parked) {
        set.add(`${g.fromId}:${g.targetHandleIndex ?? 0}`);
      }
    }
    return set;
  }, [grains]);
  const parkedSignature = useMemo(() => Array.from(parkedInputKeys).sort().join('|'), [parkedInputKeys]);
  const prevParkedSignature = useRef('');
  useEffect(() => {
    if (parkedSignature !== prevParkedSignature.current) {
      prevParkedSignature.current = parkedSignature;
      onParkedInputsChange?.(parkedInputKeys);
    }
  }, [parkedSignature, parkedInputKeys, onParkedInputsChange]);

  const stalledNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of grains) {
      if (g.stalled) set.add(g.fromId);
    }
    return set;
  }, [grains]);

  // Carry the *held grain's* own timing into node data, so each node's internal
  // path animation starts exactly when that grain arrives and lasts exactly as
  // long as it is held. Keyed by node; if several grains land at once, the
  // most recent arrival drives the path.
  const holdByNodeId = useMemo(() => {
    const map = new Map<
      string,
      { startTime: number; durationMs: number; waiting: boolean; streamIndex?: number; originTs?: number }
    >();
    for (const g of grains) {
      if (g.phase !== 'holding') continue;
      const existing = map.get(g.fromId);
      if (!existing || g.startTime > existing.startTime) {
        map.set(g.fromId, {
          startTime: g.startTime,
          durationMs: g.durationMs,
          waiting: !!g.waiting,
          streamIndex: g.streamIndex,
          originTs: g.originTs,
        });
      }
    }
    return map;
  }, [grains]);

  // Merge live zone/processing state into node data so MediaFunctionNode can style itself.
  const ringsByWriter = useMemo(() => {
    const map = new Map<string, WriterRing[]>();
    for (const ring of writerRings) {
      const list = map.get(ring.writerNodeId);
      if (list) list.push(ring);
      else map.set(ring.writerNodeId, [ring]);
    }
    return map;
  }, [writerRings]);
  const labelByNodeId = useMemo(() => new Map(nodes.map((n) => [n.id, n.data.label])), [nodes]);

  const styledNodes = useMemo(
    () =>
      nodes.map((n) => {
        const hold = holdByNodeId.get(n.id);
        return {
          ...n,
          data: {
            ...n.data,
            zone: zoneByNodeId.get(n.id),
            processing: hold !== undefined,
            processingStartedAt: hold?.startTime,
            processingDurationMs: hold?.durationMs,
            processingWaiting: hold?.waiting,
            processingStreamIndex: hold?.streamIndex,
            processingOriginTs: hold?.originTs,
            showOriginTimestamps,
            showRealGrainIndex,
            domainSizeMs,
            syncStalled: stalledNodeIds.has(n.id),
            focused: n.id === focusedNodeId,
            onLatencyChange: handleLatencyChange,
            onLabelChange: handleLabelChange,
            onSyncOutputsChange: handleSyncOutputsChange,
            onSyncInputChange: handleSyncInputChange,
            onOutputModeChange: handleOutputModeChange,
            rings: ringsByWriter.get(n.id),
            labelByNodeId,
            focusedNodeId,
            showNow,
            onFocusNode,
          },
        };
      }),
    [nodes, zoneByNodeId, holdByNodeId, stalledNodeIds, handleLatencyChange, handleLabelChange, handleSyncOutputsChange, handleSyncInputChange, showOriginTimestamps, showRealGrainIndex, domainSizeMs, focusedNodeId, handleOutputModeChange, ringsByWriter, labelByNodeId, onFocusNode, showNow],
  );

  // Item #9 follow-up: briefly highlight an edge's drawn path the moment a
  // grain actually embarks on it — a pulse on the path itself, standing in
  // for the old (now near-instant) traveling dot, to show "data was just
  // read off this edge" without implying meaningful transit time.
  const displayEdges = useMemo(() => {
    const nowFn = getNow ?? (() => performance.now());
    const t = nowFn();
    return edges.map((e) => {
      const lastActive = edgeActivity.get(e.id);
      const active = lastActive !== undefined && t - lastActive < EDGE_PULSE_MS;
      const focused = focusedNodeId !== null && e.target === focusedNodeId;
      if (!active && !focused) return e;
      const classes = [e.className, active && 'edge-pulse-active', focused && 'edge-focused'];
      return { ...e, className: classes.filter(Boolean).join(' ') };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute every grain tick, not just when `edges` identity changes
  }, [edges, grains, getNow, focusedNodeId]);

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={displayEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onEdgeUpdate={onEdgeUpdate}
      onNodeDragStart={pushHistory}
      onNodesDelete={pushHistory}
      onEdgesDelete={pushHistory}
      onNodeClick={(_, node) => onFocusNode(node.id)}
      onPaneClick={() => onFocusNode(null)}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#333" gap={24} />
      <Controls />
      <MiniMap pannable zoomable style={{ background: '#111214' }} />
      <GrainOverlay
        nodes={nodes}
        grains={grains}
        showOriginTimestamps={showOriginTimestamps}
        showRealGrainIndex={showRealGrainIndex}
        domainSizeMs={domainSizeMs}
        getNow={getNow}
      />
      <LinearBoundaryOverlay
        nodes={nodes}
        edges={edges}
        inputsByNodeId={inputsByNodeId}
        edgeActivity={edgeActivity}
        grains={grains}
        getNow={getNow}
      />
      <Panel position="top-center" className="fc-toolbar" aria-label="Canvas toolbar">
        <button
          type="button"
          className="fc-toolbar__btn"
          onClick={undo}
          disabled={historyDepth === 0}
          title="Undo (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          className="fc-toolbar__btn"
          onClick={deleteSelected}
          disabled={!hasSelection}
          title="Delete the selected function (select one first; or press Delete/Backspace)"
        >
          🗑 Delete
        </button>
        <button
          type="button"
          className="fc-toolbar__btn"
          onClick={copySelected}
          disabled={!nodes.some((n) => n.selected)}
          title="Copy the selected function (Ctrl+C)"
        >
          ⧉ Copy
        </button>
        <button
          type="button"
          className="fc-toolbar__btn"
          onClick={pasteCopied}
          disabled={!canPaste}
          title="Paste the copied function with the next free number (Ctrl+V)"
        >
          📋 Paste
        </button>
        <button
          type="button"
          className={`fc-toolbar__btn${showNow ? ' fc-toolbar__btn--on' : ''}`}
          onClick={() => setShowNow((v) => !v)}
          aria-pressed={showNow}
          title="Show wall-clock now on each ring buffer"
        >
          ◔ Now
        </button>
        {onSaveScenario && (
          <button type="button" className="fc-toolbar__btn" onClick={handleSaveScenario} title="Save this canvas as a scenario">
            💾 Save scenario
          </button>
        )}
      </Panel>
      <Panel position="top-left" className="fc-palette">
        <div className="fc-palette__title">Add media function</div>
        {PALETTE_GROUPS.map((group) => (
          <div key={group.id} className="fc-palette__group">
            <div className="fc-palette__group-title">{group.title}</div>
            <div className="fc-palette__buttons">
              {PALETTE_PRESETS.filter((preset) => preset.group === group.id).map((preset) => (
                <button key={preset.id} type="button" className="fc-palette__btn" onClick={() => addNode(preset)}>
                  {preset.button}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="fc-palette__hint">
          Drag between handles to connect · drag a link's end to move it, or drop a link on an occupied input to replace it · Ctrl+Z undoes · Ctrl+C / Ctrl+V copies a function · select + Backspace to delete · drag a media function's slider to
          retune its processing latency · grain indices are kept end to end, so a grain shatters (✕)
          only on the input whose slot was already overwritten (READ TOO LATE), and pales/wobbles
          (?) while an input waits on a not-yet-written grain
        </div>
      </Panel>
    </ReactFlow>
  );
}

/** Canvas root: React Flow requires a `ReactFlowProvider` ancestor for hooks like `useReactFlow`. */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <div className="flow-canvas-root">
      <ReactFlowProvider>
        <FlowCanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
