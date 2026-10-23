import { useEffect, useRef, useState } from 'react';
import { useViewport } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from './MediaFunctionNode';
import type { InputReading } from '../../game/graphLatency';
import { LINEAR_TICK_MS, buildNodeGeometry, type Grain } from '../../game/grainFlow';
import {
  DEFAULT_GRAIN_RATE,
  grainIndexForDisplay,
} from '../../engine/mxlGrainIndex';
import './LinearBoundaryOverlay.css';

/**
 * Items #2 / #2.b: the production workload's boundaries. Outside the
 * Ingress → Egress boundary the world is linear and synchronous (a steady,
 * clocked stream of video frames and audio samples); inside it, MXL is
 * asynchronous and passes grains along as fast as it can. This overlay draws
 * the linear side at each boundary:
 *
 * - **Ingress (2.b):** a paced "wire" of evenly spaced video and audio ticks
 *   arriving at the node's left edge, each at its own native grain rate.
 * - **Egress (2):** the mirror image — a steady tick-train leaving the right
 *   edge. The Egress reads from different ring positions to rebuild that
 *   steady cadence, and waits for the slow (video) input to arrive before
 *   reading the faster (audio) one, so the pair goes out together.
 */

const LANE_W = 260;
const GAP_PX = 16;
/** Ticks are spaced 24px apart, and slow enough that each moves only a few px per screen refresh. */
const PX_PER_MS = 24 / LINEAR_TICK_MS;
const WINDOW_MS = LANE_W / PX_PER_MS;
/** How long (ms) the Ingress "tick arrived → write" flash stays visible. */
const TRIGGER_FLASH_MS = 700;

const VIDEO_MS = LINEAR_TICK_MS;

export interface LinearBoundaryOverlayProps {
  nodes: Node<MediaFunctionNodeData>[];
  edges: Edge[];
  inputsByNodeId: Map<string, InputReading[]>;
  /** Simulated-clock time each edge last carried a grain (from `useGrainFlow`). */
  edgeActivity: Map<string, number>;
  /** Live grains, used to show which Egress inputs are parked waiting on a sibling. */
  grains: Grain[];
  domainSizeMs: number;
  showRealGrainIndex?: boolean;
  getNow?: () => number;
}

/** Re-render once per animation frame while the simulated clock is moving. */
function useFrameTick(getNow: () => number) {
  const [, setTick] = useState(0);
  const getNowRef = useRef(getNow);
  getNowRef.current = getNow;
  useEffect(() => {
    let raf = 0;
    let last = NaN;
    const loop = () => {
      const t = getNowRef.current();
      if (t !== last) {
        last = t;
        setTick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

type Direction = 'in' | 'out';

/**
 * `lagMs` is how long after a grain's origin time it leaves the wire: 0 for
 * the Ingress (the tick *is* the capture instant), the Egress's aligned
 * read lag plus its own latency for an output.
 */
function tickTimes(now: number, direction: Direction, lagMs: number) {
  const out: { originTs: number; x: number }[] = [];
  if (direction === 'out') {
    const first = Math.ceil((now - WINDOW_MS - lagMs) / VIDEO_MS);
    const last = Math.floor((now - lagMs) / VIDEO_MS);
    for (let i = first; i <= last; i += 1) {
      out.push({ originTs: i * VIDEO_MS, x: (now - (i * VIDEO_MS + lagMs)) * PX_PER_MS });
    }
  } else {
    const first = Math.ceil(now / VIDEO_MS);
    const last = Math.floor((now + WINDOW_MS) / VIDEO_MS);
    for (let i = first; i <= last; i += 1) {
      out.push({ originTs: i * VIDEO_MS, x: LANE_W - (i * VIDEO_MS - now) * PX_PER_MS });
    }
  }
  return out;
}

interface LaneProps {
  now: number;
  direction: Direction;
  lagMs: number;
  track: 'video' | 'audio';
  status?: 'OK' | 'TOO_EARLY' | 'TOO_LATE';
  domainSizeMs: number;
  showRealGrainIndex: boolean;
  /** Ingress only: simulated time of the most recent tick that triggered an MXL write. */
  triggerAt?: number;
  /** Egress only: this track's grain has arrived and is waiting on these sibling tracks (e.g. "V"). */
  waitingFor?: string;
}

function Lane({
  now,
  direction,
  lagMs,
  track,
  status = 'OK',
  domainSizeMs,
  showRealGrainIndex,
  triggerAt,
  waitingFor,
}: LaneProps) {
  const isVideo = track === 'video';
  const statusClass = status === 'TOO_LATE' ? ' lb-lane--lost' : status === 'TOO_EARLY' ? ' lb-lane--early' : '';

  // Video: one labeled tick per 20ms frame. Audio's 1ms grains (20 per frame)
  // are far too fine to draw as separate ticks at this slow, readable speed,
  // so audio is a continuous band with the shared frame boundaries marked on it.
  const videoTicks = tickTimes(now, direction, lagMs);
  const leading = videoTicks.length
    ? direction === 'out'
      ? videoTicks.reduce((a, b) => (b.x < a.x ? b : a))
      : videoTicks.reduce((a, b) => (b.x > a.x ? b : a))
    : undefined;

  const triggerAge = triggerAt === undefined ? Infinity : now - triggerAt;
  const flashing = triggerAge >= 0 && triggerAge < TRIGGER_FLASH_MS;

  return (
    <div className={`lb-lane lb-lane--${track} lb-lane--${direction}${statusClass}`}>
      {!isVideo && <div className="lb-lane__band" />}
      {flashing && (
        <div className="lb-lane__trigger" style={{ opacity: 1 - triggerAge / TRIGGER_FLASH_MS }} />
      )}
      {waitingFor && <div className="lb-lane__wait">⏳ arrived — waiting for {waitingFor}</div>}
      {videoTicks.map((t) => {
        const isLeading = isVideo && leading === t;
        return (
          <div
            key={t.originTs}
            className={`lb-tick ${isVideo ? 'lb-tick--video' : 'lb-tick--boundary'}${
              isLeading ? ' lb-tick--leading' : ''
            }`}
            style={{ left: t.x }}
          >
            {isLeading && (
              <span className="lb-tick__label">
                #{grainIndexForDisplay(t.originTs, DEFAULT_GRAIN_RATE, domainSizeMs, showRealGrainIndex)}
              </span>
            )}
          </div>
        );
      })}
      <div className="lb-lane__edge" />
    </div>
  );
}

const TRACK_LABEL: Record<'video' | 'audio', string> = {
  video: 'V · video frames',
  audio: 'A · audio (fine 1ms grains, continuous)',
};

export function LinearBoundaryOverlay({
  nodes,
  edges,
  inputsByNodeId,
  edgeActivity,
  grains,
  domainSizeMs,
  showRealGrainIndex = false,
  getNow = () => performance.now(),
}: LinearBoundaryOverlayProps) {
  useFrameTick(getNow);
  const { x, y, zoom } = useViewport();
  const now = getNow();
  const geometry = buildNodeGeometry(nodes);

  const panels: JSX.Element[] = [];

  for (const node of nodes) {
    const geom = geometry.get(node.id);
    if (!geom) continue;
    const cy = geom.y + geom.size / 2;

    if (node.data.kind === 'input' && node.data.outputCount > 0) {
      const hasAudio = node.data.outputCount > 1;
      // The tick whose arrival triggered the latest MXL write: the grains
      // spawn at `edgeActivity`, snapped to that tick's frame boundary.
      let triggerAt: number | undefined;
      for (const edge of edges) {
        if (edge.source !== node.id) continue;
        const stamp = edgeActivity.get(edge.id);
        if (stamp !== undefined && (triggerAt === undefined || stamp > triggerAt)) triggerAt = stamp;
      }
      if (triggerAt !== undefined) triggerAt = Math.floor(triggerAt / VIDEO_MS) * VIDEO_MS;
      panels.push(
        <div
          key={`in-${node.id}`}
          className="lb-panel lb-panel--in"
          style={{ left: geom.x - GAP_PX - LANE_W, top: cy, width: LANE_W }}
        >
          <div className="lb-panel__title">Linear in · synchronous, outside MXL</div>
          <div className="lb-panel__caption">{TRACK_LABEL.video}</div>
          <Lane
            now={now}
            direction="in"
            lagMs={0}
            track="video"
            domainSizeMs={domainSizeMs}
            showRealGrainIndex={showRealGrainIndex}
            triggerAt={triggerAt}
          />
          {hasAudio && (
            <>
              <div className="lb-panel__caption">{TRACK_LABEL.audio}</div>
              <Lane
                now={now}
                direction="in"
                lagMs={0}
                track="audio"
                domainSizeMs={domainSizeMs}
                showRealGrainIndex={showRealGrainIndex}
                triggerAt={triggerAt}
              />
            </>
          )}
          <div className="lb-panel__readout">
            evenly paced · jitter 0.0ms · when a tick reaches the Ingress it carries data to write, which starts
            that grain's MXL flow (flash)
          </div>
        </div>,
      );
    }

    if (node.data.kind === 'output') {
      const readings = (inputsByNodeId.get(node.id) ?? []).filter(
        (r) => r.track === 'video' || r.track === 'audio',
      );
      if (readings.length === 0) continue;

      // Egress output lag: the aligned (slowest-branch) read lag plus its own latency.
      const lagMs = readings[0].buffer.alignedLagMs + node.data.latencyMs;

      // Which inputs currently have a grain parked at this Egress, waiting for
      // a sibling input's grain to arrive before the set can be read together.
      const parkedInputs = new Set<number>();
      for (const g of grains) {
        if (g.fromId !== node.id || g.phase !== 'holding') continue;
        if (g.parked) parkedInputs.add(g.targetHandleIndex ?? 0);
      }
      const missing = readings.filter((r) => !parkedInputs.has(r.inputIndex));
      const waitingFor = parkedInputs.size > 0 && missing.length > 0 ? missing : [];
      const letterOf = (t: string) => (t === 'audio' ? 'A' : 'V');

      panels.push(
        <div
          key={`out-${node.id}`}
          className="lb-panel lb-panel--out"
          style={{ left: geom.x + geom.size + GAP_PX, top: cy, width: LANE_W }}
        >
          <div className="lb-panel__title">Linear out · synchronous, outside MXL</div>
          {readings.map((r) => {
            const track = r.track as 'video' | 'audio';
            return (
              <div key={r.inputIndex}>
                <div className="lb-panel__caption">{TRACK_LABEL[track]} · paced out</div>
                <Lane
                  now={now}
                  direction="out"
                  lagMs={lagMs}
                  track={track}
                  status={r.evaluation.status}
                  domainSizeMs={domainSizeMs}
                  showRealGrainIndex={showRealGrainIndex}
                  waitingFor={
                    parkedInputs.has(r.inputIndex) && waitingFor.length > 0
                      ? waitingFor.map((w) => letterOf(w.track)).join(' + ')
                      : undefined
                  }
                />
              </div>
            );
          })}
          <div className="lb-panel__readout">
            <div>evenly paced · jitter 0.0ms — the read position moves so every output tick is on time</div>
          </div>
        </div>,
      );
    }
  }

  return (
    <div className="lb-overlay" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
      {panels}
    </div>
  );
}
