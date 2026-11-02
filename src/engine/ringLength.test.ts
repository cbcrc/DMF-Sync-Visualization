import { describe, expect, it } from 'vitest';
import { minDomainSizeMs, ringBufferLength } from './mxlGrainIndex';
import { retainedGrainsFor } from './ringBufferEngine';

describe('ring buffer sizing', () => {
  it('truncates like MXL: 100ms at 59.94 fps is 5 grains, at 50 fps is 5', () => {
    expect(ringBufferLength(100, { numerator: 60000, denominator: 1001 })).toBe(5);
    expect(ringBufferLength(100, { numerator: 50, denominator: 1 })).toBe(5);
  });

  it('gives the slowest frame rate at least 3 grains at its minimum domain size', () => {
    const rate = { numerator: 24000, denominator: 1001 };
    expect(ringBufferLength(minDomainSizeMs(rate), rate)).toBeGreaterThanOrEqual(3);
  });

  it('always reserves at least MXL\'s two slots', () => {
    expect(retainedGrainsFor(10, 1000 / 24)).toBe(8);
  });
});
