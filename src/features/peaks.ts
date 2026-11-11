import type { AudioSamples } from "../audio/types.ts";
const pcmPeakCount = 32768;
export function calculatePeaks(buffer: AudioSamples): {
  lo: Float32Array;
  hi: Float32Array;
} {
  const n = buffer.length;
  const count = Math.min(pcmPeakCount, n);
  const lo = new Float32Array(count),
    hi = new Float32Array(count);
  const channels = Array.from(
    { length: Math.min(2, buffer.numberOfChannels) },
    (_, i) => buffer.getChannelData(i),
  );
  for (let i = 0; i < count; i++) {
    let min = 1,
      max = -1;
    const begin = Math.floor((i * n) / count),
      end = Math.max(begin + 1, Math.floor(((i + 1) * n) / count));
    for (let x = begin; x < end; x++) {
      let v = 0;
      for (const channel of channels) v += channel[x];
      v /= channels.length;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo[i] = min;
    hi[i] = max;
  }
  return { lo, hi };
}
