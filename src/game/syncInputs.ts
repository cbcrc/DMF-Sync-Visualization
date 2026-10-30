/**
 * Functions that write their media into a fresh ring buffer of their own, at the
 * current time, instead of passing the upstream grain index through.
 */
export function rewritesAsNewSource(kind: string): boolean {
  return kind === 'delay';
}

/** Mixers (multi-input Editorial functions) can read individual inputs free of the sync point. */
export function hasSyncChoice(data: { kind: string; inputCount: number }): boolean {
  return data.kind === 'editorial' && data.inputCount > 1;
}

/**
 * The wired inputs a function reads at the newest readable grain (one behind
 * the write head) instead of the aligned, slowest-branch index. They no longer
 * hold the function back. If every wired input is set to ignore sync there is
 * nothing left to align against, so they all stay synced.
 */
export function freeRunningInputs(
  data: { kind: string; inputCount: number; ignoreSyncInputs?: number[] },
  wiredInputs: number[],
): Set<number> {
  if (!hasSyncChoice(data) || !data.ignoreSyncInputs?.length) return new Set();
  const free = wiredInputs.filter((i) => data.ignoreSyncInputs!.includes(i));
  return free.length >= wiredInputs.length ? new Set() : new Set(free);
}
