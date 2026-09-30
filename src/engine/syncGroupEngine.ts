// Sync Group evaluation logic.
// See Initial_prompt.md §2.D: signals in the same SyncGroup must be aligned to
// the highest-latency member by padding the faster members with extra delay.

import type { Signal, SyncGroup } from '../types';

export interface SyncGroupPadding {
  signalId: string;
  /** Extra delay (ms) that must be added to this signal to match the group's max latency. */
  paddingMs: number;
}

/**
 * For a single SyncGroup, compute the padding required for each member signal
 * so that all members reach alignment at the group's highest accumulated latency.
 * Signals not found among `signals` are ignored.
 */
export function evaluateSyncGroup(group: SyncGroup, signals: Signal[]): SyncGroupPadding[] {
  const members = signals.filter((s) => group.memberSignalIds.includes(s.id));
  if (members.length === 0) return [];

  const maxLatencyMs = Math.max(...members.map((s) => s.latencyMs));

  return members.map((s) => ({
    signalId: s.id,
    paddingMs: maxLatencyMs - s.latencyMs,
  }));
}

/**
 * Evaluate padding for every SyncGroup in the domain, returning a flat map of
 * signalId -> required padding (ms). Signals not in any sync group are absent.
 */
export function evaluateAllSyncGroups(
  groups: SyncGroup[],
  signals: Signal[],
): Map<string, number> {
  const paddingBySignalId = new Map<string, number>();
  for (const group of groups) {
    for (const { signalId, paddingMs } of evaluateSyncGroup(group, signals)) {
      paddingBySignalId.set(signalId, paddingMs);
    }
  }
  return paddingBySignalId;
}

/**
 * Apply computed sync-group padding to a signal's latency, returning a new
 * Signal (does not mutate the input). Use after evaluateAllSyncGroups.
 */
export function applySyncGroupPadding(signal: Signal, paddingMs: number): Signal {
  if (paddingMs === 0) return signal;
  return { ...signal, latencyMs: signal.latencyMs + paddingMs };
}
