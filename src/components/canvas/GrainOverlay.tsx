import { useViewport } from 'reactflow';
import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from './MediaFunctionNode';
import type { Grain } from '../../game/grainFlow';
import { buildNodeGeometry, getGrainPosition } from '../../game/grainFlow';
import './GrainOverlay.css';

export interface GrainOverlayProps {
  nodes: Node<MediaFunctionNodeData>[];
  grains: Grain[];
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
export function GrainOverlay({ nodes, grains }: GrainOverlayProps) {
  const { x, y, zoom } = useViewport();
  const geometry = buildNodeGeometry(nodes);
  const now = performance.now();
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
        if (g.phase === 'dropped') {
          return (
            <div key={g.id} className="grain-dot grain-dot--dropped" style={{ left: pos.x, top: pos.y }}>
              ✕
            </div>
          );
        }
        if (g.phase === 'holding' && !g.parked && !g.stalled && nodesWithPath.has(g.fromId)) return null; // handed off to the node's path
        const streamClass =
          g.streamIndex === 0 ? ' grain-dot--video' : g.streamIndex === 1 ? ' grain-dot--audio' : '';
        return (
          <div
            key={g.id}
            className={`grain-dot${streamClass}${g.phase === 'holding' ? ' grain-dot--holding' : ''}${
              g.parked ? ' grain-dot--parked' : ''
            }${g.waiting ? ' grain-dot--waiting' : ''}${g.stalled ? ' grain-dot--stalled' : ''}`}
            style={{ left: pos.x, top: pos.y }}
          />
        );
      })}
    </div>
  );
}
