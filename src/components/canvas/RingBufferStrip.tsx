import type { ReactNode } from 'react';
import type { WriterRing } from '../../game/writerRings';
import { readerTitle, videoBoundaryGrains } from '../../game/writerRings';
import { grainIndexLabel, grainIndexToRingBufferIndex, sampleIndexLabel, slotColor } from '../../engine/mxlGrainIndex';
import { CELL_H, LANE_H, NOW_LABEL_W, NOW_MAX_DOMAINS, OVERWRITTEN_W, RING_STRIP_W, STRIP_W } from './ringStripLayout';
import './RingBufferStrip.css';

/** Beyond this many slots, cells are too narrow to draw individually, so the strip is one continuous bar. */
const MAX_DRAWN_CELLS = 16;

/** A CG's two video outputs: the first carries the fill, the second the key. */
const CG_OUTPUT_NAMES = ['Fill', 'Key'];

export interface RingBufferStripProps {
  ring: WriterRing;
  labelByNodeId: Map<string, string>;
  focusedNodeId: string | null;
  /** Also draw wall-clock "now" to the right of the write head, to show how far behind it the writer is. */
  showNow?: boolean;
  /** MXL domain size: the Now marker's scale is one strip width per domain. */
  domainSizeMs?: number;
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
 * The strip is a timeline of the grains the ring holds: the head is
 * always the rightmost box, and each box shows the grain index (time) it holds.
 * As time advances the indices flow right to left from box to box. Each reader
 * is a pointer under the box it reads, so its distance from the head is the
 * differential latency it needs to stay in sync: a synced input reads the grain
 * index matching the slowest branch (MXL's `FlowSynchronizationGroup` waits for
 * the grain at one origin time on every flow). Grey boxes on the left are
 * writer-reserved, and a reader beyond them has lost its grain: it moves into
 * the "too late" box, flagged ✕. Clicking a pointer selects that reader.
 */
/** A delay as the Now tag shows it: `0ms`, `−80ms`, `−1.6s`. */
function formatDelay(ms: number): string {
  if (Math.round(ms) <= 0) return '0ms';
  return ms < 1000 ? `−${Math.round(ms)}ms` : `−${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function RingBufferStrip({ ring, labelByNodeId, focusedNodeId, showNow = false, showRealGrainIndex = false, domainSizeMs = 100, onFocusNode, children }: RingBufferStripProps) {
  const n = ring.grainCount;
  const audio = ring.track === 'audio';
  const drawCells = !audio && n <= MAX_DRAWN_CELLS;
  // Readers that are too late sit in the box left of the grains, stacked by order.
  const lateKeys = ring.readers.filter((r) => r.status === 'TOO_LATE').map((r) => r.key);
  const laneOf = (r: WriterRing['readers'][number]) => (r.status === 'TOO_LATE' ? lateKeys.indexOf(r.key) : r.lane);
  const maxLane = ring.readers.reduce((m, r) => Math.max(m, laneOf(r)), 0);
  // Slot colours (matching the circular ring in the side panel) only show for the selected function's own ring.
  const selected = ring.writerNodeId === focusedNodeId;
  const holdsFocus = ring.readers.some((r) => r.readerNodeId === focusedNodeId);

  // The head is the rightmost box (the one being written). A reader sits
  // `ringAge` boxes to its left (shared with the circular ring in WriterRing,
  // see `WriterReader.ringAge`), so it can never occupy the write box. A
  // too-early reader waits at the newest readable box (age 1), drawn hollow.
  const maxAge = n - 1;
  const readableOldestAge = ring.readableOldestAge;
  const unreadableCount = maxAge - readableOldestAge;
  const slotPx = STRIP_W / n;
  const pointerX = (reader: WriterRing['readers'][number]) => {
    if (reader.ringAge === null) return OVERWRITTEN_W / 2;
    return OVERWRITTEN_W + (n - 1 - reader.ringAge + 0.5) * slotPx;
  };
  // "Now" sits the writer's delay right of the head's centre, on one scale for
  // every strip: a strip width per MXL domain (see `NOW_MAX_DOMAINS`). It uses
  // the steady lag in ms, not the whole-grain `lagGrains`, which flips between
  // two values as the clock crosses grain boundaries and made the marker jump.
  const headX = OVERWRITTEN_W + ((n - 0.5) / n) * STRIP_W;
  const lagGrains = ring.lagMs / ring.grainDurationMs;
  const lagPx = Math.max(0, ring.lagMs) * (STRIP_W / Math.max(1, domainSizeMs));
  const maxNowPx = NOW_MAX_DOMAINS * STRIP_W;
  const broken = lagPx > maxNowPx;
  const nowOffset = broken ? maxNowPx : lagPx;
  const extra = showNow ? nowOffset + NOW_LABEL_W : 0;
  const BREAK_GAP = 10;
  const overwritten = lateKeys.length;
  // Video grain boundaries, only while a reader of this audio ring is time-aligned to video:
  // each at its timestamp's sample index, so 1001-based rates show their real cadence.
  // A batch `g` sits `publishedGrainIndex - g` grains behind the head (column `n - 1 - age`).
  const videoTicks = videoBoundaryGrains(ring)
    .map((g) => (n - 1 - (ring.publishedGrainIndex - g)) * slotPx)
    .filter((x) => x >= 0 && x <= STRIP_W);
  /** Left edge (px) of a fractional age behind the head, in the track's coordinates. */
  const ageX = (age: number) => OVERWRITTEN_W + (n - 1 - age) * slotPx;
  // Audio has no slots: faint ticks mark the commit batches (at least 4px apart) and, when selected, the
  // same slot colours as the circular ring run along the readable samples.
  const audioBackground = () => {
    const tickPx = Math.max(1, Math.ceil(4 / slotPx)) * slotPx;
    const ticks = `repeating-linear-gradient(90deg, rgba(0,0,0,0.3) 0 1px, transparent 1px ${tickPx}px)`;
    if (!selected || n > 240) return ticks;
    const stops: string[] = [];
    for (let age = readableOldestAge; age >= 1; age -= 1) {
      const c = slotColor(grainIndexToRingBufferIndex(ring.publishedGrainIndex - age, n), n);
      const i = readableOldestAge - age;
      stops.push(`${c} ${(100 * i) / readableOldestAge}% ${(100 * (i + 1)) / readableOldestAge}%`);
    }
    return `${ticks}, linear-gradient(90deg, ${stops.join(', ')})`;
  };
  const label = (grainIndex: number, digits: number) => grainIndexLabel(grainIndex, ring.grainRate, showRealGrainIndex, digits);

  return (
    <div className={`ws${holdsFocus ? ' ws--focused' : ''}${overwritten > 0 ? ' ws--error' : ''}`} style={{ width: RING_STRIP_W + extra }}>
      {children}
      <div className="ws__title">
        {ring.key.split(':').length > 2 ? (CG_OUTPUT_NAMES[Number(ring.handleId.replace('out-', ''))] ?? `${ring.track} ring`) : `${ring.track} ring`} · {n} grains
        {overwritten > 0 && <span className="ws__alert"> ✕ {overwritten} too late</span>}
      </div>
      <div className="ws__track" style={{ width: STRIP_W + OVERWRITTEN_W + extra, height: CELL_H + (maxLane + 1) * LANE_H }}>
        <div className="ws__write" style={{ left: headX }} title="Head: the latest committed grain (MXL headIndex)">
          Head
        </div>
        {showNow && (
          <>
            {broken ? (
              <>
                <div className="ws__lag" style={{ left: headX, width: nowOffset - 2 * BREAK_GAP, top: CELL_H / 2 - 1 }} title={`Writer is ${ring.lagMs.toFixed(0)}ms behind now`} />
                <div className="ws__lag-break" style={{ left: headX + nowOffset - 1.5 * BREAK_GAP, top: CELL_H / 2 }} title={`Axis broken: more than ${NOW_MAX_DOMAINS} domains of delay`} />
                <div className="ws__lag" style={{ left: headX + nowOffset - BREAK_GAP, width: BREAK_GAP, top: CELL_H / 2 - 1 }} />
              </>
            ) : (
              <div className="ws__lag" style={{ left: headX, width: nowOffset, top: CELL_H / 2 - 1 }} title={`Writer is ${ring.lagMs.toFixed(0)}ms behind now`} />
            )}
            <div
              className={`ws__now${nowOffset < 44 ? ' ws__now--raised' : ''}`}
              style={{ left: headX + nowOffset, height: CELL_H + 4 }}
              title={`Now — the writer is ${ring.lagMs.toFixed(0)}ms (${Math.round(lagGrains)} grain${Math.round(lagGrains) === 1 ? '' : 's'}) behind. One strip width = one ${domainSizeMs}ms domain of delay.`}
            >
              <span>Now {formatDelay(ring.lagMs)}</span>
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
              const slot = grainIndexToRingBufferIndex(idx, n);
              const color = slotColor(slot, n);
              return (
                <div
                  key={c}
                  className={`ws__cell${age === 0 ? ' ws__cell--head' : readable ? '' : ' ws__cell--unreadable'}${selected && age === 0 ? ' ws__cell--head-selected' : ''}`}
                  style={!selected ? undefined : readable || age === 0 ? { background: color, color: '#0e1822' } : { boxShadow: `inset 0 -4px 0 ${color}` }}
                  title={`slot ${slot + 1} · grain ${label(idx, 12)}${age === 0 ? ' · being written, cannot be read' : readable ? '' : ' · outside retained history'}`}
                >
                  {label(idx, n > 8 ? 3 : 4)}
                </div>
              );
            })
          ) : (
            <>
              <div className="ws__bar ws__bar--unreadable" style={{ flexGrow: unreadableCount }} title="Writer-reserved / outside retained history — a read here is too late" />
              <div
                className={`ws__bar${audio ? ' ws__bar--audio' : ''}`}
                style={{ flexGrow: readableOldestAge, backgroundImage: audio ? audioBackground() : undefined }}
                title={audio ? 'Continuous samples. Ticks mark commit batches; a reader takes any window of samples ending at its read point.' : undefined}
              >
                {audio ? '' : `${n} grains`}
              </div>
              <div className="ws__bar ws__bar--head" style={{ flexGrow: 1 }} title="Being written — cannot be read" />
            </>
          )}
          {videoTicks.map((x) => (
            <div key={x} className="ws__vtick" style={{ left: x }} title="Video grain boundary: its timestamp as a sample index" />
          ))}
        </div>
        {ring.readers.map((reader) => {
          if (reader.ringAge === null || (!audio && !reader.pairedWithAudio)) return null;
          const read = reader.reading.buffer.alignedRead;
          let left: number;
          let right: number;
          let title: string;
          if (reader.exactWindow && read) {
            // The exact samples of the video grain read alongside, at sample precision.
            left = ageX(reader.exactWindow.fromAge);
            right = ageX(reader.exactWindow.toAge);
            const smp = (i: number) => sampleIndexLabel(i, read.sampleRate, showRealGrainIndex, read.videoRate);
            title = `Reads samples ${smp(read.firstSample)} … ${smp(read.lastSample)} (${read.sampleCount}): the video grain read alongside, by its timestamp`;
          } else if (reader.pairedWithAudio) {
            // Video: the grain whose timestamp sets the audio samples read with it.
            left = pointerX(reader) - slotPx / 2;
            right = left + slotPx;
            title = 'Video grain read with audio: its timestamp picks the audio samples';
          } else {
            right = pointerX(reader) + slotPx / 2;
            left = right - Math.min(reader.windowGrains, n) * slotPx;
            title = `Reads ${reader.windowGrains} batch${reader.windowGrains === 1 ? '' : 'es'} of samples ending at its read point`;
          }
          left = Math.max(OVERWRITTEN_W, left);
          right = Math.min(OVERWRITTEN_W + STRIP_W, right);
          if (right <= left) return null;
          const aligned = reader.exactWindow !== undefined || reader.pairedWithAudio;
          return (
            <div
              key={`win-${reader.key}`}
              className={`ws__win${aligned ? ' ws__win--aligned' : ''}${reader.readerNodeId === focusedNodeId ? ' ws__win--focused' : ''}`}
              style={{ left, width: right - left, top: CELL_H - 4 }}
              title={title}
            />
          );
        })}
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
                <span>head</span> by {fmt(headMs)}
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
