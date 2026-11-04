// Where each pane is docked and in what order, and its persistence.

export type DockSide = 'left' | 'bottom' | 'right';
export type DockItemId = 'palette' | 'playback' | 'controls' | 'clock' | 'rings' | 'timeline' | 'help';

/** `order` is one global list; a dock shows its panes in that relative order. */
export interface DockLayout {
  docks: Record<DockItemId, DockSide>;
  order: DockItemId[];
}

export const DEFAULT_LAYOUT: DockLayout = {
  docks: { palette: 'left', playback: 'left', controls: 'left', clock: 'right', rings: 'right', help: 'right', timeline: 'bottom' },
  order: ['palette', 'playback', 'controls', 'clock', 'rings', 'timeline', 'help'],
};

export const DOCKS_KEY = 'dmf-sync-viz:docks:v2';

const SIDES: DockSide[] = ['left', 'bottom', 'right'];

export function loadLayout(storage: Pick<Storage, 'getItem'>): DockLayout {
  try {
    const raw: unknown = JSON.parse(storage.getItem(DOCKS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULT_LAYOUT;
    const r = raw as { docks?: Record<string, unknown>; order?: unknown };
    const docks = { ...DEFAULT_LAYOUT.docks };
    for (const id of DEFAULT_LAYOUT.order) {
      const side = r.docks?.[id];
      if (SIDES.includes(side as DockSide)) docks[id] = side as DockSide;
    }
    const seen = Array.isArray(r.order) ? r.order.filter((id): id is DockItemId => DEFAULT_LAYOUT.order.includes(id as DockItemId)) : [];
    const order = [...new Set(seen), ...DEFAULT_LAYOUT.order.filter((id) => !seen.includes(id))];
    return { docks, order };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Moves a pane to a dock, placing it before `beforeId` (or last in the dock if null). */
export function movePane(layout: DockLayout, id: DockItemId, side: DockSide, beforeId: DockItemId | null): DockLayout {
  const order = layout.order.filter((x) => x !== id);
  const at = beforeId && beforeId !== id ? order.indexOf(beforeId) : -1;
  if (at >= 0) order.splice(at, 0, id);
  else order.push(id);
  return { docks: { ...layout.docks, [id]: side }, order };
}

export const COLLAPSED_DOCKS_KEY = 'dmf-sync-viz:collapsed-docks:v1';

/** Saved collapsed docks. Collapsing only hides a dock; pane placement and order are untouched. */
export function loadCollapsedDocks(storage: Pick<Storage, 'getItem'>): Set<DockSide> {
  try {
    const raw: unknown = JSON.parse(storage.getItem(COLLAPSED_DOCKS_KEY) ?? 'null');
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((s): s is DockSide => SIDES.includes(s as DockSide)));
  } catch {
    return new Set();
  }
}

export const MINIMIZED_KEY = 'dmf-sync-viz:minimized:v1';

/** Saved minimized pane ids, or `fallback` when nothing valid is stored. */
export function loadMinimized<T extends string>(storage: Pick<Storage, 'getItem'>, valid: readonly T[], fallback: readonly T[]): Set<T> {
  try {
    const raw: unknown = JSON.parse(storage.getItem(MINIMIZED_KEY) ?? 'null');
    if (!Array.isArray(raw)) return new Set(fallback);
    return new Set(raw.filter((id): id is T => valid.includes(id as T)));
  } catch {
    return new Set(fallback);
  }
}
