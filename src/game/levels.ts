// Level challenges (Initial_prompt.md §4 / Task 4). Each level sets the MXL
// Domain buffer size and a short goal; pass/fail is evaluated live against
// the current graph by `useGameLoop`.

export interface Level {
  id: string;
  title: string;
  description: string;
  domainSizeMs: number;
  guidance?: string;
}

export const LEVELS: Level[] = [
  {
    id: 'basics',
    title: '1. Warm-Up',
    description:
      'The minimal MXL workload: an Ingress Function writes flows V1 (video) and A1 (audio) from one paced stream, and an Egress Function re-pairs them for output. Everything is green — explore the grain indices on each input, then start adding Media Functions to the video path.',
    domainSizeMs: 100,
    guidance:
      'Watch the Egress inputs: both request the SAME grain index, because grain indices are preserved through processing. The video branch lags 30ms and audio 2ms, so audio is asked for a grain 28ms old. Add Media Functions to the video path to grow that differential until audio goes red.',
  },
  {
    id: 'align-4k-audio',
    title: '2. Align 4K Video & 8-ch Audio',
    description:
      'Same workload, but the MXL Domain is only 50ms. Keep the Egress Function reading both flows cleanly — build out the video path and find where the audio input starts to overrun.',
    domainSizeMs: 50,
  },
  {
    id: 'tight-margin',
    title: '3. Tight Margin',
    description:
      'A 30ms MXL Buffer retains almost no history. Insert Grain Repeaters to re-buffer the fast branch before it falls outside the retained window.',
    domainSizeMs: 30,
  },
  {
    id: 'av-sync-overrun',
    title: '4. A/V Sync Overrun',
    description:
      'One Ingress Function writes flows V1 (video) and A1 (audio) from the same paced stream. Video is processed twice (V1→V1a→V1b, 82ms), audio once (A1→A1a, 2ms). Grain indices are preserved, so the Egress Function must read the SAME index from both — it waits on the slow video branch, by which time the audio grain it needs sits 80ms (4 grains) behind the audio head and its slot has been recycled.',
    domainSizeMs: 100,
    guidance:
      'The audio flow only retains 3 grains (60ms) of history but is asked for a grain 4 grains old. Three fixes: (1) grow the MXL Domain to 110ms so the audio flow retains 4 grains, (2) delete the Slow Video MF and reconnect V1a straight to the Egress to shrink the differential, or (3) drop a Grain Repeater into the audio branch so A1a is re-buffered into a second sub-ring buffer.',
  },
];

export const DEFAULT_LEVEL_ID = LEVELS[0].id;
