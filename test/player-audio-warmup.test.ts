import { expect, test } from "bun:test";
import { warmPlayerAudio } from "../src/features/player-audio-warmup.ts";

test("audio warmup primes sample and oscillator paths silently and disconnects them", () => {
  const nodes: any[] = [];
  function node() {
    const result: any = { connected: [], disconnected: false, connect(target: unknown) { this.connected.push(target); }, disconnect() { this.disconnected = true; } };
    nodes.push(result);
    return result;
  }
  const gain = Object.assign(node(), { gain: { value: 1 } });
  const pan = node();
  const sample = Object.assign(node(), { start(time: number) { this.started = time; }, buffer: null, onended: null });
  const oscillator = Object.assign(node(), { start(time: number) { this.started = time; }, stop(time: number) { this.stopped = time; }, onended: null });
  const destination = {};
  const context = {
    currentTime: 2, sampleRate: 48000,
    createGain: () => gain, createStereoPanner: () => pan,
    createBufferSource: () => sample, createOscillator: () => oscillator,
    createBuffer: (channels: number, length: number, rate: number) => ({ channels, length, rate }),
  } as unknown as AudioContext;
  warmPlayerAudio(context, destination as AudioNode);
  expect(gain.gain.value).toBe(0);
  expect(sample.started).toBe(2);
  expect(oscillator.started).toBe(2);
  expect(oscillator.stopped).toBe(2.02);
  expect(pan.connected).toEqual([destination]);
  sample.onended();
  expect(gain.disconnected).toBe(false);
  oscillator.onended();
  expect(nodes.every((item) => item.disconnected)).toBe(true);
});
