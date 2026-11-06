import { describe, expect, it } from 'vitest';
import { createsCycle, requiredTrack, withoutCycles } from './connectionRules';

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

describe('createsCycle / withoutCycles', () => {
  const chain = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];

  it('rejects a link that closes a loop, including a self-link', () => {
    expect(createsCycle(chain, 'c', 'a')).toBe(true);
    expect(createsCycle(chain, 'b', 'a')).toBe(true);
    expect(createsCycle(chain, 'a', 'a')).toBe(true);
  });

  it('allows forward links and fan-out', () => {
    expect(createsCycle(chain, 'a', 'c')).toBe(false);
    expect(createsCycle(chain, 'd', 'a')).toBe(false);
  });

  it('drops only the links that close a loop, keeping order', () => {
    const links = [...chain, { source: 'c', target: 'a' }, { source: 'a', target: 'd' }];
    expect(withoutCycles(links)).toEqual([...chain, { source: 'a', target: 'd' }]);
  });
});
