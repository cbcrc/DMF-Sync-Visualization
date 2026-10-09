import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { MediaFunctionKind, RingBufferStatus } from '../../types';
import { MediaFunctionNode, type MediaFunctionNodeData } from './MediaFunctionNode';
import { GrainOverlay } from './GrainOverlay';
import { RingBufferBadgeOverlay } from './RingBufferBadgeOverlay';
import { LATENCY_RANGE, NODE_KIND_DEFAULTS, PALETTE_KINDS } from './nodeDefaults';
import { useGrainFlow } from '../../game/useGrainFlow';
import type { InputReading } from '../../game/graphLatency';
import './FlowCanvas.css';

const nodeTypes: NodeTypes = { mediaFunction: MediaFunctionNode };

/** How long (ms) an edge's "just carried a grain" highlight stays visible (item #9 follow-up). */
const EDGE_PULSE_MS = 300;

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
const initialNodes: Node<MediaFunctionNodeData>[] = [
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
    data: { kind: 'technical', label: 'Fast Video MF', latencyMs: 10, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'video-slow',
    type: 'mediaFunction',
    position: { x: 590, y: 80 },
    data: { kind: 'editorial', label: 'Slow Video MF', latencyMs: 20, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'audio-fast',
    type: 'mediaFunction',
    position: { x: 340, y: 430 },
    data: { kind: 'technical', label: 'Ultra-Fast Audio MF', latencyMs: 2, inputCount: 1, outputCount: 1 },
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
const initialEdges: Edge[] = [
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
const avSyncNodes: Node<MediaFunctionNodeData>[] = [
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
    data: { kind: 'technical', label: 'Fast Video MF', latencyMs: 10, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'av-vslow',
    type: 'mediaFunction',
    position: { x: 570, y: 50 },
    data: { kind: 'editorial', label: 'Slow Video MF', latencyMs: 72, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'av-afast',
    type: 'mediaFunction',
    position: { x: 320, y: 480 },
    data: { kind: 'technical', label: 'Ultra-Fast Audio MF', latencyMs: 2, inputCount: 1, outputCount: 1 },
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
const avSyncEdges: Edge[] = [
  { id: 'av-ing-vfast', source: 'av-ingress', sourceHandle: 'out-0', target: 'av-vfast', targetHandle: 'in-0', label: 'V1' },
  { id: 'av-vfast-vslow', source: 'av-vfast', sourceHandle: 'out-0', target: 'av-vslow', targetHandle: 'in-0', label: 'V1a' },
  { id: 'av-vslow-egress', source: 'av-vslow', sourceHandle: 'out-0', target: 'av-egress', targetHandle: 'in-0', label: 'V1b' },
  { id: 'av-ing-afast', source: 'av-ingress', sourceHandle: 'out-1', target: 'av-afast', targetHandle: 'in-0', label: 'A1' },
  { id: 'av-afast-egress', source: 'av-afast', sourceHandle: 'out-0', target: 'av-egress', targetHandle: 'in-1', label: 'A1a' },
];

/** Starter graph + per-level challenge graphs, keyed by level id. */
const LEVEL_GRAPHS: Record<string, { nodes: Node<MediaFunctionNodeData>[]; edges: Edge[] }> = {
  'av-sync-overrun': { nodes: avSyncNodes, edges: avSyncEdges },
};

const PALETTE_LABELS: Record<MediaFunctionKind, string> = {
  input: 'Input',
  synthetic: 'Synthetic',
  technical: 'Technical',
  editorial: 'Editorial',
  repeater: 'Repeater',
  recording: 'Recording',
  output: 'Output',
};

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
  levelId: string;
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
}

function FlowCanvasInner({
  onGraphChange,
  zoneByNodeId,
  statusByInputKey,
  inputsByNodeId,
  levelId,
  waveResetKey,
  showOriginTimestamps,
  showRealGrainIndex,
  domainSizeMs,
  getNow,
  onParkedInputsChange,
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<MediaFunctionNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const addedCount = useRef(0);

  useEffect(() => {
    const graph = LEVEL_GRAPHS[levelId];
    setNodes(graph ? graph.nodes : initialNodes);
    setEdges(graph ? graph.edges : initialEdges);
  }, [levelId, setEdges, setNodes]);

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

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}-${Date.now()}`,
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const addNode = useCallback(
    (kind: MediaFunctionKind) => {
      const defaults = NODE_KIND_DEFAULTS[kind];
      const n = ++addedCount.current;
      const id = `${kind}-${Date.now()}-${n}`;
      const newNode: Node<MediaFunctionNodeData> = {
        id,
        type: 'mediaFunction',
        position: { x: 120 + ((n * 60) % 480), y: 60 + ((n * 90) % 420) },
        data: { ...defaults, kind, label: `${defaults.label} ${n}` },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
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

  // Report the live graph up to App for game-loop derivation whenever it changes.
  useEffect(() => {
    onGraphChange(nodes, edges);
  }, [nodes, edges, onGraphChange]);

  const { grains, edgeActivity } = useGrainFlow(nodes, edges, statusByInputKey, waveResetKey, getNow);

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
            onLatencyChange: handleLatencyChange,
          },
        };
      }),
    [nodes, zoneByNodeId, holdByNodeId, stalledNodeIds, handleLatencyChange, showOriginTimestamps, showRealGrainIndex, domainSizeMs],
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
      if (!active) return e;
      return { ...e, className: `${e.className ?? ''} edge-pulse-active`.trim() };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute every grain tick, not just when `edges` identity changes
  }, [edges, grains, getNow]);

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={displayEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      fitView
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
      <RingBufferBadgeOverlay nodes={nodes} inputsByNodeId={inputsByNodeId} />
      <Panel position="top-left" className="fc-palette">
        <div className="fc-palette__title">Add node</div>
        <div className="fc-palette__buttons">
          {PALETTE_KINDS.map((kind) => (
            <button key={kind} type="button" className="fc-palette__btn" onClick={() => addNode(kind)}>
              {PALETTE_LABELS[kind]}
            </button>
          ))}
        </div>
        <div className="fc-palette__hint">
          Drag between handles to connect · select + Backspace to delete · drag a node's slider to
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
