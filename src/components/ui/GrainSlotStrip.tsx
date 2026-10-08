import type { RingBuffer, RingBufferEvaluation } from '../../types';
import { grainIndexToRingBufferIndex } from '../../engine/mxlGrainIndex';
import './GrainSlotStrip.css';

export interface GrainSlotStripProps {
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
  /** Compact variant for the on-canvas overlay (no per-cell text). */
  compact?: boolean;
}

/** Never render more cells than this, so a large domain can't blow out the layout. */
const MAX_CELLS = 14;

interface Cell {
  grainIndex: number;
  slot: number;
  /** This grain is gone — its slot was recycled by a newer grain. */
  lost: boolean;
  /** This grain is still retained, but too far behind the head to fit in the window. */
  offscreen?: boolean;
  isHead: boolean;
  isRead: boolean;
}

/**
 * A literal timeline of grain slots for one reader input, oldest on the left,
 * the writer's head on the right.
 *
 * Because grain indices are preserved end to end, this reads as time: each
 * cell is one absolute grain index, tagged with the physical ring slot
 * (`index mod grainCount`) it lives in. The strip shows three things at once:
 *
 * - **W** — where the writer has published to (the head).
 * - **R** — which grain this reader is asking for.
 * - the gap between them, i.e. how much retained history is left before the
 *   writer laps the reader and that grain is destroyed.
 *
 * When the reader falls outside the retained window its grain is drawn beyond
 * the left edge, struck through: the slot still exists, but a newer grain
 * owns it now.
 */
export function GrainSlotStrip({ buffer, evaluation, compact = false }: GrainSlotStripProps) {
  const { publishedGrainIndex, requestedGrainIndex, retainedGrains, grainCount } = buffer;
  const zone =
    evaluation.status === 'TOO_LATE' ? 'red' : evaluation.status === 'TOO_EARLY' ? 'yellow' : 'green';

  // Oldest still-valid grain, then clamp so the strip stays a readable width.
  const oldestRetained = publishedGrainIndex - retainedGrains;
  const firstShown = Math.max(oldestRetained, publishedGrainIndex - (MAX_CELLS - 1));

  const cells: Cell[] = [];
  for (let g = firstShown; g <= publishedGrainIndex; g += 1) {
    cells.push({
      grainIndex: g,
      slot: grainIndexToRingBufferIndex(g, grainCount),
      lost: false,
      isHead: g === publishedGrainIndex,
      isRead: g === requestedGrainIndex,
    });
  }

  // The requested grain has already been overwritten: show it as a lost cell
  // hanging off the back of the retained window.
  const readIsLost = requestedGrainIndex < oldestRetained;
  if (readIsLost) {
    cells.unshift({
      grainIndex: requestedGrainIndex,
      slot: grainIndexToRingBufferIndex(requestedGrainIndex, grainCount),
      lost: true,
      isHead: false,
      isRead: true,
    });
  }

  // Still retained, but further behind the head than the fixed-width window
  // shows (common for fine-grained audio tracks, whose grains are 20x
  // smaller than video's — the same millisecond differential spans far more
  // grain slots). Without this, R silently scrolls off the left edge and the
  // reader looks like it has no read position at all. Show it compressed,
  // off to the side, distinct from the lost/recycled styling.
  const readIsOffscreen = !readIsLost && requestedGrainIndex < firstShown;
  if (readIsOffscreen) {
    cells.unshift({
      grainIndex: requestedGrainIndex,
      slot: grainIndexToRingBufferIndex(requestedGrainIndex, grainCount),
      lost: false,
      offscreen: true,
      isHead: false,
      isRead: true,
    });
  }

  // How many more grains the writer can publish before it laps this reader.
  const grainsUntilOverwrite = retainedGrains - evaluation.deltaGrains;
  const readIsFuture = evaluation.status === 'TOO_EARLY';

  return (
    <div className={`gs-strip gs-strip--${zone}${compact ? ' gs-strip--compact' : ''}`}>
      <div className="gs-strip__cells">
        {(readIsLost || readIsOffscreen) && (
          <div
            className="gs-strip__break"
            title={readIsLost ? 'grains already recycled' : 'retained grains not shown — reader is further behind than this window'}
          />
        )}
        {cells.map((cell) => (
          <div
            key={cell.grainIndex}
            className={[
              'gs-cell',
              cell.lost ? 'gs-cell--lost' : '',
              cell.offscreen ? 'gs-cell--offscreen' : '',
              cell.isHead ? 'gs-cell--head' : '',
              cell.isRead ? 'gs-cell--read' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={`grain #${cell.grainIndex} · slot ${cell.slot}`}
          >
            {!compact && <span className="gs-cell__slot">{cell.slot}</span>}
            <span className="gs-cell__marks">
              {cell.isRead && <span className="gs-cell__mark gs-cell__mark--read">R</span>}
              {cell.isHead && <span className="gs-cell__mark gs-cell__mark--head">W</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="gs-strip__legend">
        {evaluation.status === 'TOO_LATE' ? (
          <span className="gs-strip__warn">
            R wants #{requestedGrainIndex} — recycled {Math.abs(grainsUntilOverwrite)} grain
            {Math.abs(grainsUntilOverwrite) === 1 ? '' : 's'} ago
          </span>
        ) : readIsFuture ? (
          <span className="gs-strip__wait">R waiting for W to publish #{requestedGrainIndex}</span>
        ) : readIsOffscreen ? (
          <span className="gs-strip__ok">
            R holds #{requestedGrainIndex}, {grainsUntilOverwrite} grain
            {grainsUntilOverwrite === 1 ? '' : 's'} before W overwrites it (window too narrow to show the gap)
          </span>
        ) : (
          <span className="gs-strip__ok">
            {grainsUntilOverwrite} grain{grainsUntilOverwrite === 1 ? '' : 's'} before W overwrites R
          </span>
        )}
      </div>
    </div>
  );
}
