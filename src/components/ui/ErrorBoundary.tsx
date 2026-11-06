import { Component, type ErrorInfo, type ReactNode } from 'react';
import { safeStorage } from '../../safeStorage';
import { WORKING_GRAPH_KEY } from '../../game/scenarioStorage';

interface State {
  error: Error | null;
}

/**
 * Last line of defence: without it, any render error unmounts the whole app and
 * leaves a blank page. If the autosaved canvas is what crashes, a plain reload
 * would crash again, so the fallback also offers to discard it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('DMF Sync Visualizer crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const resetCanvas = () => {
      safeStorage.removeItem(WORKING_GRAPH_KEY);
      window.location.reload();
    };
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          padding: 32,
          boxSizing: 'border-box',
          background: 'var(--ui-bg)',
          color: 'var(--ui-text)',
          fontFamily: 'inherit',
        }}
      >
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h1>
        <p style={{ color: 'var(--ui-text-dim)', margin: '0 0 16px', maxWidth: 560 }}>
          The visualizer hit an error and stopped. Reloading usually fixes it. If it keeps happening, reset the
          canvas: this discards the autosaved working graph, but keeps your saved scenarios and layout.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" onClick={resetCanvas}>Reset canvas and reload</button>
        </div>
        <pre style={{ marginTop: 24, color: 'var(--ui-text-faint)', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {error.message}
        </pre>
      </div>
    );
  }
}
