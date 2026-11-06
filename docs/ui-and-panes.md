# UI shell, panes and themes

`App.tsx` lays out a full-width top bar (the canvas toolbar, portalled in by
`FlowCanvas`) above a row of left dock, canvas and right dock, with a bottom dock
under the canvas. Docked panes never overlap.

- **Panes:** Add Function, Playback, Workload Config, Status, Clock, Ring Buffers, Timeline, Help.
  Every pane sits in a `DockItem` with a header bar (drag grip, title from
  `PANE_NAMES` in `App.tsx`, left/bottom/right dock buttons). Clock and Ring
  Buffers are separate panes; `RingBufferPanel` renders one or the other via
  `showClock` / `showRings`. Menus are in `ToolbarMenus.tsx`, playback controls in
  `PlaybackPane.tsx`.
- **Collapse:** each dock can collapse to a rail of pane names. **Hide Panes**
  collapses all. Collapsing only hides, so layout and pane state are kept. Side
  docks size to their content (200-360 px).
- **Toolbar:** Undo, Now, Save scenario, Copy/Paste, Canvas menu,
  theme toggle. Ctrl/Cmd+C and V copy and paste functions only when some are
  selected or copied; otherwise they copy text as usual. While the Scenarios page
  is open the canvas ignores its shortcuts (delete, undo, copy/paste), and Escape
  returns to the canvas.
- **Show Now** (toolbar) adds a Now marker to every ring strip on the canvas: how
  far that function's output lags real time, to one scale on every strip (one
  strip width = one MXL domain of delay) and printed on the tag ("Now −160ms").
  The strip grows to fit; past 3 domains the delay line is broken (//) so long
  delays such as a Profanity Delay chain stay compact (`ringStripLayout.ts`).
- **Workload Config** pane (`WorkloadPane.tsx`, `game/mediaConfig.ts`; minimized by
  default, toggled from Pane View): domain size, frame rate, resolution,
  audio sample rate. Default 1080p50, 48 kHz.
- **Themes:** semantic `--ui-*` CSS variables in `index.css` for Dark (default) and
  Light, set by `data-theme` on `<html>` (`src/theme.ts`, `ThemeToggle.tsx`; first
  visit follows the OS). Use the tokens, not hard-coded greys. Status and alert
  colours (red, green, ring zones) are fixed and their light-mode contrast is
  unchecked. Accent is Radio-Canada red `#EE0000`. Fonts live in `public/fonts/`
  (loaded by `src/index.css`).
- Menus and buttons use Title Case.

## Saved browser state (localStorage)

| Key | Content |
| --- | --- |
| `dmf-sync-viz:docks:v2` | dock and order of each pane (`game/docks.ts`) |
| `dmf-sync-viz:minimized:v1` | minimized panes |
| `dmf-sync-viz:collapsed-docks:v1` | collapsed docks |
| `dmf-sync-viz:media:v1` | Workload Config |
| `dmf-sync-viz:scenarios:v1` | user-saved scenarios |
| `dmf-sync-viz:working:v1` | autosaved working graph (skipped when empty) |
| `dmf-theme` | theme |

**Reset Layout** restores the dock defaults.
