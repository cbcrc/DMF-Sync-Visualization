# Scenarios and persistence

The app ships with a single **Blank Canvas** (100 ms domain, defined in
`src/game/levels.ts`). Users build their own pipelines; there are no pre-built
scenarios.

- **Saving:** Canvas ▾ → Save Canvas as Scenario… stores nodes, edges, domain size,
  media format (Workload Config), name and description in localStorage (`dmf-sync-viz:scenarios:v1`,
  `scenarioStorage.ts`). Saving with an existing name replaces it.
- **Saved Scenarios page:** a full-screen overlay at `#/scenarios` (opened from the
  Canvas menu); the canvas stays mounted underneath.
- **Autosave:** the working graph is stored in `dmf-sync-viz:working:v1` and
  restored on load, including an emptied canvas. Deleting the saved scenario
  that is open keeps its graph on the canvas as unsaved work (on Blank Canvas).

## Sharing (export / import)

The Saved Scenarios page can export one scenario (card button) or all of them to a
`*.dmfsync.json` file, and import such files. The file is plain JSON:

```json
{ "format": "dmf-sync-viz.scenarios", "version": 1, "exportedAt": "...",
  "scenarios": [{ "title": "", "description": "", "domainSizeMs": 100,
    "media": { "frameRate": "50/1", "resolution": "1920x1080", "audioSampleRate": 48000 },
    "nodes": [], "edges": [] }] }
```

- `format` identifies the file; `version` only increases for breaking changes. A
  file with a newer version is refused with a message, and unknown fields are
  ignored, so additive changes stay compatible both ways.
- `media` (the Workload Config: frame rate, resolution, audio sample rate) is
  optional. Opening a scenario with it sets the app's format; older scenarios
  without it keep the current format.
- Import validates everything through the same sanitizers as localStorage, never
  overwrites (a clashing name becomes "Name (2)"), and gives imports new ids. The
  sanitizers drop nodes with non-integer or out-of-range connector counts (0–8)
  and repeated ids, clamp latency to the function's slider range, and drop any
  link that would close a loop (the canvas also refuses to draw one).
- Community scenarios live in [`shared-scenarios/`](../shared-scenarios/README.md).
- Code: `buildScenarioFile`, `parseScenarioFile`, `mergeImported` in
  `src/game/scenarioStorage.ts`.

## Exercise: A/V sync overrun

Build this to see a too-late read. An Ingress writes video and audio with a shared
origin. Chain two video functions (about 82 ms total) and one audio function
(about 2 ms), then wire both into one Egress. The Egress must read the same point
in time from both. By the time the slow video branch publishes that instant (its
82 ms plus a 20 ms read-behind per video function), audio has moved about 110 ms
past it. In a 100 ms domain an audio reader can lag at most 80 ms: MXL keeps
twice the history for audio, but the read (one video grain of samples) must fit
in the readable half. So audio goes TOO_LATE while video stays OK.

Fixes to try: grow the domain to 140 ms, remove the slow function, add a Grain
Repeater in the audio branch, or lower the slow function's latency.
