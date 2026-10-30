import type { ReactNode } from 'react';
import type { WriterRing } from '../../game/writerRings';
import { readerTitle } from '../../game/writerRings';
import { READ_BEHIND_WRITE_GRAINS } from '../../engine/ringBufferEngine';
import { grainIndexLabel } from '../../engine/mxlGrainIndex';
import { CELL_H, LANE_H, OVERWRITTEN_W, RING_STRIP_W, STRIP_W } from './ringStripLayout';
import './RingBufferStrip.css';

/** Beyond this many slots, cells are too narrow to draw individually, so the strip is one continuous bar. */
const MAX_DRAWN_CELLS = 16;

export interface RingBufferStripProps {
  ring: WriterRing;
  labelByNodeId: Map<string, string>;
  focusedNodeId: string | null;
  /** Also mark the slot wall-clock "now" falls in, to show how far behind it the writer is. */
  showNow?: boolean;
  /** Grain index in each slot: false = simplified count from 100, true = last digits of the real MXL index. */
  showRealGrainIndex?: boolean;
  onFocusNode: (nodeId: string | null) => void;
  /** Rendered inside the card; the parent puts this ring's output handle here. */
  children?: ReactNode;
}

/**
 * A writer's ring buffer, drawn as part of its media function's block. The
 * function writes into it whether or not anything reads, and every reader's
 * link starts at the card's right edge.
 *
 * Slots are fixed: slot 1 is always on the left and slot N on the right
 * (N = domain size ÷ grain duration, so 5 slots at the default 100ms), and the
 * write head moves across them and wraps. Each slot also shows the grain index
 * it currently holds, which advances as time flows. Each reader is a pointer
 * under the slot it reads. Slots just ahead of the head are grey: they are
 * writer-reserved, so a read there is too late. Clicking a pointer selects that
 * reader (same focus as clicking the node itself).
 */
export function RingBufferStrip({ ring, labelByNodeId, focusedNodeId, showNow = false, showRealGrainIndex = false, onFocusNode, children }: RingBufferStripProps) {
  const n = ring.grainCount;
  const drawCells = ring.track !== 'audio' && n <= MAX_DRAWN_CELLS;
  // Readers that are too late sit in the box left of the slots, stacked by order.
  const lateKeys = ring.readers.filter((r) => r.status === 'TOO_LATE').map((r) => r.key);
  const laneOf = (r: WriterRing['readers'][number]) => (r.status === 'TOO_LATE' ? lateKeys.indexOf(r.key) : r.lane);
  const pointerX = (r: WriterRing['readers'][number]) => (r.status === 'TOO_LATE' ? OVERWRITTEN_W / 2 : slotX(r.requestedSlot));
  const maxLane = ring.readers.reduce((m, r) => Math.max(m, laneOf(r)), 0);
  const holdsFocus = ring.readers.some((r) => r.readerNodeId === focusedNodeId);

  // A slot's age is how many grains ago it was written: 0 is the head (being
  // written, unreadable), and ages up to `readableOldestAge` are retained.
  const maxAge = n - 1;
  const readableOldestAge = Math.min(maxAge, ring.retainedGrains + READ_BEHIND_WRITE_GRAINS);
  const unreadableCount = maxAge - readableOldestAge;
  const slotPx = STRIP_W / n;
  const slotX = (slot: number) => OVERWRITTEN_W + (slot + 0.5) * slotPx;
  const ageOf = (slot: number) => (((ring.publishedSlot - slot) % n) + n) % n;
  const overwritten = ring.readers.filter((r) => r.status === 'TOO_LATE').length;
  const nowIsHead = ring.nowSlot === ring.publishedSlot;
  const label = (grainIndex: number, digits: number) => grainIndexLabel(grainIndex, ring.grainRate, showRealGrainIndex, digits);

  // Unreadable slots follow the head, wrapping past the last slot.
  const unreadableRanges: Array<[number, number]> = [];
  if (!drawCells && unreadableCount > 0) {
    const first = (ring.publishedSlot + 1) % n;
    const end = first + unreadableCount;
    if (end <= n) unreadableRanges.push([first, end]);
    else unreadableRanges.push([first, n], [0, end - n]);
  }

  return (
    <div className={`ws${holdsFocus ? ' ws--focused' : ''}${overwritten > 0 ? ' ws--error' : ''}`} style={{ width: RING_STRIP_W }}>
      {children}
      <div className="ws__title">
        {ring.track} ring · {n} slots
        {overwritten > 0 && <span className="ws__alert"> ✕ {overwritten} too late</span>}
      </div>
      <div className="ws__track" style={{ width: STRIP_W + OVERWRITTEN_W, height: CELL_H + (maxLane + 1) * LANE_H }}>
        <div
          className="ws__overwritten"
          style={{ width: OVERWRITTEN_W, height: CELL_H }}
          title="Too late — the grain a reader asked for has been overwritten by the writer"
        >
          too late
        </div>
        {showNow && !nowIsHead && (
          <div className="ws__now" style={{ left: slotX(ring.nowSlot), height: CELL_H + 4 }} title={`Now — the writer is ${ring.lagMs.toFixed(0)}ms (${ring.lagGrains} grain${ring.lagGrains === 1 ? '' : 's'}) behind`}>
            <span>Now</span>
          </div>
        )}
        <div className="ws__write" style={{ left: slotX(ring.publishedSlot) }} title="Write head">
          {showNow && nowIsHead ? 'Write · Now' : 'Write'}
        </div>
        <div className="ws__cells" style={{ height: CELL_H, width: STRIP_W, marginLeft: OVERWRITTEN_W }}>
          {drawCells ? (
            Array.from({ length: n }, (_, slot) => {
              const age = ageOf(slot);
              const readable = age >= 1 && age <= readableOldestAge;
              const idx = ring.publishedGrainIndex - age;
              return (
                <div
                  key={slot}
                  className={`ws__cell${age === 0 ? ' ws__cell--head' : readable ? '' : ' ws__cell--unreadable'}`}
                  title={`slot ${slot + 1} · grain ${label(idx, 12)}${age === 0 ? ' · being written, cannot be read' : readable ? '' : ' · outside retained history'}`}
                >
                  <span className="ws__cell-slot">{slot + 1}</span>
                  <span className="ws__cell-idx">{label(idx, n > 8 ? 3 : 4)}</span>
                </div>
              );
            })
          ) : (
            <div className="ws__bar" style={{ flexGrow: 1 }}>
              {ring.track === 'audio' ? 'continuous' : `slots 1–${n}`}
            </div>
          )}
        </div>
        {!drawCells && (
          <>
            {unreadableRanges.map(([a, b]) => (
              <div
                key={a}
                className="ws__bar ws__bar--unreadable ws__bar--overlay"
                style={{ left: OVERWRITTEN_W + a * slotPx, width: (b - a) * slotPx, height: CELL_H }}
                title="Writer-reserved / outside retained history — a read here is too late"
              />
            ))}
            <div
              className="ws__bar ws__bar--head ws__bar--overlay"
              style={{ left: OVERWRITTEN_W + ring.publishedSlot * slotPx, width: Math.max(2, slotPx), height: CELL_H }}
              title="Being written — cannot be read"
            />
          </>
        )}
        {ring.readers.map((reader) => {
          if (reader.readerNodeId !== focusedNodeId) return null;
          const nowMs = reader.behindNowGrains * ring.grainDurationMs;
          const headMs = reader.behindHeadGrains * ring.grainDurationMs;
          const fmt = (ms: number) => `${Math.round(ms)}ms`;
          return (
            <div
              key={`bubble-${reader.key}`}
              className="ws__bubble"
              style={{ left: pointerX(reader), top: CELL_H + laneOf(reader) * LANE_H + LANE_H + 2 }}
              role="tooltip"
            >
              <div>{labelByNodeId.get(reader.readerNodeId) ?? reader.readerNodeId} is behind</div>
              <div>
                <span>now</span> by {fmt(nowMs)}
              </div>
              <div>
                <span>write head</span> by {fmt(headMs)}
              </div>
            </div>
          );
        })}
        {ring.readers.map((reader, i) => {
          const focused = reader.readerNodeId === focusedNodeId;
          const waiting = reader.status === 'TOO_EARLY';
          const late = reader.status === 'TOO_LATE';
          return (
            <button
              key={reader.key}
              type="button"
              className={`ws__ptr${focused ? ' ws__ptr--focused' : ''}${waiting ? ' ws__ptr--waiting' : ''}${late ? ' ws__ptr--late' : ''}`}
              style={{ left: pointerX(reader), top: CELL_H + laneOf(reader) * LANE_H }}
              title={readerTitle(reader, labelByNodeId)}
              onClick={(e) => {
                e.stopPropagation();
                onFocusNode(reader.readerNodeId);
              }}
            >
              {late ? '✕ ' : ''}R{i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
