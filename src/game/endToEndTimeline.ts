// End-to-end timeline model: for each Output/Recording, the chain of media
// functions that sets its delivery time, from the source input to the output.
//
// Time axis: milliseconds since the signal was captured at the input (0 = the
// moment the input wrote the grain into MXL). Each step records
//   - `readAtMs`:  how far behind "now" this function reads in its input ring
//                  (the aligned read position, see graphLatency.ts), and
//   - `latencyMs`: the delay it adds, drawn as `[startMs, endMs]` on the axis.
//
// FUTURE — Origin Time Stamp (OTS): the linear side carries an OTS that says
// when the media was really captured, before it was written into MXL. That is
// NOT implemented yet. The model is ready for it: every row has `leadInMs`
// (OTS-to-MXL-write delay, currently always 0), and every `startMs`/`endMs`
// is already shifted by it. When OTS is wired in, supply `leadInMs` per source
// (see `TimelineOptions.leadInMsBySourceId`) and the axis, ticks and totals
// follow with no further change; the step list can also gain a leading
// "linear → MXL" step in the same way.
//
// A Profanity Delay writes its output as a synthetic source: new timestamps,
// head lag back to 0. The axis keeps counting through it (the show is still
// delayed), and the row records where the timestamps were re-written
// (`stampedAtMs`) so the delay stays visible end to end.

import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { GraphBufferState } from './graphLatency';
import { freeRunningInputs, rewritesAsNewSource } from './syncInputs';

export interface TimelineStep {
  nodeId: string;
  label: string;
  kind: MediaFunctionNodeData['kind'];
  /** Start of this function's processing on the end-to-end axis (ms). */
  startMs: number;
  /** End of its processing; the next step starts here unless it waited for sync. */
  endMs: number;
  /** Delay this function adds (ms). */
  latencyMs: number;
  /** Time this function waited for slower sibling inputs before it could start (ms). */
  syncWaitMs: number;
  /** How far behind "now" it reads in its input ring buffer (ms); 0 for sources. */
  readAtMs: number;
  /**
   * True for a function that writes its output as a synthetic source (a
   * Profanity Delay): its grains get new timestamps at `endMs`. The delay it
   * added still counts on this axis.
   */
  restamps: boolean;
}

export interface TimelineRow {
  outputId: string;
  outputLabel: string;
  /** Delay between the origin timestamp (OTS) and the MXL write. Always 0 until OTS is implemented. */
  leadInMs: number;
  steps: TimelineStep[];
  /** End-to-end time from source to this output (ms, includes `leadInMs`). */
  totalMs: number;
  /**
   * Where the timestamps reaching this output were written (ms on this axis):
   * the end of the last re-stamping step, or `leadInMs` when nothing re-stamps.
   */
  stampedAtMs: number;
  /** Age of the output's timestamps when they reach it: `totalMs - stampedAtMs`. */
  stampAgeMs: number;
}

export interface TimelineOptions {
  /** Future OTS hook: per source node, ms between its origin timestamp and its MXL write. */
  leadInMsBySourceId?: ReadonlyMap<string, number>;
}

const SINK_KINDS = new Set(['output', 'recording']);

export function buildEndToEndTimeline(
  graph: GraphBufferState,
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  options: TimelineOptions = {},
): TimelineRow[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const inbound = new Map<string, { source: string; index: number }[]>();
  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    const index = e.targetHandle ? Number(e.targetHandle.replace('in-', '')) : 0;
    if (!inbound.has(e.target)) inbound.set(e.target, []);
    inbound.get(e.target)!.push({ source: e.source, index: Number.isInteger(index) ? index : 0 });
  }

  const workloadOf = (id: string) => graph.latencyByNodeId.get(id)?.workloadLatencyMs ?? 0;

  const rows: TimelineRow[] = [];
  for (const sink of nodes) {
    if (!SINK_KINDS.has(sink.data.kind)) continue;
    if (!inbound.get(sink.id)?.length) continue;

    // Walk back from the output along the branch that sets its end-to-end time.
    const chain: Node<MediaFunctionNodeData>[] = [];
    const seen = new Set<string>();
    let current: Node<MediaFunctionNodeData> | undefined = sink;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      const wired = inbound.get(current.id) ?? [];
      const free = freeRunningInputs(current.data, wired.map((w) => w.index));
      const candidates = wired.filter((w) => !free.has(w.index));
      let next: { source: string; index: number } | undefined;
      for (const w of candidates) {
        if (!next || workloadOf(w.source) > workloadOf(next.source)) next = w;
      }
      current = next ? nodeById.get(next.source) : undefined;
    }
    chain.reverse();

    const leadInMs = options.leadInMsBySourceId?.get(chain[0].id) ?? 0;
    let previousEndMs = leadInMs;
    const steps: TimelineStep[] = chain.map((n) => {
      const info = graph.latencyByNodeId.get(n.id);
      const endMs = leadInMs + (info?.workloadLatencyMs ?? 0);
      const ownMs = info?.ownLatencyMs ?? n.data.latencyMs;
      const startMs = Math.max(leadInMs, endMs - ownMs);
      const step: TimelineStep = {
        nodeId: n.id,
        label: n.data.label,
        kind: n.data.kind,
        startMs,
        endMs,
        latencyMs: ownMs,
        syncWaitMs: Math.max(0, startMs - previousEndMs),
        readAtMs: info?.inputLatencyMs ?? 0,
        restamps: rewritesAsNewSource(n.data.kind),
      };
      previousEndMs = endMs;
      return step;
    });

    const totalMs = steps[steps.length - 1].endMs;
    const lastRestamp = steps.filter((s) => s.restamps).pop();
    const stampedAtMs = lastRestamp ? lastRestamp.endMs : leadInMs;
    rows.push({
      outputId: sink.id,
      outputLabel: sink.data.label,
      leadInMs,
      steps,
      totalMs,
      stampedAtMs,
      stampAgeMs: totalMs - stampedAtMs,
    });
  }
  return rows.sort((a, b) => b.totalMs - a.totalMs);
}
