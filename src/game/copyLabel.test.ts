import { describe, expect, it } from 'vitest';
import { nextCopyLabel } from './copyLabel';

describe('nextCopyLabel', () => {
  it('starts at 2 when the source has no number', () => {
    expect(nextCopyLabel('Colour Corrector', ['Colour Corrector'])).toBe('Colour Corrector 2');
  });

  it('takes the next available number after the highest in use', () => {
    expect(nextCopyLabel('Colour Corrector 1', ['Colour Corrector 1', 'Colour Corrector 3', 'Output 9'])).toBe('Colour Corrector 4');
    expect(nextCopyLabel('Colour Corrector 2', ['Colour Corrector', 'Colour Corrector 2'])).toBe('Colour Corrector 3');
  });
});
