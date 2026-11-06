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
 *   (in-1); an Output with a single input reads video. A Profanity Delay
 *   always has the video/audio pair.
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
  if (node.kind === 'output' || node.kind === 'delay') return node.inputCount >= 2 && inputIndex !== 0 ? 'audio' : 'video';
  return otherConnectedTracks[0];
}

/** A link, reduced to the two nodes it joins. */
type Link = { source: string; target: string };

/**
 * True when a link `source → target` would close a loop: `target` already
 * reaches `source` (or they are the same node). A loop has no first writer, so
 * its flows have no defined head lag.
 */
export function createsCycle(links: Link[], source: string, target: string): boolean {
  if (source === target) return true;
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (!next.has(l.source)) next.set(l.source, []);
    next.get(l.source)!.push(l.target);
  }
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Keeps links in order, dropping each one that would close a loop with those kept before it. */
export function withoutCycles<T extends Link>(links: T[]): T[] {
  const kept: T[] = [];
  for (const l of links) if (!createsCycle(kept, l.source, l.target)) kept.push(l);
  return kept;
}
