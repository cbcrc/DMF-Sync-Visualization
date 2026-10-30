import type { ReactNode } from 'react';
import type { WriterRing } from '../../game/writerRings';
import { readerTitle } from '../../game/writerRings';
import { READ_BEHIND_WRITE_GRAINS } from '../../engine/ringBufferEngine';
import { grainIndexLabel } from '../../engine/mxlGrainIndex';
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
 * The strip is a timeline of the grains the ring holds: the write head is
 * always the rightmost box, and each box shows the grain index (time) it holds.
 * As time advances the indices flow right to left from box to box. Each reader
 * is a pointer under the box it reads, so its distance from the head is the
 * differential latency it needs to stay in sync: a synced input reads the grain
 * index matching the slowest branch (MXL's `FlowSynchronizationGroup` waits for
 * the grain at one origin time on every flow). Grey boxes on the left are
 * writer-reserved, and a reader beyond them has lost its grain: it moves into
 * the "too late" box, flagged ✕. Clicking a pointer selects that reader.
 */
export function RingBufferStrip({ ring, labelByNodeId, focusedNodeId, showNow = false, showRealGrainIndex = false, onFocusNode, children }: RingBufferStripProps) {
  const n = ring.grainCount;
  const drawCells = ring.track !== 'audio' && n <= MAX_DRAWN_CELLS;
  // Readers that are too late sit in the box left of the grains, stacked by order.
  const lateKeys = ring.readers.filter((r) => r.status === 'TOO_LATE').map((r) => r.key);
  const laneOf = (r: WriterRing['readers'][number]) => (r.status === 'TOO_LATE' ? lateKeys.indexOf(r.key) : r.lane);
  const maxLane = ring.readers.reduce((m, r) => Math.max(m, laneOf(r)), 0);
  const holdsFocus = ring.readers.some((r) => r.readerNodeId === focusedNodeId);

  // The head is the rightmost box (the one being written). A reader sits `age`
  // boxes to its left, where age = deltaGrains + READ_BEHIND_WRITE_GRAINS
  // (`deltaGrains` is measured from the newest readable grain, one behind the
  // head), so it can never occupy the write box. A too-early reader waits at
  // the newest readable box (age 1), drawn hollow.
  const maxAge = n - 1;
  const readableOldestAge = Math.min(maxAge, ring.retainedGrains + READ_BEHIND_WRITE_GRAINS);
  const unreadableCount = maxAge - readableOldestAge;
  const slotPx = STRIP_W / n;
  const pointerX = (reader: WriterRing['readers'][number]) => {
    if (reader.status === 'TOO_LATE') return OVERWRITTEN_W / 2;
    const age = Math.min(Math.max(reader.behindHeadGrains + READ_BEHIND_WRITE_GRAINS, 1), maxAge);
    return OVERWRITTEN_W + (n - 1 - age + 0.5) * slotPx;
  };
  // "Now" sits `lagGrains` boxes right of the head's centre, to scale but
  // never closer than 6px (so a tiny lag stays visible) or past the zone.
  const headX = OVERWRITTEN_W + ((n - 0.5) / n) * STRIP_W;
  const nowOffset = Math.min(NOW_W - 6, Math.max(6, ring.lagGrains * slotPx));
  const extra = showNow ? NOW_W : 0;
  const overwritten = lateKeys.length;
  const label = (grainIndex: number, digits: number) => grainIndexLabel(grainIndex, ring.grainRate, showRealGrainIndex, digits);

  return (
    <div className={`ws${holdsFocus ? ' ws--focused' : ''}${overwritten > 0 ? ' ws--error' : ''}`} style={{ width: RING_STRIP_W + extra }}>
      {children}
      <div className="ws__title">
        {ring.track} ring{ring.key.split(':').length > 2 ? ` ${Number(ring.handleId.replace('out-', '')) + 1}` : ''} · {n} grains
        {overwritten > 0 && <span className="ws__alert"> ✕ {overwritten} too late</span>}
      </div>
      <div className="ws__track" style={{ width: STRIP_W + OVERWRITTEN_W + extra, height: CELL_H + (maxLane + 1) * LANE_H }}>
        <div className="ws__write" style={{ left: headX }} title="Write head">
          Write
        </div>
        {showNow && (
          <>
            <div className="ws__lag" style={{ left: headX, width: nowOffset, top: CELL_H / 2 - 1 }} title={`Writer is ${ring.lagMs.toFixed(0)}ms behind now`} />
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
          title="Too late — the grain a reader asked for has been overwritten by the writer"
        >
          too late
        </div>
        <div className="ws__cells" style={{ height: CELL_H, width: STRIP_W, marginLeft: OVERWRITTEN_W }}>
          {drawCells ? (
            Array.from({ length: n }, (_, c) => {
              const age = n - 1 - c;
              const readable = age >= 1 && age <= readableOldestAge;
              const idx = ring.publishedGrainIndex - age;
              return (
                <div
                  key={c}
                  className={`ws__cell${age === 0 ? ' ws__cell--head' : readable ? '' : ' ws__cell--unreadable'}`}
                  title={`grain ${label(idx, 12)}${age === 0 ? ' · being written, cannot be read' : readable ? '' : ' · outside retained history'}`}
                >
                  {label(idx, n > 8 ? 3 : 4)}
                </div>
              );
            })
          ) : (
            <>
              <div className="ws__bar ws__bar--unreadable" style={{ flexGrow: unreadableCount }} title="Writer-reserved / outside retained history — a read here is too late" />
              <div className="ws__bar" style={{ flexGrow: readableOldestAge }}>
                {ring.track === 'audio' ? 'continuous' : `${n} grains`}
              </div>
              <div className="ws__bar ws__bar--head" style={{ flexGrow: 1 }} title="Being written — cannot be read" />
            </>
          )}
        </div>
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
