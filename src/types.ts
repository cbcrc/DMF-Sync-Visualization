// Core domain types for the MXL Ring Buffer Simulator.
// See Initial_prompt.md §2 for the domain concepts these model.

/** Kinds of Media Function nodes a player can place on the canvas. */
export type MediaFunctionKind =
  | 'input' // Signal source entering the domain (not itself a ring-buffered reader)
  | 'synthetic' // Pure producer, no MXL inputs
  | 'editorial' // Multi-source/complex processor (switcher, mixer, AI super-res)
  | 'technical' // Single-input minor processor (color corrector, EQ, converter)
  | 'recording' // Pure consumer/reader
  | 'repeater' // Grain repeater / artificial buffer node
  | 'output'; // Final presentation output

/** MXL timing classification for a reader's requested grain. */
export type RingBufferStatus = 'OK' | 'TOO_EARLY' | 'TOO_LATE';

/** Rational grain rate used to turn absolute timestamps into MXL grain indices. */
export interface GrainRate {
  numerator: number;
  denominator: number;
}

/**
 * A single media signal flowing through the domain (e.g. one video or audio essence).
 * `latencyMs` is the processing delay this signal has accumulated so far along its path.
 */
export interface Signal {
  id: string;
  label: string;
  /** Track kind, used for sync-group alignment (e.g. distinguishing video vs audio). */
  track: 'video' | 'audio' | 'data';
  /** Accumulated end-to-end processing latency (ms) from capture to this point. */
  latencyMs: number;
  /** Id of the SyncGroup this signal belongs to, if any. */
  syncGroupId?: string;
}

/** A node in the media pipeline graph. */
export interface MediaFunction {
  id: string;
  kind: MediaFunctionKind;
  label: string;
  /** Processing delay introduced by this node (ms). 0 for input/output passthroughs. */
  latencyMs: number;
  /** Number of MXL inputs this node reads from. */
  inputCount: number;
  /** Number of MXL outputs this node writes to. */
  outputCount: number;
  /** Ids of MediaFunctions feeding into this node's inputs, ordered by input index. */
  inputSourceIds: (string | null)[];
}

/**
 * One reader<-flow relationship: a single input of a Media Function reading
 * from one upstream flow's MXL ring buffer.
 *
 * Grain indices are *preserved end to end*: a Media Function that reads grain
 * index T and writes a processed version writes it back at index T, into the
 * same slot position (`T mod grainCount`) of its own output flow. Processing
 * therefore does not renumber grains — it makes a flow's published head lag
 * real time by the path's accumulated latency (`branchLagMs`).
 *
 * A reader that must present several flows together (audio + video) has to
 * fetch the *same* grain index from all of them, which is the slowest
 * branch's index (`alignedLagMs`). On a faster branch that index is already
 * `stalenessMs` behind that flow's own head, and if that exceeds the retained
 * history the slot has been overwritten -> TOO_LATE.
 */
export interface RingBuffer {
  /** `${readerNodeId}:${inputIndex}`. */
  id: string;
  readerNodeId: string;
  /** Upstream node whose output flow this input reads from. */
  sourceNodeId: string;
  inputIndex: number;
  /** Domain window (ms) configured for the MXL Domain. Default 100, range 10-1000. */
  sizeMs: number;
  /** MXL grain timing used by this buffer. */
  grainRate: GrainRate;
  grainDurationMs: number;
  /** Physical grain slots in one domain window (`sizeMs / grainDurationMs`). */
  grainCount: number;
  /** Grain Repeaters upstream on this branch, each contributing another sub-ring buffer. */
  repeaterCount: number;
  /** Usable history in grains after the writer-reserved slots. */
  retainedGrains: number;
  retainedMs: number;
  /** How far this flow's published head lags real time (accumulated path latency). */
  branchLagMs: number;
  /** Lag of the aligned grain index the reader must fetch (slowest branch at this node). */
  alignedLagMs: number;
  /** `alignedLagMs - branchLagMs`: how far behind this flow's head the reader is reading. */
  stalenessMs: number;
  /** Absolute timestamp of this flow's published head grain. */
  publishedTimestampMs: number;
  /** Absolute timestamp of the grain this reader is requesting. */
  requestedTimestampMs: number;
  /** Absolute MXL grain indices derived from the timestamps above. */
  publishedGrainIndex: number;
  requestedGrainIndex: number;
  /** Physical ring slots (`GrainIndex mod grainCount`). */
  publishedRingBufferIndex: number;
  requestedRingBufferIndex: number;
  /** Oldest grain index still retained (writer-reserved boundary applied). */
  retainedFromGrainIndex: number;
}

/** Result of evaluating one reader input against the upstream flow's head. */
export interface RingBufferEvaluation {
  status: RingBufferStatus;
  /** How far behind the flow's head the requested grain is (ms). */
  stalenessMs: number;
  /** Same value as `stalenessMs`, kept for the linear latency gauge. */
  deltaMs: number;
  /** Published head index minus requested index, in whole grains. */
  deltaGrains: number;
  /** `stalenessMs / retainedMs` — 0 at the head, 1 at the retention boundary. */
  occupancyRatio: number;
  publishedGrainIndex: number;
  requestedGrainIndex: number;
  publishedRingBufferIndex: number;
  requestedRingBufferIndex: number;
  retainedFromGrainIndex: number;
  retainedGrains: number;
  retainedMs: number;
}

/**
 * A set of signals (e.g. program video + audio) that must arrive aligned at a
 * common downstream node. See Initial_prompt.md §2.D.
 */
export interface SyncGroup {
  id: string;
  label: string;
  /** Signal ids that are members of this group. */
  memberSignalIds: string[];
}

/** The overall simulation domain: buffer size setting plus all graph state. */
export interface MXLDomain {
  /** Configurable MXL Domain Ring Buffer size (ms). Default 100, range 10-1000. */
  domainSizeMs: number;
  /** Domain timing constants used for timestamp/grain-index conversion. */
  grainRate: GrainRate;
  grainDurationMs: number;
  grainCount: number;
  nodes: MediaFunction[];
  signals: Signal[];
  syncGroups: SyncGroup[];
}
