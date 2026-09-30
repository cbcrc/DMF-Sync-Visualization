import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../canvas/MediaFunctionNode';
import type { GraphBufferState } from '../../game/graphLatency';
import { RingBufferGauge } from './RingBufferGauge';
import { RingBufferRing } from './RingBufferRing';
import { GrainSlotStrip } from './GrainSlotStrip';
import './RingBufferPanel.css';

export interface RingBufferPanelProps {
  nodes: Node<MediaFunctionNodeData>[];
  graph: GraphBufferState;
}

/**
 * Live ring buffer telemetry, one block per reader *input* rather than per
 * node: at a sync point the inputs disagree, and that disagreement is the
 * whole lesson. Each input shows the linear retained-history track plus the
 * discrete MXL slot dial for the flow it reads.
 */
export function RingBufferPanel({ nodes, graph }: RingBufferPanelProps) {
  const labelByNodeId = new Map(nodes.map((n) => [n.id, n.data.label]));
  const readers = nodes.filter((n) => graph.inputsByNodeId.has(n.id));

  return (
    <div className="rb-panel">
      <div className="rb-panel__title">MXL Ring Buffer Telemetry (live)</div>
      <div className="rb-panel__clock">
        Domain clock g{graph.grainCount > 0 ? Math.floor(graph.timestampMs / graph.grainDurationMs) : 0} ·{' '}
        {graph.grainDurationMs}ms grains · {graph.grainCount} slots/window
      </div>
      {readers.length === 0 && (
        <div className="rb-panel__empty">No reader inputs yet — connect a node's input.</div>
      )}
      {readers.map((n) => {
        const readings = graph.inputsByNodeId.get(n.id)!;
        return (
          <div key={n.id} className="rb-panel__group">
            <div className="rb-panel__group-title">{n.data.label}</div>
            {readings.map((reading) => {
              const source = labelByNodeId.get(reading.sourceNodeId) ?? reading.sourceNodeId;
              return (
                <div key={reading.buffer.id} className="rb-panel__entry">
                  <RingBufferGauge label={`← ${source}`} buffer={reading.buffer} evaluation={reading.evaluation} />
                  <GrainSlotStrip buffer={reading.buffer} evaluation={reading.evaluation} />
                  <RingBufferRing label={`← ${source}`} buffer={reading.buffer} evaluation={reading.evaluation} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
