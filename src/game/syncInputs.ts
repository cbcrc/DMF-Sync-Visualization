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

/** Group number meaning "live": read at the write head, in no sync group. */
export const LIVE_GROUP = 0;

/** Most groups one function can use (MXL has no limit; this keeps the node UI small). */
export const MAX_SYNC_GROUPS = 2;

export const groupLabel = (group: number) => (group === LIVE_GROUP ? 'live' : String.fromCharCode(64 + group));

/**
 * Sync group of each wired input (`LIVE_GROUP` = none). Like an MXL
 * flow synchronization group, a group is a set of this function's readers that
 * wait on one another: each group is read at its own slowest member. Inputs
 * default to group 1. If every wired input is live there is nothing to be live
 * against, so they all fall back to group 1.
 */
export function inputGroupsFor(
  data: { kind: string; inputCount: number; inputGroups?: number[] },
  wiredInputs: number[],
): Map<number, number> {
  const groups = new Map<number, number>();
  const choice = hasSyncChoice(data);
  for (const i of wiredInputs) groups.set(i, choice ? (data.inputGroups?.[i] ?? 1) : 1);
  if (wiredInputs.every((i) => groups.get(i) === LIVE_GROUP)) for (const i of wiredInputs) groups.set(i, 1);
  return groups;
}

/** The wired inputs read at the write head, outside every sync group. */
export function freeRunningInputs(
  data: { kind: string; inputCount: number; inputGroups?: number[] },
  wiredInputs: number[],
): Set<number> {
  const free = new Set<number>();
  for (const [i, g] of inputGroupsFor(data, wiredInputs)) if (g === LIVE_GROUP) free.add(i);
  return free;
}
