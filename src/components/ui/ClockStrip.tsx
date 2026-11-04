import {
  formatGrouped,
  grainIndexForDisplay,
  timestampToGrainIndex,
  timestampToTaiNs,
  timestampToTimecode,
} from '../../engine/mxlGrainIndex';
import type { GrainRate } from '../../types';
import './ClockStrip.css';

export interface ClockStripProps {
  timestampMs: number;
  grainRate: GrainRate;
  grainDurationMs: number;
  domainSizeMs: number;
  showRealGrainIndex: boolean;
}

/**
 * The domain's "now": TAI nanoseconds since the SMPTE epoch, its time of day,
 * and the grain index it maps to. Each function writes its own ring, so no single
 * slot is shown here. The sim clock stands in for TAI and
 * pauses/steps with the playback mode (real TAI never would).
 */
export function ClockStrip({
  timestampMs,
  grainRate,
  grainDurationMs,
  domainSizeMs,
  showRealGrainIndex,
}: ClockStripProps) {
  const ns = timestampToTaiNs(timestampMs);
  const index = timestampToGrainIndex(timestampMs, grainRate);
  const shownIndex = grainIndexForDisplay(timestampMs, grainRate, domainSizeMs, showRealGrainIndex);
  const grainNs = Math.round(grainDurationMs * 1e6);

  return (
    <div className="clock-strip" aria-label="Domain clock">
      <div className="clock-strip__cell clock-strip__cell--wide">
        <div className="clock-strip__lab">Now · TAI ns since SMPTE epoch</div>
        <div className="clock-strip__val clock-strip__val--big">{formatGrouped(ns)}</div>
      </div>
      <div className="clock-strip__cell">
        <div className="clock-strip__lab">TAI time of day · {Math.round(grainRate.numerator / grainRate.denominator)} fps</div>
        <div className="clock-strip__val">{timestampToTimecode(timestampMs, grainRate)}</div>
      </div>
      <div className="clock-strip__cell">
        <div className="clock-strip__lab">Grain index now</div>
        <div className="clock-strip__val">{formatGrouped(shownIndex)}</div>
      </div>
      <details className="clock-strip__formula">
        <summary>Formula</summary>
        <div>
          index = ⌊ {formatGrouped(ns)} / {formatGrouped(grainNs)} ⌋ = {formatGrouped(index)}
        </div>
      </details>
    </div>
  );
}
