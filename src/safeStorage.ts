// localStorage that never throws. Access can fail when site data is blocked
// (SecurityError) or the quota is full (QuotaExceededError); either would
// otherwise unmount the whole app. On failure, values live in memory for the
// rest of the session.

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface SafeStorage extends Pick<Storage, 'getItem' | 'removeItem'> {
  /** False when the value only reached the in-memory fallback (blocked or full storage). */
  setItem(key: string, value: string): boolean;
}

export const safeStorage: SafeStorage = {
  getItem(key) {
    try {
      return storage()?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key, value) {
    memory.set(key, value);
    try {
      const s = storage();
      if (!s) return false;
      s.setItem(key, value);
      return true;
    } catch {
      return false; // Blocked or full: the in-memory copy keeps this session working.
    }
  },
  removeItem(key) {
    memory.delete(key);
    try {
      storage()?.removeItem(key);
    } catch {
      // Nothing more to do.
    }
  },
};
