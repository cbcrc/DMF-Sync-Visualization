# DMF Latency & Sync Visualizer

An interactive, browser-based tool for visualizing latency and synchronization in
the EBU's [Dynamic Media Facility (DMF)](https://tech.ebu.ch/dmf/ra), supporting the
[AMWA JT-DMF](https://specs.amwa.tv/in-index/) work. You wire Media Functions
between an Ingress and an Egress and watch grains move through ring buffers, to see
where latency builds up and where overruns happen. Latency alone is harmless; it is
the *differential* latency between flows that must be re-paired that loses data.

This is an exploratory aid, not a specification. Inside the DMF's asynchronous
domain it follows the Media eXchange Layer
([dmf-mxl/mxl](https://github.com/dmf-mxl/mxl)); where this repo disagrees, MXL is
correct.

![Unofficial DMF definitions](assets/images/Definition_Block_Diagram.png)

## Run it

Requires Node 18.

```bash
git clone --recurse-submodules <repo-url>   # or: git submodule update --init
npm install
npm run dev                                  # http://localhost:5173/
```

Other commands: `npm run build`, `npm run lint`, `npm test`.

`reference/mxl` is a pinned copy of MXL used as reference material only; it is not
part of the build.

## Quick start

1. Open a scenario from **Canvas ▾**, or start from Blank Canvas and add functions
   from the **Add Function** pane, dragging between handles to wire them.
2. Click a function to see its rings in the **Ring Buffers** pane. Readers are
   tagged R1, R2… on the inputs.
3. Press **Step ▶** in **Playback** to advance one grain, or switch to Stepping or
   Normal.
4. Change a function's latency and watch readers turn orange (too early, waiting)
   or dark red (too late ✕).
5. Set domain size, frame rate and audio sample rate in the **Workload Config** pane (turn it on in Pane View).

Panes can be dragged, docked left/bottom/right, minimized or collapsed; your
layout and theme are saved in the browser (**Reset Layout** restores defaults).
The **Help** pane explains the on-screen elements.

## Where to go next

- [docs/](docs/README.md): architecture, UI and panes, grain-flow and playback,
  scenarios
- [AI_RULES.md](AI_RULES.md): rules for AI agents and recorded deviations from MXL
- [shared-scenarios/](shared-scenarios/README.md): scenarios people have exported and shared
- [TO-DO.md](TO-DO.md): backlog and known issues
- [SBOM.md](SBOM.md): dependencies and licences

External: [AMWA increments](https://specs.amwa.tv/in-index/),
[IN-002 Time and Identity](https://github.com/AMWA-TV/in-002),
[IN-005 External Signal Ingress](https://github.com/AMWA-TV/in-005),
[dmf-mxl/mxl](https://github.com/dmf-mxl/mxl).
