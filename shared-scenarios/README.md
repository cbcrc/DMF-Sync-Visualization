# Shared scenarios

A place for people to **export and share their scenarios** with others.

Built something interesting in the visualizer (a sync problem, a fix, a tricky
topology)? Export it and add it here so others can import it and learn from it.

## Use a shared scenario

1. Download a `*.dmfsync.json` file from this folder.
2. In the app, open **Canvas ▾ → Saved Scenarios…** and choose
   **Import From File…**.
3. It is added to your saved scenarios, including its block layout, domain size
   and media format (frame rate, resolution, audio sample rate). Your existing
   scenarios are never overwritten.

## Share your own

1. In the app, build your canvas, set the Workload Config, and save it from
   **Canvas ▾ → Save Canvas as Scenario…**. Give it a clear name and a one-line
   description of what it demonstrates.
2. On the Saved Scenarios page, press **Export** on your scenario. This downloads
   a `*.dmfsync.json` file.
3. Add the file to this folder and open a pull request. Use a short, descriptive,
   lowercase file name, for example `av-sync-overrun.dmfsync.json`.

Guidelines:

- One scenario per file, please, so each is easy to review and import on its own.
- Put what it shows, and what to try (for example "grow the domain to 110 ms"),
  in the scenario's description.
- Don't put confidential or personal information in names or descriptions.
- Don't hand-edit files except to fix the description; re-export instead.

The automated tests check that every file here imports cleanly, so a malformed
file will fail the build.

File format: see [docs/scenarios.md](../docs/scenarios.md#sharing-export--import).
