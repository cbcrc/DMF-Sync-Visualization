import { useMediaConfig } from '../../game/mediaConfig';
import {
  formatGrouped,
  grainIndexLabel,
  rateLabel,
  sampleIndexLabel,
  samplesPerAudioBatch,
  simplifiedGrainIndex,
  slotColor,
  slotHoldsGrainIndex,
  timestampToTimecode,
} from '../../engine/mxlGrainIndex';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { RingBufferStatus } from '../../types';
import { readerTitle, videoBoundaryGrains, type WriterReader, type WriterRing as WriterRingModel } from '../../game/writerRings';
import './WriterRing.css';

export interface WriterRingProps {
  ring: WriterRingModel;
  writerLabel: string;
  labelByNodeId: Map<string, string>;
  /** Reader keys (`${nodeId}:${inputIndex}`) with a grain parked waiting for a sync sibling. */
  parkedInputKeys?: Set<string>;
  /** Reader function currently focused; its markers and rows are highlighted. */
  focusedNodeId?: string | null;
  onFocusNode?: (nodeId: string | null) => void;
  /**
   * Draw only the linear now-bar and reader list, no ring. Used for audio
   * writers: MXL audio is a Continuous buffer with no discrete slots to show.
   */
  barOnly?: boolean;
  /**
   * MXL continuous (audio) flow: no slots, so draw an unbroken ring of samples
   * with each reader as a window of samples instead of a slot marker.
   */
  audio?: boolean;
  /** Grain index shown in each slot: false = simplified count, true = last digits of the real MXL index. */
  showRealGrainIndex?: boolean;
  /** Sim clock and the timestamp `ring` was computed at; together they let the heads move between graph ticks. */
  getNow?: () => number;
  snapshotMs?: number;
}

const W = 220;
const CX = W / 2;
const CY = 92;
const R_OUT = 64;
const R_IN = 38;
const BAR_X0 = 10;
const BAR_X1 = W - 10;
const BAR_H = 10;
const LANE_H = 13;

const STATUS_COLOR: Record<RingBufferStatus, string> = {
  OK: '#4caf50',
  TOO_EARLY: '#ffc107',
  TOO_LATE: '#ee0000',
};
/** Reader marker colours: identical to the canvas strip's `.ws__ptr` pointers so a reader reads the same in both views. */
function markerStyle(status: RingBufferStatus, focused: boolean) {
  if (status === 'TOO_EARLY') return focused ? { fill: 'rgba(238, 0, 0, 0.4)', text: '#ff6b6b' } : { fill: 'rgba(244, 144, 44, 0.35)', text: '#f4902c' };
  if (status === 'TOO_LATE') return { fill: focused ? '#ee0000' : '#7a0010', text: '#ffffff' };
  return { fill: focused ? '#ee0000' : '#f4902c', text: '#ffffff' };
}

/** The canvas pointer shape (a house pointing up) centred on (cx, cy) with side `s`. */
function pointerPoints(cx: number, cy: number, s: number) {
  const h = s / 2;
  return `${cx},${cy - h} ${cx + h},${cy - h + 0.35 * s} ${cx + h},${cy + h} ${cx - h},${cy + h} ${cx - h},${cy - h + 0.35 * s}`;
}

/** Audio window drawn in the video grain colour when the reader is time-aligned to a video flow. */
const VIDEO_ALIGNED_COLOR = '#3b8fe0';

/** Head marker colour, shared with the canvas strip's head pointer. */
const HEAD_COLOR = '#1a73e8';

const STATUS_LABEL: Record<RingBufferStatus, string> = { OK: 'OK', TOO_EARLY: 'waiting', TOO_LATE: 'too late' };

const slotAngle = (slot: number, count: number) => -Math.PI / 2 + (slot * 2 * Math.PI) / count;
const polar = (angle: number, radius: number) => ({ x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius });

function wedgePath(a0: number, a1: number): string {
  const o0 = polar(a0, R_OUT);
  const o1 = polar(a1, R_OUT);
  const i1 = polar(a1, R_IN);
  const i0 = polar(a0, R_IN);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${o0.x},${o0.y} A${R_OUT},${R_OUT} 0 ${large} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${R_IN},${R_IN} 0 ${large} 0 ${i0.x},${i0.y} Z`;
}

/**
 * The graph is re-evaluated only every 200ms (about ten grains), so its
 * indices arrive as a staircase. Between snapshots the markers are advanced
 * along the sim clock (`ExtraGrains`), and this small time constant only hides
 * the sub-grain mismatch when the next snapshot lands.
 */
const SMOOTH_TAU_MS = 40;

/** Fractional grains elapsed since the snapshot was taken; keeps motion continuous between graph ticks. */
type ExtraGrains = () => number;

/**
 * Angle of the slot holding `grainIndex`, advanced by the grain-index delta
 * rather than by the shortest way round. Time only moves forward, so a marker
 * that jumps several slots between renders (small rings, fast playback) still
 * sweeps clockwise instead of appearing to run backwards.
 */
function useGrainAngle(grainIndex: number, n: number): number {
  const ref = useRef<{ index: number; n: number; angle: number } | null>(null);
  const cur = ref.current;
  if (cur === null || cur.n !== n) {
    ref.current = { index: grainIndex, n, angle: slotAngle(((grainIndex % n) + n) % n, n) };
  } else {
    cur.angle += ((grainIndex - cur.index) * 2 * Math.PI) / n;
    cur.index = grainIndex;
  }
  return ref.current!.angle;
}

/**
 * Rotates `group` about the ring centre towards `target` (radians) every frame,
 * and counter-rotates `label` about its own point so text stays upright.
 */
function useSmoothRotation(
  target: number,
  n: number,
  extraGrains: ExtraGrains,
  group: RefObject<SVGGElement | null>,
  label: RefObject<SVGGElement | null>,
  /** Advance in whole `stepGrains` jumps (a video-aligned audio read consumes one video grain's span at a time). */
  step?: { grainIndex: number; stepGrains: number },
) {
  const targetRef = useRef({ target, n, extraGrains, step });
  targetRef.current = { target, n, extraGrains, step };
  const goal = () => {
    const t = targetRef.current;
    const extra = Math.max(0, t.extraGrains());
    const advance = t.step && t.step.stepGrains > 1
      ? Math.floor((t.step.grainIndex + extra + 1) / t.step.stepGrains) * t.step.stepGrains - 1 - t.step.grainIndex
      : extra;
    return t.target + (advance * 2 * Math.PI) / t.n;
  };
  useLayoutEffect(() => {
    let current = goal();
    let last = performance.now();
    let raf = 0;
    const apply = () => {
      const deg = (current * 180) / Math.PI;
      if (group.current) group.current.style.transform = `rotate(${deg}deg)`;
      if (label.current) label.current.style.transform = `rotate(${-deg}deg)`;
    };
    apply();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const want = goal();
      // A large jump (graph edit, resuming from pause) snaps instead of spinning.
      current = Math.abs(want - current) > 6 * Math.PI ? want : current + (want - current) * (1 - Math.exp(-dt / SMOOTH_TAU_MS));
      apply();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [group, label]);
}

/** The head marker (MXL's `headIndex`): the same blue pointer as the canvas strip, just outside the ring, aimed at the head slot; it rotates smoothly about the ring centre. */
function Arrow({ grainIndex, n, extraGrains, label, sweepSlots = 0 }: { grainIndex: number; n: number; extraGrains: ExtraGrains; label: string; sweepSlots?: number }) {
  const target = useGrainAngle(grainIndex, n);
  const group = useRef<SVGGElement>(null);
  const labelRef = useRef<SVGGElement>(null);
  useSmoothRotation(target, n, extraGrains, group, labelRef);
  const p = polar(0, R_OUT + 15);
  return (
    <g ref={group} style={{ transformOrigin: `${CX}px ${CY}px` }}>
      {sweepSlots > 0 && (
        <path d={wedgePath(-Math.PI / n, (2 * Math.PI * (sweepSlots - 0.5)) / n)} fill="rgba(10,12,16,0.72)" pointerEvents="none">
          <title>Head and writer-reserved samples: cannot be read</title>
        </path>
      )}
      <polygon points={pointerPoints(p.x, p.y, 22)} fill={HEAD_COLOR} transform={`rotate(-90 ${p.x} ${p.y})`}>
        <title>Head: the latest committed grain (MXL headIndex)</title>
      </polygon>
      {/* counter-rotated so the label stays upright */}
      <g ref={labelRef} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        <text x={p.x} y={p.y} fill="#ffffff" fontSize="7" fontWeight="700" textAnchor="middle" dominantBaseline="central" pointerEvents="none">
          {label}
        </text>
      </g>
    </g>
  );
}

/** A reader marker on a slot (rotates smoothly about the ring centre as its slot changes). */
function SlotReader({
  grainIndex, n, extraGrains, windowSlots = 0, windowSpan, videoAligned = false, stepGrains = 1, radius, markerR, color, status, label, className, focused, onClick, title,
}: {
  grainIndex: number; n: number; extraGrains: ExtraGrains; windowSlots?: number;
  /** Exact window in slots relative to the marker's slot centre (newer is positive); overrides `windowSlots`. */
  windowSpan?: { from: number; to: number };
  videoAligned?: boolean; stepGrains?: number; radius: number; markerR: number; color: string; status: RingBufferStatus; label: string; className: string; focused: boolean; onClick: () => void; title: string;
}) {
  const span = windowSpan ?? (windowSlots > 0 ? { from: -(windowSlots - 0.5), to: 0.5 } : null);
  const target = useGrainAngle(grainIndex, n);
  const group = useRef<SVGGElement>(null);
  const labelRef = useRef<SVGGElement>(null);
  useSmoothRotation(target, n, extraGrains, group, labelRef, videoAligned ? { grainIndex, stepGrains } : undefined);
  const edge = polar(0, R_IN);
  const p = polar(0, radius);
  const style = markerStyle(status, focused);
  return (
    <g ref={group} className={className} onClick={onClick} style={{ transformOrigin: `${CX}px ${CY}px` }}>
      {span && span.to > span.from && (
        <path
          d={`M${polar((2 * Math.PI * span.from) / n, R_OUT - 2).x},${polar((2 * Math.PI * span.from) / n, R_OUT - 2).y} A${R_OUT - 2},${R_OUT - 2} 0 ${span.to - span.from > n / 2 ? 1 : 0} 1 ${polar((2 * Math.PI * span.to) / n, R_OUT - 2).x},${polar((2 * Math.PI * span.to) / n, R_OUT - 2).y}`}
          fill="none"
          stroke={videoAligned ? VIDEO_ALIGNED_COLOR : focused ? '#ee0000' : color}
          strokeWidth="4"
          opacity="0.95"
        />
      )}
      <line x1={edge.x} y1={edge.y} x2={p.x} y2={p.y} stroke={color} strokeWidth="1" opacity="0.6" />
      {/* apex turned outward so the pointer aims at its slot as it rotates */}
      <polygon points={pointerPoints(p.x, p.y, markerR * 2)} fill={style.fill} transform={`rotate(90 ${p.x} ${p.y})`} />
      <g ref={labelRef} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
        <text x={p.x} y={p.y} fill={style.text} fontSize={markerR > 6 ? 6.5 : 5.5} fontWeight="700" textAnchor="middle" dominantBaseline="central" pointerEvents="none">
          R{label}
        </text>
      </g>
      <title>{title}</title>
    </g>
  );
}

/** Where video grains begin on an audio ring, drawn only while a reader is time-aligned to video. A slot is fixed by `index mod n`, so a boundary sits at the slot holding each grain index that is a multiple of the video span. */
function VideoGrainTicks({ ring, n }: { ring: WriterRingModel; n: number }) {
  const boundaries = videoBoundaryGrains(ring).filter((g) => g > ring.publishedGrainIndex - n && g <= ring.publishedGrainIndex + 1);
  if (boundaries.length === 0) return null;
  return (
    <g pointerEvents="none">
      <title>Video grain boundaries: each video timestamp as a sample index</title>
      {boundaries.map((g) => {
        // A fractional batch index sits at that fraction of its slot (slot = index mod n).
        const a = slotAngle(((g % n) + n) % n, n) - Math.PI / n;
        const o = polar(a, R_OUT + 2);
        const i = polar(a, R_IN - 2);
        return <line key={g} x1={i.x} y1={i.y} x2={o.x} y2={o.y} stroke={VIDEO_ALIGNED_COLOR} strokeWidth="1.5" opacity="0.9" />;
      })}
    </g>
  );
}

/** Unbroken ring of samples: thin segments in each slot's colour (no gaps or labels, so no slots read as boxes), at most 120 of them. */
function AudioRing({ n }: { n: number }) {
  const segs = Math.min(n, 120);
  const step = (2 * Math.PI) / segs;
  return (
    <g>
      {Array.from({ length: segs }, (_, i) => {
        const a = slotAngle((i * n) / segs, n) - Math.PI / n;
        return <path key={i} d={wedgePath(a, a + step + 0.01)} fill={slotColor(Math.floor((i * n) / segs), n)} />;
      })}
    </g>
  );
}

/**
 * One writer flow's MXL ring with every reader that consumes it. The slot a
 * grain lands in is fixed by its index (`index mod slots`), so readers at
 * different points in time sit on different slots; readers sharing a slot
 * fan inward by lane. Under the ring a linear "now bar" shows the same
 * readers on a time axis: oldest retained grain on the left, now on the right.
 */
/** Audio read window: aligned to a video grain (by timestamp) when a video sibling is synced, otherwise a plain batch. */
function audioWindowText(reader: WriterReader, grainMs: number): string {
  const read = reader.reading.buffer.alignedRead;
  if (read) return `1 video grain = ${((read.sampleCount * 1000) / read.sampleRate).toFixed(1).replace(/\.0$/, '')}ms · ${read.sampleCount.toLocaleString()} smp`;
  const windowMs = reader.windowGrains * grainMs;
  return windowMs >= 1 ? `${Math.round(windowMs)}ms window` : '1 batch';
}

/** Batches per video grain when it is a whole number (e.g. 2 at 50 fps), so a marker can step a grain at a time; else 1. */
function wholeBatchesPerVideoGrain(ring: WriterRingModel): number {
  const read = ring.readers.find((r) => r.reading.buffer.alignedRead)?.reading.buffer.alignedRead;
  if (!read) return 1;
  const ratio = (read.endTimestampMs - read.timestampMs) / ring.grainDurationMs;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6 ? Math.max(1, Math.round(ratio)) : 1;
}

/**
 * How MXL pairs this audio read with its video grain: the grain's timestamp,
 * converted to each flow's own index (`timestampToIndex`).
 */
function AlignedReadout({ reader, showRealGrainIndex }: { reader: WriterReader; showRealGrainIndex: boolean }) {
  const read = reader.reading.buffer.alignedRead;
  if (!read) return null;
  const grain = showRealGrainIndex ? formatGrouped(read.videoGrainIndex) : String(simplifiedGrainIndex(read.videoGrainIndex, read.videoRate));
  const smp = (i: number) => sampleIndexLabel(i, read.sampleRate, showRealGrainIndex, read.videoRate);
  return (
    <li className="writer-ring__aligned" title="MXL aligns by timestamp: one time, converted to each flow's own index (timestampToIndex)">
      <div>
        T = {timestampToTimecode(read.timestampMs, read.videoRate)} <span>(video grain timestamp)</span>
      </div>
      <div>
        V {rateLabel(read.videoRate)} fps → grain {grain}
      </div>
      <div>
        A {rateLabel({ numerator: read.sampleRate, denominator: 1000 })} kHz → samples {smp(read.firstSample)} … {smp(read.lastSample)} ({read.sampleCount.toLocaleString()})
      </div>
    </li>
  );
}

export function WriterRing({ ring, writerLabel, labelByNodeId, parkedInputKeys, focusedNodeId = null, onFocusNode, barOnly = false, audio = false, showRealGrainIndex = false, getNow, snapshotMs }: WriterRingProps) {
  const media = useMediaConfig();
  const n = ring.grainCount;
  const extraGrains: ExtraGrains = () => {
    if (!getNow || snapshotMs === undefined) return 0;
    // The sub-grain part of the snapshot time, plus the sim time elapsed since.
    const frac = snapshotMs / ring.grainDurationMs - ring.nowGrainIndex;
    return frac + (getNow() - snapshotMs) / ring.grainDurationMs;
  };
  const maxLane = ring.readers.reduce((m, r) => Math.max(m, r.lane), 0);
  const markerR = ring.readers.length > 4 ? 5.5 : 7;
  const showLabels = n <= 16;

  const span = Math.max(1, ring.lagGrains + ring.retainedGrains);
  const barX = (grainsBehindNow: number) => BAR_X1 - (Math.min(Math.max(grainsBehindNow, 0), span) / span) * (BAR_X1 - BAR_X0);
  const barY = barOnly ? 16 : 2 * CY + 6;
  const svgH = barY + BAR_H + 6 + (maxLane + 1) * LANE_H;


  return (
    <div className="writer-ring">
      <div className="writer-ring__header">
        <span className="writer-ring__lag">
          lag {ring.lagGrains} gr · {Math.round(ring.lagMs)}ms
        </span>
      </div>
      <svg className="writer-ring__svg" width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} role="img" aria-label={`${writerLabel} ring buffer with ${ring.readers.length} readers`}>
        {audio && <AudioRing n={n} />}
        {audio && !barOnly && <VideoGrainTicks ring={ring} n={n} />}
        {!barOnly && !audio && Array.from({ length: n }, (_, s) => {
          const j = slotHoldsGrainIndex(ring.publishedGrainIndex, s, n);
          const half = Math.PI / n;
          const a = slotAngle(s, n);
          const slotAge = (ring.publishedSlot - s + n) % n;
          const retained = slotAge >= 1 && slotAge <= ring.readableOldestAge;
          const isHead = slotAge === 0;
          const mid = polar(a, (R_OUT + R_IN) / 2);
          return (
            <g key={s}>
              <path
                d={wedgePath(a - half + 0.02, a + half - 0.02)}
                fill={slotColor(s, n)}
                opacity={isHead ? 1 : retained ? Math.max(0.35, 1 - slotAge / (n + 1)) : 0.15}
                stroke={isHead ? '#efb03a' : retained ? 'none' : 'var(--ui-text-faint)'}
                strokeWidth={isHead ? 1.5 : 1}
                strokeDasharray={retained || isHead ? undefined : '2 2'}
              >
                <title>{`slot ${s + 1} · grain ${grainIndexLabel(j, ring.grainRate, showRealGrainIndex, 12)}${isHead ? ' · being written, cannot be read' : retained ? '' : ' · outside retained history'}`}</title>
              </path>
              {showLabels && (
                <>
                <text x={mid.x} y={mid.y - 3.5} fill="#0e1822" fontSize="7" fontWeight="700" textAnchor="middle" dominantBaseline="middle" pointerEvents="none">
                  {s + 1}
                </text>
                <text x={mid.x} y={mid.y + 4} fill="#0e1822" fontSize="5.5" textAnchor="middle" dominantBaseline="middle" pointerEvents="none">
                  {grainIndexLabel(j, ring.grainRate, showRealGrainIndex, n > 10 ? 3 : 4)}
                </text>
                </>
              )}
            </g>
          );
        })}

        {!barOnly && <Arrow grainIndex={ring.publishedGrainIndex} n={n} extraGrains={extraGrains} label="Head" sweepSlots={audio ? n - ring.readableOldestAge : 0} />}

        {!barOnly && ring.readers.map((reader, i) => {
          const parked = parkedInputKeys?.has(reader.key) ?? false;
          const focused = reader.readerNodeId === focusedNodeId;
          const className = `writer-ring__reader${parked ? ' writer-ring__reader--parked' : ''}${focused ? ' writer-ring__reader--focused' : ''}`;
          const color = markerStyle(reader.status, focused).fill;
          const title = readerTitle(reader, labelByNodeId);
          if (reader.ringSlot === null) {
            // Too late: its grain was overwritten, so it has no slot. Park it in the hub, like the strip's "too late" box.
            const lateIdx = ring.readers.filter((r) => r.ringSlot === null).indexOf(reader);
            const x = CX - 18 + lateIdx * (markerR * 2 + 2);
            const y = CY + 22;
            return (
              <g key={reader.key} className={className} onClick={() => onFocusNode?.(reader.readerNodeId)}>
                <polygon points={pointerPoints(x, y, markerR * 2)} fill={markerStyle(reader.status, focused).fill} />
                <text x={x} y={y + markerR * 0.2} fill="#ffffff" fontSize={markerR > 6 ? 6.5 : 5.5} fontWeight="700" textAnchor="middle" dominantBaseline="central" pointerEvents="none">
                  ✕
                </text>
                <title>{title}</title>
              </g>
            );
          }
          return (
            <SlotReader
              key={reader.key}
              grainIndex={ring.publishedGrainIndex - (reader.ringAge ?? 0)}
              n={n}
              extraGrains={extraGrains}
              windowSlots={audio ? Math.min(reader.windowGrains, n) : reader.pairedWithAudio ? 1 : 0}
              windowSpan={
                reader.exactWindow && reader.ringAge !== null
                  ? { from: reader.ringAge - 0.5 - reader.exactWindow.fromAge, to: reader.ringAge - 0.5 - reader.exactWindow.toAge }
                  : undefined
              }
              videoAligned={reader.exactWindow !== undefined || reader.pairedWithAudio}
              stepGrains={reader.exactWindow ? wholeBatchesPerVideoGrain(ring) : 1}
              radius={Math.max(markerR + 2, R_IN - 4 - markerR - reader.lane * (markerR * 2 + 1))}
              markerR={markerR}
              color={color}
              status={reader.status}
              label={String(i + 1)}
              className={className}
              focused={focused}
              onClick={() => onFocusNode?.(reader.readerNodeId)}
              title={title}
            />
          );
        })}

        {!barOnly && (
          <>
            <text x={CX} y={CY - 2} style={{ fill: 'var(--ui-text-dim)' }} fontSize="8" textAnchor="middle" fontWeight="700">
              {audio ? `${samplesPerAudioBatch(media)} smp/batch` : `head slot ${ring.publishedSlot + 1}`}
            </text>
          </>
        )}

        {/* now bar: oldest retained grain (left) → now (right) */}
        <text x={BAR_X0} y={barY - 8} style={{ fill: 'var(--ui-text-dim)' }} fontSize="7">
          oldest retained
        </text>
        <rect x={BAR_X0} y={barY} width={barX(ring.lagGrains) - BAR_X0} height={BAR_H} fill="rgba(76,175,80,0.3)" />
        <rect x={barX(ring.lagGrains)} y={barY} width={BAR_X1 - barX(ring.lagGrains)} height={BAR_H} fill="rgba(239,176,58,0.3)" />
        <rect x={BAR_X0} y={barY} width={BAR_X1 - BAR_X0} height={BAR_H} fill="none" style={{ stroke: 'var(--ui-text-faint)' }} />
        <line x1={barX(ring.lagGrains)} y1={barY - 2} x2={barX(ring.lagGrains)} y2={barY + BAR_H + 2} stroke="#efb03a" strokeWidth="2" />
        <line x1={BAR_X1} y1={barY - 4} x2={BAR_X1} y2={barY + BAR_H + 4} style={{ stroke: 'var(--ui-text)' }} strokeWidth="2" />
        <text x={BAR_X1} y={barY - 8} style={{ fill: 'var(--ui-text)' }} fontSize="7" textAnchor="end" fontWeight="700">
          now
        </text>
        <text x={barX(ring.lagGrains)} y={barY - 8} fill="#efb03a" fontSize="7" textAnchor="middle" fontWeight="700">
          head
        </text>
        {ring.readers.map((reader, i) => {
          const x = barX(reader.behindNowGrains);
          const y = barY + BAR_H + 6 + reader.lane * LANE_H + LANE_H / 2 - 1;
          const focused = reader.readerNodeId === focusedNodeId;
          return (
            <g key={reader.key} className={`writer-ring__reader${focused ? ' writer-ring__reader--focused' : ''}`} onClick={() => onFocusNode?.(reader.readerNodeId)}>
              <line x1={x} y1={barY + BAR_H} x2={x} y2={y - 4} stroke={markerStyle(reader.status, focused).fill} strokeWidth="1" opacity="0.6" />
              <polygon points={pointerPoints(x, y, 11)} fill={markerStyle(reader.status, focused).fill} />
              <text x={x} y={y + 1.2} fill={markerStyle(reader.status, focused).text} fontSize="5.5" fontWeight="700" textAnchor="middle" dominantBaseline="central" pointerEvents="none">
                R{i + 1}
              </text>
              <title>{readerTitle(reader, labelByNodeId)}</title>
            </g>
          );
        })}
      </svg>

      <ul className="writer-ring__readers">
        {ring.readers.map((reader, i) => {
          const parked = parkedInputKeys?.has(reader.key) ?? false;
          const focused = reader.readerNodeId === focusedNodeId;
          return [
            <li
              key={reader.key}
              className={`writer-ring__row${parked ? ' writer-ring__row--parked' : ''}${focused ? ' writer-ring__row--focused' : ''}`}
              onClick={() => onFocusNode?.(reader.readerNodeId)}
            >
              <span className="writer-ring__dot" style={{ background: markerStyle(reader.status, focused).fill, color: markerStyle(reader.status, focused).text }}>
                R{i + 1}
              </span>
              <span className="writer-ring__name">{labelByNodeId.get(reader.readerNodeId) ?? reader.readerNodeId}</span>
              <span className="writer-ring__detail">
                {barOnly || audio ? `−${Math.round(reader.behindNowGrains * ring.grainDurationMs)}ms · ${audioWindowText(reader, ring.grainDurationMs)}` : `${reader.ringSlot === null ? 'overwritten' : `slot ${reader.ringSlot + 1}`} · −${reader.behindNowGrains} gr`}
              </span>
              <span className="writer-ring__status" style={{ color: STATUS_COLOR[reader.status] }}>
                {parked ? 'parked' : STATUS_LABEL[reader.status]}
              </span>
            </li>,
            <AlignedReadout key={`${reader.key}-aligned`} reader={reader} showRealGrainIndex={showRealGrainIndex} />,
          ];
        })}
      </ul>
    </div>
  );
}
