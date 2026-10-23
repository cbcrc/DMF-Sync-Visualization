import { Fragment, useEffect, useRef } from 'react';
import { useViewport } from 'reactflow';
import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from './MediaFunctionNode';
import type { Grain } from '../../game/grainFlow';
import { buildNodeGeometry, getGrainPosition, outputAnchor } from '../../game/grainFlow';
import { grainRateForTrack, grainIndexForDisplay } from '../../engine/mxlGrainIndex';
import './GrainOverlay.css';

export interface GrainOverlayProps {
  nodes: Node<MediaFunctionNodeData>[];
  grains: Grain[];
  /** Show each grain's MXL origin-timestamp index + offset-from-now, and a
   * "writing" flash where a grain departs a node having just been written
   * into that node's output ring buffer. Off by default to avoid clutter. */
  showOriginTimestamps?: boolean;
  /** Show the raw epoch-scaled MXL grain index instead of the small ring-relative one (item #11). */
  showRealGrainIndex?: boolean;
  /** Current MXL Domain size, needed to compute the ring-relative grain index (item #11). */
  domainSizeMs: number;
  /** Shared simulated clock (item #9) — reads instead of performance.now()/Date.now()
   *  so positions/ages stay in lockstep with the HUD's playback mode. */
  getNow?: () => number;
}

/**
 * Item #12 follow-up: since item #9's edge-travel fix collapsed travel to a
 * near-instant ~1ms hop, any flash/tag tied to a *specific* transient grain
 * object (each phase transition creates a brand-new grain id) only existed
 * in the live `grains` list for a single ~40ms tick — effectively invisible
 * in Normal/Stepping mode, not just "fast." Every flash below is now
 * event-based (recorded once, keyed by something stable across that single
 * tick) and guaranteed to stay fully visible for `FLASH_VISIBLE_MS` before
 * it's even eligible to start fading over `FLASH_FADE_MS` — independent of
 * how long the underlying grain object happens to exist for. In Manual
 * playback mode the simulated clock itself is frozen, so these timers don't
 * advance at all until the player clicks "Step".
 */
const FLASH_VISIBLE_MS = 700;
const FLASH_FADE_MS = 300;

/**
 * Origin tags anchor above the node's own top edge, not at the grain dot's
 * position — a held/parked grain's dot sits right where its edge connects
 * to the box, which is exactly where incoming lines and handle labels
 * already are. A fixed spot above the box stays clear of that clutter.
 * Offset is large enough to also clear `.mf-node__stalled-badge`
 * (`MediaFunctionNode.css`, anchored at `top: -24px`), which otherwise sits
 * in the same band.
 */
const TAG_ABOVE_NODE_PX = 48;
/** Extra vertical gap between stacked video/audio tags at the same node
 *  (item #12 follow-up: one tag per node, stacked rather than spread
 *  sideways — avoids every tag at a busy node like Egress piling up in a
 *  horizontal row that no longer reads as "above the box"). */
const TAG_STACK_GAP_PX = 20;

/**
 * Item #11: rounding the displayed age to this step keeps the on-screen
 * counter changing in comfortable, readable increments (e.g. "-100ms",
 * "-200ms"...) instead of a new value every ~40ms simulation tick, which
 * reads as flicker rather than a number a human can actually track.
 */
const AGE_DISPLAY_STEP_MS = 100;

/** Matches `graphLatency.ts`'s `indexToTrack` convention (producer output 0 = video, 1 = audio). */
function grainRateForStreamIndex(streamIndex: number | undefined) {
  return grainRateForTrack(streamIndex === 1 ? 'audio' : 'video');
}

interface RetainedTag {
  x: number;
  y: number;
  idx: number;
  ageMs: number;
  streamClass: string;
  /** Underlying grain currently backing this node+stream slot — when this
   *  changes, a newer grain has taken over the slot and the guaranteed
   *  visible window restarts (item #12 follow-up: one tag per node). */
  grainId: string;
  /** Simulated-clock time this tag first appeared — guarantees `FLASH_VISIBLE_MS`
   *  of visibility before it's eligible to start fading, regardless of how
   *  briefly the underlying grain occupies this phase. */
  firstShownAt: number;
  /** Set once the owning grain is no longer in the live list *and* `FLASH_VISIBLE_MS`
   *  has elapsed since `firstShownAt` — starts the fade-out countdown. */
  removedAt?: number;
}

/** A one-time "writing #idx" event at a node's output anchor (item #10.ii /
 *  #12 follow-up) — recorded once per departure so it survives the
 *  departing grain object itself only existing for a single tick. */
interface WriteFlashEntry {
  x: number;
  y: number;
  idx: number;
  fromId: string;
  originTs: number;
  streamIndex: number | undefined;
  appearedAt: number;
}

/**
 * Renders animated grain dots flowing along edges and pausing at nodes,
 * visualizing MXL grains moving from producers through each Media Function
 * and slowing to a hold proportional to that node's processing latency
 * before continuing downstream (see `src/game/grainFlow.ts`).
 *
 * Positioned in flow coordinate space by replicating React Flow's own pane
 * transform (`translate(x, y) scale(zoom)` from `useViewport`), since this
 * version of React Flow doesn't export a `ViewportPortal` helper.
 */
export function GrainOverlay({
  nodes,
  grains,
  showOriginTimestamps = false,
  showRealGrainIndex = false,
  domainSizeMs,
  getNow = () => performance.now(),
}: GrainOverlayProps) {
  const { x, y, zoom } = useViewport();
  const geometry = buildNodeGeometry(nodes);
  const now = getNow();
  // `originTs`/age display now shares the same simulated clock as `now` (see
  // `useSimClock`), rather than a separate Date.now()-based wall clock.
  const wallNow = now;
  // Nodes that draw their own internal processing path: while a grain is held
  // there, the node's path grain *is* the grain, so drawing the overlay dot on
  // top would double it up and break the "the media being processed is the
  // media that just arrived" handoff.
  const nodesWithPath = new Set(
    nodes.filter((n) => n.data.inputCount > 0 && n.data.outputCount > 0).map((n) => n.id),
  );

  // Item #11 (D3): tags linger at their last known spot for a brief beat after
  // their grain disappears from `grains`, instead of vanishing instantly.
  const retainedTagsRef = useRef<Map<string, RetainedTag>>(new Map());
  // Item #12 follow-up: one-time "writing #idx" events, keyed by edge+origin
  // so they survive the departing grain object (which now only exists for a
  // single tick — see the `FLASH_VISIBLE_MS` doc comment above).
  const writeFlashesRef = useRef<Map<string, WriteFlashEntry>>(new Map());
  const latestSharedOriginRef = useRef<{
    originTs: number;
    videoIdx: number | string;
    audioIdx: number | string;
    appearedAt: number;
  } | null>(null);
  useEffect(() => {
    if (!showOriginTimestamps) {
      retainedTagsRef.current.clear();
      writeFlashesRef.current.clear();
      latestSharedOriginRef.current = null;
    }
  }, [showOriginTimestamps]);

  const retained = retainedTagsRef.current;
  const writeFlashes = writeFlashesRef.current;
  const currentTagIds = new Set<string>();

  // Record each departure exactly once (grain is only ever 'traveling' for a
  // single tick now) — position/index are frozen at the moment of writing.
  if (showOriginTimestamps) {
    for (const g of grains) {
      if (g.phase !== 'traveling' || !g.edgeId) continue;
      const key = `${g.edgeId}-${g.originTs}`;
      if (writeFlashes.has(key)) continue;
      const fromGeom = geometry.get(g.fromId);
      if (!fromGeom) continue;
      const anchor = outputAnchor(fromGeom, g.sourceHandleIndex ?? 0);
      writeFlashes.set(key, {
        x: anchor.x,
        y: anchor.y,
        idx: grainIndexForDisplay(
          g.originTs ?? wallNow,
          grainRateForStreamIndex(g.streamIndex),
          domainSizeMs,
          showRealGrainIndex,
        ),
        fromId: g.fromId,
        originTs: g.originTs ?? wallNow,
        streamIndex: g.streamIndex,
        appearedAt: now,
      });
    }
    // Prune fully-faded flash events.
    for (const [key, flash] of writeFlashes) {
      if (now - flash.appearedAt > FLASH_VISIBLE_MS + FLASH_FADE_MS) writeFlashes.delete(key);
    }
  }

  // Item #12 follow-up: show at most one origin tag per node per stream (the
  // most recent grain occupying that node+stream), instead of one per grain
  // id. Busy nodes like Egress — where audio commonly parks waiting on its
  // sibling video grain — would otherwise accumulate a stack of overlapping
  // tags from every grain that has ever held there.
  const latestByKey = new Map<string, Grain>();
  if (showOriginTimestamps) {
    for (const g of grains) {
      if (g.phase !== 'holding' && g.phase !== 'dropped') continue;
      const hiddenByPath =
        g.phase === 'holding' && !g.parked && !g.stalled && nodesWithPath.has(g.fromId);
      if (hiddenByPath) continue;
      const streamClass = g.streamIndex === 0 ? 'video' : g.streamIndex === 1 ? 'audio' : 'other';
      const key = `${g.fromId}|${streamClass}`;
      const existing = latestByKey.get(key);
      if (!existing || (g.originTs ?? 0) >= (existing.originTs ?? 0)) latestByKey.set(key, g);
    }
  }
  // Stack order within a node: video closest to the box, audio above it.
  const streamStackOrder: Record<string, number> = { video: 0, audio: 1, other: 2 };
  const slotsByNode = new Map<string, string[]>(); // fromId -> ordered stream keys present
  for (const key of latestByKey.keys()) {
    const [fromId, streamClass] = key.split('|');
    const list = slotsByNode.get(fromId) ?? [];
    list.push(streamClass);
    slotsByNode.set(fromId, list);
  }
  for (const list of slotsByNode.values()) list.sort((a, b) => streamStackOrder[a] - streamStackOrder[b]);

  if (showOriginTimestamps) {
    for (const [key, g] of latestByKey) {
      const [fromId, streamClass] = key.split('|');
      const idx = grainIndexForDisplay(
        g.originTs ?? wallNow,
        grainRateForStreamIndex(g.streamIndex),
        domainSizeMs,
        showRealGrainIndex,
      );
      const rawAgeMs = wallNow - (g.originTs ?? wallNow);
      const ageMs = Math.max(0, Math.round(rawAgeMs / AGE_DISPLAY_STEP_MS) * AGE_DISPLAY_STEP_MS);
      currentTagIds.add(key);
      const existing = retained.get(key);
      // Anchor above the node's top edge (not the dot's own position, which
      // for parked/holding grains sits right where an edge connects to the
      // box — exactly where incoming lines and handle labels already are).
      const hostGeom = geometry.get(fromId);
      const slot = slotsByNode.get(fromId)?.indexOf(streamClass) ?? 0;
      const tagX = hostGeom ? hostGeom.x + hostGeom.size / 2 : 0;
      const tagY = hostGeom ? hostGeom.y - TAG_ABOVE_NODE_PX - slot * TAG_STACK_GAP_PX : 0;
      // A different grain now occupies this node+stream slot — restart the
      // guaranteed-visible window rather than reusing the old grain's timer.
      const isNewOccupant = existing?.grainId !== g.id;
      retained.set(key, {
        x: tagX,
        y: tagY,
        idx,
        ageMs,
        streamClass: streamClass === 'video' ? ' grain-dot--video' : streamClass === 'audio' ? ' grain-dot--audio' : '',
        grainId: g.id,
        firstShownAt: isNewOccupant ? now : existing!.firstShownAt,
        removedAt: undefined,
      });
    }
  }

  const rows = grains.map((g) => {
    const pos = getGrainPosition(g, now, geometry);
    if (!pos) return null;

    if (g.phase === 'dropped') {
      return (
        <div key={g.id} className="grain-dot grain-dot--dropped" style={{ left: pos.x, top: pos.y }}>
          ✕
        </div>
      );
    }
    // Item #9 follow-up: the traveling dot is replaced by an edge-path pulse
    // (see `FlowCanvas.tsx`'s `displayEdges`/`.edge-pulse-active`) now that
    // travel is a near-instant simulated hop rather than a multi-hundred-ms
    // animation — the "writing" flash above still marks the departure point.
    const hiddenByPath =
      g.phase === 'traveling' || (g.phase === 'holding' && !g.parked && !g.stalled && nodesWithPath.has(g.fromId)); // handed off to the node's path or traveling (shown as an edge pulse instead)
    const streamClass =
      g.streamIndex === 0 ? ' grain-dot--video' : g.streamIndex === 1 ? ' grain-dot--audio' : '';

    return (
      <Fragment key={g.id}>
        {!hiddenByPath && (
          <div
            className={`grain-dot${streamClass}${g.phase === 'holding' ? ' grain-dot--holding' : ''}${
              g.parked ? ' grain-dot--parked' : ''
            }${g.waiting ? ' grain-dot--waiting' : ''}${g.stalled ? ' grain-dot--stalled' : ''}`}
            style={{ left: pos.x, top: pos.y }}
          />
        )}
      </Fragment>
    );
  });

  // Age out and drop tags, guaranteeing at least `FLASH_VISIBLE_MS` of total
  // visibility from first appearance before they're even eligible to start
  // the `FLASH_FADE_MS` fade-out (item #12 follow-up — see doc comment above).
  for (const [id, tag] of retained) {
    if (currentTagIds.has(id)) {
      tag.removedAt = undefined;
      continue;
    }
    if (now - tag.firstShownAt < FLASH_VISIBLE_MS) continue;
    if (tag.removedAt === undefined) {
      tag.removedAt = now;
    } else if (now - tag.removedAt > FLASH_FADE_MS) {
      retained.delete(id);
    }
  }

  const tagRows = showOriginTimestamps
    ? Array.from(retained.entries()).map(([id, tag]) => (
        <div
          key={`tag-${id}`}
          className={`grain-origin-tag${tag.removedAt !== undefined ? ' grain-origin-tag--fading' : ''}`}
          style={{ left: tag.x, top: tag.y }}
        >
          #{tag.idx} · {tag.ageMs <= 0 ? '0' : `-${tag.ageMs}`}ms
        </div>
      ))
    : null;

  const writeFlashRows = showOriginTimestamps
    ? Array.from(writeFlashes.entries()).map(([key, flash]) => (
        <div
          key={`flash-${key}`}
          className={`grain-write-flash${now - flash.appearedAt > FLASH_VISIBLE_MS ? ' grain-write-flash--fading' : ''}`}
          style={{ left: flash.x, top: flash.y }}
        >
          <span className="grain-write-flash__label">writing #{flash.idx}</span>
        </div>
      ))
    : null;

  // Item #12: video and audio grains spawned from the same producer in the
  // same instant share one `originTs` even though their derived indices
  // diverge in magnitude (see `mxlGrainIndex.ts`) — draw a brief connector
  // between their write-flash points so that shared origin is visible, not
  // The "shared origin" readout is a fixed HUD-style chip at the top of the
  // canvas (not drawn at the connector midpoint, where it collided with the
  // "writing #" labels). It keeps showing the latest shared-origin pair and
  // pulses whenever a new one is written.
  let siblingRows: JSX.Element[] | null = null;
  if (showOriginTimestamps) {
    const groups = new Map<string, WriteFlashEntry[]>();
    for (const flash of writeFlashes.values()) {
      const groupKey = `${flash.fromId}|${flash.originTs}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(flash);
    }
    siblingRows = [];
    for (const [groupKey, members] of groups) {
      if (members.length < 2) continue;
      const [a, b] = [...members].sort((m1, m2) => (m1.streamIndex ?? 0) - (m2.streamIndex ?? 0));
      const earliestAppearedAt = Math.min(...members.map((m) => m.appearedAt));
      const fading = now - earliestAppearedAt > FLASH_VISIBLE_MS;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      siblingRows.push(
        <div
          key={`sibling-${groupKey}`}
          className={`grain-sibling-link${fading ? ' grain-sibling-link--fading' : ''}`}
          style={{ left: a.x, top: a.y, width: length, transform: `rotate(${angle}deg)` }}
        />,
      );
      const latest = latestSharedOriginRef.current;
      if (!latest || a.originTs > latest.originTs) {
        latestSharedOriginRef.current = { originTs: a.originTs, videoIdx: a.idx, audioIdx: b.idx, appearedAt: now };
      }
    }
  }

  const sharedOrigin = showOriginTimestamps ? latestSharedOriginRef.current : null;
  const sharedOriginChip = sharedOrigin ? (
    <div
      key={`shared-origin-${sharedOrigin.originTs}`}
      className={`shared-origin-chip${
        now - sharedOrigin.appearedAt < FLASH_VISIBLE_MS ? ' shared-origin-chip--pulse' : ''
      }`}
    >
      <div>⏱ shared origin · V#{sharedOrigin.videoIdx} · A#{sharedOrigin.audioIdx}</div>
      <div className="shared-origin-chip__note">
        Same instant, different grain sizes — video (~20ms) and audio (~1ms) count it in their own grains, so the
        numbers differ.
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="grain-overlay" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
        {rows}
        {writeFlashRows}
        {siblingRows}
        {tagRows}
      </div>
      {sharedOriginChip}
    </>
  );
}
