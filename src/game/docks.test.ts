import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, movePane } from './docks';

const inDock = (l: typeof DEFAULT_LAYOUT, side: string) => l.order.filter((id) => l.docks[id] === side);

describe('movePane', () => {
  it('reorders within a dock', () => {
    const l = movePane(DEFAULT_LAYOUT, 'controls', 'left', 'palette');
    expect(inDock(l, 'left')).toEqual(['controls', 'palette', 'playback']);
  });

  it('moves to another dock before a given pane, or last when none', () => {
    const before = movePane(DEFAULT_LAYOUT, 'palette', 'right', 'help');
    expect(inDock(before, 'right')).toEqual(['rings', 'palette', 'help']);
    const last = movePane(DEFAULT_LAYOUT, 'palette', 'bottom', null);
    expect(inDock(last, 'bottom')).toEqual(['timeline', 'palette']);
  });
});
