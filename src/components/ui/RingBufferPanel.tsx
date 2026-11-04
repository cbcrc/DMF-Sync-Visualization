import type { Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../canvas/MediaFunctionNode';
import type { GraphBufferState } from '../../game/graphLatency';
import { groupReadingsByWriter } from '../../game/writerRings';
import { ClockStrip } from './ClockStrip';
import { WriterRing } from './WriterRing';
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
  /** Which sub-panes are shown; each is minimized from its own header and restored from the toolbar. */
  showClock: boolean;
  showRings: boolean;
  onMinimizeClock: () => void;
  onMinimizeRings: () => void;
  /** Sim clock, so the ring heads keep moving between graph ticks. */
  getNow?: () => number;
}

/**
 * Live MXL clock (the operator can close it) plus ring buffer telemetry for the
 * selected function only (the flows it writes), one block per *writer* flow: a ring is a
 * property of the writer, and every function reading it is a marker on that
 * one ring (`WriterRing`), so several readers at different points in time can
 * be compared against the same head and "now".
 */
export function RingBufferPanel({
  nodes,
  graph,
  domainSizeMs,
  showRealGrainIndex,
  parkedInputKeys,
  focusedNodeId = null,
  onFocusNode,
  showClock,
  showRings,
  onMinimizeClock,
  onMinimizeRings,
  getNow,
}: RingBufferPanelProps) {
  const labelByNodeId = new Map(nodes.map((n) => [n.id, n.data.label]));
  // Only the selected function's own rings (the flows it writes). A function that writes nothing,
  // such as a recorder, shows the rings it reads instead so the panel isn't empty.
  const allRings = focusedNodeId === null ? [] : groupReadingsByWriter(graph);
  const ownRings = allRings.filter((ring) => ring.writerNodeId === focusedNodeId);
  const writers =
    ownRings.length > 0 ? ownRings : allRings.filter((ring) => ring.readers.some((r) => r.readerNodeId === focusedNodeId));

  return (
    <div className="rb-panel">
      {showClock && (
        <div className="rb-panel__card">
          <div className="rb-panel__header">
            <button type="button" className="rb-panel__close" onClick={onMinimizeClock} aria-label="Minimize clock" title="Minimize">
              –
            </button>
          </div>
          <ClockStrip
            timestampMs={graph.timestampMs}
            grainRate={graph.grainRate}
            grainDurationMs={graph.grainDurationMs}
            domainSizeMs={domainSizeMs}
            showRealGrainIndex={showRealGrainIndex}
          />
          <div className="rb-panel__clock">
            {graph.grainDurationMs}ms grains
            <span className="rb-panel__clock-note"> (each flow's ring buffer uses its own track's grain rate)</span>
          </div>
        </div>
      )}
      {showRings && (
        <div className="rb-panel__card">
      <div className="rb-panel__header">
        <button type="button" className="rb-panel__close" onClick={onMinimizeRings} aria-label="Minimize ring buffers" title="Minimize">
          –
        </button>
      </div>
      {focusedNodeId === null && (
        <div className="rb-panel__empty">Select a media function on the canvas to see its ring buffers.</div>
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
              audio={ring.track === 'audio'}
              showRealGrainIndex={showRealGrainIndex}
              getNow={getNow}
              snapshotMs={graph.timestampMs}
            />
          </div>
        );
      })}
        </div>
      )}
    </div>
  );
}
