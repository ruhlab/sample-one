export interface RuntimeAssets {
  resampler: string;
  distortion: string;
  vinyl: string;
  stretch: string;
  example: string;
}

declare global {
  var __sampleAssets: RuntimeAssets;
}

export const assets: RuntimeAssets = globalThis.__sampleAssets;
