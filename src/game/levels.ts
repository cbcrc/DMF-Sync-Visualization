// The built-in level list. Only the blank canvas ships with the app; everything
// else is a user-saved scenario (see `scenarioStorage.ts`).

export interface Level {
  id: string;
  title: string;
  description: string;
  domainSizeMs: number;
  guidance?: string;
}

export const LEVELS: Level[] = [
  {
    id: 'blank-canvas',
    title: 'Blank Canvas',
    description:
      'An empty canvas. Use the Add media function palette to build your own pipeline, connect the media functions, and watch the ring buffers respond.',
    domainSizeMs: 100,
  },
];

export const DEFAULT_LEVEL_ID = LEVELS[0].id;
