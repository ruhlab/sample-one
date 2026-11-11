/** Audio data required by the analysis and export functions. */
export type AudioSamples = Pick<AudioBuffer, 'numberOfChannels' | 'sampleRate' | 'length' | 'duration' | 'getChannelData'>;

export interface WavOptions {
  mono?: boolean;
  depth?: 8 | 16 | 24 | 32;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}
