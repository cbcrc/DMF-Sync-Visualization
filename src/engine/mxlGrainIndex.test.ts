import { describe, expect, it } from 'vitest';
import { TAI_EPOCH_OFFSET_MS, formatGrouped, grainIndexLabel, DEFAULT_GRAIN_RATE, timestampToGrainIndex, timestampToTaiNs, timestampToTimecode } from './mxlGrainIndex';

describe('TAI clock helpers', () => {
  it('keeps the epoch offset on whole video-tick and ring boundaries', () => {
    expect(TAI_EPOCH_OFFSET_MS % 480).toBe(0);
    expect(timestampToGrainIndex(TAI_EPOCH_OFFSET_MS) % 8).toBe(0);
  });

  it('converts to ns without losing precision beyond 2^53', () => {
    expect(timestampToTaiNs(TAI_EPOCH_OFFSET_MS)).toBe(1_792_848_000_000_000_000n);
  });

  it('labels grain indices as a count from 100, or the last digits of the real index', () => {
    const start = timestampToGrainIndex(TAI_EPOCH_OFFSET_MS);
    expect(grainIndexLabel(start, DEFAULT_GRAIN_RATE, false)).toBe('100');
    expect(grainIndexLabel(start + 7, DEFAULT_GRAIN_RATE, false)).toBe('107');
    expect(grainIndexLabel(89_642_401_234, DEFAULT_GRAIN_RATE, true)).toBe('1234');
    expect(grainIndexLabel(89_642_401_234, DEFAULT_GRAIN_RATE, true, 3)).toBe('234');
  });

  it('groups digits and formats a 50 fps time of day', () => {
    expect(formatGrouped(1792848000n)).toBe("1'792'848'000");
    expect(timestampToTimecode(3_723_460)).toBe('01:02:03:23');
  });
});
