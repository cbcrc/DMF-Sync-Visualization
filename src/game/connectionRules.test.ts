import { describe, expect, it } from 'vitest';
import { requiredTrack } from './connectionRules';

describe('requiredTrack', () => {
  it('limits audio-only functions to audio', () => {
    expect(requiredTrack({ kind: 'technical', inputCount: 1, audioOnly: true }, 0, [])).toBe('audio');
  });

  it('limits video-only functions to video', () => {
    expect(requiredTrack({ kind: 'editorial', inputCount: 3, videoOnly: true }, 2, ['audio'])).toBe('video');
  });

  it('gives an A+V output a video input and an audio input', () => {
    const out = { kind: 'output', inputCount: 2 };
    expect(requiredTrack(out, 0, [])).toBe('video');
    expect(requiredTrack(out, 1, [])).toBe('audio');
    expect(requiredTrack({ kind: 'output', inputCount: 1 }, 0, [])).toBe('video');
  });

  it('keeps a mixer on one track once something is connected', () => {
    const mixer = { kind: 'editorial', inputCount: 2 };
    expect(requiredTrack(mixer, 1, [])).toBeUndefined();
    expect(requiredTrack(mixer, 1, ['audio'])).toBe('audio');
  });
});
