import { describe, expect, it } from 'vitest';
import { createStabilityState, FAIL_RED_DURATION_MS, tickStability } from './stabilityMonitor';

describe('tickStability', () => {
  it('returns the same object when nothing changed, so React can skip the render', () => {
    const idle = createStabilityState();
    expect(tickStability(idle, new Map([['a', 'OK']]), 50)).toBe(idle);
    const red = tickStability(idle, new Map([['a', 'TOO_LATE']]), 50);
    expect(red).not.toBe(idle);
    // A frozen clock (dt = 0) leaves the red timer where it was.
    expect(tickStability(red, new Map([['a', 'TOO_LATE']]), 0)).toBe(red);
  });

  it('still advances, clears and fails as before', () => {
    let s = tickStability(createStabilityState(), new Map([['a', 'TOO_LATE']]), 1000);
    expect(s.redDurationByNodeId.get('a')).toBe(1000);
    expect(tickStability(s, new Map([['a', 'OK']]), 50).redDurationByNodeId.size).toBe(0);
    s = tickStability(s, new Map([['a', 'TOO_LATE']]), FAIL_RED_DURATION_MS);
    expect(s.failed).toBe(true);
    expect(s.failedNodeId).toBe('a');
  });
});
