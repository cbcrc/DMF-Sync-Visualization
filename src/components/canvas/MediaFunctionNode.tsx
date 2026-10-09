import { Handle, Position, type NodeProps } from 'reactflow';
import type { MediaFunctionKind } from '../../types';
import { nodeSizeForLatency } from './nodeSizing';
import { LATENCY_RANGE } from './nodeDefaults';
import { grainRateForTrack, grainIndexForDisplay } from '../../engine/mxlGrainIndex';
import './MediaFunctionNode.css';

/** Data payload for a Media Function node on the canvas (subset of `MediaFunction`). */
export interface MediaFunctionNodeData {
  kind: MediaFunctionKind;
  label: string;
  latencyMs: number;
  inputCount: number;
  outputCount: number;
  /** Live Ring Buffer zone for this node's input (Task 4), if it's a reader. */
  zone?: 'green' | 'yellow' | 'red';
  /** True while a grain is currently "held" at this node, processing (Task 4 grain-flow viz). */
  processing?: boolean;
  /**
   * Timing of the grain currently being processed, so the node's internal path
   * animation starts when that grain *arrives* rather than looping free. The
   * start time doubles as a React key, restarting the animation per arrival.
   */
  processingStartedAt?: number;
  processingDurationMs?: number;
  /** The held grain arrived on an input whose reader is running ahead (TOO_EARLY). */
  processingWaiting?: boolean;
  /** Which producer output branch the held grain descends from (0/1 = video/audio by convention), for color-coding. */
  processingStreamIndex?: number;
  /**
   * Origin capture timestamp (`Date.now()`-based) of the grain currently held
   * here, unchanged from when its producer first wrote it — shown (when
   * `showOriginTimestamps`) to demonstrate that processing never re-stamps a
   * grain with a new reference time (item #10.iii).
   */
  processingOriginTs?: number;
  /** Mirrors the HUD's "Show origin timestamps" toggle (`App.tsx`). */
  showOriginTimestamps?: boolean;
  /** Mirrors the HUD's "Use real MXL index" toggle (item #11, `App.tsx`). */
  showRealGrainIndex?: boolean;
  /** Current MXL Domain size, needed to compute the ring-relative grain index (item #11). */
  domainSizeMs?: number;
  /** Set when this node is waiting on a synchronized sibling flow that suffered an overrun drop. */
  syncStalled?: boolean;
  /**
   * Set by the canvas so the node can retune its own processing latency —
   * this is the player's "efficiency" control for a Media Function.
   */
  onLatencyChange?: (nodeId: string, latencyMs: number) => void;
}

/** Short glyph + display name per kind, used since this app has no icon library. */
const KIND_META: Record<MediaFunctionKind, { glyph: string; name: string }> = {
  input: { glyph: '▶', name: 'Input' },
  synthetic: { glyph: '✦', name: 'Synthetic' },
  editorial: { glyph: '⇄', name: 'Editorial' },
  technical: { glyph: '⚙', name: 'Technical' },
  recording: { glyph: '●', name: 'Recording' },
  repeater: { glyph: '↻', name: 'Repeater' },
  output: { glyph: '■', name: 'Output' },
};

/**
 * Evenly space `count` handles along a node edge, returning percentage offsets.
 */
function handleOffsets(count: number): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 1) / (count + 1)) * 100);
}

/** Custom React Flow node rendering a Media Function, sized by its processing latency. */
export function MediaFunctionNode({ id, data, selected }: NodeProps<MediaFunctionNodeData>) {
  const size = nodeSizeForLatency(data.latencyMs);
  const meta = KIND_META[data.kind];
  const zoneClass = data.zone ? ` mf-node--zone-${data.zone}` : '';
  const processingClass = data.processing ? ' mf-node--processing' : '';
  const stalledClass = data.syncStalled ? ' mf-node--stalled' : '';
  const range = LATENCY_RANGE[data.kind];
  const adjustable = range !== undefined && data.onLatencyChange !== undefined;

  return (
    <div
      className={`mf-node${selected ? ' mf-node--selected' : ''}${zoneClass}${processingClass}${stalledClass}`}
      style={{ width: size, height: size }}
    >
      {data.syncStalled && (
        <div className="mf-node__stalled-badge" title="Synchronization stalled: sibling flow dropped">
          ⚠ Sync Stalled: sibling flow dropped
        </div>
      )}
      {data.inputCount > 0 &&
        handleOffsets(data.inputCount).map((top, i) => (
          <Handle
            key={`in-${i}`}
            id={`in-${i}`}
            type="target"
            position={Position.Left}
            style={{ top: `${top}%` }}
          />
        ))}

      <div className="mf-node__glyph">{meta.glyph}</div>
      <div className="mf-node__label">{data.label}</div>
      <div className="mf-node__kind">{meta.name}</div>

      {/* Internal processing path. The grain only exists while one is actually
          being held here, and crosses the track exactly once over that hold —
          so the dot the user just watched arrive is visibly the dot being
          processed. Slow functions therefore crawl, fast ones dart across. */}
      {data.inputCount > 0 && data.outputCount > 0 && (
        <div className="mf-node__path" title={`${data.latencyMs}ms processing path`}>
          <div className="mf-node__path-track" />
          {data.processing && data.processingDurationMs !== undefined && (
            <div
              // Keyed on arrival time so each new grain restarts the traversal.
              key={data.processingStartedAt}
              className={`mf-node__path-grain${
                data.processingStreamIndex === 0
                  ? ' mf-node__path-grain--video'
                  : data.processingStreamIndex === 1
                    ? ' mf-node__path-grain--audio'
                    : ''
              }${data.processingWaiting ? ' mf-node__path-grain--waiting' : ''}`}
              style={{ animationDuration: `${data.processingDurationMs}ms` }}
            />
          )}
          {data.processing && data.showOriginTimestamps && data.processingOriginTs !== undefined && (
            <div
              className="mf-node__ref-badge"
              title="Grain time reference carried through processing unchanged — this node does not re-stamp it"
            >
              ref #{grainIndexForDisplay(
                data.processingOriginTs,
                grainRateForTrack(data.processingStreamIndex === 1 ? 'audio' : 'video'),
                data.domainSizeMs ?? 100,
                data.showRealGrainIndex ?? false,
              )} kept
            </div>
          )}
        </div>
      )}

      {adjustable ? (
        // `nodrag`/`nowheel` stop React Flow from panning the node while the
        // player is dragging the slider.
        <div className="mf-node__tune nodrag nowheel">
          <input
            type="range"
            className="mf-node__slider"
            min={range.min}
            max={range.max}
            step={range.step}
            value={data.latencyMs}
            aria-label={`${data.label} processing latency in milliseconds`}
            onChange={(e) => data.onLatencyChange?.(id, Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <div className="mf-node__latency">{data.latencyMs}ms</div>
        </div>
      ) : (
        data.latencyMs > 0 && <div className="mf-node__latency">{data.latencyMs}ms</div>
      )}

      {data.outputCount > 0 &&
        handleOffsets(data.outputCount).map((top, i) => (
          <Handle
            key={`out-${i}`}
            id={`out-${i}`}
            type="source"
            position={Position.Right}
            style={{ top: `${top}%` }}
          />
        ))}
    </div>
  );
}
