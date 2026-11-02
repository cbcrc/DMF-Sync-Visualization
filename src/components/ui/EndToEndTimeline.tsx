import { useMemo } from 'react';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../canvas/MediaFunctionNode';
import type { GraphBufferState } from '../../game/graphLatency';
import { buildEndToEndTimeline } from '../../game/endToEndTimeline';
import './EndToEndTimeline.css';

interface Props {
  graph: GraphBufferState;
  nodes: Node<MediaFunctionNodeData>[];
  edges: Edge[];
  focusedNodeId: string | null;
  onFocusNode: (id: string | null) => void;
  onMinimize: () => void;
}

const fmt = (ms: number) => `${Math.round(ms)}ms`;

/** A round tick step that gives roughly 4-8 ticks across the axis. */
function tickStep(maxMs: number): number {
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((s) => maxMs / s <= 8) ?? 10000;
}

/**
 * Linear end-to-end timeline: one lane per output, running from the source
 * input (left, 0ms) to the output. Each media function is a block whose width
 * is the latency it adds; the caret at its left edge is where it reads from
 * (how far behind "now" in its input ring). The operator can minimize it.
 */
export function EndToEndTimeline({ graph, nodes, edges, focusedNodeId, onFocusNode, onMinimize }: Props) {
  const rows = useMemo(() => buildEndToEndTimeline(graph, nodes, edges), [graph, nodes, edges]);

  const axisMs = Math.max(100, ...rows.map((r) => r.totalMs));
  const step = tickStep(axisMs);
  const ticks = Array.from({ length: Math.floor(axisMs / step) + 1 }, (_, i) => i * step);
  const pct = (ms: number) => `${(ms / axisMs) * 100}%`;

  return (
    <div className="e2e">
      <div className="e2e__header">
        <div className="e2e__title">End-to-end timeline · input → output</div>
        <button type="button" className="e2e__close" onClick={onMinimize} aria-label="Minimize timeline" title="Minimize">
          –
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="e2e__empty">Connect an input through to an output to see its end-to-end time.</div>
      ) : (
        <div className="e2e__body">
          {rows.map((row) => (
            <div className="e2e__row" key={row.outputId}>
              <div className="e2e__row-label" title={row.outputLabel}>
                {row.outputLabel}
                <span className="e2e__total">{fmt(row.totalMs)}</span>
              </div>
              <div className="e2e__lane">
                {row.steps.map((s) => (
                  <div key={s.nodeId}>
                    {s.syncWaitMs > 0 && (
                      <div
                        className="e2e__wait"
                        style={{ left: pct(s.startMs - s.syncWaitMs), width: pct(s.syncWaitMs) }}
                        title={`${s.label} waits ${fmt(s.syncWaitMs)} for sync`}
                      />
                    )}
                    <button
                      type="button"
                      className={`e2e__step e2e__step--${s.kind}${s.nodeId === focusedNodeId ? ' is-focused' : ''}${s.latencyMs === 0 ? ' is-instant' : ''}`}
                      style={{ left: pct(s.startMs), width: s.latencyMs === 0 ? undefined : pct(s.latencyMs) }}
                      title={`${s.label}: reads ${fmt(s.readAtMs)} behind now, adds ${fmt(s.latencyMs)} (${fmt(s.startMs)} → ${fmt(s.endMs)})`}
                      onClick={() => onFocusNode(s.nodeId === focusedNodeId ? null : s.nodeId)}
                    >
                      <span className="e2e__step-name">{s.label}</span>
                      {s.latencyMs > 0 && <span className="e2e__step-ms">+{fmt(s.latencyMs)}</span>}
                    </button>
                  </div>
                ))}
              </div>
              <div className="e2e__reads">
                {row.steps.map((s) => (
                  <span key={s.nodeId} className="e2e__read">
                    <b>{s.label}</b> reads −{fmt(s.readAtMs)}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="e2e__axis">
            {ticks.map((t) => (
              <span key={t} className="e2e__tick" style={{ left: pct(t) }}>
                {t}
              </span>
            ))}
            <span className="e2e__axis-unit">ms since MXL write at input</span>
          </div>
        </div>
      )}
      <div className="e2e__note">
        OTS not applied yet: 0 ms is the moment the input writes into MXL. A future iteration may anchor this at the Origin
        Time Stamp (OTS) carried on the linear side, adding the capture-to-MXL lead-in.
      </div>
    </div>
  );
}
