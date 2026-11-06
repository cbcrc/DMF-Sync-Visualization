import { grainDurationMs, minDomainSizeMs, samplesPerAudioBatch, type MediaConfig } from '../../engine/mxlGrainIndex';
import { FRAME_RATES, RESOLUTIONS, SAMPLE_RATES, rateId } from '../../game/mediaConfig';
import './WorkloadPane.css';

export interface WorkloadPaneProps {
  onMinimize: () => void;
  domainSizeMs: number;
  onDomainSizeChange: (sizeMs: number) => void;
  media: MediaConfig;
  onMediaChange: (media: MediaConfig) => void;
}

/** MXL Domain size and the A/V format of the workload. */
export function WorkloadPane({ onMinimize, domainSizeMs, onDomainSizeChange, media, onMediaChange }: WorkloadPaneProps) {
  const grainMs = grainDurationMs(media.videoRate);
  const samples = samplesPerAudioBatch(media);

  return (
    <div className="wl-pane">
      <div className="wl-pane__header">
        <button type="button" className="wl-pane__min" onClick={onMinimize} aria-label="Minimize workload config" title="Minimize">
          –
        </button>
      </div>
      <label className="wl-pane__field">
        MXL Domain Size: <strong>{domainSizeMs}ms</strong>
        <input
          type="range"
          min={minDomainSizeMs(media.videoRate)}
          max={1000}
          step={10}
          value={domainSizeMs}
          onChange={(e) => onDomainSizeChange(Number(e.target.value))}
        />
      </label>
      <div className="wl-pane__heading">Video</div>
      <label className="wl-pane__field">
        Resolution
        <select value={media.resolution} onChange={(e) => onMediaChange({ ...media, resolution: e.target.value })}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r.replace('x', ' × ')}
            </option>
          ))}
        </select>
      </label>
      <label className="wl-pane__field">
        Frame Rate (Grain Rate)
        <select
          value={rateId(media.videoRate)}
          onChange={(e) => {
            const f = FRAME_RATES.find((fr) => fr.id === e.target.value);
            if (!f) return;
            onMediaChange({ ...media, videoRate: f.rate });
            onDomainSizeChange(Math.max(domainSizeMs, minDomainSizeMs(f.rate)));
          }}
        >
          {FRAME_RATES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="wl-pane__note">1 video grain = 1 frame = {grainMs.toFixed(2)}ms</div>
      <div className="wl-pane__heading">Audio</div>
      <label className="wl-pane__field">
        Sample Rate
        <select value={media.audioSampleRate} onChange={(e) => onMediaChange({ ...media, audioSampleRate: Number(e.target.value) })}>
          {SAMPLE_RATES.map((r) => (
            <option key={r} value={r}>
              {r / 1000} kHz
            </option>
          ))}
        </select>
      </label>
      <div className="wl-pane__note">10 ms audio commit batch (MXL default) = {Number.isInteger(samples) ? samples : samples.toFixed(1)} samples</div>
      <button
        type="button"
        className="wl-pane__reset"
        onClick={() => onMediaChange({ videoRate: { numerator: 50, denominator: 1 }, resolution: '1920x1080', audioSampleRate: 48000 })}
        title="1080p50 with 48 kHz audio"
      >
        Reset to 1080p50 / 48 kHz
      </button>
    </div>
  );
}
