import { LEVELS, type Level } from '../../game/levels';
import type { InputReading } from '../../game/graphLatency';
import type { StabilityState } from '../../game/stabilityMonitor';
import { FAIL_RED_DURATION_MS } from '../../game/stabilityMonitor';
import './GameHud.css';

export interface GameHudProps {
  level: Level;
  onSelectLevel: (levelId: string) => void;
  domainSizeMs: number;
  onDomainSizeChange: (sizeMs: number) => void;
  totalWorkloadLatencyMs: number;
  stabilityMarginMs: number;
  stability: StabilityState;
  onReset: () => void;
  onRestartWave?: () => void;
  /** Every reader input currently reading a grain that has been overwritten. */
  lateInputs: InputReading[];
  nodeLabelById: Map<string, string>;
}

/**
 * Task 4 HUD: level challenge picker + MXL Domain size control, plus the
 * spec's §3 telemetry readouts (Total Workload Latency, Stability Margin)
 * and the §4.3 fail condition (any node Red for > 3s).
 */
export function GameHud({
  level,
  onSelectLevel,
  domainSizeMs,
  onDomainSizeChange,
  totalWorkloadLatencyMs,
  stabilityMarginMs,
  stability,
  onReset,
  onRestartWave,
  lateInputs,
  nodeLabelById,
}: GameHudProps) {
  const marginClass = stabilityMarginMs < 0 ? 'game-hud__stat-value--bad' : '';

  return (
    <div className="game-hud">
      <div className="game-hud__levels">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`game-hud__level-btn${l.id === level.id ? ' game-hud__level-btn--active' : ''}`}
            onClick={() => onSelectLevel(l.id)}
          >
            {l.title}
          </button>
        ))}
      </div>
      <div className="game-hud__desc">{level.description}</div>
      {level.guidance && <div className="game-hud__guidance">{level.guidance}</div>}

      <label className="game-hud__slider">
        MXL Domain Size: <strong>{domainSizeMs}ms</strong>
        <input
          type="range"
          min={10}
          max={1000}
          step={10}
          value={domainSizeMs}
          onChange={(e) => onDomainSizeChange(Number(e.target.value))}
        />
      </label>

      <div className="game-hud__stats">
        <div className="game-hud__stat">
          <span className="game-hud__stat-label">Total Workload Latency</span>
          <span className="game-hud__stat-value">{Math.round(totalWorkloadLatencyMs)}ms</span>
        </div>
        <div className="game-hud__stat">
          <span className="game-hud__stat-label">Stability Margin</span>
          <span className={`game-hud__stat-value ${marginClass}`}>{Math.round(stabilityMarginMs)}ms</span>
        </div>
        {onRestartWave && (
          <button
            type="button"
            className="game-hud__restart-btn"
            onClick={onRestartWave}
            title="Restart the current grain wave"
          >
            Restart Wave
          </button>
        )}
      </div>

      {lateInputs.length > 0 && (
        <div className="game-hud__late">
          <div className="game-hud__late-title">Read too late</div>
          {lateInputs.map((reading) => (
            <div key={reading.buffer.id} className="game-hud__late-row">
              <strong>{nodeLabelById.get(reading.readerNodeId) ?? reading.readerNodeId}</strong> needs grain #
              {reading.buffer.requestedGrainIndex} from{' '}
              <strong>{nodeLabelById.get(reading.sourceNodeId) ?? reading.sourceNodeId}</strong>, but that flow's
              head is already at #{reading.buffer.publishedGrainIndex} —{' '}
              {Math.round(reading.evaluation.stalenessMs)}ms behind, and only{' '}
              {Math.round(reading.buffer.retainedMs)}ms is retained.
            </div>
          ))}
          <div className="game-hud__late-hint">
            That branch is waiting on a slower one. Shorten the slow path, grow the MXL Domain, or add a Grain
            Repeater to the fast branch.
          </div>
        </div>
      )}

      {stability.failed && (
        <div className="game-hud__fail">
          <div>
            READ TOO LATE! Node stayed in Red for &gt; {FAIL_RED_DURATION_MS / 1000}s. Insert a Grain Repeater or
            reduce latency.
          </div>
          <button type="button" onClick={onReset}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
