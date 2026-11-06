import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './safeStorage';

afterEach(() => vi.unstubAllGlobals());

describe('safeStorage', () => {
  it('falls back to memory when storage is blocked', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(safeStorage.setItem('k', 'v')).toBe(false);
    expect(safeStorage.getItem('k')).toBe('v');
    safeStorage.removeItem('k');
    expect(safeStorage.getItem('k')).toBeNull();
  });

  it('reports a failed write when storage is full', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    vi.stubGlobal('window', { localStorage: full });
    expect(safeStorage.setItem('k2', 'v')).toBe(false);
  });

  it('reports a successful write', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: () => {} },
    });
    expect(safeStorage.setItem('k3', 'v')).toBe(true);
    expect(data.get('k3')).toBe('v');
  });
});
