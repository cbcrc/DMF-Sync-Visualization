// Item #9: a single shared "teaching clock" that every timing-driven engine
// (grain-flow animation, ring buffer evaluation, stability monitor, origin-
// timestamp display) reads from instead of calling `performance.now()` /
// `Date.now()` directly. This is what lets the whole simulation be slowed
// down or single-stepped as one coherent unit rather than each engine
// independently racing real wall-clock time.
//
// Deliberate departure from strict MXL wall-clock fidelity (see
// `AI_RULES.md`'s Known Simplifications): real MXL grain indices are derived
// from true elapsed PTP/TAI time, never slowed or paused. This clock is a
// pedagogical aid so a player can watch grains resolve at a readable pace.

import { useCallback, useEffect, useRef, useState } from 'react';
import { grainDurationMs } from '../engine/mxlGrainIndex';

export type PlaybackMode = 'normal' | 'stepping' | 'manual';

/** How much slower than real time the simulated clock advances in Stepping mode. */
const STEPPING_SPEED = 0.2;

/** Default single-click advance in Manual mode: one video grain's worth of simulated time. */
export const MANUAL_STEP_MS = grainDurationMs();

export interface SimClock {
  mode: PlaybackMode;
  setMode: (mode: PlaybackMode) => void;
  /** Current simulated clock value (ms, monotonic) — read this instead of performance.now()/Date.now(). */
  getNow: () => number;
  /** Manual-mode only: nudge the clock forward by `incrementMs` (defaults to one grain). */
  step: (incrementMs?: number) => void;
}

/**
 * Normal: advances 1:1 with real time (today's behavior).
 * Stepping: auto-advances, but at `STEPPING_SPEED` so grains visibly crawl.
 * Manual: frozen — only `step()` moves it forward, one quantum at a time.
 */
export function useSimClock(): SimClock {
  const [mode, setModeState] = useState<PlaybackMode>('normal');
  const modeRef = useRef<PlaybackMode>('normal');
  const simNowRef = useRef(performance.now());
  const lastRealRef = useRef(performance.now());

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const realNow = performance.now();
      const dtReal = realNow - lastRealRef.current;
      lastRealRef.current = realNow;
      if (modeRef.current === 'normal') {
        simNowRef.current += dtReal;
      } else if (modeRef.current === 'stepping') {
        simNowRef.current += dtReal * STEPPING_SPEED;
      }
      // 'manual': no auto-advance; only `step()` moves the clock.
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setMode = useCallback((next: PlaybackMode) => {
    // Reset the real-time reference so switching modes never applies a
    // large backlog of elapsed real time in one jump (e.g. after a long
    // spell in Manual mode) — the next frame always applies a fresh, small dt.
    lastRealRef.current = performance.now();
    modeRef.current = next;
    setModeState(next);
  }, []);

  const getNow = useCallback(() => simNowRef.current, []);

  const step = useCallback((incrementMs: number = MANUAL_STEP_MS) => {
    simNowRef.current += incrementMs;
  }, []);

  return { mode, setMode, getNow, step };
}
