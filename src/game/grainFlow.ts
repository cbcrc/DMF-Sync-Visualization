// Pure grain-flow simulation: models MXL grains traveling along edges and
// pausing ("processing") at each Media Function node for a duration
// proportional to its latencyMs, then fanning out to its outgoing edges.
// This is a purely visual layer on top of `graphLatency.ts`'s latency math —
// it doesn't feed back into ring buffer evaluation.
//
// Pacing is a closed loop: the producer injects one grain per outgoing flow
// (e.g. one video + one audio), and doesn't inject again until that set has
// been consumed at the far end. The user follows a single timestamp through
// the graph and sees the branches arrive at different times, rather than
// losing it in a continuous stream.

import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { nodeSizeForLatency } from '../components/canvas/nodeSizing';
import type { RingBufferStatus } from '../types';
import { DEFAULT_GRAIN_RATE, grainDurationMs } from '../engine/mxlGrainIndex';

export type GrainPhase = 'traveling' | 'holding' | 'dropped';

export interface Grain {
  id: string;
  phase: GrainPhase;
  /** Node the grain is currently at (holding/dropped) or departed from (traveling). */
  fromId: string;
  /** Node the grain is heading to (traveling only). */
  toId?: string;
  edgeId?: string;
  sourceHandleIndex?: number;
  targetHandleIndex?: number;
  startTime: number;
  durationMs: number;
  /**
   * Set when this grain arrived on an input whose reader is TOO_EARLY —
   * the grain still holds/fans-out normally but is rendered as "waiting"
   * (pale/wobbling) to visualize the reader being ahead of the writer.
   */
  waiting?: boolean;
  /**
   * Which output branch of the originating producer this grain descends
   * from (its `sourceHandleIndex` at spawn time), carried forward through
   * every hold/travel/drop derived from it. Used purely for color-coding
   * distinct flows (e.g. video vs. audio) as they diverge and reconverge —
   * has no effect on the timing/ring-buffer simulation itself.
   */
  streamIndex?: number;
  /**
   * Set on a grain that has arrived at a multi-input (sync) node but is
   * paused — not yet aging — because its sibling input(s) haven't arrived
   * yet. Once every wired input has a parked grain, they're all released
   * together (same startTime), so the node visibly holds/consumes them in
   * sync rather than each racing through independently. This is what makes
   * "Egress waits for the slow branch, then both disappear together" show
   * up on screen as evidence that synchronization was achieved.
   */
  parked?: boolean;
  /**
   * Set when a surviving sibling grain is parked at a sync node where one or
   * more required sibling inputs suffered an overrun drop (TOO_LATE). The
   * grain remains parked in an alert state until the pipeline is restarted or
   * re-tuned.
   */
  stalled?: boolean;
  /**
   * Simulated-clock timestamp (ms, same `useSimClock` clock
   * `ringBufferEngine`/`mxlGrainIndex` display logic uses) this grain's
   * content originated at. Set once when a producer spawns a brand new
   * grain and then carried unchanged through every travel/hold/fan-out
   * derived from it — this is what lets the UI show "this grain was
   * captured at index N" no matter how far downstream it has traveled, and
   * how many grains behind the simulated clock (`simNow - originTs`) it has
   * fallen along the way. Mirrors MXL's Origin Timestamp (OTS) concept
   * (docs/Timing.md): a media function that processes a grain does not
   * re-stamp it with a new capture time.
   */
  originTs?: number;
}

export interface NodeGeom {
  id: string;
  x: number;
  y: number;
  size: number;
  latencyMs: number;
  inputCount: number;
  outputCount: number;
}

/**
 * Edge travel duration (ms) — see `travelDuration`'s doc comment: this is
 * deliberately near-zero (not literal 0ms, which would divide-by-zero in
 * the position interpolation) so a grain hops across an edge in effectively
 * one frame, matching MXL's effectively-instant write→read handoff.
 */
const EDGE_TRAVEL_MS = 1;
/** Base hold time (ms) even for 0ms-latency nodes, so pass-through is still visible. */
const HOLD_BASE_MS = 150;
/** How many extra ms a grain pauses per ms of the node's processing latency. */
const HOLD_MS_PER_LATENCY_MS = 15;
/** Cap, set high enough that even a ~100ms Media Function isn't clipped — the
 *  whole point is that slow functions visibly crawl relative to fast ones. */
const HOLD_MAX_MS = 1800;
/** Pause (ms) after the pipeline drains before the next grain set is injected. */
const RESPAWN_GAP_MS = 350;
/**
 * Spacing (simulated ms) of the ticks drawn on the linear Ingress/Egress
 * lanes, and the instants an Ingress write can begin. Deliberately a multiple
 * of the 20ms video frame: real 20ms ticks are too close to a screen's refresh
 * interval to be followed by eye (they alias and appear to run backwards), so
 * each drawn tick stands for one frame in a human-readable cadence.
 */
export const LINEAR_TICK_MS = grainDurationMs(DEFAULT_GRAIN_RATE) * 24;

/** Latest linear tick boundary at or before `t`. */
export function tickBoundaryAtOrBefore(t: number): number {
  return Math.floor((t + 1e-6) / LINEAR_TICK_MS) * LINEAR_TICK_MS;
}

/** First instant at or after the respawn gap that coincides with a linear tick arriving. */
export function nextSpawnAt(drainedAt: number): number {
  return Math.ceil((drainedAt + RESPAWN_GAP_MS - 1e-6) / LINEAR_TICK_MS) * LINEAR_TICK_MS;
}
/** How long (ms) a dropped grain's "shatter" burst plays before it's removed. */
const DROPPED_MS = 450;
/** Safety cap in case of graph cycles / runaway fan-out. */
const MAX_GRAINS = 60;

/**
 * Reserved key in the spawn-tracking map recording when the pipeline last went
 * empty. The map is keyed by node id otherwise, so this can't collide.
 */
const DRAIN_KEY = '__drained__';

export function buildNodeGeometry(nodes: Node<MediaFunctionNodeData>[]): Map<string, NodeGeom> {
  const map = new Map<string, NodeGeom>();
  for (const n of nodes) {
    map.set(n.id, {
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      size: nodeSizeForLatency(n.data.latencyMs),
      latencyMs: n.data.latencyMs,
      inputCount: n.data.inputCount,
      outputCount: n.data.outputCount,
    });
  }
  return map;
}

function handlePercent(index: number, count: number): number {
  return ((index + 1) / (Math.max(1, count) + 1)) * 100;
}

/** Pixel position of a node's Nth output handle (right edge), matching MediaFunctionNode's layout. */
export function outputAnchor(geom: NodeGeom, index: number): { x: number; y: number } {
  const pct = handlePercent(index, geom.outputCount);
  return { x: geom.x + geom.size, y: geom.y + (geom.size * pct) / 100 };
}

/** Pixel position of a node's Nth input handle (left edge), matching MediaFunctionNode's layout. */
export function inputAnchor(geom: NodeGeom, index: number): { x: number; y: number } {
  const pct = handlePercent(index, geom.inputCount);
  return { x: geom.x, y: geom.y + (geom.size * pct) / 100 };
}

function parseHandleIndex(handle: string | null | undefined, prefix: string): number {
  if (!handle) return 0;
  const n = Number(handle.replace(prefix, ''));
  return Number.isFinite(n) ? n : 0;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Control-point offset, matching React Flow's own bezier edge math
 * (`calculateControlOffset` with the default 0.25 curvature) so a grain rides
 * exactly on the drawn edge rather than cutting the corner.
 */
function controlOffset(distance: number, curvature = 0.25): number {
  if (distance >= 0) return 0.5 * distance;
  return curvature * 25 * Math.sqrt(-distance);
}

/**
 * The two cubic control points for an edge leaving a node's right side and
 * entering the next node's left side — the only orientation this canvas uses.
 */
function bezierControls(a: Point, b: Point): [Point, Point] {
  const dx = b.x - a.x;
  return [
    { x: a.x + controlOffset(dx), y: a.y },
    { x: b.x - controlOffset(dx), y: b.y },
  ];
}

function cubicPoint(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  };
}

/** Samples used to approximate arc length so the dot moves at a steady speed. */
const ARC_SAMPLES = 24;

/**
 * Walk the curve at a constant *arc-length* fraction rather than a constant
 * bezier parameter. Without this the dot visibly surges through the middle of
 * a curved edge and crawls at the ends.
 */
function pointAlongCurve(a: Point, b: Point, fraction: number): Point {
  const [c1, c2] = bezierControls(a, b);
  const lengths: number[] = [0];
  let prev = a;
  let total = 0;
  for (let i = 1; i <= ARC_SAMPLES; i += 1) {
    const p = cubicPoint(a, c1, c2, b, i / ARC_SAMPLES);
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    lengths.push(total);
    prev = p;
  }
  if (total === 0) return a;

  const target = Math.min(1, Math.max(0, fraction)) * total;
  for (let i = 1; i <= ARC_SAMPLES; i += 1) {
    if (lengths[i] < target) continue;
    const span = lengths[i] - lengths[i - 1];
    const within = span === 0 ? 0 : (target - lengths[i - 1]) / span;
    return cubicPoint(a, c1, c2, b, (i - 1 + within) / ARC_SAMPLES);
  }
  return b;
}

/**
 * Item #9 follow-up: writing a grain into a node's output ring buffer and
 * the next node reading it is effectively instantaneous in real MXL (shared
 * memory, not a wire) — the only latency worth visualizing is a node's own
 * processing hold (`holdDuration`). Edge travel used to scale with on-screen
 * distance (up to >1s for a long edge), which misleadingly implied transit
 * time that doesn't exist. Now every edge takes the same tiny, near-instant
 * duration regardless of length — just enough for the dot's position to
 * interpolate across a frame rather than teleport with a visible pop. Kept
 * as a non-zero floor (not literal 0ms) only to avoid a divide-by-zero in
 * `getGrainPosition`'s `(now - startTime) / durationMs`.
 */
function travelDuration(): number {
  return EDGE_TRAVEL_MS;
}

/** Longer processing latency -> longer visible pause at the node (capped so it stays watchable). */
function holdDuration(latencyMs: number): number {
  return Math.min(HOLD_MAX_MS, HOLD_BASE_MS + Math.max(0, latencyMs) * HOLD_MS_PER_LATENCY_MS);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Advance the grain simulation by one tick: progress travel/hold timers,
 * transition arrived grains from traveling->holding (and holding->traveling
 * fan-out to every outgoing edge), inject the next grain set once the previous
 * one has fully drained, and drop any grain referencing a node/edge removed
 * from the graph. Mutates `lastSpawnByNode` (used here to track when the
 * pipeline last went empty) as a side effect; otherwise pure over its inputs.
 */
export function stepGrains(
  prev: Grain[],
  now: number,
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  lastSpawnByNode: Map<string, number>,
  statusByInputKey?: Map<string, RingBufferStatus>,
  droppedHandlesByWave?: Map<string, Set<number>>,
): Grain[] {
  const geometry = buildNodeGeometry(nodes);
  const edgeIds = new Set(edges.map((e) => e.id));
  const outgoingByNode = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!outgoingByNode.has(e.source)) outgoingByNode.set(e.source, []);
    outgoingByNode.get(e.source)!.push(e);
  }

  const next: Grain[] = [];
  // Use persistent dropped-handle tracking for the active wave if provided
  const droppedHandles = droppedHandlesByWave ?? new Map<string, Set<number>>();

  for (const g of prev) {
    const fromGeom = geometry.get(g.fromId);
    if (!fromGeom) continue; // source/current node was removed

    if (g.phase === 'traveling') {
      if (!g.edgeId || !edgeIds.has(g.edgeId) || !g.toId || !geometry.has(g.toId)) continue; // edge/target removed
      if (now - g.startTime < g.durationMs) {
        next.push(g);
        continue;
      }
      // Status is per *input*: at a sync node the fast branch can be too late
      // while the slow branch reads happily at its own head.
      const status = statusByInputKey?.get(`${g.toId}:${g.targetHandleIndex ?? 0}`);
      if (status === 'TOO_LATE') {
        // Ring buffer overrun at the destination: this grain's slot has
        // already been overwritten by the time it would be read, so it is
        // visually lost — shatter in place and do not fan out.
        next.push({
          id: `${g.toId}-drop-${now}-${randomSuffix()}`,
          phase: 'dropped',
          fromId: g.toId,
          startTime: now,
          durationMs: DROPPED_MS,
          streamIndex: g.streamIndex,
          originTs: g.originTs,
        });
        // Record this handle as dropped for the active wave
        if (!droppedHandles.has(g.toId)) droppedHandles.set(g.toId, new Set());
        droppedHandles.get(g.toId)!.add(g.targetHandleIndex ?? 0);
        continue;
      }
      next.push({
        id: `${g.toId}-hold-${now}-${randomSuffix()}`,
        phase: 'holding',
        fromId: g.toId,
        targetHandleIndex: g.targetHandleIndex,
        startTime: now,
        // Parked (paused, non-aging) until every wired input at this node
        // has a grain waiting; the release pass below then starts all of
        // them aging together. For a single-input node this resolves in
        // the same tick, so behavior there is unchanged.
        durationMs: Number.POSITIVE_INFINITY,
        parked: true,
        waiting: status === 'TOO_EARLY',
        streamIndex: g.streamIndex,
        originTs: g.originTs,
      });
      continue;
    }

    if (g.phase === 'dropped') {
      if (now - g.startTime < g.durationMs) {
        next.push(g);
      }
      continue; // dropped grains never fan out — the data is gone
    }

    // Holding.
    if (now - g.startTime < g.durationMs) {
      next.push(g);
      continue;
    }
    const outs = outgoingByNode.get(g.fromId) ?? [];
    for (const e of outs) {
      if (!geometry.has(e.target)) continue;
      const srcIdx = parseHandleIndex(e.sourceHandle, 'out-');
      const tgtIdx = parseHandleIndex(e.targetHandle, 'in-');
      next.push({
        id: `${e.id}-travel-${now}-${randomSuffix()}`,
        phase: 'traveling',
        fromId: g.fromId,
        toId: e.target,
        edgeId: e.id,
        sourceHandleIndex: srcIdx,
        targetHandleIndex: tgtIdx,
        streamIndex: g.streamIndex,
        startTime: now,
        durationMs: travelDuration(),
        originTs: g.originTs,
      });
    }
    // Grains with no outgoing edges (Recording/Output nodes) are simply consumed here.
  }

  // Sync release & stall detection:
  // A parked grain only starts aging once every wired input at its node has
  // a grain parked too. If any wired input suffered an overrun drop, the
  // surviving sibling(s) cannot synchronize and enter a stalled alert state.
  const requiredHandlesByNode = new Map<string, Set<number>>();
  for (const e of edges) {
    const tgtIdx = parseHandleIndex(e.targetHandle, 'in-');
    if (!requiredHandlesByNode.has(e.target)) requiredHandlesByNode.set(e.target, new Set());
    requiredHandlesByNode.get(e.target)!.add(tgtIdx);
  }
  const parkedByNode = new Map<string, Grain[]>();
  for (const g of next) {
    if (g.phase === 'holding' && g.parked) {
      if (!parkedByNode.has(g.fromId)) parkedByNode.set(g.fromId, []);
      parkedByNode.get(g.fromId)!.push(g);
    }
  }

  const releaseDurationById = new Map<string, number>();
  const stalledNodeIds = new Set<string>();

  for (const [nodeId, parked] of parkedByNode) {
    const required = requiredHandlesByNode.get(nodeId);
    if (!required) continue;
    const presentHandles = new Set(parked.map((g) => g.targetHandleIndex ?? 0));
    const nodeDropped = droppedHandles.get(nodeId);

    // If any required sibling input was dropped, synchronization failed for this wave.
    // The surviving sibling stays parked in an alert state until restart or tuning fix.
    const hasDroppedSibling = [...required].some((h) => nodeDropped?.has(h));
    if (hasDroppedSibling) {
      stalledNodeIds.add(nodeId);
      continue;
    }

    const allPresent = [...required].every((h) => presentHandles.has(h));
    if (!allPresent) continue;
    const toGeom = geometry.get(nodeId)!;
    const duration = holdDuration(toGeom.latencyMs);
    for (const g of parked) releaseDurationById.set(g.id, duration);
  }

  const released = next.map((g) => {
    if (releaseDurationById.has(g.id)) {
      return { ...g, startTime: now, durationMs: releaseDurationById.get(g.id)!, parked: false, stalled: false };
    }
    if (g.phase === 'holding' && g.parked && stalledNodeIds.has(g.fromId)) {
      return { ...g, stalled: true };
    }
    return g;
  });

  // Closed loop: the Ingress only injects the next grain set once the previous
  // one has been fully consumed at the Egress (or destroyed en route). This
  // keeps exactly one video grain and one audio grain in flight, so the user
  // can follow a single timestamp's journey and watch the two branches
  // diverge, instead of trying to track a continuous stream.
  //
  // A shattered grain still counts as in-flight until its burst finishes, so a
  // too-late loss stays on screen long enough to read.
  const pipelineBusy = released.length > 0;
  const drainedAt = lastSpawnByNode.get(DRAIN_KEY);
  if (pipelineBusy) {
    lastSpawnByNode.delete(DRAIN_KEY);
  } else if (drainedAt === undefined) {
    lastSpawnByNode.set(DRAIN_KEY, now); // just drained; start the gap timer
  }

  const readyToSpawn = !pipelineBusy && drainedAt !== undefined && now + 1e-6 >= nextSpawnAt(drainedAt);

  if (readyToSpawn) {
    lastSpawnByNode.delete(DRAIN_KEY);
    droppedHandles.clear(); // Fresh wave: clear previous dropped history
    // Capture timestamp for this wave's brand new grains — the one fixed
    // reference point every downstream copy of this grain will carry
    // forward unchanged. Uses the same simulated clock as `now` (see
    // `useSimClock`) so origin-timestamp age display (item #11) and travel/
    // hold timing stay in lockstep under Stepping/Manual playback modes.
    // The wave is triggered by the linear feed: the Ingress can only write
    // once a tick has arrived with data, so the grains carry that tick's
    // capture time (the latest video-frame boundary), not an arbitrary `now`.
    const wallNow = tickBoundaryAtOrBefore(now);
    for (const n of nodes) {
      if (n.data.inputCount > 0) continue; // only producers (Input/Synthetic) spawn new grains
      const outs = outgoingByNode.get(n.id);
      if (!outs || outs.length === 0) continue;

      for (const e of outs) {
        if (!geometry.has(e.target)) continue;
        const srcIdx = parseHandleIndex(e.sourceHandle, 'out-');
        const tgtIdx = parseHandleIndex(e.targetHandle, 'in-');
        released.push({
          id: `${e.id}-travel-${now}-${randomSuffix()}`,
          phase: 'traveling',
          fromId: n.id,
          toId: e.target,
          edgeId: e.id,
          sourceHandleIndex: srcIdx,
          targetHandleIndex: tgtIdx,
          streamIndex: srcIdx,
          startTime: now,
          durationMs: travelDuration(),
          originTs: wallNow,
        });
      }
    }
  }

  return released.length > MAX_GRAINS ? released.slice(released.length - MAX_GRAINS) : released;
}

/** Edge travel duration (ms), exported for callers that need to schedule
 *  exactly past a hop (see `nextReadEventAt`'s doc comment below). */
export function edgeTravelDurationMs(): number {
  return EDGE_TRAVEL_MS;
}

/**
 * Item #9 follow-up: the simulated-clock time of the next "read" event — the
 * moment some downstream Media Function next receives a grain into its
 * input ring buffer. Considers two sources, both resolving through one
 * remaining `EDGE_TRAVEL_MS` hop:
 *  - a currently-holding (actively aging, not parked-waiting-on-a-sibling)
 *    grain finishing its hold and fanning out across the edge, or
 *  - a grain already mid-hop (`'traveling'`) — relevant because Manual
 *    mode's frozen clock can leave one sitting mid-travel between clicks
 *    (its own single remaining `EDGE_TRAVEL_MS` hop hasn't happened yet).
 * Returns `null` if nothing is currently counting down (e.g. the pipeline is
 * fully parked waiting on a stalled sibling, or fully drained between waves).
 */
export function nextReadEventAt(grains: Grain[]): number | null {
  let min: number | null = null;
  for (const g of grains) {
    let endTime: number;
    if (g.phase === 'holding' && !g.parked && Number.isFinite(g.durationMs)) {
      endTime = g.startTime + g.durationMs + EDGE_TRAVEL_MS;
    } else if (g.phase === 'traveling') {
      endTime = g.startTime + g.durationMs; // already in flight — this *is* its arrival time
    } else {
      continue;
    }
    if (min === null || endTime < min) min = endTime;
  }
  return min;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Live pixel position for a grain at time `now`. Traveling grains ride the
 * edge's actual bezier curve (matching React Flow's own edge geometry) and
 * ease out as they approach the target node, visually reinforcing that the
 * signal is slowing down to be processed; holding grains sit at the node's
 * center for the duration of its (latency-scaled) hold.
 */
export function getGrainPosition(
  grain: Grain,
  now: number,
  geometry: Map<string, NodeGeom>,
): { x: number; y: number } | null {
  if (grain.phase === 'holding' || grain.phase === 'dropped') {
    const geom = geometry.get(grain.fromId);
    if (!geom) return null;
    // Parked grains (waiting at a multi-input sync node for every sibling to
    // arrive) used to all collapse onto the node's dead center — with two+
    // siblings parked at once (e.g. video + audio at Egress) they rendered
    // exactly on top of one another. Spread them out along the node's real
    // input-handle positions instead (same spacing `inputAnchor` draws the
    // handles at), blended partway toward the center so they still read as
    // "inside" the node rather than sitting on its border.
    if (grain.phase === 'holding' && grain.parked) {
      const anchor = inputAnchor(geom, grain.targetHandleIndex ?? 0);
      const centerX = geom.x + geom.size / 2;
      const centerY = geom.y + geom.size / 2;
      // Kept close to the handle (rather than blended toward center) so a
      // parked grain visibly sits right where its edge connects to the box
      // — reading as "held at the door, waiting on a sibling" rather than
      // "already inside being processed". This makes it obvious at a glance
      // which input (e.g. audio) is the one being made to wait.
      const PARK_BLEND = 0.15; // 0 = at the handle, 1 = dead center
      return {
        x: anchor.x + (centerX - anchor.x) * PARK_BLEND,
        y: anchor.y + (centerY - anchor.y) * PARK_BLEND,
      };
    }
    return { x: geom.x + geom.size / 2, y: geom.y + geom.size / 2 };
  }
  const fromGeom = geometry.get(grain.fromId);
  const toGeom = grain.toId ? geometry.get(grain.toId) : undefined;
  if (!fromGeom || !toGeom) return null;
  const a = outputAnchor(fromGeom, grain.sourceHandleIndex ?? 0);
  const b = inputAnchor(toGeom, grain.targetHandleIndex ?? 0);
  const t = easeOutQuad(Math.min(1, (now - grain.startTime) / grain.durationMs));
  return pointAlongCurve(a, b, t);
}
