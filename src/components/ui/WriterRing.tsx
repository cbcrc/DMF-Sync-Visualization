import { grainIndexLabel, slotHoldsGrainIndex } from '../../engine/mxlGrainIndex';
import type { RingBufferStatus } from '../../types';
import { readerTitle, type WriterRing as WriterRingModel } from '../../game/writerRings';
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
  /** Grain index shown in each slot: false = simplified count, true = last digits of the real MXL index. */
  showRealGrainIndex?: boolean;
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

/** An arrow at `angle` just outside the ring, pointing at the slot. */
function Arrow({ angle, color, offset = 0, label }: { angle: number; color: string; offset?: number; label: string }) {
  const a = angle + offset;
  const p = polar(a, R_OUT + 7);
  const t = polar(a, R_OUT + 17);
  return (
    <g>
      <g transform={`translate(${p.x} ${p.y}) rotate(${(a * 180) / Math.PI + 180})`}>
        <path d="M-4,-4 L4,0 L-4,4 Z" fill={color} />
      </g>
      <text x={t.x} y={t.y} fill={color} fontSize="7" fontWeight="700" textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
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
export function WriterRing({ ring, writerLabel, labelByNodeId, parkedInputKeys, focusedNodeId = null, onFocusNode, barOnly = false, showRealGrainIndex = false }: WriterRingProps) {
  const n = ring.grainCount;
  const maxLane = ring.readers.reduce((m, r) => Math.max(m, r.lane), 0);
  const lagSlots = Math.min(Math.max(ring.lagGrains, 0), n - 1);
  const markerR = ring.readers.length > 4 ? 5.5 : 7;
  const showLabels = n <= 16;

  const span = Math.max(1, ring.lagGrains + ring.retainedGrains);
  const barX = (grainsBehindNow: number) => BAR_X1 - (Math.min(Math.max(grainsBehindNow, 0), span) / span) * (BAR_X1 - BAR_X0);
  const barY = barOnly ? 16 : 2 * CY + 6;
  const svgH = barY + BAR_H + 6 + (maxLane + 1) * LANE_H;

  const headAngle = slotAngle(ring.publishedSlot, n);
  const nowAngle = slotAngle(ring.nowSlot, n);
  const sameSlot = ring.publishedSlot === ring.nowSlot;
  const lagStart = headAngle;
  const lagEnd = headAngle + (lagSlots * 2 * Math.PI) / n;
  const lagArcStart = polar(lagStart, R_OUT + 3);
  const lagArcEnd = polar(lagEnd, R_OUT + 3);

  return (
    <div className="writer-ring">
      <div className="writer-ring__header">
        <span className="writer-ring__label">{writerLabel}</span>
        <span className="writer-ring__lag">
          lag {ring.lagGrains} gr · {Math.round(ring.lagMs)}ms
        </span>
      </div>
      <svg className="writer-ring__svg" width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} role="img" aria-label={`${writerLabel} ring buffer with ${ring.readers.length} readers`}>
        {!barOnly && Array.from({ length: n }, (_, s) => {
          const j = slotHoldsGrainIndex(ring.publishedGrainIndex, s, n);
          const age = ring.publishedGrainIndex - j;
          const half = Math.PI / n;
          const a = slotAngle(s, n);
          const retained = age < ring.retainedGrains;
          const mid = polar(a, (R_OUT + R_IN) / 2);
          return (
            <g key={s}>
              <path
                d={wedgePath(a - half + 0.02, a + half - 0.02)}
                fill={`hsl(${(s * 360) / n} 55% 62%)`}
                opacity={retained ? Math.max(0.35, 1 - age / (n + 1)) : 0.15}
                stroke={retained ? 'none' : 'rgba(255,255,255,0.35)'}
                strokeDasharray={retained ? undefined : '2 2'}
              >
                <title>{`slot ${s + 1} · grain ${grainIndexLabel(j, ring.grainRate, showRealGrainIndex, 12)}${retained ? '' : ' · outside retained history'}`}</title>
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

        {!barOnly && lagSlots > 0 && (
          <path
            d={`M${lagArcStart.x},${lagArcStart.y} A${R_OUT + 3},${R_OUT + 3} 0 ${lagEnd - lagStart > Math.PI ? 1 : 0} 1 ${lagArcEnd.x},${lagArcEnd.y}`}
            fill="none"
            stroke="#efb03a"
            strokeWidth="2"
            strokeDasharray="3 2"
          >
            <title>{`Flow latency: head is ${ring.lagGrains} grains behind now`}</title>
          </path>
        )}
        {!barOnly && <Arrow angle={nowAngle} color="#ffffff" label="now" />}
        {!barOnly && <Arrow angle={headAngle} color="#efb03a" label="head" offset={sameSlot ? 0.3 : 0} />}

        {!barOnly && ring.readers.map((reader, i) => {
          const a = slotAngle(reader.requestedSlot, n);
          const radius = Math.max(markerR + 2, R_IN - 4 - markerR - reader.lane * (markerR * 2 + 1));
          const edge = polar(a, R_IN);
          const p = polar(a, radius);
          const parked = parkedInputKeys?.has(reader.key) ?? false;
          const focused = reader.readerNodeId === focusedNodeId;
          return (
            <g
              key={reader.key}
              className={`writer-ring__reader${parked ? ' writer-ring__reader--parked' : ''}${focused ? ' writer-ring__reader--focused' : ''}`}
              onClick={() => onFocusNode?.(reader.readerNodeId)}
            >
              <line x1={edge.x} y1={edge.y} x2={p.x} y2={p.y} stroke={STATUS_COLOR[reader.status]} strokeWidth="1" opacity="0.6" />
              <circle cx={p.x} cy={p.y} r={markerR} fill={STATUS_COLOR[reader.status]} stroke={focused ? '#ee0000' : '#111214'} strokeWidth={focused ? 2.5 : 1} />
              <text x={p.x} y={p.y} fill="#111214" fontSize={markerR > 6 ? 8 : 7} fontWeight="700" textAnchor="middle" dominantBaseline="central" pointerEvents="none">
                {i + 1}
              </text>
              <title>{readerTitle(reader, labelByNodeId)}</title>
            </g>
          );
        })}

        {!barOnly && (
          <>
            <text x={CX} y={CY - 4} fill="#ffffff" fontSize="8" textAnchor="middle" fontWeight="700">
              now slot {ring.nowSlot + 1}
            </text>
            <text x={CX} y={CY + 7} fill="#cfcfcf" fontSize="7" textAnchor="middle">
              head slot {ring.publishedSlot + 1}
            </text>
          </>
        )}

        {/* now bar: oldest retained grain (left) → now (right) */}
        <text x={BAR_X0} y={barY - 8} fill="#cfcfcf" fontSize="7">
          oldest retained
        </text>
        <rect x={BAR_X0} y={barY} width={barX(ring.lagGrains) - BAR_X0} height={BAR_H} fill="rgba(76,175,80,0.3)" />
        <rect x={barX(ring.lagGrains)} y={barY} width={BAR_X1 - barX(ring.lagGrains)} height={BAR_H} fill="rgba(239,176,58,0.3)" />
        <rect x={BAR_X0} y={barY} width={BAR_X1 - BAR_X0} height={BAR_H} fill="none" stroke="rgba(255,255,255,0.5)" />
        <line x1={barX(ring.lagGrains)} y1={barY - 2} x2={barX(ring.lagGrains)} y2={barY + BAR_H + 2} stroke="#efb03a" strokeWidth="2" />
        <line x1={BAR_X1} y1={barY - 4} x2={BAR_X1} y2={barY + BAR_H + 4} stroke="#ffffff" strokeWidth="2" />
        <text x={BAR_X1} y={barY - 8} fill="#ffffff" fontSize="7" textAnchor="end" fontWeight="700">
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
              <line x1={x} y1={barY + BAR_H} x2={x} y2={y - 4} stroke={STATUS_COLOR[reader.status]} strokeWidth="1" opacity="0.6" />
              <circle cx={x} cy={y} r={5} fill={STATUS_COLOR[reader.status]} stroke={focused ? '#ee0000' : '#111214'} strokeWidth={focused ? 2.5 : 1} />
              <text x={x} y={y} fill="#111214" fontSize="6.5" fontWeight="700" textAnchor="middle" dominantBaseline="central" pointerEvents="none">
                {i + 1}
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
          return (
            <li
              key={reader.key}
              className={`writer-ring__row${parked ? ' writer-ring__row--parked' : ''}${focused ? ' writer-ring__row--focused' : ''}`}
              onClick={() => onFocusNode?.(reader.readerNodeId)}
            >
              <span className="writer-ring__dot" style={{ background: STATUS_COLOR[reader.status] }}>
                {i + 1}
              </span>
              <span className="writer-ring__name">{labelByNodeId.get(reader.readerNodeId) ?? reader.readerNodeId}</span>
              <span className="writer-ring__detail">
                {barOnly ? `−${Math.round(reader.behindNowGrains * ring.grainDurationMs)}ms` : `slot ${reader.requestedSlot + 1} · −${reader.behindNowGrains} gr`}
              </span>
              <span className="writer-ring__status" style={{ color: STATUS_COLOR[reader.status] }}>
                {parked ? 'parked' : STATUS_LABEL[reader.status]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
