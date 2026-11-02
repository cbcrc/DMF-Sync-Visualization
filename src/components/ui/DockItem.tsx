import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { DockItemId, DockSide } from '../../game/docks';
import './Dock.css';

const SIDES: { side: DockSide; glyph: string; label: string }[] = [
  { side: 'left', glyph: '◧', label: 'Dock left' },
  { side: 'bottom', glyph: '⬓', label: 'Dock bottom' },
  { side: 'right', glyph: '◨', label: 'Dock right' },
];

export interface DockItemProps {
  id: DockItemId;
  side: DockSide;
  /** The pane after this one in its dock, so "drop on the lower half" can insert after. */
  nextId: DockItemId | null;
  /** Pane currently being dragged anywhere in the app, if any. */
  dragId: DockItemId | null;
  onDragId: (id: DockItemId | null) => void;
  /** Drop `from` into this dock just before `before` (null = last). */
  onDropBefore: (from: DockItemId, before: DockItemId | null) => void;
  onDock: (side: DockSide) => void;
  /** Lets a pane that renders itself elsewhere (a portal) attach to this item's body. */
  bodyRef?: (el: HTMLDivElement | null) => void;
  /** Panes that should stretch to fill spare room in the bottom dock. */
  grow?: boolean;
  children?: ReactNode;
}

/** Wraps a pane in a dock: drag the grip to reorder or move it to another dock, or use the side buttons. */
export function DockItem({ id, side, nextId, dragId, onDragId, onDropBefore, onDock, bodyRef, grow, children }: DockItemProps) {
  const [over, setOver] = useState<'before' | 'after' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const placement = (e: DragEvent<HTMLElement>) => {
    const r = rootRef.current!.getBoundingClientRect();
    const horizontal = side === 'bottom';
    const frac = horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    return frac < 0.5 ? 'before' : 'after';
  };

  const cls = ['dock-item', grow ? 'dock-item--grow' : '', dragId === id ? 'dock-item--dragging' : '', over && dragId ? `dock-item--drop-${over}-${side === 'bottom' ? 'h' : 'v'}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={cls}
      onDragOver={(e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(placement(e));
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        e.stopPropagation();
        onDropBefore(dragId, placement(e) === 'before' ? id : nextId);
        setOver(null);
        onDragId(null);
      }}
    >
      <div className="dock-item__bar">
        <span
          className="dock-item__grip"
          draggable
          title="Drag to reorder or move to another dock"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            if (rootRef.current) e.dataTransfer.setDragImage(rootRef.current, 10, 10);
            onDragId(id);
          }}
          onDragEnd={() => onDragId(null)}
        >
          ⋮⋮ drag
        </span>
        <div className="dock-item__btns" role="group" aria-label="Dock position">
          {SIDES.map((s) => (
            <button
              key={s.side}
              type="button"
              className={`dock-item__btn${s.side === side ? ' dock-item__btn--active' : ''}`}
              title={s.label}
              aria-label={s.label}
              aria-pressed={s.side === side}
              onClick={() => onDock(s.side)}
            >
              {s.glyph}
            </button>
          ))}
        </div>
      </div>
      <div className="dock-item__body" ref={bodyRef}>
        {children}
      </div>
    </div>
  );
}
