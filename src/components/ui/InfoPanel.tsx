import { useState } from 'react';
import './InfoPanel.css';

/**
 * Collapsible explainer for the MXL timing model this simulator implements.
 * Kept deliberately short — one line per concept — so it's a quick reference,
 * not a document. Starts open so new users see it immediately.
 */
export function InfoPanel() {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button type="button" className="info-panel-toggle" onClick={() => setOpen(true)} aria-label="Show ring buffer help">
        ?
      </button>
    );
  }

  return (
    <div className="info-panel">
      <div className="info-panel__header">
        <span className="info-panel__title">How MXL timestamps drive this</span>
        <button type="button" className="info-panel__close" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </div>

      <div className="info-panel__text info-panel__intro">
        A grain's index (<code>timestamp ÷ duration</code>) is preserved end to end. A Media
        Function writes its result back at the <em>same</em> index — processing only delays when
        a flow's head is published, it never renumbers grains.
      </div>

      <div className="info-panel__row">
        <span className="info-panel__dot info-panel__dot--green" />
        <div>
          <div className="info-panel__label">OK</div>
          <div className="info-panel__text">Requested grain is still retained. Serial chains always land here.</div>
        </div>
      </div>

      <div className="info-panel__row">
        <span className="info-panel__dot info-panel__dot--yellow" />
        <div>
          <div className="info-panel__label">Too early</div>
          <div className="info-panel__text">Requested grain is newer than the head — the reader waits. No data lost.</div>
        </div>
      </div>

      <div className="info-panel__row">
        <span className="info-panel__dot info-panel__dot--red" />
        <div>
          <div className="info-panel__label">Too late — the sync trap</div>
          <div className="info-panel__text">
            A sync point reads the <em>same</em> index from every input, aligned to its slowest
            branch. A faster branch's grain can age past the retained window before that index is
            read — unrecoverable loss, shown as a "✕". Fix by shortening the slow branch (drag its
            latency slider), growing the MXL Domain, or adding a Grain Repeater.
          </div>
        </div>
      </div>

      <div className="info-panel__text info-panel__footnote">
        Slot strips under each node show <strong>W</strong> (write head) and <strong>R</strong>
        (requested read) on the ring; the dotted track inside a function shows the grain actually
        being processed, at a speed set by its latency. At a sync point (e.g. Egress), a dashed
        ring means a grain has arrived and is paused — waiting for its sibling flow to catch up —
        before both are consumed together.
      </div>
    </div>
  );
}
