import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LEVELS, type Level } from '../../game/levels';
import { grainDurationMs, minDomainSizeMs, samplesPerAudioBatch, type MediaConfig } from '../../engine/mxlGrainIndex';
import { FRAME_RATES, RESOLUTIONS, SAMPLE_RATES, rateId } from '../../game/mediaConfig';
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
  domainSizeMs: number;
  onDomainSizeChange: (sizeMs: number) => void;
  media: MediaConfig;
  onMediaChange: (media: MediaConfig) => void;
}

/** Canvas and Workload Config dropdowns for the left of the toolbar. */
export function ToolbarMenus(p: ToolbarMenusProps) {
  const { media } = p;
  const grainMs = grainDurationMs(media.videoRate);
  const samples = samplesPerAudioBatch(media);

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
          Saved scenarios…
        </button>
        <button type="button" className="tb-menu__item" onClick={p.onSaveScenario} title="Save this canvas as a scenario">
          💾 Save canvas as scenario…
        </button>
        <label
          className="tb-menu__check"
          title="Tag each grain on the canvas with the origin timestamp it keeps from the writer, and flash nodes as they write"
        >
          <input type="checkbox" checked={p.showOriginTimestamps} onChange={(e) => p.onToggleOriginTimestamps(e.target.checked)} />
          Show grain origin tags
        </label>
      </MenuButton>

      <MenuButton label="Workload Config" title="MXL Domain size and audio/video format">
        <label className="tb-menu__field">
          MXL Domain size: <strong>{p.domainSizeMs}ms</strong>
          <input
            type="range"
            min={minDomainSizeMs(media.videoRate)}
            max={1000}
            step={10}
            value={p.domainSizeMs}
            onChange={(e) => p.onDomainSizeChange(Number(e.target.value))}
          />
        </label>
        <div className="tb-menu__heading">Video</div>
        <label className="tb-menu__field">
          Resolution
          <select value={media.resolution} onChange={(e) => p.onMediaChange({ ...media, resolution: e.target.value })}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace('x', ' × ')}
              </option>
            ))}
          </select>
        </label>
        <label className="tb-menu__field">
          Frame rate (grain rate)
          <select
            value={rateId(media.videoRate)}
            onChange={(e) => {
              const f = FRAME_RATES.find((fr) => fr.id === e.target.value);
              if (!f) return;
              p.onMediaChange({ ...media, videoRate: f.rate });
              p.onDomainSizeChange(Math.max(p.domainSizeMs, minDomainSizeMs(f.rate)));
            }}
          >
            {FRAME_RATES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <div className="tb-menu__note">1 video grain = 1 frame = {grainMs.toFixed(2)}ms</div>
        <div className="tb-menu__heading">Audio</div>
        <label className="tb-menu__field">
          Sample rate
          <select
            value={media.audioSampleRate}
            onChange={(e) => p.onMediaChange({ ...media, audioSampleRate: Number(e.target.value) })}
          >
            {SAMPLE_RATES.map((r) => (
              <option key={r} value={r}>
                {r / 1000} kHz
              </option>
            ))}
          </select>
        </label>
        <div className="tb-menu__note">1ms audio commit batch = {Number.isInteger(samples) ? samples : samples.toFixed(1)} samples</div>
        <button
          type="button"
          className="tb-menu__item"
          onClick={() => p.onMediaChange({ videoRate: { numerator: 50, denominator: 1 }, resolution: '1920x1080', audioSampleRate: 48000 })}
          title="1080p50 with 48 kHz audio"
        >
          Reset to 1080p50 / 48 kHz
        </button>
      </MenuButton>

    </>
  );
}
