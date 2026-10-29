import type { ReactNode } from 'react';
import type { WriterRing } from '../../game/writerRings';
import { readerTitle } from '../../game/writerRings';
import { READ_BEHIND_WRITE_GRAINS } from '../../engine/ringBufferEngine';
import { CELL_H, LANE_H, NOW_W, OVERWRITTEN_W, RING_STRIP_W, STRIP_W } from './ringStripLayout';
import './RingBufferStrip.css';

/** Beyond this many slots, cells are too narrow to draw individually, so the strip is one continuous bar. */
const MAX_DRAWN_CELLS = 16;

export interface RingBufferStripProps {
  ring: WriterRing;
  labelByNodeId: Map<string, string>;
  focusedNodeId: string | null;
  /** Also draw wall-clock "now" to the right of the write head, to show how far behind it the writer is. */
  showNow?: boolean;
  onFocusNode: (nodeId: string | null) => void;
  /** Rendered inside the card; the parent puts this ring's output handle here. */
  children?: ReactNode;
}

/**
 * A writer's ring buffer, drawn as part of its media function's block. The
 * function writes into it whether or not anything reads, and every reader's
 * link starts at the card's right edge. The slots run oldest → newest with the
 * write head on the right; each reader is a pointer under the slot it reads, so
 * its position relative to the head is visible at a glance. Clicking a pointer
 * selects that reader (same focus as clicking the node itself).
 */
export function RingBufferStrip({ ring, labelByNodeId, focusedNodeId, showNow = false, onFocusNode, children }: RingBufferStripProps) {
  const n = ring.grainCount;
  const drawCells = ring.track !== 'audio' && n <= MAX_DRAWN_CELLS;
  const maxLane = ring.readers.reduce((m, r) => Math.max(m, r.lane), 0);
  const holdsFocus = ring.readers.some((r) => r.readerNodeId === focusedNodeId);

  // The head is the rightmost slot (the one being written). A reader sits
  // `age` slots to its left, where age = deltaGrains + READ_BEHIND_WRITE_GRAINS
  // (`deltaGrains` is measured from the newest readable grain, one behind the
  // head), so it can never occupy the write slot. A too-early reader waits at the
  // newest readable slot (age 1), drawn hollow. A too-late reader keeps its true
  // position, which lies in the unreadable stretch (clamped to the oldest end).
  const maxAge = n - 1;
  const readableOldestAge = Math.min(maxAge, ring.retainedGrains + READ_BEHIND_WRITE_GRAINS);
  const unreadableCount = maxAge - readableOldestAge;
  const slotPx = STRIP_W / n;
  // Past the oldest slot lies the "overwritten" zone, shared by audio and video:
  // a reader too far behind slides into it by its true distance.
  const pointerX = (reader: WriterRing['readers'][number]) => {
    const age = Math.max(reader.behindHeadGrains + READ_BEHIND_WRITE_GRAINS, 1);
    if (age <= maxAge) return OVERWRITTEN_W + (n - 1 - age + 0.5) * slotPx;
    return Math.max(10, OVERWRITTEN_W + 0.5 * slotPx - (age - maxAge) * slotPx);
  };
  // "Now" sits `lagGrains` slots right of the head's centre, to scale but
  // never closer than 6px (so a tiny lag stays visible) or past the zone.
  const headX = OVERWRITTEN_W + ((n - 0.5) / n) * STRIP_W;
  const nowOffset = Math.min(NOW_W - 6, Math.max(6, ring.lagGrains * slotPx));
  const extra = showNow ? NOW_W : 0;
  const overwritten = ring.readers.filter((r) => r.status === 'TOO_LATE').length;

  return (
    <div className={`ws${holdsFocus ? ' ws--focused' : ''}${overwritten > 0 ? ' ws--error' : ''}`} style={{ width: RING_STRIP_W + extra }}>
      {children}
      <div className="ws__title">
        {ring.track} ring · {n} slots
        {overwritten > 0 && <span className="ws__alert"> ✕ {overwritten} too late</span>}
      </div>
      <div className="ws__track" style={{ width: STRIP_W + OVERWRITTEN_W + extra, height: CELL_H + (maxLane + 1) * LANE_H }}>
        <div className="ws__write" style={{ left: OVERWRITTEN_W + ((n - 0.5) / n) * STRIP_W }} title="Write head">
          Write
        </div>
        {showNow && (
          <>
            <div
              className="ws__lag"
              style={{ left: headX, width: nowOffset, top: CELL_H / 2 - 1 }}
              title={`Writer is ${ring.lagMs.toFixed(0)}ms behind now`}
            />
            <div
              className="ws__now"
              style={{ left: headX + nowOffset, height: CELL_H + 4 }}
              title={`Now — the writer is ${ring.lagMs.toFixed(0)}ms (${ring.lagGrains} grain${ring.lagGrains === 1 ? '' : 's'}) behind`}
            >
              <span>Now</span>
            </div>
          </>
        )}
        <div
          className="ws__overwritten"
          style={{ width: OVERWRITTEN_W, height: CELL_H }}
          title="Overwritten — a read this far behind has lost its grain"
        />
        <div className="ws__cells" style={{ height: CELL_H, width: STRIP_W, marginLeft: OVERWRITTEN_W }}>
          {drawCells ? (
            Array.from({ length: n }, (_, c) => {
              const age = n - 1 - c;
              const slot = (((ring.publishedSlot - age) % n) + n) % n;
              const readable = age >= 1 && age <= readableOldestAge;
              return (
                <div
                  key={c}
                  className={`ws__cell${age === 0 ? ' ws__cell--head' : readable ? '' : ' ws__cell--unreadable'}`}
                  title={age === 0 ? 'Being written — cannot be read' : readable ? undefined : 'Outside retained history'}
                >
                  {slot}
                </div>
              );
            })
          ) : (
            <>
              <div
                className="ws__bar ws__bar--unreadable"
                style={{ flexGrow: unreadableCount }}
                title="Writer-reserved / outside retained history — a read here is too late"
              />
              <div className="ws__bar" style={{ flexGrow: readableOldestAge }}>
                {ring.track === 'audio' ? 'continuous' : `slots 0–${n - 1}`}
              </div>
              <div className="ws__bar ws__bar--head" style={{ flexGrow: 1 }} title="Being written — cannot be read" />
            </>
          )}
        </div>
        {ring.readers.map((reader, i) => {
          const focused = reader.readerNodeId === focusedNodeId;
          const waiting = reader.status === 'TOO_EARLY';
          const late = reader.status === 'TOO_LATE';
          return (
            <button
              key={reader.key}
              type="button"
              className={`ws__ptr${focused ? ' ws__ptr--focused' : ''}${waiting ? ' ws__ptr--waiting' : ''}${late ? ' ws__ptr--late' : ''}`}
              style={{ left: pointerX(reader), top: CELL_H + reader.lane * LANE_H }}
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
