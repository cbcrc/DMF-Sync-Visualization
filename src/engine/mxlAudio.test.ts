// Audio and A/V alignment checked against dmf-mxl/mxl (reference/mxl, 6e654e2):
// Instance.cpp (continuous buffer sizing, 10 ms default commit batch),
// PosixContinuousFlowReader.cpp (readable window), IndexConversion.hpp (rounding).
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency } from '../game/graphLatency';
import {
  DEFAULT_MEDIA_CONFIG,
  TAI_EPOCH_OFFSET_MS,
  continuousBufferSamples,
  grainIndexToTimestampMs,
  sampleIndexAt,
  sampleIndexLabel,
  samplesPerAudioBatch,
  simplifiedGrainIndex,
  timestampToGrainIndex,
  timestampToIndex,
} from './mxlGrainIndex';
import { continuousGeometry, retainedGrainsFor } from './ringBufferEngine';

describe('MXL continuous (audio) ring', () => {
  it('is twice the history, rounded up to a 4 KiB page of float32 samples', () => {
    expect(continuousBufferSamples(100, 48000)).toBe(10240); // 9'600 -> 10 pages
    expect(continuousBufferSamples(200, 48000)).toBe(19456); // 19'200 -> 19 pages
  });

  it('commits in 10 ms batches by default', () => {
    expect(samplesPerAudioBatch({ videoRate: { numerator: 50, denominator: 1 }, resolution: '', audioSampleRate: 48000 })).toBe(480);
    expect(samplesPerAudioBatch({ videoRate: { numerator: 50, denominator: 1 }, resolution: '', audioSampleRate: 44100 })).toBe(441);
  });

  it('lets a reader lag by half the buffer, less its read window', () => {
    // 100 ms: 5'120 readable samples. One batch: (5'120 - 480) / 480 -> 9 batches.
    expect(continuousGeometry(100).retainedGrains).toBe(9);
    // Aligned to a 20 ms video grain: (5'120 - 960) / 480 -> 8 batches.
    expect(continuousGeometry(100, undefined, 960).retainedGrains).toBe(8);
    // Video in the same domain keeps MXL's discrete rule: 5 slots - 2.
    expect(retainedGrainsFor(5)).toBe(3);
  });
});

describe('A/V at a synced Output (100 ms domain)', () => {
  const T0 = 1_792_848_000_000; // on a video grain boundary
  const node = (id: string, kind: MediaFunctionNodeData['kind'], latencyMs: number, inputCount: number, outputCount: number, extra = {}): Node<MediaFunctionNodeData> =>
    ({ id, type: 'mediaFunction', position: { x: 0, y: 0 }, data: { label: id, kind, latencyMs, inputCount, outputCount, ...extra } });
  const avEdges = (audioVia?: string): Edge[] => [
    { id: 'e1', source: 'in', sourceHandle: 'out-0', target: 'v', targetHandle: 'in-0' },
    { id: 'e2', source: 'v', sourceHandle: 'out-0', target: 'out', targetHandle: 'in-0' },
    ...(audioVia
      ? [
          { id: 'e3', source: 'in', sourceHandle: 'out-1', target: audioVia, targetHandle: 'in-0' },
          { id: 'e4', source: audioVia, sourceHandle: 'out-0', target: 'out', targetHandle: 'in-1' },
        ]
      : [{ id: 'e3', source: 'in', sourceHandle: 'out-1', target: 'out', targetHandle: 'in-1' }]),
  ];
  const readAt = (videoLatencyMs: number, t: number, audioLatencyMs?: number, media = DEFAULT_MEDIA_CONFIG) => {
    const nodes = [
      node('in', 'input', 0, 0, 2),
      node('v', 'editorial', videoLatencyMs, 1, 1),
      node('out', 'output', 0, 2, 0),
      ...(audioLatencyMs !== undefined ? [node('a', 'technical', audioLatencyMs, 1, 1, { audioOnly: true })] : []),
    ];
    const g = computeGraphLatency(nodes, avEdges(audioLatencyMs !== undefined ? 'a' : undefined), 100, t, media);
    const readings = g.inputsByNodeId.get('out')!;
    return { audio: readings.find((r) => r.track === 'audio')!, video: readings.find((r) => r.track === 'video')! };
  };

  it('reads the samples of the video grain read alongside, by its timestamp', () => {
    const { audio, video } = readAt(30, T0 + 7);
    const k = video.buffer.requestedGrainIndex;
    const a = audio.buffer.alignedRead!;
    expect(a.videoGrainIndex).toBe(k);
    expect(a.firstSample).toBe(k * 960); // T_k = k × 20 ms → sample k × 960 at 48 kHz
    expect(a.lastSample).toBe(k * 960 + 959);
    expect(audio.alignmentSpanMs).toEqual({ startMs: k * 20, endMs: k * 20 + 20 });
    expect(video.alignmentSpanMs).toEqual(audio.alignmentSpanMs);
  });

  it('holds audio until the paired video grain is complete, so its wait depends on the frame phase', () => {
    // Video path = 50 ms + a 20 ms read-behind. Audio must keep the grain's samples until
    // the grain ends (T_k+1), which falls on video's 20 ms grid: 80 ms at T0, 95 ms 15 ms later.
    expect(readAt(50, T0).audio.buffer.stalenessMs).toBe(80);
    expect(readAt(50, T0).audio.evaluation.status).toBe('OK');
    expect(readAt(60, T0).audio.evaluation.status).toBe('OK'); // 80 ms ≤ ~86.7 ms
    expect(readAt(60, T0 + 15).audio.evaluation.status).toBe('TOO_LATE'); // 95 ms
  });

  it('marks audio too late past half the buffer less the grain of samples it reads', () => {
    for (let dt = 0; dt < 20; dt += 1) expect(readAt(70, T0 + dt).audio.evaluation.status).toBe('TOO_LATE'); // ≥ 90 ms
  });

  it('never waits early when audio and video arrive together', () => {
    const nodes = [node('in', 'input', 0, 0, 2), node('out', 'output', 0, 2, 0)];
    const edges: Edge[] = [
      { id: 'e1', source: 'in', sourceHandle: 'out-0', target: 'out', targetHandle: 'in-0' },
      { id: 'e2', source: 'in', sourceHandle: 'out-1', target: 'out', targetHandle: 'in-1' },
    ];
    for (let dt = 0; dt < 40; dt += 1) {
      const audio = computeGraphLatency(nodes, edges, 100, T0 + dt).inputsByNodeId.get('out')!.find((r) => r.track === 'audio')!;
      expect(audio.evaluation.status).toBe('OK');
    }
  });

  it('pairs an earlier video grain when audio is the slower flow, as a sync group waits for it', () => {
    for (let dt = 0; dt < 40; dt += 1) {
      const { audio, video } = readAt(5, T0 + dt, 30); // audio path 30 + 10 ms, video 5 + 20 ms
      expect(audio.evaluation.status).toBe('OK');
      expect(audio.buffer.alignedRead!.lastSample).toBeLessThanOrEqual(audio.buffer.alignedRead!.headSample);
      expect(video.evaluation.status).toBe('OK');
    }
  });

  it('follows the 29.97 fps cadence: 1602/1601 samples a grain, 8008 per 5 grains', () => {
    const ntsc = { ...DEFAULT_MEDIA_CONFIG, videoRate: { numerator: 30000, denominator: 1001 } };
    const frameMs = 1001 / 30;
    const counts: number[] = [];
    for (let j = 0; j < 5; j += 1) counts.push(readAt(30, T0 + j * frameMs + 1, undefined, ntsc).audio.buffer.alignedRead!.sampleCount);
    expect(new Set(counts)).toEqual(new Set([1601, 1602]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(8008);
  });
});

describe('timestamp to index', () => {
  it('converts between flows rounding to the nearest index, like MXL', () => {
    const ntsc = { numerator: 30000, denominator: 1001 }; // 33.37 ms grains
    expect(timestampToIndex(20, ntsc)).toBe(1); // 0.6 of a grain
    expect(timestampToIndex(10, ntsc)).toBe(0); // 0.3 of a grain
    expect(sampleIndexAt(1001 / 30, 48000)).toBe(1602); // 1601.6 samples
  });

  it('places a live head on the grain whose span contains now', () => {
    const ntsc = { numerator: 30000, denominator: 1001 };
    expect(timestampToGrainIndex(20, ntsc)).toBe(0);
    expect(timestampToGrainIndex(40, { numerator: 50, denominator: 1 })).toBe(2);
  });
});

describe('simplified sample labels', () => {
  it('count from simplified grain 100 and wrap with it, so a grain and its samples read together', () => {
    const fps50 = { numerator: 50, denominator: 1 };
    const g100 = timestampToGrainIndex(TAI_EPOCH_OFFSET_MS, fps50);
    expect(simplifiedGrainIndex(g100 + 3, fps50)).toBe(103);
    expect(sampleIndexLabel((g100 + 3) * 960, 48000, false, fps50)).toBe("2'880"); // 3 grains × 960
    // Before the start, both wrap: grain 998 ↔ 898 grains of samples.
    expect(simplifiedGrainIndex(g100 - 2, fps50)).toBe(998);
    expect(sampleIndexLabel((g100 - 2) * 960, 48000, false, fps50)).toBe("862'080");
  });

  it('anchor to grain 100 at 1001-based rates too', () => {
    const ntsc = { numerator: 30000, denominator: 1001 };
    const g100 = timestampToGrainIndex(TAI_EPOCH_OFFSET_MS, ntsc);
    const first = (k: number) => sampleIndexAt(grainIndexToTimestampMs(k, ntsc), 48000);
    // 5 grains in: 8'008 samples, whatever the epoch's phase in the cadence.
    expect(sampleIndexLabel(first(g100 + 5), 48000, false, ntsc)).toBe("8'008");
  });
});
