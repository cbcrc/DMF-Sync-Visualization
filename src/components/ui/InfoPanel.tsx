import './InfoPanel.css';

/**
 * Collapsible explainer for the MXL timing model this simulator implements.
 * Kept deliberately short — one line per concept — so it's a quick reference,
 * not a document. Starts open so new users see it immediately.
 */
export function InfoPanel({ onMinimize }: { onMinimize: () => void }) {
  return (
    <div className="info-panel">
      <div className="info-panel__header">
        <span className="info-panel__title">How MXL timestamps drive this</span>
        <button type="button" className="info-panel__close" onClick={onMinimize} aria-label="Minimize" title="Minimize">
          –
        </button>
      </div>

      <div className="info-panel__text info-panel__intro">
        A grain's index (<code>timestamp ÷ duration</code>) never changes as it moves through the
        graph. Functions write at the <em>same</em> index; processing only delays when the head
        is published. A Profanity Delay is the exception: it re-writes media as a new source.
      </div>

      <div className="info-panel__row">
        <span className="info-panel__dot info-panel__dot--green" />
        <div>
          <div className="info-panel__label">OK</div>
          <div className="info-panel__text">The requested grain is still in the ring.</div>
        </div>
      </div>

      <div className="info-panel__row">
        <span className="info-panel__dot info-panel__dot--yellow" />
        <div>
          <div className="info-panel__label">Too early</div>
          <div className="info-panel__text">The grain is newer than the head, so the reader waits. Nothing is lost.</div>
        </div>
      </div>

      <div className="info-panel__row">
        <span className="info-panel__dot info-panel__dot--red" />
        <div>
          <div className="info-panel__label">Too late ✕</div>
          <div className="info-panel__text">
            Inputs in one sync group read the same index, set by the slowest. A faster input's grain
            can be overwritten first. Shorten the slow path, grow the Domain, or add a Grain Repeater.
          </div>
        </div>
      </div>

      <div className="info-panel__text info-panel__footnote">
        <strong>Rings</strong> mark the Write head and each reader (<strong>R1</strong>, <strong>R2</strong>…,
        also tagged on the reader's inputs). Click one to focus it. <strong>Sync A / B</strong> on a mixer input
        groups inputs that wait for each other; <strong>live</strong> reads at the head and never waits.
        A dashed ring is a grain paused for its group. Use <strong>Show Now</strong> to see wall-clock lag.
      </div>
    </div>
  );
}
