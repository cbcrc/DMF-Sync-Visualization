import { useEffect, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow';
import type { MediaFunctionKind } from '../../types';
import { nodeSizeForLatency } from './nodeSizing';
import { hasSyncChoice } from '../../game/syncInputs';
import { DELAY_MAX_MS, LATENCY_RANGE, outputModeOf } from './nodeDefaults';
import { grainRateForTrack, grainIndexForDisplay } from '../../engine/mxlGrainIndex';
import type { WriterRing } from '../../game/writerRings';
import { RingBufferStrip } from './RingBufferStrip';
import './MediaFunctionNode.css';

/** Which flows a producer writes: one ring for each. */
export type OutputMode = 'video' | 'audio' | 'both';

/** Data payload for a Media Function node on the canvas (subset of `MediaFunction`). */
export interface MediaFunctionNodeData {
  kind: MediaFunctionKind;
  label: string;
  latencyMs: number;
  inputCount: number;
  outputCount: number;
  /**
   * Audio-only producer: its one output carries the audio flow, so the handle
   * is `out-1` (the video/audio-by-handle convention) rather than `out-0`.
   */
  audioOnly?: boolean;
  /** Video-only function: reads video sources only. */
  videoOnly?: boolean;
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
  /** This reader is the focused one: its inbound links and ring pointers are highlighted too. */
  focused?: boolean;
  /**
   * Set by the canvas so the node can retune its own processing latency —
   * this is the player's "efficiency" control for a Media Function.
   */
  onLatencyChange?: (nodeId: string, latencyMs: number) => void;
  /** Lets the player rename this function by clicking its label. */
  onLabelChange?: (nodeId: string, label: string) => void;
  /** This function's own ring buffers (one per output flow), drawn as part of its block. */
  rings?: WriterRing[];
  labelByNodeId?: Map<string, string>;
  focusedNodeId?: string | null;
  /** Show wall-clock "now" on each ring, to see how far behind it the writer is. */
  showNow?: boolean;
  onFocusNode?: (nodeId: string | null) => void;
  /** Output only: release together with every other Output that has this on; off = as fast as possible. */
  syncOutputs?: boolean;
  onSyncOutputsChange?: (nodeId: string, synced: boolean) => void;
  /** Mixer inputs (by index) that ignore sync and read as close to the write head as possible. */
  ignoreSyncInputs?: number[];
  onSyncInputChange?: (nodeId: string, inputIndex: number, ignoreSync: boolean) => void;
  /** Lets an Input or Output switch between video only, audio only, or both flows. */
  onOutputModeChange?: (nodeId: string, mode: OutputMode) => void;
}

const MODE_LABEL: Record<OutputMode, string> = { video: 'Video only', audio: 'Audio only', both: 'Audio + video' };

/** Short glyph + display name per kind, used since this app has no icon library. */
const KIND_META: Record<MediaFunctionKind, { glyph: string; name: string }> = {
  input: { glyph: '▶', name: 'Input' },
  synthetic: { glyph: '✦', name: 'Synthetic' },
  editorial: { glyph: '⇄', name: 'Editorial' },
  technical: { glyph: '⚙', name: 'Technical' },
  recording: { glyph: '●', name: 'Recording' },
  repeater: { glyph: '↻', name: 'Repeater' },
  delay: { glyph: '⏳', name: 'Delay' },
  output: { glyph: '■', name: 'Output' },
};

/**
 * Evenly space `count` handles along a node edge, returning percentage offsets.
 */
function handleOffsets(count: number): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 1) / (count + 1)) * 100);
}

/** Click-to-edit function name. Enter/blur commits, Escape cancels, a blank name is ignored. */
function EditableLabel({ id, label, onChange }: { id: string; label: string; onChange?: (id: string, label: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!onChange) return <div className="mf-node__label">{label}</div>;
  if (draft === null) {
    return (
      <div
        className="mf-node__label mf-node__label--editable nodrag"
        title="Click to rename"
        role="button"
        tabIndex={0}
        onClick={() => setDraft(label)}
        onKeyDown={(e) => e.key === 'Enter' && setDraft(label)}
      >
        {label}
      </div>
    );
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) onChange(id, next);
    setDraft(null);
  };
  return (
    <input
      className="mf-node__label-input nodrag"
      value={draft}
      maxLength={40}
      autoFocus
      aria-label="Function name"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep Backspace/Delete from deleting the node
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setDraft(null);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
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

  // Producers (Input) and sinks (Output) choose which flows they carry.
  const hasFlowMode = (data.inputCount === 0 && data.outputCount > 0) || (data.kind === 'output' && data.outputCount === 0);
  const outputIds = data.outputCount === 0
    ? []
    : data.audioOnly
    ? ['out-1']
    : Array.from({ length: data.outputCount }, (_, i) => `out-${i}`);
  const rings = data.rings ?? [];
  const ringHandleIds = new Set(rings.map((r) => r.handleId));

  // React Flow caches handle positions. Handles move when the connector count
  // or layout changes without the node resizing, so refresh them or links
  // keep attaching where the handle used to be.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleLayoutKey = `${data.inputCount}|${data.outputCount}|${data.audioOnly ? 'a' : ''}|${size}|${rings.map((r) => r.handleId).join(',')}`;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleLayoutKey, updateNodeInternals]);

  return (
    <div className="mf-block">
    <div
      className={`mf-node${selected || data.focused ? ' mf-node--selected' : ''}${zoneClass}${processingClass}${stalledClass}`}
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
      {hasSyncChoice(data) &&
        data.onSyncInputChange &&
        handleOffsets(data.inputCount).map((top, i) => {
          const ignored = data.ignoreSyncInputs?.includes(i) ?? false;
          return (
            <button
              key={`sync-${i}`}
              type="button"
              className={`mf-node__input-sync nodrag${ignored ? ' mf-node__input-sync--free' : ''}`}
              style={{ top: `${top}%` }}
              title={
                ignored
                  ? `Input ${i + 1} ignores sync: read as close to the write head as possible, and the function does not wait for it. Click to force sync.`
                  : `Input ${i + 1} is synced: read at the grain index aligned with the other synced inputs. Click to ignore sync.`
              }
              aria-pressed={ignored}
              onClick={() => data.onSyncInputChange?.(id, i, !ignored)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {ignored ? 'live' : 'sync'}
            </button>
          );
        })}

      <div className="mf-node__glyph">{meta.glyph}</div>
      <EditableLabel id={id} label={data.label} onChange={data.onLabelChange} />
      {hasFlowMode && data.onOutputModeChange ? (
        <select
          className="mf-node__mode nodrag"
          value={outputModeOf(data)}
          aria-label={`${data.label} output flows`}
          onChange={(e) => data.onOutputModeChange?.(id, e.target.value as OutputMode)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(Object.keys(MODE_LABEL) as OutputMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      ) : (
        <div className="mf-node__kind">{data.audioOnly ? `Audio ${meta.name}` : data.videoOnly ? `Video ${meta.name}` : meta.name}</div>
      )}

      {data.kind === 'output' && data.onSyncOutputsChange && (
        <label
          className="mf-node__sync nodrag"
          title="Synced: released together with the other synced Outputs. Unchecked: consumed as fast as possible."
        >
          <input
            type="checkbox"
            checked={data.syncOutputs ?? false}
            onChange={(e) => data.onSyncOutputsChange?.(id, e.target.checked)}
            onPointerDown={(e) => e.stopPropagation()}
          />
          Sync outputs
        </label>
      )}

      {data.kind === 'delay' && (
        <div
          className="mf-node__delay"
          title={`Media is parked in this node's own buffer for ${data.latencyMs}ms (up to ${DELAY_MAX_MS}ms), outside the MXL ring buffers, then re-written into the MXL Domain as a new source.`}
        >
          <div className="mf-node__delay-label">Delay buffer · {DELAY_MAX_MS / 1000}s max</div>
          <div className="mf-node__delay-bar">
            <div className="mf-node__delay-fill" style={{ width: `${Math.min(100, (data.latencyMs / DELAY_MAX_MS) * 100)}%` }} />
          </div>
        </div>
      )}

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

      {/* Outputs without a ring (none expected) keep an unseen anchor on the body. */}
      {outputIds
        .filter((hid) => !ringHandleIds.has(hid))
        .map((hid, i) => (
          <Handle
            key={hid}
            id={hid}
            type="source"
            position={Position.Right}
            style={{ top: `${handleOffsets(outputIds.length)[i]}%`, opacity: 0, pointerEvents: 'none' }}
          />
        ))}
    </div>
    {rings.length > 0 && (
      <div className="mf-block__rings" style={{ minHeight: size }}>
        {rings.map((ring) => (
          <RingBufferStrip
            key={ring.key}
            ring={ring}
            labelByNodeId={data.labelByNodeId ?? new Map()}
            focusedNodeId={data.focusedNodeId ?? null}
            showNow={data.showNow}
            onFocusNode={data.onFocusNode ?? (() => undefined)}
          >
            <Handle id={ring.handleId} type="source" position={Position.Right} className="mf-block__handle" />
          </RingBufferStrip>
        ))}
      </div>
    )}
    </div>
  );
}
