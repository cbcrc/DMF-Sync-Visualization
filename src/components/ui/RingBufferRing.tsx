import type { RingBuffer, RingBufferEvaluation } from '../../types';
import { slotHoldsGrainIndex } from '../../engine/mxlGrainIndex';
import './RingBufferRing.css';

export interface RingBufferRingProps {
  label: string;
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
}

const RING_RADIUS_PX = 40;
const RING_DIAL_SIZE_PX = RING_RADIUS_PX * 2 + 16;

/**
 * The literal MXL ring geometry for one reader input: `grainCount` physical
 * slots, with `RingBufferIndex = GrainIndex mod RingBufferLength`
 * (https://github.com/dmf-mxl/mxl/blob/main/docs/Timing.md).
 *
 * Because grain indices are preserved end to end, the slot a reader lands on
 * is fixed by the absolute grain index it asks for. The dial shows:
 *
 * - the writer's published head slot,
 * - this reader's requested slot,
 * - and, when TOO_LATE, which *newer* grain that slot now actually holds.
 */
export function RingBufferRing({ label, buffer, evaluation }: RingBufferRingProps) {
  const length = buffer.grainCount;
  const zoneClass = evaluation.status === 'TOO_LATE' ? 'red' : evaluation.status === 'TOO_EARLY' ? 'yellow' : 'green';
  const slots = Array.from({ length }, (_, i) => i);
  const slotHolds = slotHoldsGrainIndex(buffer.publishedGrainIndex, buffer.requestedRingBufferIndex, length);

  return (
    <div className={`rb-ring rb-ring--${zoneClass}`}>
      <div className="rb-ring__header">
        <span className="rb-ring__label">{label}</span>
        <span className="rb-ring__badge">{evaluation.status.replace('_', ' ')}</span>
      </div>
      <div className="rb-ring__dial" style={{ width: RING_DIAL_SIZE_PX, height: RING_DIAL_SIZE_PX }}>
        {slots.map((i) => {
          const angle = (360 * i) / length;
          const isHead = i === buffer.publishedRingBufferIndex;
          const isRead = i === buffer.requestedRingBufferIndex;
          return (
            <div
              key={i}
              className="rb-ring__spoke"
              style={{ transform: `rotate(${angle}deg)`, height: RING_RADIUS_PX }}
            >
              <div
                className={`rb-ring__slot-mark${isHead ? ' rb-ring__slot-mark--head' : ''}${
                  isRead ? ' rb-ring__slot-mark--read' : ''
                }`}
              />
            </div>
          );
        })}
        <div
          className="rb-ring__spoke rb-ring__spoke--reader"
          style={{
            transform: `rotate(${(360 * buffer.requestedRingBufferIndex) / length}deg)`,
            height: RING_RADIUS_PX,
          }}
        >
          <div className={`rb-ring__reader-glyph rb-ring__reader-glyph--${zoneClass}`}>
            {evaluation.status === 'TOO_LATE' && '✕'}
            {evaluation.status === 'TOO_EARLY' && '?'}
            {evaluation.status === 'OK' && '●'}
          </div>
        </div>
      </div>
      <div className="rb-ring__meta">
        <div>
          Head: grain #{buffer.publishedGrainIndex} (slot {buffer.publishedRingBufferIndex}/{length})
        </div>
        <div>
          Wants: grain #{buffer.requestedGrainIndex} (slot {buffer.requestedRingBufferIndex}/{length})
        </div>
        <div>
          Retains {buffer.retainedGrains} grain{buffer.retainedGrains === 1 ? '' : 's'} back to #
          {buffer.retainedFromGrainIndex}
          {buffer.repeaterCount > 0 && ` · +${buffer.repeaterCount} repeater buffer${buffer.repeaterCount === 1 ? '' : 's'}`}
        </div>
        {evaluation.status === 'TOO_LATE' && (
          <div className="rb-ring__warn">
            Slot overwritten — now holds grain #{slotHolds} ({evaluation.deltaGrains} grains behind the head)
          </div>
        )}
        {evaluation.status === 'TOO_EARLY' && <div className="rb-ring__warn">Not written yet — waiting for head</div>}
      </div>
    </div>
  );
}
