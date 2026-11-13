import test from "node:test";
import assert from "node:assert/strict";
import { encodeWav } from "../src/audio/wav.ts";
import { estimateBpm } from "../src/audio/tempo.ts";
import { calculatePeaks } from "../src/features/peaks.ts";
import { buildZip } from "../src/audio/zip.ts";
import { readSampleZip, isProjectZip } from "../src/audio/read-zip.ts";

function audio(channels, sampleRate = 8000) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (index) => channels[index],
  };
}

test("WAV export writes the requested depth, channel count and sample data", () => {
  const input = audio([Float32Array.from([1, 0]), Float32Array.from([-1, 0])]);
  const bytes = encodeWav(input, 0, input.duration, { mono: true, depth: 16 }),
    view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 4);
  assert.equal(view.getInt16(44, true), 0);
});

test("tempo detection estimates a regular beat and rejects silence", async () => {
  const data = new Float32Array(8000 * 8);
  for (let frame = 0; frame < data.length; frame += 4000)
    for (let j = 0; j < 120; j++) data[frame + j] = 0.9 * Math.exp(-j / 25);
  assert.ok(Math.abs((await estimateBpm(audio([data]))) - 120) < 3);
  await assert.rejects(
    estimateBpm(audio([new Float32Array(8000 * 4)])),
    /rhythmic audio/,
  );
});

test("waveform peaks retain the minimum and maximum signal values", () => {
  const peaks = calculatePeaks(audio([Float32Array.from([-1, 0.5, 0.25, 1])]));
  assert.deepEqual([...peaks.lo], [-1, 0.5, 0.25, 1]);
  assert.deepEqual([...peaks.hi], [-1, 0.5, 0.25, 1]);
});

test("slice archives contain valid ZIP headers and entry names", async () => {
  const zip = buildZip([{ name: "test.wav", data: new Uint8Array([1, 2, 3]) }]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), "test.wav");
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
});

test("sampler ZIP import sorts numbered entries and rejects invalid archives", async () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    name: `${20 - i}-slice.wav`,
    data: new Uint8Array([20 - i]),
  }));
  const archive = new Uint8Array(await buildZip(entries).arrayBuffer());
  const result = readSampleZip(archive);
  assert.equal(result.length, 20);
  assert.deepEqual(
    result.map((entry) => entry.data[0]),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  assert.throws(() => readSampleZip(archive.subarray(0, 35)), /ZIP|incomplete/);
  assert.throws(() => readSampleZip(new Uint8Array([1, 2, 3])), /ZIP/);
});

test("project archives preserve audio buffers, shared references, and reject wrong apps", async () => {
  const { exportProject, importProject } =
    await import("../src/audio/project.ts");
  const previous = globalThis.AudioBuffer;
  class FakeAudioBuffer {
    channels: Float32Array[];
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    constructor(channels: number, length: number, sampleRate: number) {
      this.numberOfChannels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
      this.channels = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
    }
    getChannelData(channel: number) {
      return this.channels[channel];
    }
    copyToChannel(data: Float32Array, channel: number) {
      this.channels[channel].set(data);
    }
  }
  try {
    globalThis.AudioBuffer = FakeAudioBuffer as unknown as typeof AudioBuffer;
    const source = new FakeAudioBuffer(2, 3, 22050);
    source.channels[0].set([0.125, -0.75, 1.5]);
    source.channels[1].set([-1, 0.5, 0]);
    const blob = exportProject("player", {
      pads: [source, source],
      setting: 42,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const context = {
      createBuffer: (c: number, l: number, r: number) =>
        new FakeAudioBuffer(c, l, r),
    } as unknown as BaseAudioContext;
    const result = importProject(bytes, "player", context);
    assert.equal(result.pads[0], result.pads[1]);
    assert.equal(result.pads[0].sampleRate, 22050);
    assert.deepEqual(
      [...result.pads[0].getChannelData(0)],
      [0.125, -0.75, 1.5],
    );
    assert.deepEqual([...result.pads[0].getChannelData(1)], [-1, 0.5, 0]);
    assert.equal(result.setting, 42);
    assert.throws(() => importProject(bytes, "sampler", context), /compatible/);
  } finally {
    globalThis.AudioBuffer = previous;
  }
});

test("ZIP import distinguishes project manifests from sample archives", async () => {
  const project = new Uint8Array(
    await buildZip([
      { name: "project.json", data: new TextEncoder().encode("{}") },
    ]).arrayBuffer(),
  );
  const samples = new Uint8Array(
    await buildZip([
      { name: "sample.wav", data: new Uint8Array([1]) },
    ]).arrayBuffer(),
  );
  assert.equal(isProjectZip(project), true);
  assert.equal(isProjectZip(samples), false);
  assert.throws(() => isProjectZip(new Uint8Array([1, 2])), /ZIP/);
});
