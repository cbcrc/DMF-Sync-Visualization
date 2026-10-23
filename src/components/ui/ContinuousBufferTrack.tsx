import type { RingBuffer, RingBufferEvaluation } from '../../types';
import { READ_BEHIND_WRITE_GRAINS, WRITER_RESERVED_MS } from '../../engine/ringBufferEngine';
import './ContinuousBufferTrack.css';

export interface ContinuousBufferTrackProps {
  label: string;
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
  /**
   * Absolute time span of the video grain this audio input is aligned
   * against at this sync point (item #10.ii) — highlighted on the strip so
   * players can see which slice of audio's much finer grains corresponds to
   * one video frame. Omitted when this input isn't at a true A/V sync point.
   */
  alignmentSpanMs?: { startMs: number; endMs: number };
  /** Compact variant for the on-canvas overlay (no captions). */
  compact?: boolean;
  /**
   * True while this reader's canvas grain is currently parked waiting for a
   * sync sibling — adds a pulsing ring on the read marker matching the
   * canvas's `.grain-dot--parked` styling, so the two views read as one event.
   */
  parked?: boolean;
}

/**
 * Audio-track visualization standing in for MXL's **Continuous** ring buffer
 * (`docs/Architecture.md`: audio uses per-sample Continuous buffers, not the
 * discrete numbered grain slots video/data use — a tail portion reserved for
 * the writer, the reader free to roam the rest). Rather than drawing audio
 * as the same kind of slot grid as video (misleading — it has no discrete
 * slots to a player, and its grains are 20x smaller, so a slot grid either
 * overflows or hides the read position), this renders the retained window as
 * a smooth continuous strip measured in time, not grain count:
 *
 * - **R (read)** is *always* rendered, clamped to the strip — it never
 *   scrolls off and disappears. When the real position has crossed a bound
 *   (TOO_LATE/TOO_EARLY) it pins at the edge with a direction arrow instead
 *   of vanishing, so the player can always see roughly how far off it is.
 * - A **danger meter** fills from empty (at the head) toward full (at the
 *   retention boundary) in proportion to `occupancyRatio` — the single
 *   clearest "how close to TOO_LATE" signal, independent of grain geometry.
 * - A hatched band at the head end stands in for the Continuous buffer's
 *   writer-reserved region (simplified to the same fixed time margin used
 *   for video's slot reservation — see `AI_RULES.md`'s Known
 *   Simplifications).
 * - At a true A/V sync point, `alignmentSpanMs` highlights the slice of this
 *   audio strip that falls within the one video grain being read at the
 *   same aligned instant (item #10.ii) — audio's grains are 20x finer than
 *   video's, so this is visibly a span of many audio grains, not a single
 *   one.
 */
export function ContinuousBufferTrack({
  label,
  buffer,
  evaluation,
  alignmentSpanMs,
  compact = false,
  parked = false,
}: ContinuousBufferTrackProps) {
  const zone = evaluation.status === 'TOO_LATE' ? 'red' : evaluation.status === 'TOO_EARLY' ? 'yellow' : 'green';

  // 0% at the head (now), 100% at the retention boundary (oldest retained).
  const clampedOccupancyPercent = Math.min(100, Math.max(0, 100 * evaluation.occupancyRatio));
  const overshotLate = evaluation.occupancyRatio > 1; // past the retention boundary
  const overshotEarly = evaluation.occupancyRatio < 0; // requesting a not-yet-published instant
  // Read marker position along the strip: 0% = oldest/left, 100% = head/right.
  // The reader sits one grain behind the write head (MXL can't read the grain
  // being written), so offset the marker by one grain's worth of time.
  const readOffsetMs = evaluation.stalenessMs + READ_BEHIND_WRITE_GRAINS * buffer.grainDurationMs;
  const readMarkerPercent =
    buffer.retainedMs > 0 ? Math.min(100, Math.max(0, 100 * (1 - readOffsetMs / buffer.retainedMs))) : 0;

  const reservedWidthPercent = buffer.sizeMs > 0 ? Math.min(40, (100 * WRITER_RESERVED_MS) / buffer.sizeMs) : 0;

  const marginMs = buffer.retainedMs - evaluation.stalenessMs;

  // Map an absolute timestamp to the same 0%=oldest/100%=head scale the read
  // marker uses, so the alignment band sits in the right place relative to it.
  const percentForTime = (tMs: number) =>
    buffer.retainedMs > 0
      ? Math.min(100, Math.max(0, 100 * (1 - (buffer.publishedTimestampMs - tMs) / buffer.retainedMs)))
      : 0;
  const alignStartPercent = alignmentSpanMs ? percentForTime(alignmentSpanMs.startMs) : 0;
  const alignEndPercent = alignmentSpanMs ? percentForTime(alignmentSpanMs.endMs) : 0;

  return (
    <div className={`cb-track cb-track--${zone}${compact ? ' cb-track--compact' : ''}`}>
      {!compact && (
        <div className="cb-track__header">
          <span className="cb-track__label">{label}</span>
          <span className="cb-track__delta">{Math.round(evaluation.stalenessMs)}ms behind</span>
        </div>
      )}
      <div className="cb-track__strip">
        <div className="cb-track__flow" />
        <div
          className="cb-track__danger-fill"
          style={{ width: `${clampedOccupancyPercent}%` }}
          title="How close this read is to the retention boundary (fills as it nears TOO_LATE)"
        />
        <div
          className="cb-track__reserved"
          style={{ width: `${reservedWidthPercent}%` }}
          title="Writer-reserved margin (simplified, fixed time budget — see Known Simplifications)"
        />
        {alignmentSpanMs && alignEndPercent > alignStartPercent && (
          <div
            className="cb-track__align-span"
            style={{ left: `${alignStartPercent}%`, width: `${alignEndPercent - alignStartPercent}%` }}
            title={`Audio slice aligned to this sync point's video grain (${Math.round(
              alignmentSpanMs.endMs - alignmentSpanMs.startMs,
            )}ms of audio grains)`}
          />
        )}
        <div className="cb-track__marker cb-track__marker--write" title="Writer head (now)" />
        <div
          className={`cb-track__marker cb-track__marker--read cb-track__marker--${zone}${
            parked ? ' cb-track__marker--parked' : ''
          }`}
          style={{ left: `${readMarkerPercent}%` }}
          title="Instant this reader is asking for"
        >
          {overshotLate && <span className="cb-track__overshoot cb-track__overshoot--left">◀</span>}
          {overshotEarly && <span className="cb-track__overshoot cb-track__overshoot--right">▶</span>}
        </div>
      </div>
      {!compact && (
        <>
          <div className="cb-track__scale">
            <span>oldest retained (-{Math.round(buffer.retainedMs)}ms)</span>
            <span>head</span>
          </div>
          <div className="cb-track__legend">
            {evaluation.status === 'TOO_LATE' ? (
              <span className="cb-track__warn">
                READ TOO LATE — {Math.round(Math.abs(marginMs))}ms past the retention boundary
              </span>
            ) : evaluation.status === 'TOO_EARLY' ? (
              <span className="cb-track__wait">TOO EARLY — waiting for the writer to reach this instant</span>
            ) : (
              <span className="cb-track__ok">{Math.round(marginMs)}ms of margin before this read is recycled</span>
            )}
          </div>
          {alignmentSpanMs && (
            <div className="cb-track__legend cb-track__legend--align">
              ⬚ highlighted: the {Math.round(alignmentSpanMs.endMs - alignmentSpanMs.startMs)}ms of audio grains
              aligned to the video grain read at this sync point
            </div>
          )}
        </>
      )}
    </div>
  );
}
