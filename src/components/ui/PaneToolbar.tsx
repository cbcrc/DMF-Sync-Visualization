import './PaneToolbar.css';

export type PaneId = 'palette' | 'playback' | 'controls' | 'clock' | 'rings' | 'timeline' | 'help';

const PANES: { id: PaneId; label: string }[] = [
  { id: 'palette', label: 'Add function' },
  { id: 'playback', label: 'Playback' },
  { id: 'controls', label: 'Status' },
  { id: 'clock', label: 'Clock' },
  { id: 'rings', label: 'Ring buffers' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'help', label: 'Help' },
];

export interface PaneToolbarProps {
  minimized: Set<PaneId>;
  onToggle: (id: PaneId) => void;
  /** Puts every pane back in its default dock and restores minimized ones. */
  onResetLayout: () => void;
}

/** Row of buttons for every pane: minimized panes show as hollow chips, and clicking one restores it. */
export function PaneToolbar({ minimized, onToggle, onResetLayout }: PaneToolbarProps) {
  return (
    <div className="pane-toolbar" role="toolbar" aria-label="Panes">
      {PANES.map(({ id, label }) => {
        const isMinimized = minimized.has(id);
        return (
          <button
            key={id}
            type="button"
            className={`pane-toolbar__btn${isMinimized ? ' pane-toolbar__btn--minimized' : ''}`}
            aria-pressed={!isMinimized}
            title={isMinimized ? `Restore ${label}` : `Minimize ${label}`}
            onClick={() => onToggle(id)}
          >
            {label}
          </button>
        );
      })}
      <button type="button" className="pane-toolbar__btn" title="Reset pane layout" onClick={onResetLayout}>
        Reset layout
      </button>
    </div>
  );
}
