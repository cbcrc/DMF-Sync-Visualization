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

/** How long (ms) after a grain embarks on an edge the "writing" flash shows at its departure point. */
const WRITE_FLASH_MS = 250;

/**
 * Item #11: rounding the displayed age to this step keeps the on-screen
 * counter changing in comfortable, readable increments (e.g. "-100ms",
 * "-200ms"...) instead of a new value every ~40ms simulation tick, which
 * reads as flicker rather than a number a human can actually track.
 */
const AGE_DISPLAY_STEP_MS = 100;

/**
 * Item #11: how long a tag keeps rendering (fading out) at its last known
 * position after its grain leaves the live `grains` list, so a fast-traveling
 * grain's tag doesn't vanish before a player has had a chance to read it.
 */
const TAG_LINGER_MS = 220;

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
  /** Set once the owning grain is no longer in the live list — starts the fade-out countdown. */
  removedAt?: number;
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
  useEffect(() => {
    if (!showOriginTimestamps) retainedTagsRef.current.clear();
  }, [showOriginTimestamps]);

  const retained = retainedTagsRef.current;
  const currentTagIds = new Set<string>();

  const rows = grains.map((g) => {
    const pos = getGrainPosition(g, now, geometry);
    if (!pos) return null;

    // Just embarked on an edge: this is the moment the departing node's
    // output ring buffer was "written" — flash a brief pulse at the
    // exact anchor point it left from, labeled with the grain index it
    // was written at (MXL preserves this index all the way downstream).
    let writeFlash: { flashX: number; flashY: number; idx: number } | null = null;
    if (showOriginTimestamps && g.phase === 'traveling' && now - g.startTime < WRITE_FLASH_MS) {
      const fromGeom = geometry.get(g.fromId);
      if (fromGeom) {
        const anchor = outputAnchor(fromGeom, g.sourceHandleIndex ?? 0);
        writeFlash = {
          flashX: anchor.x,
          flashY: anchor.y,
          idx: grainIndexForDisplay(
            g.originTs ?? wallNow,
            grainRateForStreamIndex(g.streamIndex),
            domainSizeMs,
            showRealGrainIndex,
          ),
        };
      }
    }

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

    if (!hiddenByPath && showOriginTimestamps) {
      const idx = grainIndexForDisplay(
        g.originTs ?? wallNow,
        grainRateForStreamIndex(g.streamIndex),
        domainSizeMs,
        showRealGrainIndex,
      );
      const rawAgeMs = wallNow - (g.originTs ?? wallNow);
      const ageMs = Math.max(0, Math.round(rawAgeMs / AGE_DISPLAY_STEP_MS) * AGE_DISPLAY_STEP_MS);
      currentTagIds.add(g.id);
      retained.set(g.id, { x: pos.x, y: pos.y, idx, ageMs, streamClass, removedAt: undefined });
    }

    return (
      <Fragment key={g.id}>
        {writeFlash && (
          <div className="grain-write-flash" style={{ left: writeFlash.flashX, top: writeFlash.flashY }}>
            <span className="grain-write-flash__label">writing #{writeFlash.idx}</span>
          </div>
        )}
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

  // Age out and drop tags whose grain is no longer present, after a short linger.
  for (const [id, tag] of retained) {
    if (currentTagIds.has(id)) continue;
    if (tag.removedAt === undefined) {
      tag.removedAt = now;
    } else if (now - tag.removedAt > TAG_LINGER_MS) {
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

  return (
    <div className="grain-overlay" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
      {rows}
      {tagRows}
    </div>
  );
}
