import type { PlaybackMode } from '../../game/useSimClock';
import './PlaybackPane.css';

export interface PlaybackPaneProps {
  onMinimize: () => void;
  playbackMode: PlaybackMode;
  onSetPlaybackMode: (mode: PlaybackMode) => void;
  onStep: () => void;
  onStepBack: () => void;
  /** false = simplified count from 100, true = real MXL index. */
  showRealGrainIndex: boolean;
  onToggleRealGrainIndex: (show: boolean) => void;
}

const MODE_LABELS: Record<PlaybackMode, string> = { normal: 'Normal', stepping: 'Stepping', manual: 'Manual' };

/** Animation playback controls: mode, manual stepping, and grain display options. */
export function PlaybackPane(p: PlaybackPaneProps) {
  return (
    <div className="pb-pane">
      <div className="pb-pane__header">
        <span className="pb-pane__title">Animation playback</span>
        <button type="button" className="pb-pane__min" onClick={p.onMinimize} aria-label="Minimize playback" title="Minimize">
          –
        </button>
      </div>
      <div className="pb-pane__row">
        {(['normal', 'stepping', 'manual'] as PlaybackMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`pb-pane__chip${m === p.playbackMode ? ' pb-pane__chip--active' : ''}`}
            onClick={() => p.onSetPlaybackMode(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {p.playbackMode === 'manual' && (
        <div className="pb-pane__row">
          <button type="button" className="pb-pane__chip pb-pane__chip--wide" onClick={p.onStepBack} title="Go back one step">
            ◀ Back
          </button>
          <button type="button" className="pb-pane__chip pb-pane__chip--wide" onClick={p.onStep} title="Advance one grain">
            Step ▶
          </button>
        </div>
      )}
      <div className="pb-pane__row">
        <span className="pb-pane__label">Grain index:</span>
        {[false, true].map((real) => (
          <button
            key={String(real)}
            type="button"
            className={`pb-pane__chip${real === p.showRealGrainIndex ? ' pb-pane__chip--active' : ''}`}
            onClick={() => p.onToggleRealGrainIndex(real)}
            title={real ? 'The true MXL grain index (TAI time ÷ grain duration); last digits shown' : 'A simple count starting at 100'}
          >
            {real ? 'TAI Time' : 'Simplified'}
          </button>
        ))}
      </div>
    </div>
  );
}
