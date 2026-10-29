import type { Track } from './graphLatency';

/** The parts of a node that decide which flow an input connector accepts. */
export interface InputRuleNode {
  kind: string;
  inputCount: number;
  audioOnly?: boolean;
  videoOnly?: boolean;
}

/**
 * The track an input connector may read, or undefined when it takes any track.
 *
 * - An audio-only function reads audio only, a video-only function video only.
 * - An Output carrying both flows has a video input (in-0) and an audio input
 *   (in-1); an Output with a single input reads video.
 * - Any other function is neutral until something is connected, then every
 *   input must carry the same track as the ones already connected (a mixer
 *   does not mix audio with video).
 */
export function requiredTrack(
  node: InputRuleNode,
  inputIndex: number,
  otherConnectedTracks: Track[],
): Track | undefined {
  if (node.audioOnly) return 'audio';
  if (node.videoOnly) return 'video';
  if (node.kind === 'output') return node.inputCount >= 2 && inputIndex !== 0 ? 'audio' : 'video';
  return otherConnectedTracks[0];
}
