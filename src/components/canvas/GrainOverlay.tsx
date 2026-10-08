import { Fragment } from 'react';
import { useViewport } from 'reactflow';
import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from './MediaFunctionNode';
import type { Grain } from '../../game/grainFlow';
import { buildNodeGeometry, getGrainPosition, outputAnchor } from '../../game/grainFlow';
import { grainRateForTrack, timestampToGrainIndex } from '../../engine/mxlGrainIndex';
import './GrainOverlay.css';

export interface GrainOverlayProps {
  nodes: Node<MediaFunctionNodeData>[];
  grains: Grain[];
  /** Show each grain's MXL origin-timestamp index + offset-from-now, and a
   * "writing" flash where a grain departs a node having just been written
   * into that node's output ring buffer. Off by default to avoid clutter. */
  showOriginTimestamps?: boolean;
}

/** How long (ms) after a grain embarks on an edge the "writing" flash shows at its departure point. */
const WRITE_FLASH_MS = 250;

/** Matches `graphLatency.ts`'s `indexToTrack` convention (producer output 0 = video, 1 = audio). */
function grainRateForStreamIndex(streamIndex: number | undefined) {
  return grainRateForTrack(streamIndex === 1 ? 'audio' : 'video');
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
export function GrainOverlay({ nodes, grains, showOriginTimestamps = false }: GrainOverlayProps) {
  const { x, y, zoom } = useViewport();
  const geometry = buildNodeGeometry(nodes);
  const now = performance.now();
  const wallNow = Date.now();
  // Nodes that draw their own internal processing path: while a grain is held
  // there, the node's path grain *is* the grain, so drawing the overlay dot on
  // top would double it up and break the "the media being processed is the
  // media that just arrived" handoff.
  const nodesWithPath = new Set(
    nodes.filter((n) => n.data.inputCount > 0 && n.data.outputCount > 0).map((n) => n.id),
  );

  return (
    <div className="grain-overlay" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
      {grains.map((g) => {
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
              idx: timestampToGrainIndex(g.originTs ?? wallNow, grainRateForStreamIndex(g.streamIndex)),
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
        const hiddenByPath = g.phase === 'holding' && !g.parked && !g.stalled && nodesWithPath.has(g.fromId); // handed off to the node's path
        const streamClass =
          g.streamIndex === 0 ? ' grain-dot--video' : g.streamIndex === 1 ? ' grain-dot--audio' : '';
        const originIdx = showOriginTimestamps
          ? timestampToGrainIndex(g.originTs ?? wallNow, grainRateForStreamIndex(g.streamIndex))
          : null;
        const ageMs = showOriginTimestamps ? wallNow - (g.originTs ?? wallNow) : null;
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
            {!hiddenByPath && showOriginTimestamps && originIdx !== null && (
              <div className="grain-origin-tag" style={{ left: pos.x, top: pos.y }}>
                #{originIdx} · {ageMs! <= 0 ? '0' : `-${ageMs}`}ms
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
