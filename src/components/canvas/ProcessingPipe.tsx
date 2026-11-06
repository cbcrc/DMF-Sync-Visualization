import { useEffect, useRef, useState } from 'react';
import { advanceDisplayClock, extrapolatePipe, type DisplayClock, type ProcessingPipe as PipeModel } from '../../game/processingPipe';
import { grainDurationMs, grainIndexLabel } from '../../engine/mxlGrainIndex';

/** A Manual step is one grain at the default rate (`useSimClock`); every pipe replays it at the same pace. */
const STEP_MS = grainDurationMs();

const ms = (v: number) => `${Math.round(v)}ms`;

/**
 * The grains inside a function while it processes them. Each chip is a grain
 * it has read and not yet written, labelled with its index: it enters on the
 * left when read, crosses in the function's latency, and is written on the
 * right with the same index. The ends show the index read now and the one at
 * the output head, the same indices as the reader marker and the output strip.
 *
 * With `getNow` (the simulated clock), it redraws every animation frame,
 * moving on from the last snapshot (`extrapolatePipe`), so chips glide instead
 * of jumping once per 50 ms game tick. In Manual mode (`replaySteps`) each
 * Step is replayed slowly (`advanceDisplayClock`), so the grains are seen
 * moving through the function, then it holds still until the next Step.
 */
export function ProcessingPipe({
  pipe: snapshot,
  showRealGrainIndex,
  getNow,
  replaySteps = false,
}: {
  pipe: PipeModel;
  showRealGrainIndex: boolean;
  getNow?: () => number;
  replaySteps?: boolean;
}) {
  const [nowMs, setNowMs] = useState<number | undefined>(undefined);
  const display = useRef<DisplayClock | undefined>(undefined);
  const replayRef = useRef(replaySteps);
  replayRef.current = replaySteps;
  useEffect(() => {
    if (!getNow) return undefined;
    let raf = 0;
    const frame = (realNow: number) => {
      display.current = advanceDisplayClock(display.current, getNow(), realNow, STEP_MS, replayRef.current);
      const t = display.current.shownMs;
      setNowMs((prev) => (prev === t ? prev : t));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [getNow]);
  const pipe = nowMs === undefined ? snapshot : extrapolatePipe(snapshot, nowMs);
  const label = (index: number) => grainIndexLabel(index, pipe.grainRate, showRealGrainIndex);
  const unit = pipe.track === 'audio' ? 'batch' : 'grain';
  const inFlight = pipe.readIndex - pipe.writeIndex;
  return (
    <div
      className="mf-pipe"
      title={
        pipe.latencyMs === 0
          ? `No processing delay: each ${unit} is written with the index it was read, at once.`
          : `Reading #${label(pipe.readIndex)}, writing #${label(pipe.writeIndex)}. Each ${unit} takes ${ms(pipe.latencyMs)} and is written with the index it was read; ${inFlight} ${unit}${inFlight === 1 ? ' is' : 's are'} in flight.`
      }
    >
      <div className="mf-pipe__ends">
        <span>reads #{label(pipe.readIndex)}</span>
        {pipe.hiddenCount > 0 && (
          <span className="mf-pipe__more" title={`${pipe.hiddenCount} more ${unit}${pipe.hiddenCount === 1 ? '' : 's'} in flight, not drawn`}>
            +{pipe.hiddenCount}
          </span>
        )}
        <span>writes #{label(pipe.writeIndex)}</span>
      </div>
      <div className={`mf-pipe__track mf-pipe__track--${pipe.track}`}>
        {pipe.latencyMs === 0 && <span className="mf-pipe__idle">written as read</span>}
        {pipe.chips.map((c) => (
          <span
            key={c.index}
            // Alternate grains take alternate lanes so neighbours never overlap.
            className={`mf-pipe__chip mf-pipe__chip--lane${((c.index % 2) + 2) % 2}`}
            style={{ left: `calc(${c.progress} * (100% - var(--mf-pipe-chip-w)))` }}
            title={`#${label(c.index)}: read ${ms(c.progress * pipe.latencyMs)} ago, written as #${label(c.index)} in ${ms((1 - c.progress) * pipe.latencyMs)}`}
          >
            {label(c.index)}
          </span>
        ))}
      </div>
    </div>
  );
}
