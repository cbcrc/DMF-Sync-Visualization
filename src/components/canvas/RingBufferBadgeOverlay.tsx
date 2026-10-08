import { useViewport } from 'reactflow';
import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from './MediaFunctionNode';
import { buildNodeGeometry } from '../../game/grainFlow';
import type { InputReading } from '../../game/graphLatency';
import { GrainSlotStrip } from '../ui/GrainSlotStrip';
import { ContinuousBufferTrack } from '../ui/ContinuousBufferTrack';
import './RingBufferBadgeOverlay.css';

export interface RingBufferBadgeOverlayProps {
  nodes: Node<MediaFunctionNodeData>[];
  /** Per-reader-node input readings, straight from `computeGraphLatency`. */
  inputsByNodeId: Map<string, InputReading[]>;
}

/**
 * Compact per-*input* ring buffer status bars rendered directly under each
 * reader node. One row per connected input, because at a sync node the inputs
 * disagree: the slow branch reads at its own head while the fast branch's
 * grain was overwritten long ago. Positioned in flow coordinate space the same
 * way as `GrainOverlay` (replicating React Flow's pane transform).
 */
export function RingBufferBadgeOverlay({ nodes, inputsByNodeId }: RingBufferBadgeOverlayProps) {
  const { x, y, zoom } = useViewport();
  const geometry = buildNodeGeometry(nodes);
  const labelByNodeId = new Map(nodes.map((n) => [n.id, n.data.label]));

  return (
    <div className="rb-badge-overlay" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
      {nodes.map((n) => {
        const readings = inputsByNodeId.get(n.id);
        const geom = geometry.get(n.id);
        if (!readings || !geom) return null;
        return (
          <div
            key={n.id}
            className="rb-badge-stack"
            style={{ left: geom.x + geom.size / 2, top: geom.y + geom.size + 8 }}
          >
            {readings.map((reading) => {
              const { evaluation, buffer } = reading;
              const zone =
                evaluation.status === 'TOO_LATE'
                  ? 'red'
                  : evaluation.status === 'TOO_EARLY'
                    ? 'yellow'
                    : 'green';
              const statusLabel =
                evaluation.status === 'TOO_LATE'
                  ? 'READ TOO LATE'
                  : evaluation.status === 'TOO_EARLY'
                    ? 'TOO EARLY'
                    : `${Math.round(evaluation.stalenessMs)}ms behind head`;
              return (
                <div key={buffer.id} className={`rb-badge rb-badge--${zone}`}>
                  <div className="rb-badge__text">
                    ← {labelByNodeId.get(reading.sourceNodeId) ?? reading.sourceNodeId} · {statusLabel}
                  </div>
                  {reading.track === 'audio' ? (
                    <ContinuousBufferTrack
                      label={labelByNodeId.get(reading.sourceNodeId) ?? reading.sourceNodeId}
                      buffer={buffer}
                      evaluation={evaluation}
                      alignmentSpanMs={reading.alignmentSpanMs}
                      compact
                    />
                  ) : (
                    <GrainSlotStrip buffer={buffer} evaluation={evaluation} compact />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
