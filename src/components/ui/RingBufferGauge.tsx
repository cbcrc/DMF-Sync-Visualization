import type { RingBuffer, RingBufferEvaluation } from '../../types';
import { gaugeZone, RING_BUFFER_ZONES } from '../../engine/ringBufferEngine';
import './RingBufferGauge.css';

export interface RingBufferGaugeProps {
  /** Label for the reader input this gauge represents (e.g. "Multiview ← Audio EQ"). */
  label: string;
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
}

/**
 * Linear ring buffer track (SPEC.md §3) for one reader input.
 *
 * The track spans this flow's retained history: the writer's published head
 * sits fixed at the right edge, the back edge (oldest retained grain) at the
 * left. The Read marker is the aligned grain index the reader must fetch — it
 * slides left as the *other* branches of a sync group get slower, and falls
 * off the left edge entirely when the grain has been overwritten.
 */
export function RingBufferGauge({ label, buffer, evaluation }: RingBufferGaugeProps) {
  const zone = gaugeZone(evaluation);
  const readMarkerPercent = Math.min(100, Math.max(0, 100 * (1 - evaluation.occupancyRatio)));
  const warnBandPercent = (1 - RING_BUFFER_ZONES.tooLateWarningRatio) * 100;

  return (
    <div className={`rb-gauge rb-gauge--${zone}`}>
      <div className="rb-gauge__header">
        <span className="rb-gauge__label">{label}</span>
        <span className="rb-gauge__delta">{Math.round(evaluation.stalenessMs)}ms behind</span>
      </div>
      <div className="rb-gauge__track">
        <div className="rb-gauge__zone rb-gauge__zone--yellow" style={{ width: `${warnBandPercent}%` }} />
        <div className="rb-gauge__zone rb-gauge__zone--green" style={{ width: `${100 - warnBandPercent}%` }} />
        <div className="rb-gauge__marker rb-gauge__marker--write" title="Published head (newest written grain)" />
        <div
          className={`rb-gauge__marker rb-gauge__marker--read rb-gauge__marker--${zone}`}
          style={{ left: `${readMarkerPercent}%` }}
          title="Aligned grain index this reader is requesting"
        />
      </div>
      <div className="rb-gauge__scale">
        <span>oldest retained (-{Math.round(buffer.retainedMs)}ms)</span>
        <span>head</span>
      </div>
      {evaluation.status === 'TOO_EARLY' && (
        <div className="rb-gauge__badge rb-gauge__badge--yellow">TOO EARLY — reader waits for the writer</div>
      )}
      {evaluation.status === 'TOO_LATE' && (
        <div className="rb-gauge__badge rb-gauge__badge--red">READ TOO LATE — slot already overwritten</div>
      )}
    </div>
  );
}
