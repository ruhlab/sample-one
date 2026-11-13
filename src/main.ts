import { setupSliderReset } from "./features/slider-reset.ts";
import { state } from "./state.ts";
import { createEditorFeature } from "./features/editor.ts";
import { createChopFeature } from "./features/chop.ts";
import { assets } from "./assets.ts";
import { createCaptureFeature } from "./features/capture.ts";
import { calculatePeaks } from "./features/peaks.ts";
import { createFxChain } from "./features/fx-chain.ts";
import { createWaveformFeature } from "./features/waveform.ts";
import { createPlayFeature } from "./features/play.ts";
import { estimateBpm } from "./audio/tempo.ts";
import { stretchPitch } from "./audio/stretch.ts";
import { encodeWav } from "./audio/wav.ts";
import { buildZip } from "./audio/zip.ts";
import {
  exportProject,
  importProject,
  downloadProject,
} from "./audio/project.ts";
import {
  createEqStage,
  setEqStage,
  createReverbStage,
  setReverbStage,
  createDelayStage,
  setDelayStage,
  createDistortionStage,
  setDistortionStage,
  createCompressorStage,
  setCompressorStage,
} from "./audio/effect-stages.ts";
/* Sample/One: client-side, single-sample capture and editing workstation. */
("use strict");

const $ = (id: string): any => document.getElementById(id);
const els = Object.fromEntries(
  [
    "sourceBadge",
    "sourceLabel",
    "connectTab",
    "connectInput",
    "disconnect",
    "inputDevices",
    "inputHint",
    "levelFill",
    "dbLevel",
    "recordBtn",
    "recordLabel",
    "playBtn",
    "playSelectionBtn",
    "stopBtn",
    "loopBtn",
    "recMessage",
    "counter",
    "importBtn",
    "exampleBtn",
    "exportBtn",
    "fileInput",
    "waveCanvas",
    "emptyWave",
    "formatLabel",
    "zoom",
    "zoomLabel",
    "viewScroll",
    "durationStat",
    "startStat",
    "endStat",
    "rangeStat",
    "sampleName",
    "inBtn",
    "outBtn",
    "allBtn",
    "cropBtn",
    "deleteBtn",
    "normalizeBtn",
    "undoBtn",
    "exportSelectionBtn",
    "transientBtn",
    "splitBtn",
    "selectionStart",
    "selectionEnd",
    "reverseBtn",
    "silenceBtn",
    "chopCount",
    "customChopsBtn",
    "transientSensitivity",
    "sensitivityValue",
    "sliceInspector",
    "sliceStart",
    "sliceEnd",
    "auditionSliceBtn",
    "chopUndoBtn",
    "addSliceBtn",
    "clearSlicesBtn",
    "sliceCount",
    "slices",
    "exportZipBtn",
    "dropOverlay",
    "toast",
  ].map((key) => [key, $(key)]),
);
const canvas = els.waveCanvas;
const ctx = canvas.getContext("2d", { alpha: false });
const MAX_RECORD_MS = 180_000;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const duration = () => (state.buffer ? state.buffer.duration : 0);
const secs = (v) => `${(Number.isFinite(v) ? v : 0).toFixed(2)} s`;
function clock(seconds) {
  const cs = Math.max(0, Math.floor(seconds * 100));
  return `${String(Math.floor(cs / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
function toast(message) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3900);
}
async function audioContext() {
  if (!state.ctx || state.ctx.state === "closed")
    state.ctx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
  if (state.ctx.state === "suspended") await state.ctx.resume();
  return state.ctx;
}
function updateUI() {
  const has = Boolean(state.buffer);
  const source = Boolean(state.sourceStream);
  const recording = state.recorder?.state === "recording";
  const busy = recording || state.recordBusy || state.processing;
  const playing = Boolean(state.playing);
  const span = has
    ? Math.max(0, state.selection.end - state.selection.start)
    : 0;
  els.sourceBadge.classList.toggle("connected", source && !recording);
  els.sourceBadge.classList.toggle("rec-live", recording);
  els.sourceLabel.textContent = recording
    ? "Recording audio"
    : source
      ? state.sourceLabel
      : "Source disconnected";
  els.recordBtn.disabled = (!source && !recording) || state.recordBusy;
  els.recordBtn.classList.toggle("recording", recording);
  els.recordLabel.textContent = recording ? "Stop recording" : "Record sample";
  els.connectTab.disabled = busy;
  els.connectInput.disabled = busy;
  els.inputDevices.disabled = busy;
  els.disconnect.disabled = !source || busy;
  els.playBtn.disabled = !has || busy;
  els.playSelectionBtn.disabled = !has || busy || span < 0.01;
  els.stopBtn.disabled =
    !playing && !recording && !state.fxPreview && !state.fxPreviewStarting;
  document
    .querySelectorAll<HTMLButtonElement>("[data-process]")
    .forEach((button) => (button.disabled = !has || busy));
  els.exportBtn.disabled = !has || busy;
  els.exampleBtn.disabled = busy;
  els.importBtn.disabled = busy;
  els.exportSelectionBtn.disabled = !has || busy || span < 0.01;
  els.zoom.disabled = !has;
  $("bpm").disabled = busy;
  $("detectBpm").disabled = !has || busy || state.bpmDetecting;
  els.inBtn.disabled = !has || busy;
  els.outBtn.disabled = !has || busy;
  els.allBtn.disabled = !has || busy;
  els.cropBtn.disabled = !has || busy || span < 0.01;
  els.deleteBtn.disabled =
    !has || busy || span < 0.01 || span >= duration() - 0.005;
  els.normalizeBtn.disabled = !has || busy;
  for (const input of [$("timelineLength"), $("soundStart"), $("soundLength")])
    input.disabled = !has || busy;
  if (has && state.placement) {
    const ratio = duration() / state.fxBase.duration;
    if (document.activeElement !== $("timelineLength"))
      $("timelineLength").value = duration().toFixed(3);
    if (document.activeElement !== $("soundStart"))
      $("soundStart").value = (
        (state.placement.start / state.fxBase.sampleRate) *
        ratio
      ).toFixed(3);
    if (document.activeElement !== $("soundLength"))
      $("soundLength").value = (
        ((state.placement.end - state.placement.start) /
          state.fxBase.sampleRate) *
        ratio
      ).toFixed(3);
  } else if (!has) {
    $("timelineLength").value = "";
    $("soundStart").value = "";
    $("soundLength").value = "";
  }
  for (const input of [els.selectionStart, els.selectionEnd]) {
    input.disabled = !has || busy;
    input.max = String(duration());
  }
  if (document.activeElement !== els.selectionStart)
    els.selectionStart.value = has ? state.selection.start.toFixed(3) : "";
  if (document.activeElement !== els.selectionEnd)
    els.selectionEnd.value = has ? state.selection.end.toFixed(3) : "";
  for (const button of [els.reverseBtn, els.silenceBtn])
    button.disabled = !has || busy || span < 0.01;
  $("fxAdd").disabled = !has || busy;
  $("fxApplyChainBtn").disabled =
    !has || busy || state.fxRenderPending || Boolean(state.fxRenderError);
  $("fxDiscardBtn").disabled = !has || busy;
  $("fxResetBtn").disabled = !has || busy;
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "#fxList input, #fxList select, #fxList button",
    )
    .forEach((el) => (el.disabled = !has || busy));
  els.customChopsBtn.disabled = !has || busy;
  els.chopCount.disabled = !has || busy;
  els.undoBtn.disabled = !state.undo.length || busy;
  els.chopUndoBtn.disabled = !state.undo.length || busy;
  els.transientSensitivity.disabled = !has || busy;
  els.transientBtn.disabled = !has || busy;
  els.splitBtn.disabled = !has || busy;
  els.addSliceBtn.disabled = !has || busy || span < 0.01;
  els.clearSlicesBtn.disabled = !state.slices.length || busy;
  els.exportZipBtn.disabled = !state.slices.length || busy;
  document
    .querySelectorAll<HTMLButtonElement>("[data-chops]")
    .forEach((el) => (el.disabled = !has || busy));
  els.emptyWave.style.display = has || recording ? "none" : "flex";
  els.durationStat.textContent = secs(duration());
  els.startStat.textContent = secs(has ? state.selection.start : 0);
  els.endStat.textContent = secs(has ? state.selection.end : 0);
  els.rangeStat.textContent = secs(span);
  els.formatLabel.textContent = has
    ? `${state.buffer.sampleRate.toLocaleString()} Hz · ${state.buffer.numberOfChannels === 1 ? "Mono" : state.buffer.numberOfChannels === 2 ? "Stereo" : state.buffer.numberOfChannels + " ch"} · ${clock(duration())}`
    : "No audio loaded";
  els.sliceCount.textContent = String(state.slices.length);
  els.recMessage.textContent = recording
    ? "Capturing live audio…"
    : source
      ? "Source ready · press Record"
      : "Connect a source to record";
  els.zoomLabel.textContent = `${state.zoom}×`;
  els.viewScroll.classList.toggle("hidden", !has || state.zoom === 1);
}

function snapshot() {
  if (!state.buffer) return;
  state.undo.push({
    buffer: state.buffer,
    fxBase: state.fxBase,
    fxChain: structuredClone(state.fxChain),
    fxDraft: structuredClone(state.fxDraft),
    bpm: state.bpm,
    tempoRate: state.tempoRate,
    placement: state.placement ? { ...state.placement } : null,
    name: state.name,
    slices: state.slices.map((s) => ({ ...s })),
    selection: { ...state.selection },
    cursor: state.cursor,
  });
  if (state.undo.length > 8) state.undo.shift();
}
function stopPlayback() {
  if (state.playing) {
    const item = state.playing;
    state.playing = null;
    try {
      item.node.onended = null;
      item.node.stop(0);
    } catch {}
    try {
      item.node.disconnect();
      item.gain.disconnect();
    } catch {}
    updateUI();
  }
}
function updatePeaks() {
  state.peaks = state.buffer ? calculatePeaks(state.buffer) : null;
}

function loadSample(buffer, name) {
  stopPads();
  state.padConfig.clear();
  state.bank = 0;
  state.selectedSliceId = null;
  state.selectedSliceEdge = null;
  stopPlayback();
  stopEffectPreview();
  clearTimeout(state.fxPreviewTimer);
  state.originalBuffer = buffer;
  state.fxBase = buffer;
  state.fxChain = [];
  state.fxDraft = [];
  state.fxRendered = null;
  state.fxRenderVersion++;
  state.fxRenderPending = false;
  state.fxRenderError = null;
  $("fxStatus").textContent = "";
  state.bpm = 120;
  state.tempoRate = 1;
  state.bpmGeneration++;
  state.bpmDetecting = false;
  $("bpm").value = "120";
  setDetectBpmLabel(false);
  state.buffer = buffer;
  state.placement = { start: 0, end: buffer.length };
  setResampleRate(buffer.sampleRate);
  syncEffectControls();
  state.name = name || "Untitled sample";
  els.sampleName.value = state.name;
  state.selection = { start: 0, end: buffer.duration };
  state.cursor = 0;
  state.slices = [];
  state.nextId = 1;
  state.undo = [];
  state.zoom = 1;
  state.viewFraction = 0;
  els.zoom.value = "1";
  els.viewScroll.value = "0";
  updatePeaks();
  renderSlices();
  updateUI();
  els.counter.textContent = clock(buffer.duration);
  setTimeout(() => {
    if (state.buffer === buffer) detectTempo(true);
  }, 0);
}
function range(): [number, number] {
  return [
    clamp(state.selection.start, 0, duration()),
    clamp(state.selection.end, 0, duration()),
  ];
}
function selectRange(start, end) {
  const d = duration();
  state.selection = {
    start: clamp(Math.min(start, end), 0, d),
    end: clamp(Math.max(start, end), 0, d),
  };
  updateUI();
}
async function playRange(
  start,
  end,
  options: { slice?: any; offset?: number; transport?: boolean } = {},
) {
  if (!state.buffer) return;
  stopEffectPreview();
  stopPlayback();
  start = clamp(start, 0, duration());
  end = clamp(end, 0, duration());
  if (end - start < 0.005) return;
  try {
    const ac = await audioContext();
    const node = ac.createBufferSource();
    node.buffer = options.slice ? sliceBuffer(options.slice) : state.buffer;
    const gain = ac.createGain();
    gain.gain.value = 0.86;
    node.connect(gain);
    gain.connect(ac.destination);
    const offset = clamp(options.offset ?? start, start, end - 0.001);
    const loop = Boolean(options.transport && state.transportLoop);
    const item = {
      node,
      gain,
      start,
      end,
      offset,
      loop,
      transport: Boolean(options.transport),
      startedAt: ac.currentTime,
    };
    state.playing = item;
    state.cursor = offset;
    node.onended = () => {
      if (state.playing === item) {
        state.cursor = end;
        state.playing = null;
        try {
          node.disconnect();
          gain.disconnect();
        } catch {}
        updateUI();
      }
    };
    const bufferOffset = options.slice ? offset - start : offset;
    if (loop) {
      node.loop = true;
      node.loopStart = options.slice ? 0 : start;
      node.loopEnd = options.slice ? node.buffer.duration : end;
      node.start(0, bufferOffset);
    } else
      node.start(
        0,
        bufferOffset,
        Math.min(end - offset, node.buffer.duration - bufferOffset),
      );
    updateUI();
  } catch (error) {
    toast(error.message || "Cannot play this audio.");
  }
}
function playTransport(start, end) {
  if (state.tab === "editor") {
    stopEffectPreview();
    startEffectPreview(start, end);
  } else playRange(start, end, { transport: true });
}
function livePlayhead() {
  if (state.fxPreview)
    return previewPosition(state.fxPreview) / state.fxPreview.ratio;
  if (!state.playing) return state.cursor;
  const item = state.playing,
    elapsed = Math.max(0, state.ctx.currentTime - item.startedAt);
  if (item.loop)
    return (
      item.start +
      ((item.offset - item.start + elapsed) % (item.end - item.start))
    );
  return Math.min(item.end, item.offset + elapsed);
}
function extractBuffer(input, start, end) {
  const a = clamp(Math.floor(start * input.sampleRate), 0, input.length);
  const b = clamp(Math.ceil(end * input.sampleRate), a + 1, input.length);
  const out = state.ctx.createBuffer(
    input.numberOfChannels,
    b - a,
    input.sampleRate,
  );
  for (let c = 0; c < input.numberOfChannels; c++)
    out.getChannelData(c).set(input.getChannelData(c).subarray(a, b));
  return out;
}
function setResampleRate(rate) {
  const select =
    $("resampleRate") || fxTemplates.quality?.querySelector("#resampleRate");
  if (!select) return;
  if (![...select.options].some((option) => Number(option.value) === rate)) {
    const option = document.createElement("option");
    option.value = String(rate);
    option.textContent = String(rate);
    select.appendChild(option);
  }
  select.value = String(rate);
}
async function convertSampleRate(input, targetRate, taps) {
  if (targetRate === input.sampleRate) return input;
  const channels = Array.from({ length: input.numberOfChannels }, (_, c) =>
    input.getChannelData(c).slice(),
  );
  const worker = new Worker(assets.resampler);
  try {
    const data = await new Promise<Float32Array[]>((resolve, reject) => {
      worker.onmessage = (event) =>
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data.channels);
      worker.onerror = (event) =>
        reject(new Error(event.message || "Resampler failed."));
      worker.postMessage(
        { channels, sourceRate: input.sampleRate, targetRate, taps },
        channels.map((channel) => channel.buffer),
      );
    });
    const out = state.ctx.createBuffer(
      input.numberOfChannels,
      data[0].length,
      targetRate,
    );
    for (let c = 0; c < data.length; c++) out.getChannelData(c).set(data[c]);
    return out;
  } finally {
    worker.terminate();
  }
}
function sliceBuffer(slice) {
  const input = state.buffer,
    sr = input.sampleRate,
    a = clamp(Math.floor(slice.start * sr), 0, input.length - 1),
    b = clamp(Math.ceil(slice.end * sr), a + 1, input.length),
    length = b - a,
    out = state.ctx.createBuffer(input.numberOfChannels, length, sr);
  const fadeIn = Math.min(length, Math.round((slice.fadeIn || 0) * sr)),
    fadeOut = Math.min(length, Math.round((slice.fadeOut || 0) * sr));
  for (let c = 0; c < input.numberOfChannels; c++) {
    const src = input.getChannelData(c),
      dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const inGain = fadeIn > 0 ? Math.min(1, i / Math.max(1, fadeIn - 1)) : 1,
        outGain =
          fadeOut > 0
            ? Math.min(1, (length - 1 - i) / Math.max(1, fadeOut - 1))
            : 1;
      dst[i] = src[a + i] * Math.min(inGain, outGain);
    }
  }
  return out;
}
function previewPosition(preview) {
  const elapsed = Math.max(0, preview.ac.currentTime - preview.startedAt),
    position = preview.offset + elapsed;
  return preview.loop
    ? preview.start +
        ((position - preview.start) % (preview.end - preview.start))
    : Math.min(preview.end, position);
}
function schedulePreview(preview) {
  const position = livePlayhead(),
    start = preview.uiStart,
    end = preview.uiEnd;
  stopEffectPreview();
  startEffectPreview(start, end, position);
}
async function startEffectPreview(start, end, seek = start) {
  if (!state.fxBase || state.processing) return;
  const generation = ++state.fxPreviewGeneration;
  state.fxPreviewStarting = true;
  updateUI();
  try {
    stopPlayback();
    stopPads();
    const ac = await audioContext(),
      buffer = state.fxRendered || state.buffer;
    if (generation !== state.fxPreviewGeneration || state.tab !== "editor")
      return;
    const ratio = buffer.duration / duration(),
      a = clamp(start * ratio, 0, buffer.duration),
      b = clamp(end * ratio, a, buffer.duration),
      offset = clamp(seek * ratio, a, Math.max(a, b - 0.001));
    if (b - a < 0.005) return;
    const source = ac.createBufferSource(),
      gain = ac.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.86;
    source.connect(gain);
    gain.connect(ac.destination);
    source.loop = state.transportLoop;
    source.loopStart = a;
    source.loopEnd = b;
    const preview = {
      ac,
      source,
      gain,
      start: a,
      end: b,
      offset,
      origin: 0,
      startedAt: ac.currentTime,
      loop: state.transportLoop,
      uiStart: start,
      uiEnd: end,
      ratio,
    };
    state.fxPreview = preview;
    source.onended = () => {
      if (state.fxPreview === preview) {
        state.cursor = end;
        stopEffectPreview();
      }
    };
    if (source.loop) source.start(0, offset);
    else source.start(0, offset, b - offset);
  } catch (error) {
    toast(`Unable to play effects: ${error.message}`);
  } finally {
    state.fxPreviewStarting = false;
    updateUI();
  }
}
function stopEffectPreview() {
  state.fxPreviewGeneration++;
  const preview = state.fxPreview;
  if (!preview) return;
  state.fxPreview = null;
  try {
    preview.source.onended = null;
    preview.source.stop();
    preview.source.disconnect();
    preview.gain.disconnect();
  } catch {}
  updateUI();
}
const vinylModules = new WeakMap();
async function createVinylProcessor(ac, channels, p) {
  if (!vinylModules.has(ac))
    vinylModules.set(
      ac,
      ac.audioWorklet.addModule(assets.vinyl).catch((error) => {
        vinylModules.delete(ac);
        throw error;
      }),
    );
  await vinylModules.get(ac);
  const node = new AudioWorkletNode(ac, "sample-one-vinyl", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    channelCount: channels,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  for (const [name, value] of Object.entries({
    comp: p.vinylComp ?? 0.6,
    noise: p.vinylNoise ?? 0,
    wow: p.vinylWow ?? 0,
    level: p.vinylLevel ?? 0.8,
    mix: p.mix ?? 1,
  }))
    node.parameters.get(name).value = value;
  return node;
}
async function renderEffect(input, a, b, kind, p) {
  if (
    (kind === "reverb" || kind === "delay" || kind === "distortion") &&
    input.numberOfChannels > 2
  )
    throw new Error(
      "Reverb, delay and distortion support mono or stereo samples.",
    );
  const sr = input.sampleRate,
    length = b - a,
    channels =
      kind === "reverb" || kind === "delay" || kind === "distortion"
        ? 2
        : input.numberOfChannels,
    offline = new OfflineAudioContext(channels, length, sr);
  const part = offline.createBuffer(input.numberOfChannels, length, sr);
  for (let c = 0; c < input.numberOfChannels; c++)
    part.getChannelData(c).set(input.getChannelData(c).subarray(a, b));
  const source = offline.createBufferSource();
  source.buffer = part;
  if (kind === "eq") {
    const node = createEqStage(offline);
    setEqStage(offline, node, { enabled: true, settings: p }, false);
    source.connect(node.input);
    node.output.connect(offline.destination);
  } else if (kind === "reverb" || kind === "delay") {
    const node =
      kind === "reverb"
        ? createReverbStage(offline)
        : createDelayStage(offline);
    if (kind === "reverb")
      setReverbStage(offline, node, { enabled: true, settings: p }, false);
    else setDelayStage(offline, node, { enabled: true, settings: p }, false);
    source.connect(node.input);
    node.output.connect(offline.destination);
  } else if (kind === "distortion") {
    const node = await createDistortionStage(offline);
    setDistortionStage(offline, node, { enabled: true, settings: p }, false);
    source.connect(node.input);
    node.output.connect(offline.destination);
  } else if (kind === "compressor" && p.type === "vinyl303") {
    const node = await createVinylProcessor(offline, channels, p);
    // Public spectral observations suggest a broad midrange lift and rolled-off highs.
    const mid = offline.createBiquadFilter(),
      high = offline.createBiquadFilter(),
      air = offline.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = Math.min(1400, sr * 0.45);
    mid.Q.value = 0.9;
    mid.gain.value = 3;
    high.type = "lowpass";
    high.frequency.value = Math.min(9000, sr * 0.45);
    high.Q.value = 0.7;
    air.type = "lowpass";
    air.frequency.value = Math.min(6500, sr * 0.45);
    air.Q.value = 0.5;
    source.connect(node, 0, 0);
    source.connect(mid).connect(high).connect(air).connect(node, 0, 1);
    node.connect(offline.destination);
  } else {
    const node = createCompressorStage(offline);
    setCompressorStage(offline, node, { enabled: true, settings: p }, false);
    source.connect(node.input);
    node.output.connect(offline.destination);
  }
  source.start();
  return offline.startRendering();
}
function normalize() {
  return editSource("normalize");
}
function undo() {
  const item = state.undo.pop();
  if (!item) return;
  stopPlayback();
  Object.assign(state, {
    buffer: item.buffer,
    fxBase: item.fxBase,
    fxChain: item.fxChain,
    bpm: item.bpm ?? 120,
    tempoRate: item.tempoRate ?? 1,
    placement: item.placement
      ? { ...item.placement }
      : { start: 0, end: item.fxBase.length },
    name: item.name,
    slices: item.slices,
    selection: item.selection,
    cursor: item.cursor,
  });
  stopEffectPreview();
  state.fxDraft = structuredClone(item.fxDraft || state.fxChain);
  state.fxRendered = null;
  syncEffectControls();
  queueFxRender();
  state.bpmGeneration++;
  state.bpmDetecting = false;
  $("bpm").value = String(state.bpm);
  setDetectBpmLabel(false);
  els.sampleName.value = state.name;
  state.zoom = 1;
  state.viewFraction = 0;
  els.zoom.value = 1;
  els.viewScroll.value = 0;
  updatePeaks();
  renderSlices();
  updateUI();
  toast("Last edit undone.");
}

function wavBytes(buffer, start = 0, end = buffer.duration) {
  return encodeWav(buffer, start, end, {
    mono: $("exportChannels").value === "mono",
    depth: Number($("exportDepth").value) as 8 | 16 | 24 | 32,
  });
}
function safeName(value) {
  return (
    (value || "sample")
      .replace(/[^\w .-]+/g, "-")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 65) || "sample"
  );
}
function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function exportWav(
  start = 0,
  end = duration(),
  name = state.name,
  slice = null,
) {
  if (!state.buffer) return;
  try {
    const bytes = slice
      ? wavBytes(sliceBuffer(slice))
      : wavBytes(state.buffer, start, end);
    download(bytes, `${safeName(name)}.wav`, "audio/wav");
  } catch (error) {
    toast(`Export failed: ${error.message}`);
  }
}
function exportSlicesZip() {
  if (!state.buffer || !state.slices.length) return;
  try {
    const entries = state.slices.map((s, i) => ({
      name: `${String(i + 1).padStart(2, "0")}-${safeName(s.name)}.wav`,
      data: wavBytes(sliceBuffer(s)),
    }));
    download(
      buildZip(entries),
      `${safeName(state.name)}-slices.zip`,
      "application/zip",
    );
    toast(`Exported ${entries.length} WAV slices as ZIP.`);
  } catch (error) {
    toast(`Unable to export slices: ${error.message}`);
  }
}

async function importAudio(file) {
  if (!file) return;
  if (
    !/\.(wav|mp3|m4a|aac|flac|ogg|webm|aiff?|opus)$/i.test(file.name) &&
    !file.type.startsWith("audio/")
  ) {
    toast("Choose an audio file (WAV, MP3, FLAC, OGG, M4A, or similar).");
    return;
  }
  try {
    const ac = await audioContext();
    const buffer = await ac.decodeAudioData(await file.arrayBuffer());
    loadSample(buffer, file.name.replace(/\.[^.]+$/, ""));
    toast(`Loaded ${file.name}. Drag across the waveform to select a region.`);
  } catch (error) {
    toast(`The browser could not decode this file: ${error.message}`);
  }
  els.fileInput.value = "";
}

// Estimate tempo from the autocorrelation of an energy-onset envelope.
// Tempo and beat phase are separate: the displayed grid always starts at timeline zero.
function setDetectBpmLabel(loading) {
  const button = $("detectBpm");
  const label = loading ? "Detecting BPM…" : "Detect BPM";
  button.title = label;
  button.setAttribute("aria-label", label);
}
async function detectTempo(automatic = false) {
  if (!state.buffer || state.processing) return;
  const buffer = state.buffer,
    generation = ++state.bpmGeneration,
    button = $("detectBpm");
  state.bpmDetecting = true;
  button.disabled = true;
  setDetectBpmLabel(true);
  try {
    const bpm = await estimateBpm(
      buffer,
      () => state.buffer === buffer && state.bpmGeneration === generation,
    );
    if (
      bpm === null ||
      state.buffer !== buffer ||
      state.bpmGeneration !== generation
    )
      return;
    state.bpm = bpm;
    $("bpm").value = String(bpm);
    toast(`Estimated ${bpm} BPM. Adjust manually if needed.`);
  } catch (error) {
    if (state.bpmGeneration === generation)
      toast(
        automatic
          ? "Could not detect BPM; using 120. " + error.message
          : error.message,
      );
  } finally {
    if (state.bpmGeneration === generation) {
      state.bpmDetecting = false;
      setDetectBpmLabel(false);
      updateUI();
    }
  }
}
async function setTempo(value) {
  state.bpmGeneration++;
  state.bpmDetecting = false;
  setDetectBpmLabel(false);
  if (!Number.isFinite(value) || value < 40 || value > 240) {
    $("bpm").value = String(state.bpm);
    toast("Enter a BPM between 40 and 240.");
    updateUI();
    return;
  }
  if (!state.buffer) {
    state.bpm = value;
    updateUI();
    return;
  }
  if (state.processing || Math.abs(value - state.bpm) < 1e-9) {
    $("bpm").value = String(state.bpm);
    updateUI();
    return;
  }
  if (!state.tempoChangesSpeed) {
    snapshot();
    state.bpm = value;
    $("bpm").value = String(value);
    updateUI();
    return;
  }
  const base = state.fxBase,
    oldBuffer = state.buffer,
    newRate = (state.tempoRate * value) / state.bpm;
  stopEffectPreview();
  stopPlayback();
  stopPads();
  clearTimeout(state.fxPreviewTimer);
  state.fxRenderVersion++;
  state.fxRenderPending = false;
  state.processing = true;
  updateUI();
  try {
    const output = await renderChain(
      base,
      structuredClone(state.fxChain),
      newRate,
    );
    if (state.fxBase !== base || state.buffer !== oldBuffer)
      throw new Error("The sample changed while processing.");
    const scale = output.duration / oldBuffer.duration;
    snapshot();
    state.buffer = output;
    state.tempoRate = newRate;
    state.bpm = value;
    state.fxRendered = null;
    for (const slice of state.slices) {
      slice.start *= scale;
      slice.end *= scale;
    }
    state.selection = {
      start: state.selection.start * scale,
      end: state.selection.end * scale,
    };
    state.cursor *= scale;
    updatePeaks();
    renderSlices();
    toast(`Tempo set to ${value} BPM.`);
  } catch (error) {
    toast(`Unable to change tempo: ${error.message}`);
  } finally {
    $("bpm").value = String(state.bpm);
    state.processing = false;
    queueFxRender();
    updateUI();
  }
}
function wirePairedControl(id, onChange = () => {}) {
  const input = $(id),
    slider = $(id + "Slider");
  slider.addEventListener("input", () => {
    const step = Number(input.step) || 1,
      min = Number(input.min),
      rounded = min + Math.round((Number(slider.value) - min) / step) * step;
    input.value = String(
      Math.round(clamp(rounded, min, Number(input.max)) * 1000) / 1000,
    );
    slider.value = input.value;
    onChange();
  });
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (
      input.value !== "" &&
      Number.isFinite(value) &&
      value >= Number(input.min) &&
      value <= Number(input.max)
    ) {
      slider.value = input.value;
      onChange();
    }
  });
  input.addEventListener("change", () => {
    const value = Number(input.value);
    input.value =
      input.value !== "" && Number.isFinite(value)
        ? String(clamp(value, Number(input.min), Number(input.max)))
        : slider.value;
    slider.value = input.value;
    onChange();
  });
}
function wireEvents() {
  document.addEventListener("dblclick", (event) => {
    const slider = event.target;
    if (
      !(slider instanceof HTMLInputElement) ||
      slider.type !== "range" ||
      slider.disabled
    )
      return;
    slider.value = slider.defaultValue;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  els.connectTab.addEventListener("click", connectTab);
  els.connectInput.addEventListener("click", () => connectInput());
  els.inputDevices.addEventListener("change", () =>
    connectInput(els.inputDevices.value),
  );
  els.disconnect.addEventListener("click", releaseSource);
  els.recordBtn.addEventListener("click", toggleRecording);
  els.playBtn.addEventListener("click", () => playTransport(0, duration()));
  els.playSelectionBtn.addEventListener("click", () =>
    playTransport(...range()),
  );
  els.loopBtn.addEventListener("click", () => {
    const item = state.playing,
      offset = item?.transport ? livePlayhead() : null;
    state.transportLoop = !state.transportLoop;
    els.loopBtn.setAttribute("aria-pressed", String(state.transportLoop));
    if (state.fxPreview) schedulePreview(state.fxPreview);
    else if (item?.transport)
      playRange(item.start, item.end, { transport: true, offset });
  });
  els.stopBtn.addEventListener("click", () => {
    if (state.recorder?.state === "recording") stopRecording();
    stopEffectPreview();
    stopPlayback();
  });
  els.importBtn.addEventListener("click", () => els.fileInput.click());
  els.exampleBtn.addEventListener("click", async () => {
    try {
      const response = await fetch(assets.example);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await importAudio(
        new File([await response.blob()], "drum.wav", { type: "audio/wav" }),
      );
    } catch (error) {
      toast(`Could not load example: ${error.message}`);
    }
  });
  els.fileInput.addEventListener("change", () =>
    importAudio(els.fileInput.files?.[0]),
  );
  els.exportBtn.addEventListener("click", () => exportWav());
  els.exportSelectionBtn.addEventListener("click", () =>
    exportWav(...range(), `${state.name}-selection`),
  );
  els.sampleName.addEventListener("input", () => {
    state.name = els.sampleName.value || "Untitled sample";
  });
  els.inBtn.addEventListener("click", () =>
    selectRange(
      Math.min(state.cursor, state.selection.end),
      state.selection.end,
    ),
  );
  els.outBtn.addEventListener("click", () =>
    selectRange(
      state.selection.start,
      Math.max(state.cursor, state.selection.start),
    ),
  );
  els.allBtn.addEventListener("click", () => selectRange(0, duration()));
  els.cropBtn.addEventListener("click", crop);
  els.deleteBtn.addEventListener("click", deleteRegion);
  els.normalizeBtn.addEventListener("click", normalize);
  $("fxResetBtn").addEventListener("click", () => {
    state.fxDraft = [];
    syncEffectControls();
    queueFxRender();
  });
  $("fxApplyChainBtn").addEventListener("click", commitEffectChain);
  $("fxDiscardBtn").addEventListener("click", () => {
    state.fxDraft = structuredClone(state.fxChain);
    syncEffectControls();
    queueFxRender();
  });
  for (const [button, mode] of [
    [els.reverseBtn, "reverse"],
    [els.silenceBtn, "silence"],
  ])
    button.addEventListener("click", () => processSelection(mode));
  for (const [input, edge] of [
    [els.selectionStart, "start"],
    [els.selectionEnd, "end"],
  ])
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!state.buffer || input.value === "" || !Number.isFinite(value)) {
        input.value = state.buffer ? state.selection[edge].toFixed(3) : "";
        return;
      }
      const time = clamp(value, 0, duration());
      if (edge === "start")
        selectRange(Math.min(time, state.selection.end), state.selection.end);
      else
        selectRange(
          state.selection.start,
          Math.max(time, state.selection.start),
        );
      input.value = state.selection[edge].toFixed(3);
    });
  $("exportDepth").addEventListener("change", updateUI);
  $("exportChannels").addEventListener("change", updateUI);
  for (const edge of ["In", "Out"]) {
    const id = "sliceFade" + edge;
    wirePairedControl(id);
    for (const control of [$(id), $(id + "Slider")])
      control.addEventListener("change", () => {
        const slice = selectedSlice();
        if (!slice) return;
        const value =
          clamp(
            Number($(id).value) || 0,
            0,
            slice.end - slice.start > 0 ? (slice.end - slice.start) * 1000 : 0,
          ) / 1000;
        if (Math.abs((slice["fade" + edge] || 0) - value) > 1e-9) {
          snapshot();
          slice["fade" + edge] = value;
        }
      });
  }
  els.customChopsBtn.addEventListener("click", () => {
    const count = Number(els.chopCount.value);
    if (!Number.isInteger(count) || count < 2 || count > 128) {
      toast("Choose a slice count from 2 to 128.");
      return;
    }
    equalChops(count);
  });
  els.undoBtn.addEventListener("click", undo);
  els.chopUndoBtn.addEventListener("click", undo);
  els.transientSensitivity.addEventListener("input", () => {
    els.sensitivityValue.textContent = `${els.transientSensitivity.value}%`;
  });
  els.auditionSliceBtn.addEventListener("click", () => {
    const slice = selectedSlice();
    if (slice) playRange(slice.start, slice.end, { slice });
  });
  for (const [input, edge] of [
    [els.sliceStart, "start"],
    [els.sliceEnd, "end"],
  ])
    input.addEventListener("change", () => {
      const slice = selectedSlice(),
        value = Number(input.value);
      if (!slice || input.value === "" || !Number.isFinite(value)) {
        if (slice) input.value = slice[edge].toFixed(3);
        return;
      }
      if (Math.abs(value - slice[edge]) < 1e-9) {
        input.value = slice[edge].toFixed(3);
        return;
      }
      const linked = linkedBoundaries(slice[edge]);
      snapshot();
      stopPlayback();
      state.cursor = moveBoundaries(linked, value);
      state.selectedSliceEdge = edge;
      state.slices.sort((a, b) => a.start - b.start);
      input.value = slice[edge].toFixed(3);
      renderSlices();
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-chops]")
    .forEach((el) =>
      el.addEventListener("click", () => equalChops(Number(el.dataset.chops))),
    );
  els.addSliceBtn.addEventListener("click", addSlice);
  els.splitBtn.addEventListener("click", splitAtCursor);
  els.transientBtn.addEventListener("click", transientChops);
  els.clearSlicesBtn.addEventListener("click", () => {
    if (state.slices.length) {
      snapshot();
      state.slices = [];
      renderSlices();
    }
  });
  els.exportZipBtn.addEventListener("click", exportSlicesZip);
  els.zoom.addEventListener("input", () => {
    const previous = viewport(),
      [start, end] = range(),
      d = duration();
    const hasRegion = end - start > 0.01 && end - start < d - 0.005;
    const anchor = hasRegion ? (start + end) / 2 : clamp(state.cursor, 0, d);
    const position =
      anchor >= previous.start && anchor <= previous.end
        ? (anchor - previous.start) / previous.width
        : 0.5;
    state.zoom = Number(els.zoom.value);
    const width = d / state.zoom,
      available = d - width;
    state.viewFraction =
      available > 0 ? clamp((anchor - position * width) / available, 0, 1) : 0;
    els.viewScroll.value = String(Math.round(state.viewFraction * 1000));
    updateUI();
  });
  els.viewScroll.addEventListener("input", () => {
    state.viewFraction = Number(els.viewScroll.value) / 1000;
  });
  $("bpm").addEventListener("change", () => {
    const input = $("bpm");
    setTempo(input.value === "" ? NaN : Number(input.value));
  });
  $("detectBpm").addEventListener("click", () => detectTempo());
  $("tempoSpeedToggle").addEventListener("click", () => {
    state.tempoChangesSpeed = !state.tempoChangesSpeed;
    $("tempoSpeedToggle").setAttribute(
      "aria-pressed",
      String(state.tempoChangesSpeed),
    );
  });
  $("timelineLength").addEventListener("change", () => {
    const input = $("timelineLength");
    if (input.value === "") {
      updateUI();
      return;
    }
    const start =
      ((state.placement.start / state.fxBase.sampleRate) * duration()) /
      state.fxBase.duration;
    setSoundPlacement(Number(input.value), start);
  });
  $("soundStart").addEventListener("change", () => {
    const input = $("soundStart");
    if (input.value === "") {
      updateUI();
      return;
    }
    setSoundPlacement(duration(), Number(input.value));
  });
  $("soundLength").addEventListener("change", () => {
    const input = $("soundLength"),
      value = Number(input.value);
    if (input.value === "" || !Number.isFinite(value) || value < 0.015) {
      toast("Enter a sound length of at least 0.015 seconds.");
      input.value = (
        (((state.placement.end - state.placement.start) /
          state.fxBase.sampleRate) *
          duration()) /
        state.fxBase.duration
      ).toFixed(3);
      return;
    }
    const start =
      ((state.placement.start / state.fxBase.sampleRate) * duration()) /
      state.fxBase.duration;
    stretchSound("end", start + value);
  });
  function markerAt(x, width) {
    const markers = [];
    if (state.tab === "chop") {
      for (const slice of state.slices)
        for (const edge of ["start", "end"])
          markers.push({
            kind: "slice",
            time: slice[edge],
            id: slice.id,
            edge,
          });
    } else if (state.tab === "editor") {
      for (const edge of ["start", "end"])
        markers.push({ kind: "selection", time: state.selection[edge], edge });
    }
    return (
      markers
        .map((marker) => ({
          ...marker,
          distance: Math.abs(xForTime(marker.time, width) - x),
        }))
        .filter((marker) => marker.distance <= 8)
        .sort(
          (a, b) =>
            a.distance - b.distance ||
            Number(b.id === state.selectedSliceId) -
              Number(a.id === state.selectedSliceId),
        )[0] || null
    );
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (!state.buffer || state.processing) return;
    const rect = canvas.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    if (state.tab === "editor" && state.placement && y >= rect.height - 22) {
      const factor =
          duration() / state.fxBase.duration / state.fxBase.sampleRate,
        left = xForTime(state.placement.start * factor, rect.width),
        right = xForTime(state.placement.end * factor, rect.width);
      if (x >= left && x <= right) {
        const clipped =
          state.placement.start < 0 ||
          state.placement.end > state.fxBase.length;
        const leftDistance = Math.abs(x - left),
          rightDistance = Math.abs(x - right);
        const edge =
          Math.min(leftDistance, rightDistance) <= 8
            ? leftDistance <= rightDistance
              ? "start"
              : "end"
            : null;
        state.pointer = {
          kind: "placement",
          edge,
          id: event.pointerId,
          anchorX: x,
          anchorTime: timeAtPixel(x, rect.width),
          delta: 0,
          moved: false,
          clipPeaks:
            (clipped || edge) && state.placement.clip
              ? calculatePeaks(state.placement.clip)
              : null,
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    const marker = markerAt(x, rect.width);
    const linked =
      marker?.kind === "slice" ? linkedBoundaries(marker.time) : [];
    if (marker?.kind === "slice") selectSlice(marker.id, marker.edge);
    state.pointer = {
      id: event.pointerId,
      anchorX: x,
      anchorTime: timeAtPixel(x, rect.width),
      marker,
      linked,
      moved: false,
      snapshotTaken: false,
      originalSelection: { ...state.selection },
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.buffer) return;
    const rect = canvas.getBoundingClientRect(),
      x = event.clientX - rect.left,
      p = state.pointer;
    if (!p) {
      const y = event.clientY - rect.top;
      let cursor = markerAt(x, rect.width) ? "ew-resize" : "crosshair";
      if (state.tab === "editor" && state.placement && y >= rect.height - 22) {
        const factor =
            duration() / state.fxBase.duration / state.fxBase.sampleRate,
          left = xForTime(state.placement.start * factor, rect.width),
          right = xForTime(state.placement.end * factor, rect.width);
        cursor =
          Math.abs(x - left) <= 8 || Math.abs(x - right) <= 8
            ? "ew-resize"
            : x >= left && x <= right
              ? "grab"
              : "crosshair";
      }
      canvas.style.cursor = cursor;
      return;
    }
    if (p.id !== event.pointerId) return;
    if (Math.abs(x - p.anchorX) > 4) p.moved = true;
    if (!p.moved) return;
    const time = timeAtPixel(x, rect.width);
    if (p.kind === "placement") {
      const factor =
        duration() / state.fxBase.duration / state.fxBase.sampleRate;
      if (p.edge) {
        const minLength = 0.015,
          span = (state.placement.end - state.placement.start) * factor;
        p.delta =
          p.edge === "start"
            ? Math.min(time - p.anchorTime, span - minLength)
            : Math.max(time - p.anchorTime, minLength - span);
      } else {
        let min = -state.placement.end * factor + factor,
          max = duration() - state.placement.start * factor - factor;
        for (const slice of state.slices) {
          min = Math.max(min, -slice.start);
          max = Math.min(max, duration() - slice.end);
        }
        p.delta = clamp(time - p.anchorTime, min, max);
      }
      return;
    }
    if (p.marker?.kind === "selection") {
      const t = clamp(p.marker.time + time - p.anchorTime, 0, duration());
      if (p.marker.edge === "start")
        selectRange(Math.min(t, state.selection.end), state.selection.end);
      else
        selectRange(state.selection.start, Math.max(t, state.selection.start));
    } else if (p.marker?.kind === "slice") {
      if (!p.snapshotTaken) {
        snapshot();
        p.snapshotTaken = true;
        stopPlayback();
      }
      state.cursor = moveBoundaries(
        p.linked,
        p.marker.time + time - p.anchorTime,
      );
      const slice = selectedSlice();
      if (slice) {
        els.sliceStart.value = slice.start.toFixed(3);
        els.sliceEnd.value = slice.end.toFixed(3);
      }
    } else {
      selectRange(p.anchorTime, time);
      state.cursor = p.anchorTime;
    }
  });
  const endPointer = (event) => {
    const p = state.pointer;
    if (!p || p.id !== event.pointerId) return;
    if (p.kind === "placement") {
      state.pointer = null;
      if (event.type === "pointerup" && p.moved) {
        const factor =
          duration() / state.fxBase.duration / state.fxBase.sampleRate;
        if (p.edge)
          stretchSound(p.edge, state.placement[p.edge] * factor + p.delta);
        else
          setSoundPlacement(
            duration(),
            state.placement.start * factor + p.delta,
          );
      }
      updateUI();
      return;
    }
    if (event.type === "pointercancel") {
      if (p.marker?.kind === "selection") state.selection = p.originalSelection;
      if (p.marker?.kind === "slice" && p.snapshotTaken) {
        for (const item of p.linked) {
          const slice = state.slices.find((s) => s.id === item.id);
          if (slice) slice[item.edge] = item.time;
        }
        state.undo.pop();
      }
    } else if (!p.moved && !p.marker) {
      const rect = canvas.getBoundingClientRect(),
        time = timeAtPixel(event.clientX - rect.left, rect.width);
      state.cursor = time;
      if (state.tab === "chop") {
        const slice = state.slices.find((s) => time >= s.start && time < s.end);
        if (slice) {
          selectSlice(slice.id);
          state.cursor = time;
        }
      }
    }
    if (p.marker?.kind === "slice" && p.moved) {
      state.slices.sort((a, b) => a.start - b.start);
      renderSlices();
    }
    if (event.type === "pointerup" && !p.moved && p.marker?.kind === "slice") {
      const input = p.marker.edge === "start" ? els.sliceStart : els.sliceEnd;
      input.focus();
      input.select();
    }
    state.pointer = null;
    updateUI();
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => {
    if (!state.pointer) canvas.style.cursor = "crosshair";
  });
  canvas.addEventListener("dblclick", () => {
    if (state.buffer) selectRange(0, duration());
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const tag = target?.tagName;
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(tag) ||
      target?.isContentEditable ||
      event.repeat
    )
      return;
    if (tag === "BUTTON" && (event.code === "Space" || event.code === "Enter"))
      return;
    if (state.tab === "play") {
      if (event.key === "Escape") {
        stopPads();
        stopPlayback();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const index = padKeys.indexOf(event.code);
      if (index >= 0) {
        event.preventDefault();
        const slice = visibleSlices()[index];
        if (slice) {
          state.heldKeys.set(event.code, slice.id);
          triggerPad(slice.id);
        }
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (state.fxPreview || state.fxPreviewStarting) {
        stopEffectPreview();
        updateUI();
      } else if (state.playing) stopPlayback();
      else playTransport(...range());
    }
    if (event.key === "Escape") {
      stopEffectPreview();
      stopPlayback();
    }
    if (
      state.tab !== "play" &&
      event.key.toLowerCase() === "r" &&
      state.sourceStream
    )
      toggleRecording();
  });
  document.addEventListener("keyup", (event) => {
    const id = state.heldKeys.get(event.code);
    if (id !== undefined) {
      state.heldKeys.delete(event.code);
      releasePad(id);
    }
  });
  window.addEventListener("blur", stopPads);
  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    els.dropOverlay.classList.add("active");
  });
  window.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  window.addEventListener("dragleave", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dropOverlay.classList.remove("active");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    els.dropOverlay.classList.remove("active");
    if (event.dataTransfer?.files?.[0])
      importAudio(event.dataTransfer.files[0]);
  });
  window.addEventListener("pagehide", () => {
    stopEffectPreview();
    stopPads();
    stopPlayback();
    state.sourceStream?.getTracks().forEach((t) => t.stop());
  });
}

function selectTab(tab) {
  if (state.tab === "play" && tab !== "play") stopPads();
  if (state.tab === "editor" && tab !== "editor") stopEffectPreview();
  if (state.tab !== tab) {
    state.midiLearning = null;
    stopPlayback();
  }
  state.tab = tab;
  for (const name of ["capture", "editor", "chop", "play"]) {
    const selected = name === tab,
      button = $(`tab-${name}`);
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`view-${name}`).hidden = !selected;
  }
  if (tab === "play") renderPads();
  if (tab === "editor" || tab === "chop") {
    const panel = $(`view-${tab}`);
    panel.prepend($("wave-panel"));
    requestAnimationFrame(drawWave);
  }
}
function setupViews() {
  $("capture-actions").append(
    els.recordBtn,
    els.importBtn,
    els.exampleBtn,
    els.recMessage,
    els.counter,
  );
  const tabs = ["capture", "editor", "chop", "play"];
  tabs.forEach((tab, index) => {
    const button = $(`tab-${tab}`);
    button.addEventListener("click", () => selectTab(tab));
    button.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabs[next]);
      $(`tab-${tabs[next]}`).focus();
    });
  });
  $("bank-prev").addEventListener("click", () => {
    stopPads();
    state.midiLearning = null;
    state.bank--;
    renderPads();
  });
  $("bank-next").addEventListener("click", () => {
    stopPads();
    state.midiLearning = null;
    state.bank++;
    renderPads();
  });
  $("pads-stop").addEventListener("click", stopPads);
}

const {
  padKeys,
  padLabels,
  visibleSlices,
  configFor,
  stopPad,
  stopPads,
  triggerPad,
  releasePad,
  renderPads,
  restoreMidi,
} = createPlayFeature({
  state,
  $,
  audioContext,
  sliceBuffer,
  toast,
  clamp,
  duration,
});
const {
  selectedSlice,
  selectSlice,
  linkedBoundaries,
  moveBoundaries,
  renderSlices,
  highlightSlice,
  addSlice,
  equalChops,
  splitAtCursor,
  transientChops,
} = createChopFeature({
  state,
  els,
  duration,
  clamp,
  range,
  snapshot,
  stopPad,
  renderPads,
  playRange,
  exportWav,
  updateUI,
  toast,
  secs,
});
const {
  releaseSource,
  connectTab,
  connectInput,
  stopRecording,
  toggleRecording,
} = createCaptureFeature({
  state,
  els,
  updateUI,
  audioContext,
  toast,
  stopPlayback,
  loadSample,
  secs,
  clock,
  MAX_RECORD_MS,
});
const {
  fxTemplates,
  setupEffectChain,
  syncEffectControls,
  renderChain,
  queueFxRender,
  commitEffectChain,
} = createFxChain({
  state,
  $,
  audioContext,
  clamp,
  duration,
  renderEffect,
  renderSlices,
  snapshot,
  stopEffectPreview,
  startEffectPreview,
  stopPlayback,
  stretchPitch,
  convertSampleRate,
  toast,
  updatePeaks,
  updateUI,
  livePlayhead,
});
const {
  editSource,
  setSoundPlacement,
  stretchSound,
  crop,
  deleteRegion,
  processSelection,
} = createEditorFeature({
  state,
  els,
  range,
  duration,
  clamp,
  snapshot,
  stopEffectPreview,
  stopPlayback,
  stopPads,
  renderChain,
  queueFxRender,
  stretchPitch,
  updateUI,
  updatePeaks,
  renderSlices,
  toast,
  MAX_RECORD_MS,
});
const { viewport, timeAtPixel, xForTime, drawWave, animate } =
  createWaveformFeature({
    state,
    canvas,
    ctx,
    els,
    duration,
    clamp,
    range,
    selectedSlice,
    livePlayhead,
    clock,
  });

const projectStateKeys = [
  "buffer",
  "originalBuffer",
  "fxBase",
  "fxRendered",
  "fxChain",
  "fxDraft",
  "fxNextId",
  "bpm",
  "tempoRate",
  "tempoChangesSpeed",
  "placement",
  "name",
  "selection",
  "cursor",
  "slices",
  "nextId",
  "undo",
  "selectedSliceId",
  "selectedSliceEdge",
  "bank",
  "transportLoop",
  "zoom",
  "viewFraction",
];
$("project-export").addEventListener("click", () => {
  if (
    state.processing ||
    state.fxRenderPending ||
    state.recorder?.state === "recording" ||
    state.recordBusy
  ) {
    toast("Wait for audio processing or recording to finish.");
    return;
  }
  try {
    const data = Object.fromEntries(
      projectStateKeys.map((key) => [key, state[key]]),
    );
    const controls = Object.fromEntries(
      [
        ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "input[id]:not([type=file]), select[id]",
        ),
      ].map((el) => [
        el.id,
        { value: el.value, checked: "checked" in el ? el.checked : false },
      ]),
    );
    downloadProject(
      exportProject("sampler", {
        data,
        controls,
        tab: state.tab,
        padConfig: [...state.padConfig],
      }),
      `${safeName(state.name)}-project.zip`,
    );
    toast("Project exported.");
  } catch (error) {
    toast(`Project export failed: ${error.message}`);
  }
});
$("project-import").addEventListener("click", () => $("project-file").click());
$("project-file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (
    state.processing ||
    state.recorder?.state === "recording" ||
    state.recordBusy
  ) {
    toast("Wait for audio processing or recording to finish.");
    return;
  }
  try {
    const ac = await audioContext();
    const saved = importProject(
        new Uint8Array(await file.arrayBuffer()),
        "sampler",
        ac,
      ),
      data = saved.data;
    const validBuffer = (value) =>
      value === null || value instanceof AudioBuffer;
    if (
      !data ||
      ![data.buffer, data.originalBuffer, data.fxBase, data.fxRendered].every(
        validBuffer,
      ) ||
      (data.buffer && !data.fxBase) ||
      !Array.isArray(data.slices) ||
      !Array.isArray(data.undo) ||
      !Array.isArray(data.fxChain) ||
      !Array.isArray(data.fxDraft) ||
      !data.selection ||
      !Array.isArray(saved.padConfig) ||
      !["capture", "editor", "chop", "play"].includes(saved.tab)
    )
      throw new Error("Invalid sampler project state.");
    const fxTypes = [
      "quality",
      "pitch",
      "eq",
      "reverb",
      "delay",
      "distortion",
      "compressor",
    ];
    if (
      [...data.fxChain, ...data.fxDraft].some(
        (effect) =>
          !effect || !fxTypes.includes(effect.type) || !effect.settings,
      )
    )
      throw new Error("Invalid project effects.");
    if (
      data.buffer &&
      (!data.placement ||
        !Number.isFinite(data.placement.start) ||
        !Number.isFinite(data.placement.end))
    )
      throw new Error("Invalid project timeline.");
    const configs = new Map(saved.padConfig);
    stopPads();
    stopPlayback();
    stopEffectPreview();
    clearTimeout(state.fxPreviewTimer);
    state.fxRenderVersion++;
    state.bpmGeneration++;
    state.bpmDetecting = false;
    state.fxRenderPending = false;
    state.fxRenderError = null;
    for (const key of projectStateKeys) state[key] = data[key];
    state.padConfig = configs;
    if (state.fxBase) setResampleRate(state.fxBase.sampleRate);
    syncEffectControls();
    for (const [id, value] of Object.entries(saved.controls || {})) {
      const el = document.getElementById(id) as
        HTMLInputElement | HTMLSelectElement;
      if (el && el.type !== "file" && value && typeof value === "object") {
        const control = value as { value: string; checked: boolean };
        el.value = control.value;
        if ("checked" in el) el.checked = control.checked;
      }
    }
    setDetectBpmLabel(false);
    updatePeaks();
    renderSlices();
    selectTab(saved.tab);
    updateUI();
    els.counter.textContent = clock(state.buffer?.duration || 0);
    if (state.fxBase && state.fxDraft.length && !state.fxRendered)
      queueFxRender();
    if (
      [...state.padConfig.values()].some((config) => config?.midi) &&
      !(await restoreMidi())
    ) {
      toast("Project imported; MIDI access was unavailable.");
    } else toast("Project imported. Reconnect audio inputs if needed.");
  } catch (error) {
    toast(`Project import failed: ${error.message}`);
  }
});

setupSliderReset();
setupEffectChain();
setupViews();
wireEvents();
updateUI();
renderSlices();
if (!navigator.mediaDevices) {
  els.inputHint.textContent =
    "Capture requires a secure context (localhost / HTTPS)";
}
animate();
