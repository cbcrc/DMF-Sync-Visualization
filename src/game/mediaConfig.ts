// A/V format options for the workload, its persistence, and a context so canvas
// components can read the active format without prop drilling.

import { createContext, useContext } from 'react';
import { DEFAULT_MEDIA_CONFIG, type MediaConfig } from '../engine/mxlGrainIndex';
import type { GrainRate } from '../types';

export const MEDIA_CONFIG_KEY = 'dmf-sync-viz:media:v1';

export const FRAME_RATES: { id: string; label: string; rate: GrainRate }[] = [
  { id: '24000/1001', label: '23.976 fps', rate: { numerator: 24000, denominator: 1001 } },
  { id: '24/1', label: '24 fps', rate: { numerator: 24, denominator: 1 } },
  { id: '25/1', label: '25 fps', rate: { numerator: 25, denominator: 1 } },
  { id: '30000/1001', label: '29.97 fps', rate: { numerator: 30000, denominator: 1001 } },
  { id: '30/1', label: '30 fps', rate: { numerator: 30, denominator: 1 } },
  { id: '50/1', label: '50 fps', rate: { numerator: 50, denominator: 1 } },
  { id: '60000/1001', label: '59.94 fps', rate: { numerator: 60000, denominator: 1001 } },
  { id: '60/1', label: '60 fps', rate: { numerator: 60, denominator: 1 } },
];

export const RESOLUTIONS = ['1280x720', '1920x1080', '2560x1440', '3840x2160', '7680x4320'];

export const SAMPLE_RATES = [44100, 48000, 96000];

export const rateId = (r: GrainRate) => `${r.numerator}/${r.denominator}`;

/** Portable form of a MediaConfig (frame rate as "num/den"), used in storage and shared files. */
export interface MediaJson {
  frameRate: string;
  resolution: string;
  audioSampleRate: number;
}

export const mediaToJson = (c: MediaConfig): MediaJson => ({
  frameRate: rateId(c.videoRate),
  resolution: c.resolution,
  audioSampleRate: c.audioSampleRate,
});

/** Reads untrusted media JSON; unknown values fall back to defaults. Undefined if it isn't an object. */
export function mediaFromJson(raw: unknown): MediaConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const frame = FRAME_RATES.find((f) => f.id === r.frameRate);
  return {
    videoRate: frame?.rate ?? DEFAULT_MEDIA_CONFIG.videoRate,
    resolution: RESOLUTIONS.includes(r.resolution as string) ? (r.resolution as string) : DEFAULT_MEDIA_CONFIG.resolution,
    audioSampleRate: SAMPLE_RATES.includes(r.audioSampleRate as number) ? (r.audioSampleRate as number) : DEFAULT_MEDIA_CONFIG.audioSampleRate,
  };
}

export function loadMediaConfig(storage: Pick<Storage, 'getItem'>): MediaConfig {
  try {
    return mediaFromJson(JSON.parse(storage.getItem(MEDIA_CONFIG_KEY) ?? 'null')) ?? DEFAULT_MEDIA_CONFIG;
  } catch {
    return DEFAULT_MEDIA_CONFIG;
  }
}

export function persistMediaConfig(storage: Pick<Storage, 'setItem'>, config: MediaConfig): void {
  try {
    storage.setItem(MEDIA_CONFIG_KEY, JSON.stringify(mediaToJson(config)));
  } catch {
    // Storage full or unavailable: the setting just won't survive a reload.
  }
}

export const MediaConfigContext = createContext<MediaConfig>(DEFAULT_MEDIA_CONFIG);

export const useMediaConfig = (): MediaConfig => useContext(MediaConfigContext);
