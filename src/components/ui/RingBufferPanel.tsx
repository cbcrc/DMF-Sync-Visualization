import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../canvas/MediaFunctionNode';
import type { GraphBufferState } from '../../game/graphLatency';
import { RingBufferGauge } from './RingBufferGauge';
import { RingBufferRing } from './RingBufferRing';
import { GrainSlotStrip } from './GrainSlotStrip';
import { ContinuousBufferTrack } from './ContinuousBufferTrack';
import './RingBufferPanel.css';

export interface RingBufferPanelProps {
  nodes: Node<MediaFunctionNodeData>[];
  graph: GraphBufferState;
  /**
   * Reader inputs (keyed `${nodeId}:${inputIndex}`) that currently have a grain
   * parked on canvas waiting for a sync sibling — highlights the matching row so
   * a player sees the canvas parking and this panel's "waiting" telemetry as one
   * correlated event rather than two disconnected visuals.
   */
  parkedInputKeys?: Set<string>;
}

/**
 * Live ring buffer telemetry, one block per reader *input* rather than per
 * node: at a sync point the inputs disagree, and that disagreement is the
 * whole lesson. Video/data inputs show the discrete MXL grain-slot strip and
 * ring dial; audio inputs show `ContinuousBufferTrack` instead, modelling
 * MXL's Continuous (not Discrete) ring buffer with a slot-free, time-based
 * visualization whose read marker is always visible (see that component's
 * doc comment). All inputs also get the track-agnostic linear gauge.
 */
export function RingBufferPanel({ nodes, graph, parkedInputKeys }: RingBufferPanelProps) {
  const labelByNodeId = new Map(nodes.map((n) => [n.id, n.data.label]));
  const readers = nodes.filter((n) => graph.inputsByNodeId.has(n.id));

  return (
    <div className="rb-panel">
      <div className="rb-panel__title">MXL Ring Buffer Telemetry (live)</div>
      <div className="rb-panel__clock">
        Video domain clock g{graph.grainCount > 0 ? Math.floor(graph.timestampMs / graph.grainDurationMs) : 0} ·{' '}
        {graph.grainDurationMs}ms grains · {graph.grainCount} slots/window
        <span className="rb-panel__clock-note"> (each input below uses its own track's grain rate)</span>
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
              const isParked = parkedInputKeys?.has(`${reading.readerNodeId}:${reading.inputIndex}`) ?? false;
              return (
                <div key={reading.buffer.id} className={`rb-panel__entry${isParked ? ' rb-panel__entry--parked' : ''}`}>
                  <RingBufferGauge label={`← ${source}`} buffer={reading.buffer} evaluation={reading.evaluation} />
                  {reading.track === 'audio' ? (
                    <ContinuousBufferTrack
                      label={`← ${source}`}
                      buffer={reading.buffer}
                      evaluation={reading.evaluation}
                      alignmentSpanMs={reading.alignmentSpanMs}
                      parked={isParked}
                    />
                  ) : (
                    <>
                      <GrainSlotStrip buffer={reading.buffer} evaluation={reading.evaluation} />
                      <RingBufferRing label={`← ${source}`} buffer={reading.buffer} evaluation={reading.evaluation} />
                    </>
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
