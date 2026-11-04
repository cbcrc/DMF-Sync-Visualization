import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LEVELS, type Level } from '../../game/levels';
import { SaveIcon } from './ToolbarIcons';
import './ToolbarMenus.css';

/** A toolbar button that opens a dropdown panel; closes on outside click or Escape. */
function MenuButton({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tb-menu nodrag" ref={rootRef}>
      <button
        type="button"
        className={`fc-toolbar__btn${open ? ' fc-toolbar__btn--on' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>
      {open && <div className="tb-menu__panel">{children}</div>}
    </div>
  );
}

export interface ToolbarMenusProps {
  level: Level;
  onSelectLevel: (levelId: string) => void;
  onOpenScenarios: () => void;
  /** Saves the current canvas as a scenario (prompts for a name). */
  onSaveScenario: () => void;
  /** Tag each moving grain on the canvas with its origin timestamp. */
  showOriginTimestamps: boolean;
  onToggleOriginTimestamps: (show: boolean) => void;
}

/** Canvas dropdown for the left of the toolbar. */
export function ToolbarMenus(p: ToolbarMenusProps) {
  return (
    <>
      <MenuButton label="Canvas" title="Start a blank canvas, open or save scenarios">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`tb-menu__item${l.id === p.level.id ? ' tb-menu__item--active' : ''}`}
            onClick={() => p.onSelectLevel(l.id)}
          >
            {l.title}
          </button>
        ))}
        <button type="button" className="tb-menu__item" onClick={p.onOpenScenarios}>
          Saved Scenarios…
        </button>
        <button type="button" className="tb-menu__item" onClick={p.onSaveScenario} title="Save this canvas as a scenario">
          <SaveIcon />Save Canvas as Scenario…
        </button>
        <label
          className="tb-menu__check"
          title="Tag each grain on the canvas with the origin timestamp it keeps from the writer, and flash nodes as they write"
        >
          <input type="checkbox" checked={p.showOriginTimestamps} onChange={(e) => p.onToggleOriginTimestamps(e.target.checked)} />
          Show Grain Origin Tags
        </label>
      </MenuButton>
    </>
  );
}
