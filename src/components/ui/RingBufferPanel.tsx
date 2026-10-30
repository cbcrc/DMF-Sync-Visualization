import { useState } from 'react';
import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../canvas/MediaFunctionNode';
import type { GraphBufferState } from '../../game/graphLatency';
import { groupReadingsByWriter } from '../../game/writerRings';
import { ClockStrip } from './ClockStrip';
import { WriterRing } from './WriterRing';
import { RingBufferGauge } from './RingBufferGauge';
import { GrainSlotStrip } from './GrainSlotStrip';
import { ContinuousBufferTrack } from './ContinuousBufferTrack';
import './RingBufferPanel.css';

export interface RingBufferPanelProps {
  nodes: Node<MediaFunctionNodeData>[];
  graph: GraphBufferState;
  domainSizeMs: number;
  /** Mirrors the HUD's "Use real MXL index" toggle (item #11). */
  showRealGrainIndex: boolean;
  /**
   * Reader inputs (keyed `${nodeId}:${inputIndex}`) that currently have a grain
   * parked on canvas waiting for a sync sibling — highlights the matching row so
   * a player sees the canvas parking and this panel's "waiting" telemetry as one
   * correlated event rather than two disconnected visuals.
   */
  parkedInputKeys?: Set<string>;
  /** Reader function currently focused; rings it reads from, and its markers, are highlighted. */
  focusedNodeId?: string | null;
  onFocusNode?: (nodeId: string | null) => void;
}

/**
 * Live MXL clock (the operator can close it) plus ring buffer telemetry for the
 * selected function only, one block per *writer* flow: a ring is a
 * property of the writer, and every function reading it is a marker on that
 * one ring (`WriterRing`), so several readers at different points in time can
 * be compared against the same head and "now". Each reader keeps its own
 * detail below: the linear gauge plus, for video/data, the grain-slot strip.
 * Audio writers are MXL Continuous buffers, so they get only the
 * now-bar (no slot ring), and each reader's detail is the slot-free
 * `ContinuousBufferTrack`.
 */
export function RingBufferPanel({
  nodes,
  graph,
  domainSizeMs,
  showRealGrainIndex,
  parkedInputKeys,
  focusedNodeId = null,
  onFocusNode,
}: RingBufferPanelProps) {
  const labelByNodeId = new Map(nodes.map((n) => [n.id, n.data.label]));
  const [clockOpen, setClockOpen] = useState(true);
  // Ring buffers appear only for the selected function: the ones it writes and the ones it reads.
  const writers =
    focusedNodeId === null
      ? []
      : groupReadingsByWriter(graph).filter(
          (ring) => ring.writerNodeId === focusedNodeId || ring.readers.some((r) => r.readerNodeId === focusedNodeId),
        );

  return (
    <div className="rb-panel">
      {clockOpen ? (
        <>
          <div className="rb-panel__header">
            <div className="rb-panel__title">MXL Clock · TAI (live)</div>
            <button type="button" className="rb-panel__close" onClick={() => setClockOpen(false)} aria-label="Close clock">
              ×
            </button>
          </div>
          <ClockStrip
            timestampMs={graph.timestampMs}
            grainRate={graph.grainRate}
            grainDurationMs={graph.grainDurationMs}
            grainCount={graph.grainCount}
            domainSizeMs={domainSizeMs}
            showRealGrainIndex={showRealGrainIndex}
          />
          <div className="rb-panel__clock">
            {graph.grainDurationMs}ms grains · {graph.grainCount} slots/window
            <span className="rb-panel__clock-note"> (each flow's ring buffer uses its own track's grain rate)</span>
          </div>
        </>
      ) : (
        <button type="button" className="rb-panel-toggle" onClick={() => setClockOpen(true)}>
          MXL clock
        </button>
      )}
      {focusedNodeId !== null && writers.length === 0 && (
        <div className="rb-panel__empty">This function has no ring buffers to show yet — connect an input or an output.</div>
      )}
      {writers.map((ring) => {
        const writerLabel = labelByNodeId.get(ring.writerNodeId) ?? ring.writerNodeId;
        const holdsFocus = ring.readers.some((r) => r.readerNodeId === focusedNodeId);
        return (
          <div key={ring.key} className={`rb-panel__group${holdsFocus ? ' rb-panel__group--focused' : ''}`}>
            <div className="rb-panel__group-title">
              {writerLabel} <span className="rb-panel__track">{ring.track}</span>
            </div>
            <WriterRing
              ring={ring}
              writerLabel={writerLabel}
              labelByNodeId={labelByNodeId}
              parkedInputKeys={parkedInputKeys}
              focusedNodeId={focusedNodeId}
              onFocusNode={onFocusNode}
              barOnly={ring.track === 'audio'}
              showRealGrainIndex={showRealGrainIndex}
            />
            {ring.readers.map((reader, i) => {
              const { reading } = reader;
              const readerLabel = labelByNodeId.get(reader.readerNodeId) ?? reader.readerNodeId;
              const label = `${i + 1} → ${readerLabel}`;
              const isParked = parkedInputKeys?.has(reader.key) ?? false;
              return (
                <div key={reader.key} className={`rb-panel__entry${isParked ? ' rb-panel__entry--parked' : ''}`}>
                  <RingBufferGauge label={label} buffer={reading.buffer} evaluation={reading.evaluation} />
                  {reading.track === 'audio' ? (
                    <ContinuousBufferTrack
                      label={label}
                      buffer={reading.buffer}
                      evaluation={reading.evaluation}
                      alignmentSpanMs={reading.alignmentSpanMs}
                      parked={isParked}
                    />
                  ) : (
                    <GrainSlotStrip buffer={reading.buffer} evaluation={reading.evaluation} />
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
