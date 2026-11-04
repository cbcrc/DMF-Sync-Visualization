const base = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  style: { verticalAlign: '-0.125em', marginRight: '0.3em' },
};

/** Minimal line icons that match the weight of the Copy button's glyph. */
export function SaveIcon() {
  return (
    <svg {...base}>
      <path d="M8 2.5v7.5M4.5 7 8 10.5 11.5 7M3 13.5h10" />
    </svg>
  );
}

export function PasteIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3.5" width="10" height="10" rx="1.5" />
      <path d="M6 3.5v-1h4v1" />
    </svg>
  );
}
