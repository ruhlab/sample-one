import { buildZip } from "./zip.ts";
import { readStoredZip } from "./read-zip.ts";
import type { ZipEntry } from "./types.ts";

type AudioRecord = {
  name: string;
  channels: number;
  length: number;
  sampleRate: number;
};

/** A versioned archive with lossless, planar 32-bit float audio. */
export function exportProject(app: "sampler" | "player", data: unknown): Blob {
  const entries: ZipEntry[] = [],
    buffers: AudioRecord[] = [],
    ids = new Map<AudioBuffer, number>();
  function encode(value: any): any {
    if (value instanceof AudioBuffer) {
      let id = ids.get(value);
      if (id === undefined) {
        id = buffers.length;
        ids.set(value, id);
        const name = `audio/${id}.f32`,
          samples = new Float32Array(value.length * value.numberOfChannels);
        for (let channel = 0; channel < value.numberOfChannels; channel++)
          samples.set(value.getChannelData(channel), channel * value.length);
        entries.push({ name, data: new Uint8Array(samples.buffer) });
        buffers.push({
          name,
          channels: value.numberOfChannels,
          length: value.length,
          sampleRate: value.sampleRate,
        });
      }
      return { $audio: id };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, encode(v)]),
      );
    return value;
  }
  const state = encode(data);
  entries.unshift({
    name: "project.json",
    data: new TextEncoder().encode(
      JSON.stringify({
        format: "sample-one-project",
        version: 1,
        app,
        buffers,
        state,
      }),
    ),
  });
  return buildZip(entries);
}

export function importProject(
  bytes: Uint8Array,
  app: "sampler" | "player",
  context: BaseAudioContext,
): any {
  const entries = readStoredZip(bytes),
    files = new Map(entries.map((entry) => [entry.name, entry.data]));
  const json = files.get("project.json");
  if (!json) throw new Error("This ZIP does not contain a SAMPLE/ONE project.");
  const manifest = JSON.parse(new TextDecoder().decode(json));
  if (
    manifest.format !== "sample-one-project" ||
    manifest.version !== 1 ||
    manifest.app !== app ||
    !Array.isArray(manifest.buffers) ||
    !manifest.state ||
    typeof manifest.state !== "object"
  )
    throw new Error(`This is not a compatible ${app} project.`);
  const buffers = manifest.buffers.map((item: AudioRecord, i: number) => {
    if (
      item.name !== `audio/${i}.f32` ||
      !Number.isInteger(item.channels) ||
      item.channels < 1 ||
      item.channels > 32 ||
      !Number.isInteger(item.length) ||
      item.length < 1 ||
      !Number.isInteger(item.sampleRate) ||
      item.sampleRate < 3000 ||
      item.sampleRate > 384000
    )
      throw new Error("Invalid project audio metadata.");
    const bytes = files.get(item.name);
    if (!bytes || bytes.byteLength !== item.length * item.channels * 4)
      throw new Error("Project audio is missing or incomplete.");
    const buffer = context.createBuffer(
        item.channels,
        item.length,
        item.sampleRate,
      ),
      samples = new Float32Array(bytes.slice().buffer);
    for (let c = 0; c < item.channels; c++)
      buffer.copyToChannel(
        samples.subarray(c * item.length, (c + 1) * item.length),
        c,
      );
    return buffer;
  });
  function decode(value: any): any {
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "$audio")) {
        if (!Number.isInteger(value.$audio) || !buffers[value.$audio])
          throw new Error("Invalid project audio reference.");
        return buffers[value.$audio];
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, decode(v)]),
      );
    }
    return value;
  }
  return decode(manifest.state);
}
export function downloadProject(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
