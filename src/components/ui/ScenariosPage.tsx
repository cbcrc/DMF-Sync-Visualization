import { useRef, useState } from 'react';
import type { Scenario } from '../../game/scenarios';
import { ringBufferLength } from '../../engine/mxlGrainIndex';
import { buildScenarioFile } from '../../game/scenarioStorage';
import type { SavedScenario } from '../../game/scenarioStorage';
import './ScenariosPage.css';

export interface ScenariosPageProps {
  scenarios: Scenario[];
  activeScenarioId: string;
  /** Loads the scenario onto the canvas and returns to it. */
  onOpen: (id: string) => void;
  /** Saves the current canvas under `title` (same name replaces). Returns false if storage failed. */
  onSave: (title: string, description: string) => boolean;
  onDelete: (id: string) => void;
  /** Imports scenarios from the text of an exported file as new saved scenarios. */
  onImport: (fileText: string) => { ok: boolean; text: string };
  onClose: () => void;
}

const THUMB_W = 220;
const THUMB_H = 110;
const PAD = 10;

/** Tiny node/edge sketch of a scenario's graph, scaled to fit. */
function Thumbnail({ scenario }: { scenario: Scenario }) {
  const { nodes, edges } = scenario;
  if (nodes.length === 0) return <div className="scn-card__thumb scn-card__thumb--empty">empty</div>;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - minX);
  const spanY = Math.max(1, Math.max(...ys) - minY);
  const scale = Math.min((THUMB_W - 2 * PAD) / spanX, (THUMB_H - 2 * PAD) / spanY);
  const pos = new Map(
    nodes.map((n) => [
      n.id,
      { x: PAD + (n.position.x - minX) * scale, y: PAD + (n.position.y - minY) * scale },
    ]),
  );
  const fillFor = (kind: string) =>
    kind === 'input' ? '#4caf50' : kind === 'output' || kind === 'recording' ? '#ffc107' : '#8ab4f8';
  return (
    <svg className="scn-card__thumb" viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} role="img" aria-label={`${nodes.length} functions`}>
      {edges.map((e) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        return a && b ? <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.35)" /> : null;
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        return <circle key={n.id} cx={p.x} cy={p.y} r={4.5} fill={fillFor(n.data.kind)} />;
      })}
    </svg>
  );
}

/**
 * Full-screen scenarios page: every built-in and user-saved scenario as a
 * card, plus a form to save the current canvas. Rendered over the canvas, which
 * stays mounted underneath so nothing on it is lost by opening this page.
 */
export function ScenariosPage({ scenarios, activeScenarioId, onOpen, onSave, onDelete, onImport, onClose }: ScenariosPageProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const existing = scenarios.find((s) => !s.builtIn && s.title.toLowerCase() === title.trim().toLowerCase());

  const handleSave = () => {
    const ok = onSave(title, description);
    setMessage(
      ok
        ? { ok, text: existing ? `Updated “${existing.title}”.` : 'Saved.' }
        : { ok, text: 'Could not save: browser storage is full or unavailable.' },
    );
    if (ok) {
      setTitle('');
      setDescription('');
    }
  };

  const download = (list: Scenario[], filename: string) => {
    const file = buildScenarioFile(list as SavedScenario[]);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const fileName = (title: string) => `${title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'scenario'}.dmfsync.json`;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(onImport(await file.text()));
    if (fileInput.current) fileInput.current.value = '';
  };

  const builtIn = scenarios.filter((s) => s.builtIn);
  const saved = scenarios.filter((s) => !s.builtIn);

  const renderCard = (s: Scenario) => (
    <li key={s.id} className={`scn-card${s.id === activeScenarioId ? ' scn-card--active' : ''}`}>
      <Thumbnail scenario={s} />
      <div className="scn-card__body">
        <h3 className="scn-card__title">{s.title}</h3>
        <p className="scn-card__desc">{s.description || 'No description.'}</p>
        <div className="scn-card__meta">
          {s.nodes.length} functions · {s.domainSizeMs}ms domain · {ringBufferLength(s.domainSizeMs)} slots
          {s.id === activeScenarioId && ' · on canvas'}
        </div>
        <div className="scn-card__actions">
          <button type="button" className="scn-btn scn-btn--primary" onClick={() => onOpen(s.id)}>
            Open
          </button>
          {!s.builtIn && (
            <button type="button" className="scn-btn" onClick={() => download([s], fileName(s.title))}>
              Export
            </button>
          )}
          {!s.builtIn && (
            <button
              type="button"
              className="scn-btn"
              onClick={() => {
                if (window.confirm(`Delete “${s.title}”?`)) onDelete(s.id);
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <div className="scn-page" role="dialog" aria-label="Scenarios">
      <div className="scn-page__inner">
        <header className="scn-page__header">
          <h2>Scenarios</h2>
          <button type="button" className="scn-btn" onClick={onClose}>
            ← Back to Canvas
          </button>
        </header>

        <section className="scn-save" aria-label="Save current canvas">
          <h3>Save the current canvas</h3>
          <div className="scn-save__fields">
            <input
              className="scn-input"
              placeholder="Scenario name"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="scn-input scn-input--wide"
              placeholder="Description (optional)"
              value={description}
              maxLength={400}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button type="button" className="scn-btn scn-btn--primary" onClick={handleSave} disabled={!title.trim()}>
              {existing ? 'Replace Saved Scenario' : 'Save Scenario'}
            </button>
          </div>
          <p className="scn-save__hint">
            Saves the functions, connections, latencies and domain size in this browser. Using the name of an existing
            saved scenario replaces it.
          </p>
          {message && <p className={message.ok ? 'scn-msg' : 'scn-msg scn-msg--bad'}>{message.text}</p>}
        </section>

        <section className="scn-save" aria-label="Share scenarios">
          <h3>Share</h3>
          <div className="scn-save__fields">
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <button type="button" className="scn-btn" onClick={() => fileInput.current?.click()}>
              Import From File…
            </button>
            <button
              type="button"
              className="scn-btn"
              disabled={saved.length === 0}
              onClick={() => download(saved, 'dmf-sync-scenarios.dmfsync.json')}
            >
              Export All Saved
            </button>
          </div>
          <p className="scn-save__hint">
            Exports are JSON files you can send to others. Imported scenarios are added alongside yours; a name that
            already exists gets a number added instead of overwriting.
          </p>
        </section>

        <h3 className="scn-section">Saved by you</h3>
        {saved.length === 0 ? (
          <p className="scn-empty">Nothing saved yet.</p>
        ) : (
          <ul className="scn-grid">{saved.map(renderCard)}</ul>
        )}

        <h3 className="scn-section">Built-in</h3>
        <ul className="scn-grid">{builtIn.map(renderCard)}</ul>
      </div>
    </div>
  );
}
