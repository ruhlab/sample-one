import { shouldShowBeat, shouldResetForLoop, displayBeatIndex, shouldStopIdleClock } from "./features/beat-display.ts";
import { warmPlayerAudio } from "./features/player-audio-warmup.ts";
import { padActivity, loopDisplayDuration } from "./features/pad-activity.ts";
import { groupTargets, nextGroupState, groupSurvivor, groupTogglePlan } from "./features/player-groups.ts";
import { loopCutEnd, loopCutOffset } from "./features/loop-cut.ts";
import { beatInterval, triggerBeat, nextBeatAtTempo, queueWakeBeat, rebaseBeat } from "./features/beat-interval.ts";
import { setupSliderReset } from "./features/slider-reset.ts";
import { encodeWav } from "./audio/wav.ts";
import { readSampleZip, isProjectZip } from "./audio/read-zip.ts";
import {
  exportProject,
  importProject,
  downloadProject,
} from "./audio/project.ts";
import { calculatePeaks } from "./features/peaks.ts";
import {
  newMidiMappings,
  midiBank,
  midiFromLegacy,
  midiLabel,
  validateMidiMappings,
  ccPressed,
  bpmFromCc,
  claimMidiInput,
  type MidiNote,
} from "./features/player-midi.ts";

type Pad = {
  buffer: AudioBuffer;
  name: string;
  volume: number;
  pan: number;
  pitch: number;
  fadein: number;
  fadeout: number;
  mode: string;
  group?: string;
  triggerBeats: number;
  triggerDelay?: number;
  loopBeats?: number;
  midi: { channel: number; note: number } | null;
};
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  startBeat: number;
  triggerOrigin: number;
  startedAt: number;
  offset: number;
};
const $ = (id: string) => document.getElementById(id) as any;
const keys = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyV",
];
const labels = [
  "1",
  "2",
  "3",
  "4",
  "Q",
  "W",
  "E",
  "R",
  "A",
  "S",
  "D",
  "F",
  "Z",
  "X",
  "C",
  "V",
];
let pads: (Pad | null)[] = Array(16).fill(null),
  bank = 0,
  selected: number | null = null,
  mode = "edit",
  midi: MIDIAccess | null = null,
  learning = false,
  learnedNote: (MidiNote & { kind: "note" | "cc"; inputId: string }) | null =
    null,
  controlMidi: Record<
    string,
    { channel: number; note: number; kind: "note" | "cc"; inputId?: string }
  > = {},
  bpm = 120,
  defaultTriggerBeats = 0,
  defaultTriggerDelay = 0,
  groupModes: ("one" | "all")[] = Array(8).fill("one"),
  metronomeEnabled = false,
  metronomeVolume = 1,
  metronomeOnRecord = false,
  countdownEnabled = false,
  counting = false,
  recordStarting = false,
  generalLog = false,
  midiLog = false,
  midiButtonType = "momentary",
  midiButtonTypes: Record<string, "momentary" | "toggle"> = {},
  lastBpmCc: number | null = null,
  masterVolume = 1,
  defaultMode = "one-shot",
  midiMappings = newMidiMappings(),
  preserveMidi = false;
const midiControlIds = [
  "record",
  "stop-all",
  "bank-prev",
  "bank-next",
  "master-volume",
  "bpm",
  "metronome",
] as const;
const midiButtonIds = ["record", "stop-all", "bank-prev", "bank-next", "metronome"] as const;
function validButtonTypes(value: unknown): value is Record<string, "momentary" | "toggle"> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([id, type]) => midiButtonIds.includes(id as any) && (type === "momentary" || type === "toggle"));
}
function validControlMidi(value: any): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, entry]: [string, any]) =>
        midiControlIds.includes(id as any) &&
        entry &&
        Number.isInteger(entry.channel) &&
        entry.channel >= 0 &&
        entry.channel <= 15 &&
        Number.isInteger(entry.note) &&
        entry.note >= 0 &&
        entry.note <= 127 &&
        (entry.inputId === undefined ||
          (typeof entry.inputId === "string" && entry.inputId.length > 0)) &&
        (["master-volume", "bpm"].includes(id)
          ? entry.kind === "cc"
          : ["note", "cc"].includes(entry.kind)),
    )
  );
}
const midiStorageKey = "sample-one-player-midi-v1";
try {
  const saved = JSON.parse(localStorage.getItem(midiStorageKey) || "null");
  if (saved?.preserve === true && validateMidiMappings(saved.mappings)) {
    preserveMidi = true;
    midiMappings = saved.mappings;
    if (validControlMidi(saved.controls)) controlMidi = saved.controls;
    if (["momentary", "toggle"].includes(saved.buttonType))
      midiButtonType = saved.buttonType;
    if (validButtonTypes(saved.buttonTypes)) midiButtonTypes = { ...saved.buttonTypes };
  }
} catch {}
function validGroupModes(value: unknown): value is ("one" | "all")[] {
  return Array.isArray(value) && value.length === 8 && value.every((mode) => mode === "one" || mode === "all");
}
function exclusiveGroup(group: string | undefined): boolean {
  return !!group && groupModes[Number(group) - 1] !== "all";
}
const generalStorageKey = "sample-one-player-general-v1";
try {
  const saved = JSON.parse(localStorage.getItem(generalStorageKey) || "null");
  if (saved && typeof saved === "object") {
    if (
      Number.isFinite(saved.masterVolume) &&
      saved.masterVolume >= 0 &&
      saved.masterVolume <= 2
    )
      masterVolume = saved.masterVolume;
    if (Number.isInteger(saved.bpm) && saved.bpm >= 40 && saved.bpm <= 240)
      bpm = saved.bpm;
    if (
      Number.isFinite(saved.metronomeVolume) &&
      saved.metronomeVolume >= 0 &&
      saved.metronomeVolume <= 1
    )
      metronomeVolume = saved.metronomeVolume;
    if (["one-shot", "loop", "gate", "loop-cut"].includes(saved.defaultMode))
      defaultMode = saved.defaultMode;
    if (["momentary", "toggle"].includes(saved.midiButtonType))
      midiButtonType = saved.midiButtonType;
    if (validButtonTypes(saved.midiButtonTypes)) midiButtonTypes = { ...saved.midiButtonTypes };
    defaultTriggerBeats = beatInterval(saved.defaultTriggerBeats, saved.quantize === true ? 1 : 0);
    defaultTriggerDelay = beatInterval(saved.defaultTriggerDelay);
    if (validGroupModes(saved.groupModes)) groupModes = saved.groupModes.slice();
    if (typeof saved.metronomeEnabled === "boolean")
      metronomeEnabled = saved.metronomeEnabled;
    if (typeof saved.metronomeOnRecord === "boolean")
      metronomeOnRecord = saved.metronomeOnRecord;
    if (typeof saved.countdownEnabled === "boolean")
      countdownEnabled = saved.countdownEnabled;
    if (typeof saved.individual === "boolean")
      midiMappings.individual = saved.individual;
    if (typeof saved.generalLog === "boolean") generalLog = saved.generalLog;
    if (typeof saved.midiLog === "boolean") midiLog = saved.midiLog;
  }
} catch {}
function saveGeneralOptions() {
  try {
    localStorage.setItem(
      generalStorageKey,
      JSON.stringify({
        masterVolume,
        bpm,
        defaultTriggerBeats,
        defaultTriggerDelay,
        groupModes,
        metronomeEnabled,
        metronomeVolume,
        metronomeOnRecord,
        countdownEnabled,
        defaultMode,
        individual: midiMappings.individual,
        midiButtonType,
        midiButtonTypes,
        generalLog,
        midiLog,
      }),
    );
  } catch {
    logGeneral("Could not save general options to localStorage");
  }
}
function saveMidi() {
  try {
    if (preserveMidi)
      localStorage.setItem(
        midiStorageKey,
        JSON.stringify({
          preserve: true,
          mappings: midiMappings,
          controls: controlMidi,
          buttonType: midiButtonType,
          buttonTypes: midiButtonTypes,
        }),
      );
    else localStorage.removeItem(midiStorageKey);
  } catch {
    status("Could not save MIDI settings in this browser.");
  }
}
let context: AudioContext | null = null,
  master: GainNode | null = null,
  recorder: AudioWorkletNode | null = null,
  recording = false,
  stopping = false;
let audioWarmed = false;
let left: Float32Array[] = [],
  right: Float32Array[] = [],
  recordFrames = 0;
const voices = new Map<number, Voice>(),
  pending = new Map<number, object>(),
  heldKeys = new Map<string, number>(),
  heldButtonKeys = new Map<string, number>(),
  heldMidi = new Map<string, number[]>(),
  heldPadGroups = new Map<number, number[]>(),
  heldGroupToggles = new Set<number>(),
  groupDesired = new Map<string, boolean>(),
  heldCc = new Map<string, boolean>();
let messageTimer: ReturnType<typeof setTimeout>;
let statusMessage: string | null = null;
function logGeneral(event: string, details?: unknown) {
  if (generalLog) console.log("[SAMPLE/ONE]", event, details ?? "");
}
function logMidi(event: string, details?: unknown) {
  if (midiLog) console.log("[SAMPLE/ONE MIDI]", event, details ?? "");
}
function renderStatusText() {
  $("board-hint").textContent = statusMessage ?? (learning
    ? learnedNote
      ? `${learnedNote.kind === "cc" ? "CC" : "Note"} ${learnedNote.note} · Channel ${learnedNote.channel + 1}: select a pad or control`
      : "Play a MIDI note or move a controller, then select a pad or control"
    : mode === "edit"
      ? "Select a pad to edit it · Press it again to play · Drop audio onto a pad"
      : "Play pads or use a MIDI controller");
}
function status(message: string) {
  logGeneral("Status", message);
  statusMessage = message;
  renderStatusText();
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    statusMessage = null;
    renderStatusText();
  }, 4500);
}
async function audio() {
  if (!context) {
    context = new AudioContext({ latencyHint: "interactive" });
    context.addEventListener("statechange", () => {
      if (context?.state !== "running") audioWarmed = false;
      resetBeatIfIdle();
      logGeneral("Audio context state", context?.state);
    });
    logGeneral("Audio context created", {
      sampleRate: context.sampleRate,
      state: context.state,
    });
    master = context.createGain();
    master.gain.value = masterVolume;
    master.connect(context.destination);
  }
  if (context.state !== "running") await context.resume();
  if (!audioWarmed && context.state === "running") {
    audioWarmed = true;
    try {
      warmPlayerAudio(context, master!);
    } catch (error) {
      audioWarmed = false;
      logGeneral("Audio warmup unavailable", String(error));
    }
  }
  return context;
}
function makePad(buffer: AudioBuffer, name: string): Pad {
  return {
    buffer,
    name: name.replace(/\.[^.]+$/, ""),
    volume: 0.86,
    pan: 0,
    pitch: 0,
    fadein: 0,
    fadeout: 0,
    mode: defaultMode,
    group: "",
    triggerBeats: defaultTriggerBeats,
    triggerDelay: defaultTriggerDelay,
    loopBeats: 0,
    midi: null,
  };
}
function stopPad(index: number, fade = false) {
  const removedQueued = queued.delete(index);
  const removedPending = pending.delete(index);
  const voice = voices.get(index);
  if (!voice) {
    if (removedQueued || removedPending) updateLights();
    return;
  }
  voices.delete(index);
  const fadeTime = fade && (!context || voice.startedAt <= context.currentTime) ? pads[index]?.fadeout || 0 : 0;
  if (fadeTime && context) {
    const now = context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + fadeTime);
    try {
      voice.source.stop(now + fadeTime);
    } catch {}
    updateLights();
    return;
  }
  try {
    voice.source.stop();
  } catch {}
  voice.source.disconnect();
  voice.gain.disconnect();
  voice.pan.disconnect();
  updateLights();
}
function stopAll() {
  for (const index of [...voices.keys()]) stopPad(index);
  pending.clear();
  queued.clear();
  updateLights();
  heldKeys.clear();
  heldButtonKeys.clear();
  heldMidi.clear();
  heldPadGroups.clear();
  heldGroupToggles.clear();
  groupDesired.clear();
}
let lightFrame: number | null = null;
function updateLights() {
  stopBeatClockIfIdle();
  resetBeatIfIdle();
  if (firstDisplayBeat === null && beatDisplayActive() && !metronomeEnabled && !recording && !counting) {
    firstDisplayBeat = Math.max(0, Math.floor(clockPosition() + 0.01));
    showBeat(0);
  }
  document.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((button) => {
    const index = Number(button.dataset.pad);
    const voice = voices.get(index), pad = pads[index];
    const now = context?.currentTime ?? 0;
    const offset = voice ? voiceOffset(voice, now) : 0;
    const loopEnd = voice?.source.loop ? voice.source.loopEnd || voice.source.buffer!.duration : 0;
    const state = padActivity(voice && pad ? {
      started: context?.state === "running" && voice.startedAt <= now,
      offset,
      audioDuration: loopDisplayDuration(pad.buffer.duration, loopEnd, voice.source.playbackRate.value),
    } : null, queued.get(index)?.action === "start", pending.has(index));
    button.classList.toggle("active", state === "playing");
    button.classList.toggle("waiting", state === "waiting");
  });
  if (voices.size && lightFrame === null) {
    lightFrame = requestAnimationFrame(() => {
      lightFrame = null;
      updateLights();
    });
  }
}
const queued = new Map<number, { action: "start" | "stop"; beat: number; origin: number }>();
let queueTimer: ReturnType<typeof setTimeout> | null = null;
function clockPosition() { return clockRunning ? beatNumber + (performance.now() - nextBeat) / (60000 / bpm) : 0; }
function scheduleQueue() {
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = null;
  if (!queued.size) return;
  const now = clockPosition();
  const wakeBeat = (index: number, entry: { action: "start" | "stop"; beat: number }) =>
    queueWakeBeat(entry.beat, bpm, entry.action === "start" && !!pads[index]?.group && !exclusiveGroup(pads[index]?.group));
  const earliest = Math.min(...[...queued].map(([index, entry]) => wakeBeat(index, entry)));
  queueTimer = setTimeout(() => {
    queueTimer = null;
    const position = clockPosition();
    for (const [index, entry] of [...queued]) {
      if (wakeBeat(index, entry) > position + 0.0001) continue;
      queued.delete(index);
      if (entry.action === "stop") stopPad(index, true);
      else void playPad(index, entry.beat, entry.origin);
    }
    updateLights();
    scheduleQueue();
  }, Math.max(0, (earliest - now) * 60000 / bpm));
}
function queueAction(index: number, action: "start" | "stop", pad: Pad, position?: number) {
  if (!clockRunning) resetBeatClock(40);
  const origin = position ?? clockPosition();
  queued.set(index, { action, beat: triggerBeat(origin, pad.triggerBeats, pad.triggerDelay ?? 0), origin });
  scheduleQueue();
}
function resetClockForLoopStart(targets: number[]) {
  const startingLoop = targets.some((index) => ["loop", "loop-cut"].includes(pads[index]?.mode ?? ""));
  const loopRunning = !!context && context.state === "running" &&
    [...voices.values()].some((voice) => voice.source.loop && voice.startedAt <= context!.currentTime);
  const metronomeRunning = metronomeEnabled || (recording && metronomeOnRecord) || counting;
  if (shouldResetForLoop(startingLoop, loopRunning, metronomeRunning)) resetBeatClock(40);
}
function trigger(index: number) {
  const group = pads[index]?.group;
  const playAll = !!group && !exclusiveGroup(group);
  const targets = groupTargets(pads, index, playAll);
  heldPadGroups.set(index, targets);
  if (!playAll || !group) {
    heldGroupToggles.delete(index);
    if (!voices.has(index) && !pending.has(index) && queued.get(index)?.action !== "start") resetClockForLoopStart(targets);
    void triggerPad(index);
    return;
  }
  heldGroupToggles.add(index);
  const anyActive = targets.some((target) => voices.has(target) || pending.has(target) || queued.get(target)?.action === "start");
  const desired = groupDesired.get(group);
  const turnOn = nextGroupState(desired, anyActive);
  groupDesired.set(group, turnOn);
  if (turnOn) resetClockForLoopStart(targets);
  const position = clockPosition();
  const members = targets.map((index) => ({
    index,
    playing: voices.has(index) && (!context || voices.get(index)!.startedAt <= context.currentTime),
  }));
  clockHold++;
  for (const { index: target, action } of groupTogglePlan(turnOn, members)) {
    const pad = pads[target];
    if (!pad) continue;
    if (action === "restart") {
      // A fresh group launch must not retain voices or starts from an older launch.
      stopPad(target);
      void triggerPad(target, position, true);
    } else {
      pending.delete(target);
      queued.delete(target);
      if (action === "stop" && (pad.triggerBeats || pad.triggerDelay))
        queueAction(target, "stop", pad, position);
      else stopPad(target, true);
    }
  }
  clockHold--;
  scheduleQueue();
  updateLights();
}
async function triggerPad(index: number, position?: number, forceStart = false) {
  const pad = pads[index];
  if (!pad) return;
  const origin = position ?? clockPosition();
  if (!pad.triggerBeats && !pad.triggerDelay) {
    if (!forceStart && (pad.mode === "loop" || pad.mode === "loop-cut") && (voices.has(index) || pending.has(index))) stopPad(index, true);
    else void playPad(index, forceStart && position !== undefined ? position + 0.01 * bpm / 60 : undefined, origin);
    return;
  }
  const token = {};
  pending.set(index, token);
  try {
    await audio();
    if (pending.get(index) !== token || pads[index] !== pad) return;
    pending.delete(index);
    const action = !forceStart && (pad.mode === "loop" || pad.mode === "loop-cut") && (voices.has(index) || queued.get(index)?.action === "start") ? "stop" : "start";
    if (action === "stop" && queued.get(index)?.action === "start" && !voices.has(index)) queued.delete(index);
    else {
      if (action === "start" && exclusiveGroup(pad.group)) {
        for (const [otherIndex, otherAction] of queued) {
          if (otherIndex !== index && otherAction.action === "start" && pads[otherIndex]?.group === pad.group) queued.delete(otherIndex);
        }
      }
      queueAction(index, action, pad, origin);
    }
    updateLights();
  } catch (e) {
    if (pending.get(index) === token) pending.delete(index);
    updateLights();
    status(`Could not play audio: ${(e as Error).message}`);
  }
}
function configureLoopCut(ac: AudioContext, source: AudioBufferSourceNode, pad: Pad, tempo: number): number {
  const end = loopCutEnd(pad.buffer.duration, source.playbackRate.value, tempo, pad.loopBeats ?? 0);
  let buffer = pad.buffer;
  if (end > buffer.duration) {
    buffer = ac.createBuffer(pad.buffer.numberOfChannels, Math.ceil(end * pad.buffer.sampleRate), pad.buffer.sampleRate);
    for (let channel = 0; channel < pad.buffer.numberOfChannels; channel++)
      buffer.copyToChannel(pad.buffer.getChannelData(channel), channel);
  }
  source.buffer = buffer;
  source.loop = true;
  source.loopEnd = end;
  return end;
}

function voiceOffset(voice: Voice, now: number): number {
  const source = voice.source;
  const position = voice.offset + Math.max(0, now - voice.startedAt) * source.playbackRate.value;
  const end = source.loop ? source.loopEnd || source.buffer!.duration : source.buffer!.duration;
  return source.loop ? position % end : Math.min(position, end);
}

function refreshVoice(index: number, realign = false) {
  const pad = pads[index], voice = voices.get(index), ac = context;
  if (!pad || !voice || !ac) return;
  try {
    const now = ac.currentTime;
    const previous = voice.source;
    const waiting = voice.startedAt > now;
    const startTime = waiting || realign ? now + Math.max(0, (voice.startBeat - clockPosition()) * 60 / bpm) : now;
    const previousOffset = voiceOffset(voice, now);
    const source = ac.createBufferSource();
    source.playbackRate.value = 2 ** (pad.pitch / 12);
    let offset: number;
    if (pad.mode === "loop-cut") {
      const end = configureLoopCut(ac, source, pad, bpm);
      offset = loopCutOffset(clockPosition(), voice.startBeat, end, source.playbackRate.value, bpm);
    } else {
      source.buffer = pad.buffer;
      source.loop = pad.mode === "loop";
      const elapsed = realign ? Math.max(0, clockPosition() - voice.startBeat) * 60 / bpm * source.playbackRate.value : previousOffset;
      if (!source.loop && elapsed >= pad.buffer.duration) {
        stopPad(index);
        return;
      }
      offset = source.loop ? elapsed % pad.buffer.duration : elapsed;
    }
    source.connect(voice.gain);
    source.onended = () => {
      source.disconnect();
      if (voice.source !== source) return;
      if (voices.get(index) === voice) voices.delete(index);
      voice.gain.disconnect();
      voice.pan.disconnect();
      updateLights();
    };
    source.start(startTime, offset);
    voice.source = source;
    voice.startedAt = startTime;
    if (startTime > now) setTimeout(updateLights, (startTime - now) * 1000 + 20);
    voice.offset = offset;
    previous.stop(now);
    updateVoiceGain(index);
    resetBeatIfIdle();
  } catch (e) {
    status(`Could not update pad playback: ${(e as Error).message}`);
  }
}
function updateVoiceGain(index: number) {
  const pad = pads[index], voice = voices.get(index), ac = context;
  if (!pad || !voice || !ac) return;
  const now = ac.currentTime;
  const start = Math.max(now, voice.startedAt);
  const gain = voice.gain.gain;
  const duration = pad.buffer.duration / voice.source.playbackRate.value;
  const elapsed = Math.max(0, (clockPosition() - voice.startBeat) * 60 / bpm);
  const fadeIn = Math.min(pad.fadein, duration);
  const fadeRemaining = Math.max(0, fadeIn - elapsed);
  gain.cancelAndHoldAtTime(now);
  if (start > now) gain.setValueAtTime(fadeIn ? 0 : pad.volume, start);
  if (fadeRemaining) gain.linearRampToValueAtTime(pad.volume, start + fadeRemaining);
  else gain.setTargetAtTime(pad.volume, start, 0.005);
  if (!voice.source.loop && pad.fadeout > 0) {
    const remaining = Math.max(0, (pad.buffer.duration - voiceOffset(voice, now)) / voice.source.playbackRate.value);
    const fade = Math.min(pad.fadeout, Math.max(0, remaining - fadeRemaining));
    if (fade) {
      gain.setValueAtTime(pad.volume, start + remaining - fade);
      gain.linearRampToValueAtTime(0, start + remaining);
    }
  }
}
function reschedulePadAction(index: number) {
  const entry = queued.get(index), pad = pads[index], voice = voices.get(index);
  if (!pad) return;
  if (entry) queueAction(index, entry.action, pad, entry.origin);
  if (voice) {
    voice.startBeat = triggerBeat(voice.triggerOrigin, pad.triggerBeats, pad.triggerDelay ?? 0);
    refreshVoice(index, true);
  }
  updateLights();
}

async function playPad(index: number, scheduledBeat?: number, triggerOrigin?: number) {
  const pad = pads[index];
  if (!pad) return;
  if (exclusiveGroup(pad.group)) {
    pads.forEach((other, otherIndex) => {
      if (otherIndex !== index && other?.group === pad.group) stopPad(otherIndex, true);
    });
  }
  stopPad(index);
  const token = {};
  pending.set(index, token);
  try {
    const ac = await audio();
    if (pending.get(index) !== token || pads[index] !== pad) return;
    pending.delete(index);
    const source = ac.createBufferSource(),
      gain = ac.createGain(),
      pan = ac.createStereoPanner();
    source.playbackRate.value = 2 ** (pad.pitch / 12);
    pan.pan.value = pad.pan;
    const duration = pad.buffer.duration / source.playbackRate.value,
      now = ac.currentTime,
      startBeat = scheduledBeat ?? clockPosition(),
      startTime = now + Math.max(0, (startBeat - clockPosition()) * 60 / bpm),
      fadeIn = Math.min(pad.fadein, duration),
      fadeOut = Math.min(pad.fadeout, Math.max(0, duration - fadeIn));
    gain.gain.setValueAtTime(fadeIn ? 0 : pad.volume, startTime);
    if (fadeIn) gain.gain.linearRampToValueAtTime(pad.volume, startTime + fadeIn);
    if (pad.mode !== "loop" && pad.mode !== "loop-cut" && fadeOut) {
      gain.gain.setValueAtTime(pad.volume, startTime + duration - fadeOut);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
    }
    source.loop = pad.mode === "loop" || pad.mode === "loop-cut";
    let offset = 0;
    if (pad.mode === "loop-cut") {
      const end = configureLoopCut(ac, source, pad, bpm);
      offset = loopCutOffset(clockPosition(), startBeat, end, source.playbackRate.value, bpm);
    } else {
      source.buffer = pad.buffer;
      if (source.loop && scheduledBeat !== undefined)
        offset = (Math.max(0, clockPosition() - startBeat) * 60 / bpm * source.playbackRate.value) % pad.buffer.duration;
    }
    source.connect(gain);
    gain.connect(pan);
    pan.connect(master!);
    const voice: Voice = { source, gain, pan, startBeat, triggerOrigin: triggerOrigin ?? startBeat, startedAt: startTime, offset };
    voices.set(index, voice);
    source.onended = () => {
      source.disconnect();
      if (voice.source !== source) return;
      if (voices.get(index) === voice) voices.delete(index);
      gain.disconnect();
      pan.disconnect();
      updateLights();
    };
    source.start(startTime, offset);
    if (startTime > now) setTimeout(updateLights, Math.max(0, (startTime - now) * 1000) + 20);
    updateLights();
  } catch (e) {
    pending.delete(index);
    updateLights();
    status(`Could not play audio: ${(e as Error).message}`);
  }
}
function release(index: number) {
  const targets = heldPadGroups.get(index) ?? [index];
  heldPadGroups.delete(index);
  if (heldGroupToggles.delete(index)) return;
  for (const target of targets) releasePad(target);
}
function releasePad(index: number) {
  if (pads[index]?.mode !== "gate") return;
  if (!pads[index]?.triggerBeats && !pads[index]?.triggerDelay) { stopPad(index, true); return; }
  pending.delete(index);
  if (voices.has(index)) queueAction(index, "stop", pads[index]!);
  else queued.delete(index);
  updateLights();
}
const waveforms = new WeakMap<AudioBuffer, string>();
function padWaveform(buffer: AudioBuffer): SVGSVGElement {
  let pathData = waveforms.get(buffer);
  if (!pathData) {
    const { lo, hi } = calculatePeaks(buffer);
    pathData = "";
    for (let x = 0; x < 120; x++) {
      const start = Math.floor((x * lo.length) / 120);
      const end = Math.max(start + 1, Math.floor(((x + 1) * lo.length) / 120));
      let min = 1,
        max = -1;
      for (let i = start; i < Math.min(end, lo.length); i++) {
        min = Math.min(min, lo[i]);
        max = Math.max(max, hi[i]);
      }
      pathData += `M${x + 0.5} ${50 - max * 36}V${50 - min * 36}`;
    }
    waveforms.set(buffer, pathData);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("pad-wave");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", ".8");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  return svg;
}
function updatePadGroupBadge(button: HTMLButtonElement, index: number) {
  const pad = pads[index];
  const group = pad?.group;
  const mapping = midiBank(midiMappings, Math.floor(index / 16))[index % 16];
  button.setAttribute("aria-label", `${pad?.name || "Empty pad"}, key ${labels[index % 16]}${mapping ? `, MIDI ${midiLabel(mapping)}` : ""}${group ? `, group ${group}` : ""}`);
  button.classList.toggle("has-group", !!group);
  let badge = button.querySelector<HTMLElement>(".pad-group-badge");
  if (!group) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "pad-group-badge";
    badge.setAttribute("aria-hidden", "true");
    button.appendChild(badge);
  }
  badge.textContent = `#${group}`;
}
function render() {
  $("bank-label").textContent = `${bank + 1}/${pads.length / 16}`;
  $("bank-label").setAttribute("aria-label", `Bank ${bank + 1} of ${pads.length / 16}`);
  $("bank-prev").disabled = !learning && bank === 0;
  $("bank-next").disabled = !learning && bank >= pads.length / 16 - 1;
  for (const id of midiControlIds) {
    $(id).classList.toggle("midi-target", learning);
    const mapping = controlMidi[id];
    const label = $(id).dataset.label || $(id).getAttribute("aria-label") || id;
    $(id).title = mapping
      ? `${label} · MIDI ${mapping.kind === "cc" ? `CC ${mapping.note} · ${mapping.channel + 1}` : midiLabel(mapping)}`
      : label;
  }
  $("editor").hidden = false;
  $("edit-mode").classList.toggle("active", mode === "edit");
  $("play-mode").classList.toggle("active", mode === "play");
  $("record").hidden = mode !== "play" && !recording && !stopping && !learning;
  $("bank-add").hidden = mode === "play";
  $("midi-learn").classList.toggle("learning", learning);
  $("midi-learn").setAttribute("aria-pressed", String(learning));
  $("midi-learn").title = learning ? "Done learning" : "MIDI Learn";
  $("midi-learn").setAttribute("aria-label", learning ? "Done learning" : "MIDI Learn");
  renderStatusText();
  const grid = $("player-grid");
  grid.replaceChildren();
  for (let i = 0; i < 16; i++) {
    const index = bank * 16 + i,
      pad = pads[index],
      card = document.createElement("div"),
      button = document.createElement("button");
    card.className = "pad-card";
    button.type = "button";
    button.className = `pad-trigger${pad ? "" : " empty"}${selected === index && mode === "edit" ? " selected" : ""}`;
    button.dataset.pad = String(index);
    button.classList.toggle("midi-target", learning);
    const assignedMidi = midiBank(midiMappings, bank)[i];
    const key = document.createElement("span"),
      name = document.createElement("span");
    key.className = "pad-key";
    name.className = "pad-name";
    key.textContent = labels[i];
    name.textContent = pad?.name || (mode === "edit" ? "+ Add sound" : "Empty");
    const top = document.createElement("span");
    top.className = "pad-top";
    top.appendChild(key);
    if (assignedMidi) {
      const note = document.createElement("span");
      note.className = "pad-midi";
      note.textContent = midiLabel(assignedMidi);
      top.appendChild(note);
    }
    button.append(top, name);
    updatePadGroupBadge(button, index);
    if (pad) button.prepend(padWaveform(pad.buffer));
    let pointerPlayed = false;
    button.addEventListener("pointerdown", (e) => {
      pointerPlayed = false;
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      if (learning) {
        assignLearnedNote(index);
        return;
      }
      if (mode === "edit" && selected !== index) {
        selected = index;
        renderEditor();
        document
          .querySelectorAll("[data-pad]")
          .forEach((el) => el.classList.toggle("selected", el === button));
        return;
      }
      pointerPlayed = true;
      void trigger(index);
    });
    const releasePointer = () => {
      if (pointerPlayed) release(index);
      pointerPlayed = false;
    };
    button.addEventListener("pointerup", releasePointer);
    button.addEventListener("pointercancel", releasePointer);
    button.addEventListener("keydown", (e) => {
      if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
        e.preventDefault();
        if (learning) {
          assignLearnedNote(index);
          return;
        }
        heldButtonKeys.set(e.code, index);
        if (mode === "edit") {
          selected = index;
          render();
        }
        void trigger(index);
      }
    });
    button.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
      }
    });
    button.addEventListener("dragover", (e) => {
      if (mode === "edit" && e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        button.classList.add("drag-over");
      }
    });
    button.addEventListener("dragleave", () =>
      button.classList.remove("drag-over"),
    );
    button.addEventListener("drop", (e) => {
      e.preventDefault();
      button.classList.remove("drag-over");
      if (mode === "edit" && e.dataTransfer?.files[0]) {
        selected = index;
        void loadPad(e.dataTransfer.files[0], index);
      }
    });
    card.append(button);
    grid.append(card);
  }
  renderEditor();
  updateLights();
}
type MidiTableRow = { id: string; label: string; pad?: number; continuous?: boolean };
const midiTableRows: MidiTableRow[] = [
  { id: "record", label: "Record" }, { id: "stop-all", label: "Stop all" },
  { id: "bank-prev", label: "Previous bank" }, { id: "bank-next", label: "Next bank" },
  { id: "metronome", label: "Metronome" }, { id: "master-volume", label: "Master volume", continuous: true },
  { id: "bpm", label: "BPM", continuous: true },
  ...labels.map((label, pad) => ({ id: `pad-${pad}`, label: `Pad ${pad + 1} (${label})`, pad })),
];
function initMidiTable() {
  const list = $("midi-mapping-list") as HTMLElement;
  for (const row of midiTableRows) {
    const el = document.createElement("div");
    el.className = "midi-mapping-row";
    el.dataset.row = row.id;
    const name = document.createElement("span");
    name.textContent = row.label;
    el.append(name);
    const type = document.createElement("select");
    type.dataset.field = "kind";
    type.setAttribute("aria-label", `${row.label} MIDI type`);
    type.innerHTML = `<option value="">None</option>${row.continuous ? "" : '<option value="note">Note</option>'}<option value="cc">CC</option>`;
    el.append(type);
    for (const [field, min, max] of [["channel", 1, 16], ["note", 0, 127]] as const) {
      const input = document.createElement("input");
      input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1";
      input.dataset.field = field; input.setAttribute("aria-label", `${row.label} ${field === "note" ? "MIDI number" : "channel"}`);
      el.append(input);
    }
    const device = document.createElement("select");
    device.dataset.field = "inputId"; device.setAttribute("aria-label", `${row.label} MIDI input`); el.append(device);
    if (!row.continuous && row.pad === undefined) {
      const buttonType = document.createElement("select");
      buttonType.dataset.field = "buttonType"; buttonType.setAttribute("aria-label", `${row.label} CC button type`);
      buttonType.innerHTML = '<option value="momentary">Momentary</option><option value="toggle">Toggle</option>';
      el.append(buttonType);
    } else { const spacer = document.createElement("span"); spacer.textContent = row.continuous ? "Value" : "—"; el.append(spacer); }
    const clear = document.createElement("button");
    clear.type = "button"; clear.dataset.field = "clear"; clear.textContent = "×"; clear.title = `Clear ${row.label} mapping`; clear.setAttribute("aria-label", clear.title); el.append(clear);
    list.append(el);
  }
  list.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const el = input.closest<HTMLElement>("[data-row]");
    const row = midiTableRows.find((item) => item.id === el?.dataset.row);
    if (!row || !el) return;
    const field = input.dataset.field;
    if (field === "buttonType") {
      midiButtonTypes[row.id] = input.value === "toggle" ? "toggle" : "momentary";
      heldCc.clear(); saveGeneralOptions(); saveMidi(); return;
    }
    const get = (name: string) => el.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`)!;
    const kind = get("kind").value;
    const bankNotes = midiBank(midiMappings, bank);
    if (!kind) {
      if (row.pad !== undefined) bankNotes[row.pad] = null; else delete controlMidi[row.id];
    } else {
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? Math.round(n) : min));
      const inputId = get("inputId").value;
      const mapping = { kind: kind as "note" | "cc", channel: clamp(Number(get("channel").value), 1, 16) - 1, note: clamp(Number(get("note").value), 0, 127), ...(inputId ? { inputId } : {}) };
      if (row.pad !== undefined) bankNotes[row.pad] = mapping; else controlMidi[row.id] = mapping;
    }
    heldCc.clear(); heldMidi.clear(); saveMidi(); render();
  });
  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.field !== "clear") return;
    const row = midiTableRows.find((item) => item.id === target.closest<HTMLElement>("[data-row]")?.dataset.row);
    if (!row) return;
    if (row.pad !== undefined) midiBank(midiMappings, bank)[row.pad] = null; else delete controlMidi[row.id];
    heldCc.clear(); heldMidi.clear(); saveMidi(); render();
  });
}
function renderMidiTable() {
  $("midi-bank-context").textContent = midiMappings.individual ? `Pads: Bank ${bank + 1}` : "Pads: Shared across banks";
  const notes = midiBank(midiMappings, bank);
  for (const row of midiTableRows) {
    const el = document.querySelector<HTMLElement>(`#midi-mapping-list [data-row="${row.id}"]`)!;
    if (!el) continue;
    const mapping = row.pad !== undefined ? notes[row.pad] : controlMidi[row.id];
    const get = (name: string) => el.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`)!;
    const kind = get("kind"), channel = get("channel"), number = get("note"), device = get("inputId") as HTMLSelectElement;
    kind.value = mapping ? mapping.kind ?? "note" : "";
    channel.value = String((mapping?.channel ?? 0) + 1); number.value = String(mapping?.note ?? 0);
    channel.disabled = number.disabled = device.disabled = !mapping;
    device.replaceChildren(new Option("Any", ""));
    if (midi) for (const input of midi.inputs.values()) device.add(new Option(input.name || input.id, input.id));
    if (mapping?.inputId && ![...device.options].some((option) => option.value === mapping.inputId)) device.add(new Option("Disconnected", mapping.inputId));
    device.value = mapping?.inputId ?? "";
    const buttonType = el.querySelector<HTMLSelectElement>('[data-field="buttonType"]');
    if (buttonType) { buttonType.value = midiButtonTypes[row.id] ?? midiButtonType; buttonType.disabled = mapping?.kind !== "cc"; }
  }
}
let editingPadName: number | null = null;
let originalPadName = "";
function renderEditor() {
  const pad = selected === null ? null : pads[selected];
  $("editor").setAttribute("aria-label", selected === null ? "General options" : `Pad ${labels[selected % 16]}, bank ${Math.floor(selected / 16) + 1} settings`);
  document.querySelectorAll<HTMLElement>("#general-options [data-edit-only]").forEach((section) => {
    section.hidden = mode === "play";
  });
  $("general-options").hidden = selected !== null;
  $("editor-controls").hidden = selected === null;
  $("master-volume").value = String(masterVolume);
  $("master-volume-value").textContent = `${Math.round(masterVolume * 100)}%`;
  $("default-mode").value = defaultMode;
  $("bpm").value = String(bpm);
  $("bpm-slider").value = String(bpm);
  $("quantize").value = String(defaultTriggerBeats);
  $("default-trigger-delay").value = String(defaultTriggerDelay);
  groupModes.forEach((groupMode, index) => { $("group-mode-" + (index + 1)).value = groupMode; });
  renderMetronomeButton();
  $("metronome-volume").value = String(metronomeVolume);
  $("metronome-volume-value").textContent =
    `${Math.round(metronomeVolume * 100)}%`;
  $("metronome-on-record").checked = metronomeOnRecord;
  $("countdown").checked = countdownEnabled;
  $("midi-individual").checked = midiMappings.individual;
  $("midi-preserve").checked = preserveMidi;
  renderMidiTable();
  $("general-log").checked = generalLog;
  $("midi-log").checked = midiLog;
  if (selected === null) return;
  $("loop-cut-settings").hidden = pad?.mode !== "loop-cut";
  $("pad-loop-beats").value = String(pad?.loopBeats ?? 0);
  $("pad-quantize").value = String(pad?.triggerBeats ?? 0);
  $("pad-quantize").disabled = !pad;
  $("pad-trigger-delay").value = String(pad?.triggerDelay ?? 0);
  $("pad-trigger-delay").disabled = !pad;
  $("pad-group").value = pad?.group || "";
  $("pad-group").disabled = !pad;
  if (editingPadName !== selected || !pad) editingPadName = null;
  $("pad-name-display").hidden = editingPadName !== null;
  $("pad-name").hidden = editingPadName === null;
  $("pad-name-display").textContent = pad?.name || "Empty pad";
  $("pad-name-display").disabled = !pad;
  if (editingPadName === null) $("pad-name").value = pad?.name || "";
  $("pad-name").disabled = !pad;
  $("remove-pad").disabled = !pad;
  for (const field of ["mode", "volume", "pan", "pitch", "fadein", "fadeout"]) {
    $("pad-" + field).disabled = !pad;
    if (pad) $("pad-" + field).value = pad[field];
  }
  $("volume-value").textContent = pad
    ? `${Math.round(pad.volume * 100)}%`
    : "—";
  $("pan-value").textContent = pad
    ? pad.pan === 0
      ? "Center"
      : `${Math.round(Math.abs(pad.pan) * 100)}% ${pad.pan < 0 ? "L" : "R"}`
    : "—";
  $("pitch-value").textContent = pad
    ? `${pad.pitch > 0 ? "+" : ""}${pad.pitch} st`
    : "—";
  $("fadein-value").textContent = pad ? `${pad.fadein.toFixed(2)} s` : "—";
  $("fadeout-value").textContent = pad ? `${pad.fadeout.toFixed(2)} s` : "—";
  const assignedMidi = midiBank(midiMappings, Math.floor(selected / 16))[
    selected % 16
  ];
  $("midi-label").textContent = assignedMidi
    ? midiLabel(assignedMidi)
    : "No note assigned";
  $("midi-clear").disabled = !assignedMidi;
}
async function loadPad(file: File, index: number) {
  try {
    const ac = await audio(),
      buffer = await ac.decodeAudioData(await file.arrayBuffer());
    stopPad(index);
    pads[index] = makePad(buffer, file.name);
    selected = index;
    render();
    status(`Loaded ${file.name}`);
  } catch {
    status(`Could not load ${file.name} as audio.`);
    render();
  }
}
function chooseZipImport(): Promise<string> {
  if (!pads.some(Boolean)) return Promise.resolve("clear");
  const dialog = $("zip-choice") as HTMLDialogElement;
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue || "cancel"),
      { once: true },
    );
    dialog.returnValue = "cancel";
    dialog.showModal();
  });
}
async function loadZip(file: File, bytes?: Uint8Array) {
  try {
    const entries = readSampleZip(bytes ?? new Uint8Array(await file.arrayBuffer())),
      ac = await audio(),
      loaded: Pad[] = [];
    for (const entry of entries)
      loaded.push(
        makePad(
          await ac.decodeAudioData(
            entry.data.buffer.slice(
              entry.data.byteOffset,
              entry.data.byteOffset + entry.data.byteLength,
            ) as ArrayBuffer,
          ),
          entry.name,
        ),
      );
    const choice = await chooseZipImport();
    if (choice === "cancel") return;
    stopAll();
    if (choice === "empty") {
      const next = pads.slice();
      for (const pad of loaded) {
        let index = next.indexOf(null);
        if (index < 0) {
          index = next.length;
          next.push(...Array(16).fill(null));
        }
        next[index] = pad;
      }
      pads = next;
    } else {
      pads = [...loaded, ...Array((16 - (loaded.length % 16)) % 16).fill(null)];
      bank = 0;
    }
    selected = null;
    learning = false;
    render();
    status(`Imported ${loaded.length} pads.`);
  } catch (e) {
    status(`ZIP import failed: ${(e as Error).message}`);
  }
}
let metronomeTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;
let cancelCount: (() => void) | null = null;
function clickSound(ac: AudioContext, accent: boolean) {
  if (metronomeVolume <= 0) return;
  const oscillator = ac.createOscillator(),
    gain = ac.createGain(),
    now = ac.currentTime;
  oscillator.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, 0.8 * metronomeVolume),
    now + 0.003,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  oscillator.connect(gain);
  gain.connect(ac.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
let nextBeat = performance.now();
let beatNumber = 0;
let clockRunning = false;
let clockHold = 0;
let firstDisplayBeat: number | null = null;
function beatDisplayActive(): boolean {
  return shouldShowBeat(
    context?.state === "running",
    metronomeEnabled || (recording && metronomeOnRecord),
    recording || counting,
    !!context && [...voices.values()].some((voice) => voice.source.loop && voice.startedAt <= context!.currentTime),
  );
}
function resetBeatIfIdle() {
  if (beatDisplayActive()) return;
  firstDisplayBeat = null;
  $("beat-indicator").setAttribute("aria-label", "Beat indicator idle");
  $("beat-indicator").querySelectorAll(".beat-led.lit").forEach((led: Element) => led.classList.remove("lit"));
}
function stopBeatClockIfIdle() {
  if (!clockRunning || !shouldStopIdleClock(
    clockHold > 0, metronomeEnabled, recording || counting,
    queued.size > 0 || pending.size > 0, [...voices.values()].some((voice) => voice.source.loop),
  )) return;
  clockRunning = false;
  if (metronomeTimer) clearTimeout(metronomeTimer);
  metronomeTimer = null;
  beatNumber = 0;
  nextBeat = performance.now();
}
function updateMetronome() {
  if (!clockRunning && (metronomeEnabled || recording || counting)) resetBeatClock();
  stopBeatClockIfIdle();
  resetBeatIfIdle();
}
function showBeat(beat: number) {
  const indicator = $("beat-indicator");
  indicator.setAttribute("aria-label", `Beat ${beat + 1} of 4`);
  indicator.querySelectorAll(".beat-led").forEach((led: HTMLElement, index: number) => {
    led.classList.remove("lit");
    if (index === beat) { void led.offsetWidth; led.classList.add("lit"); }
  });
}
function beatTick() {
  if (!clockRunning) return;
  const now = performance.now();
  if (now >= nextBeat) {
    const interval = 60000 / bpm;
    const steps = Math.floor((now - nextBeat) / interval) + 1;
    const running = context?.state === "running";
    const metronomeActive = running && !counting && (metronomeEnabled || (recording && metronomeOnRecord));
    if (beatDisplayActive()) {
      const currentBeat = beatNumber + steps - 1;
      firstDisplayBeat ??= currentBeat;
      showBeat(displayBeatIndex(currentBeat, firstDisplayBeat));
    } else resetBeatIfIdle();
    if (metronomeActive) clickSound(context!, beatNumber % 4 === 0);
    beatNumber += steps;
    nextBeat += steps * interval;
  }
  stopBeatClockIfIdle();
  if (clockRunning) metronomeTimer = setTimeout(beatTick, Math.max(0, nextBeat - performance.now()));
}
function resetBeatClock(leadMs = 0) {
  const now = performance.now();
  const previousPosition = clockRunning ? beatNumber + (now - nextBeat) / (60000 / bpm) : 0;
  const newPosition = -leadMs / (60000 / bpm);
  const shift = previousPosition - newPosition;
  for (const voice of voices.values()) {
    voice.startBeat = rebaseBeat(voice.startBeat, shift);
    voice.triggerOrigin = rebaseBeat(voice.triggerOrigin, shift);
  }
  for (const entry of queued.values()) {
    entry.beat = rebaseBeat(entry.beat, shift);
    entry.origin = rebaseBeat(entry.origin, shift);
  }
  beatNumber = 0;
  firstDisplayBeat = null;
  nextBeat = now + leadMs;
  clockRunning = true;
  if (metronomeTimer) clearTimeout(metronomeTimer);
  if (leadMs) metronomeTimer = setTimeout(beatTick, leadMs);
  else beatTick();
  scheduleQueue();
}
function setRecordButtonState(state: "ready" | "recording" | "counting" | "finishing") {
  const label = { ready: "Record WAV", recording: "Stop recording", counting: "Cancel count-in", finishing: "Finishing recording" }[state];
  const button = $("record") as HTMLButtonElement;
  button.dataset.label = label;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = state === "ready"
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/></svg>';
}
function startCount(ac: AudioContext): Promise<boolean> {
  counting = true;
  updateMetronome();
  setRecordButtonState("counting");
  $("countdown-overlay").hidden = false;
  const interval = 60000 / bpm;
  return new Promise((resolve) => {
    let beat = 0;
    const finish = (completed: boolean) => {
      if (countdownTimer) clearTimeout(countdownTimer);
      countdownTimer = null;
      cancelCount = null;
      counting = false;
      $("countdown-overlay").hidden = true;
      updateMetronome();
      resolve(completed);
    };
    cancelCount = () => finish(false);
    const tick = () => {
      if (beat === 4) {
        finish(true);
        return;
      }
      $("countdown-number").textContent = String(++beat);
      clickSound(ac, beat === 1);
      countdownTimer = setTimeout(tick, interval);
    };
    tick();
  });
}
$("bpm").onchange = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value);
  const oldBpm = bpm;
  bpm = Number.isFinite(value)
    ? Math.max(40, Math.min(240, Math.round(value)))
    : 120;
  nextBeat = nextBeatAtTempo(performance.now(), nextBeat, oldBpm, bpm);
  $("bpm").value = String(bpm);
  $("bpm-slider").value = String(bpm);
  for (const [index] of voices) {
    if (pads[index]?.mode === "loop-cut" || (context && voices.get(index)!.startedAt > context.currentTime)) refreshVoice(index);
  }
  renderEditor();
  logGeneral("BPM changed", bpm);
  if (metronomeTimer) clearTimeout(metronomeTimer);
  beatTick();
  scheduleQueue();
};
$("bpm-slider").oninput = (event: Event) => {
  $("bpm").value = (event.target as HTMLInputElement).value;
  $("bpm").dispatchEvent(new Event("change", { bubbles: true }));
};
function renderMetronomeButton() {
  $("metronome").setAttribute("aria-pressed", String(metronomeEnabled));
  $("metronome").classList.toggle("active", metronomeEnabled);
}
let metronomeChange = 0;
async function setMetronome(enabled: boolean) {
  const change = ++metronomeChange;
  metronomeEnabled = enabled;
  saveGeneralOptions();
  logGeneral("Metronome changed", { enabled, bpm, audioState: context?.state });
  renderMetronomeButton();
  if (!enabled) {
    updateMetronome();
    return;
  }
  try {
    await audio();
    if (metronomeEnabled && change === metronomeChange) resetBeatClock();
  } catch {
    if (change !== metronomeChange) return;
    metronomeEnabled = false;
    saveGeneralOptions();
    renderMetronomeButton();
    updateMetronome();
    status("Metronome audio is unavailable.");
  }
}
$("metronome").onclick = () => { void setMetronome(!metronomeEnabled); };
$("metronome-volume").oninput = (event: Event) => {
  metronomeVolume = Number((event.target as HTMLInputElement).value);
  $("metronome-volume-value").textContent =
    `${Math.round(metronomeVolume * 100)}%`;
};
$("metronome-on-record").onchange = (event: Event) => {
  metronomeOnRecord = (event.target as HTMLInputElement).checked;
  if (recording) updateMetronome();
};
$("countdown").onchange = (event: Event) => {
  countdownEnabled = (event.target as HTMLInputElement).checked;
};
const worklet = `class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.active = false; this.port.onmessage = e => { if (e.data === 'start') this.active = true; if (e.data === 'stop') { this.active = false; this.port.postMessage({done:true}); } }; }
  process(inputs, outputs) { const input = inputs[0]; if (this.active) { const l = input[0] ? input[0].slice() : new Float32Array(outputs[0][0].length), r = input[1] ? input[1].slice() : l.slice(); this.port.postMessage({l,r}, [l.buffer,r.buffer]); } return true; }
} registerProcessor('performance-capture', Capture);`;
async function toggleRecord() {
  logGeneral("Record requested", {
    recording,
    stopping,
    recordStarting,
    counting,
    countdownEnabled,
  });
  if (counting) {
    cancelCount?.();
    return;
  }
  if (stopping || recordStarting) return;
  if (recording) {
    recording = false;
    updateMetronome();
    stopping = true;
    logGeneral("Recording stopping", { frames: recordFrames });
    recorder!.port.postMessage("stop");
    $("record").disabled = true;
    setRecordButtonState("finishing");
    return;
  }
  recordStarting = true;
  try {
    const ac = await audio();
    if (!recorder) {
      const url = URL.createObjectURL(
        new Blob([worklet], { type: "text/javascript" }),
      );
      try {
        await ac.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      recorder = new AudioWorkletNode(ac, "performance-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      master!.connect(recorder);
      recorder.connect(ac.destination);
      recorder.port.onmessage = (event) => {
        if (event.data.done) {
          stopping = false;
          $("record").disabled = false;
          setRecordButtonState("ready");
          $("record").classList.remove("recording");
          render();
          if (!recordFrames) {
            status("No audio was captured. Please try again.");
            return;
          }
          try {
            const buffer = ac.createBuffer(2, recordFrames, ac.sampleRate);
            let offset = 0;
            for (let i = 0; i < left.length; i++) {
              buffer.getChannelData(0).set(left[i], offset);
              buffer.getChannelData(1).set(right[i], offset);
              offset += left[i].length;
            }
            const url = URL.createObjectURL(
                new Blob([new Uint8Array(encodeWav(buffer))], {
                  type: "audio/wav",
                }),
              ),
              link = document.createElement("a");
            link.href = url;
            link.download = "sample-one-performance.wav";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            status("Performance exported as WAV.");
          } catch (e) {
            status(`Recording export failed: ${(e as Error).message}`);
          } finally {
            left = [];
            right = [];
            recordFrames = 0;
          }
        } else {
          left.push(event.data.l);
          right.push(event.data.r);
          recordFrames += event.data.l.length;
        }
      };
    }
    if (countdownEnabled && !(await startCount(ac))) {
      setRecordButtonState("ready");
      return;
    }
    left = [];
    right = [];
    recordFrames = 0;
    recording = true;
    updateMetronome();
    logGeneral("Recording started", { sampleRate: ac.sampleRate });
    recorder.port.postMessage("start");
    setRecordButtonState("recording");
    $("record").classList.add("recording");
    status("Recording performance…");
  } catch (e) {
    status(`Recording unavailable: ${(e as Error).message}`);
    setRecordButtonState("ready");
  } finally {
    recordStarting = false;
  }
}
$("edit-mode").onclick = () => {
  mode = "edit";
  render();
};
$("play-mode").onclick = () => {
  mode = "play";
  selected = null;
  render();
};
$("bank-prev").onclick = () => {
  stopAll();
  bank--;
  selected = null;
  render();
};
$("bank-next").onclick = () => {
  stopAll();
  bank++;
  selected = null;
  render();
};
$("bank-add").onclick = () => {
  stopAll();
  pads.push(...Array(16).fill(null));
  bank = pads.length / 16 - 1;
  selected = null;
  learning = false;
  render();
};
$("project-export").onclick = () => {
  try {
    downloadProject(
      exportProject("player", {
        pads,
        bank,
        mode,
        selected,
        masterVolume,
        defaultMode,
        midiMappings,
        controlMidi,
        bpm,
        defaultTriggerBeats,
        defaultTriggerDelay,
        groupModes,
        metronomeEnabled,
        metronomeVolume,
        metronomeOnRecord,
        countdownEnabled,
        generalLog,
        midiLog,
        midiButtonType,
        midiButtonTypes,
      }),
      "sample-one-player-project.zip",
    );
    status("Project exported.");
  } catch (e) {
    status(`Project export failed: ${(e as Error).message}`);
  }
};
$("project-import").onclick = () => $("project-file").click();
$("project-file").onchange = async (event: Event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (recording || stopping || counting || recordStarting) {
    status("Stop recording before importing.");
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isProjectZip(bytes)) {
      await loadZip(file, bytes);
      return;
    }
    const ac = await audio(),
      saved = importProject(bytes, "player", ac);
    if (
      !Array.isArray(saved.pads) ||
      !saved.pads.length ||
      saved.pads.length % 16 ||
      saved.pads.some(
        (pad: Pad | null) =>
          pad !== null &&
          (!(pad.buffer instanceof AudioBuffer) ||
            typeof pad.name !== "string" ||
            (pad.loopBeats !== undefined && ![0, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32].includes(pad.loopBeats)) ||
            (pad.triggerDelay !== undefined && (!Number.isFinite(pad.triggerDelay) || pad.triggerDelay < 0 || pad.triggerDelay > 16)) ||
            (pad.triggerBeats !== undefined && (!Number.isFinite(pad.triggerBeats) || pad.triggerBeats < 0 || pad.triggerBeats > 1024)) ||
            ((pad as any).quantize !== undefined && typeof (pad as any).quantize !== "boolean") ||
            (pad.group !== undefined && !["", "1", "2", "3", "4", "5", "6", "7", "8"].includes(pad.group)) ||
            !["one-shot", "loop", "gate", "loop-cut"].includes(pad.mode)),
      )
    )
      throw new Error("Invalid player project state.");
    if (
      !Number.isInteger(saved.bank) ||
      saved.bank < 0 ||
      saved.bank >= saved.pads.length / 16 ||
      !["play", "edit"].includes(saved.mode)
    )
      throw new Error("Invalid player project settings.");
    const restoredMappings =
      saved.midiMappings === undefined
        ? midiFromLegacy(saved.pads)
        : saved.midiMappings;
    if (
      !validateMidiMappings(restoredMappings) ||
      (saved.masterVolume !== undefined &&
        (!Number.isFinite(saved.masterVolume) ||
          saved.masterVolume < 0 ||
          saved.masterVolume > 2)) ||
      (saved.defaultMode !== undefined &&
        !["one-shot", "loop", "gate", "loop-cut"].includes(saved.defaultMode))
    )
      throw new Error("Invalid player project options.");
    if (saved.midiButtonTypes !== undefined && !validButtonTypes(saved.midiButtonTypes))
      throw new Error("Invalid MIDI button types.");
    if (saved.groupModes !== undefined && !validGroupModes(saved.groupModes))
      throw new Error("Invalid group modes.");
    if (saved.controlMidi !== undefined && !validControlMidi(saved.controlMidi))
      throw new Error("Invalid MIDI control mappings.");
    if (
      saved.bpm !== undefined &&
      (!Number.isFinite(saved.bpm) || saved.bpm < 40 || saved.bpm > 240)
    )
      throw new Error("Invalid BPM.");
    if (
      saved.metronomeVolume !== undefined &&
      (!Number.isFinite(saved.metronomeVolume) ||
        saved.metronomeVolume < 0 ||
        saved.metronomeVolume > 1)
    )
      throw new Error("Invalid metronome volume.");
    stopAll();
    pads = saved.pads.map((pad: Pad | null) =>
      pad ? { ...pad, triggerDelay: beatInterval(pad.triggerDelay), triggerBeats: beatInterval(pad.triggerBeats, (pad as any).quantize === true || ((pad as any).quantize === undefined && saved.quantize === true) ? 1 : 0) } : null,
    );
    midiMappings = restoredMappings;
    controlMidi = saved.controlMidi || {};
    bpm = saved.bpm ?? 120;
    nextBeat = performance.now() + 60000 / bpm;
    if (metronomeTimer) clearTimeout(metronomeTimer);
    beatTick();
    defaultTriggerBeats = beatInterval(saved.defaultTriggerBeats, saved.quantize === true ? 1 : 0);
    defaultTriggerDelay = beatInterval(saved.defaultTriggerDelay);
    groupModes = saved.groupModes?.slice() ?? Array(8).fill("one");
    metronomeEnabled = saved.metronomeEnabled === true;
    metronomeVolume = saved.metronomeVolume ?? 1;
    metronomeOnRecord = saved.metronomeOnRecord === true;
    countdownEnabled = saved.countdownEnabled === true;
    generalLog = saved.generalLog === true;
    midiLog = saved.midiLog === true;
    midiButtonType = saved.midiButtonType === "toggle" ? "toggle" : "momentary";
    midiButtonTypes = saved.midiButtonTypes ? { ...saved.midiButtonTypes } : {};
    heldCc.clear();
    lastBpmCc = null;
    updateMetronome();
    masterVolume = saved.masterVolume ?? 1;
    defaultMode = saved.defaultMode ?? "one-shot";
    if (master) master.gain.value = masterVolume;
    saveMidi();
    saveGeneralOptions();
    bank = saved.bank;
    mode = saved.mode;
    selected =
      mode === "edit" &&
      Number.isInteger(saved.selected) &&
      saved.selected >= 0 &&
      saved.selected < pads.length
        ? saved.selected
        : null;
    learning = false;
    learnedNote = null;
    render();
    if (
      (Object.keys(controlMidi).length > 0 ||
        midiMappings.shared.some(Boolean) ||
        Object.values(midiMappings.banks).some((notes) =>
          notes.some(Boolean),
        )) &&
      navigator.requestMIDIAccess
    ) {
      try {
        midi ||= await navigator.requestMIDIAccess();
        midi.onstatechange = connectMidi;
        connectMidi();
      } catch {
        status("Project imported; MIDI access was unavailable.");
        return;
      }
    }
    status("Project imported.");
  } catch (e) {
    status(`Import failed: ${(e as Error).message}`);
  }
};
$("stop-all").onclick = stopAll;
$("record").onclick = toggleRecord;
$("load-pad").onclick = () => $("audio-file").click();
$("audio-file").onchange = (e: Event) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (file && selected !== null) void loadPad(file, selected);
  input.value = "";
};
$("remove-pad").onclick = () => {
  if (selected !== null) {
    stopPad(selected);
    pads[selected] = null;
    learning = false;
    render();
  }
};
function reconcileGroup(group: string | undefined, preferred?: number) {
  if (!group) return;
  const members = pads.flatMap((pad, index) => pad?.group === group ? [index] : []);
  if (!members.length) { groupDesired.delete(group); return; }
  const active = (index: number) => voices.has(index) || pending.has(index) || queued.get(index)?.action === "start";
  const candidates = members.filter(active);
  if (exclusiveGroup(group)) {
    const keep = groupSurvivor(candidates, [...voices.keys()], preferred);
    for (const index of members) if (index !== keep) stopPad(index, true);
    groupDesired.delete(group);
  } else {
    const preferredOn = preferred !== undefined && active(preferred) && queued.get(preferred)?.action !== "stop";
    const on = !!candidates.length && (preferredOn || (groupDesired.get(group) ?? true));
    groupDesired.set(group, on);
    if (on) {
      const reference = (preferred !== undefined ? voices.get(preferred) : undefined)
        ?? candidates.map((index) => voices.get(index)).find(Boolean);
      const origin = reference?.triggerOrigin ?? clockPosition();
      for (const index of members) {
        if (queued.get(index)?.action === "stop") queued.delete(index);
        if (!active(index)) void triggerPad(index, origin, true);
      }
    }
  }
  scheduleQueue();
  updateLights();
}
$("pad-quantize").onchange = (e: Event) => {
  if (selected === null || !pads[selected]) return;
  const value = beatInterval(Number((e.target as HTMLInputElement).value));
  pads[selected]!.triggerBeats = value;
  (e.target as HTMLInputElement).value = String(value);
  reschedulePadAction(selected);
};
$("pad-trigger-delay").onchange = (e: Event) => {
  if (selected === null || !pads[selected]) return;
  pads[selected]!.triggerDelay = beatInterval(Number((e.target as HTMLSelectElement).value));
  reschedulePadAction(selected);
};
for (let index = 0; index < 8; index++) {
  $("group-mode-" + (index + 1)).onchange = (event: Event) => {
    const group = String(index + 1);
    groupModes[index] = (event.target as HTMLSelectElement).value === "all" ? "all" : "one";
    reconcileGroup(group);
    saveGeneralOptions();
  };
}
$("default-trigger-delay").onchange = (e: Event) => {
  defaultTriggerDelay = beatInterval(Number((e.target as HTMLSelectElement).value));
  saveGeneralOptions();
};
$("pad-loop-beats").onchange = (e: Event) => {
  if (selected === null || !pads[selected]) return;
  pads[selected]!.loopBeats = Number((e.target as HTMLSelectElement).value);
  if (pads[selected]!.mode === "loop-cut") refreshVoice(selected);
  renderEditor();
};
$("pad-group").onchange = (e: Event) => {
  if (selected === null || !pads[selected]) return;
  const index = selected;
  const oldGroup = pads[index]!.group;
  const group = (e.target as HTMLSelectElement).value;
  pads[index]!.group = group;
  const button = document.querySelector<HTMLButtonElement>(`[data-pad="${index}"]`);
  if (button) updatePadGroupBadge(button, index);
  reconcileGroup(oldGroup);
  reconcileGroup(group, index);
};
$("quantize").onchange = (e: Event) => {
  defaultTriggerBeats = beatInterval(Number((e.target as HTMLInputElement).value));
  (e.target as HTMLInputElement).value = String(defaultTriggerBeats);
  saveGeneralOptions();
};
$("pad-name-display").onclick = () => {
  if (selected === null || !pads[selected]) return;
  editingPadName = selected;
  originalPadName = pads[selected]!.name;
  $("pad-name").value = originalPadName;
  $("pad-name-display").hidden = true;
  $("pad-name").hidden = false;
  $("pad-name").focus();
  $("pad-name").select();
};
$("pad-name").onblur = () => {
  editingPadName = null;
  renderEditor();
};
$("pad-name").onkeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && selected !== null && pads[selected]) {
      pads[selected]!.name = originalPadName;
      const name = document.querySelector(`[data-pad="${selected}"] .pad-name`);
      if (name) name.textContent = originalPadName;
    }
    $("pad-name").blur();
  }
};
$("pad-name").oninput = (e: Event) => {
  if (selected !== null && pads[selected]) {
    pads[selected]!.name = (e.target as HTMLInputElement).value;
    const name = document.querySelector(`[data-pad="${selected}"] .pad-name`);
    if (name) name.textContent = pads[selected]!.name;
  }
};
for (const field of [
  "mode",
  "volume",
  "pan",
  "pitch",
  "fadein",
  "fadeout",
] as const)
  $("pad-" + field).oninput = (e: Event) => {
    if (selected === null || !pads[selected]) return;
    const pad = pads[selected]!;
    if (field === "mode") pad.mode = (e.target as HTMLSelectElement).value;
    else pad[field] = Number((e.target as HTMLInputElement).value);
    const voice = voices.get(selected);
    if (field === "mode" || field === "pitch") refreshVoice(selected);
    else if (field === "pan" && voice && context) voice.pan.pan.setTargetAtTime(pad.pan, context.currentTime, 0.005);
    else if (field === "volume" || field === "fadein" || field === "fadeout") updateVoiceGain(selected);
    renderEditor();
  };
function connectMidi() {
  if (midi)
    for (const input of midi.inputs.values()) input.onmidimessage = handleMidi;
  renderMidiTable();
}
function handleMidi(event: MIDIMessageEvent) {
  if (!event.data) return;
  const [byte, note, velocity] = event.data,
    kind = byte & 0xf0,
    channel = byte & 15;
  logMidi("Received", {
    input: (event.target as MIDIInput)?.id,
    data: [...event.data],
    learning,
  });
  if (kind !== 0x90 && kind !== 0x80 && kind !== 0xb0) return;
  const inputId = (event.target as MIDIInput).id;
  const down = kind === 0x90 && velocity > 0,
    key = `${inputId}:${channel}:${note}`;
  if (learning) {
    if (down || (kind === 0xb0 && velocity > 0)) {
      learnedNote = {
        channel,
        note,
        kind: kind === 0xb0 ? "cc" : "note",
        inputId,
      };
      render();
    }
    return;
  }
  if (kind === 0xb0) {
    const control = midiButtonIds.find((id) => {
      const mapping = controlMidi[id];
      return mapping?.kind === "cc" && mapping.channel === channel && mapping.note === note && matchesMidiInput(mapping, inputId);
    });
    if (control) {
      if (ccPressed(heldCc, key, velocity, (midiButtonTypes[control] ?? midiButtonType) === "toggle")) activateMidiControl(control);
      return;
    }
    const mapping = controlMidi["master-volume"];
    if (
      mapping?.kind === "cc" &&
      mapping.channel === channel &&
      mapping.note === note &&
      matchesMidiInput(mapping, inputId)
    ) {
      setMasterVolume((velocity / 127) * 2);
      return;
    }
    const bpmMapping = controlMidi["bpm"];
    if (
      bpmMapping?.kind === "cc" &&
      bpmMapping.channel === channel &&
      bpmMapping.note === note &&
      matchesMidiInput(bpmMapping, inputId)
    ) {
      const next = bpmFromCc(bpm, lastBpmCc, velocity);
      logMidi("BPM CC", { value: velocity, previous: lastBpmCc, bpm: next });
      lastBpmCc = velocity;
      if (next !== bpm) {
        $("bpm").value = String(next);
        $("bpm").dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const ccKey = `cc:${key}`;
    if (velocity === 0) {
      heldCc.delete(ccKey);
      (heldMidi.get(ccKey) || []).forEach(release);
      heldMidi.delete(ccKey);
    } else if (ccPressed(heldCc, ccKey, velocity)) {
      triggerMidiPads("cc", channel, note, inputId, ccKey);
    }
    return;
  }
  if (!down) {
    (heldMidi.get(key) || []).forEach(release);
    heldMidi.delete(key);
    return;
  }
  if (heldMidi.has(key)) return;
  const control = [
    "record",
    "stop-all",
    "bank-prev",
    "bank-next",
    "metronome",
  ].find((id) => {
    const mapping = controlMidi[id];
    return (
      mapping?.kind === "note" &&
      mapping.channel === channel &&
      mapping.note === note &&
      matchesMidiInput(mapping, inputId)
    );
  });
  if (control) {
    activateMidiControl(control);
    heldMidi.set(key, []);
    return;
  }
  if (
    Object.values(controlMidi).some(
      (mapping) =>
        mapping.kind === "note" &&
        mapping.channel === channel &&
        mapping.note === note &&
        mapping.inputId === inputId,
    )
  )
    return;
  triggerMidiPads("note", channel, note, inputId, key);
}
function triggerMidiPads(mappingKind: "note" | "cc", channel: number, note: number, inputId: string, key: string) {
  const indexes: number[] = [];
  for (let i = bank * 16; i < bank * 16 + 16; i++) {
    const mapping = midiBank(midiMappings, bank)[i % 16];
    if (
      pads[i] &&
      (mapping?.kind ?? "note") === mappingKind &&
      mapping?.channel === channel &&
      mapping.note === note &&
      matchesMidiInput(mapping, inputId)
    )
      indexes.push(i);
  }
  const triggeredGroups = new Set<string>();
  const uniqueIndexes = indexes.filter((index) => {
    const group = pads[index]?.group;
    if (!group || exclusiveGroup(group)) return true;
    if (triggeredGroups.has(group)) return false;
    triggeredGroups.add(group);
    return true;
  });
  heldMidi.set(key, uniqueIndexes);
  uniqueIndexes.forEach((index) => {
    if (mode === "edit") {
      selected = index;
      render();
    }
    void trigger(index);
  });
}
function matchesMidiInput(mapping: { inputId?: string }, inputId: string) {
  const unbound = !mapping.inputId;
  const matches = claimMidiInput(mapping, inputId);
  if (unbound && matches) {
    saveMidi();
    logMidi("Existing MIDI mapping bound to input", { input: inputId });
  }
  return matches;
}
function activateMidiControl(id: string) {
  logMidi("Control activated", {
    id,
    disabled: $(id).disabled,
    recording,
    metronomeEnabled,
  });
  if (id === "metronome") void setMetronome(!metronomeEnabled);
  else $(id).click();
}
function assignLearnedNote(index: number) {
  if (!learnedNote) {
    status("Play a MIDI note first.");
    return;
  }
  midiBank(midiMappings, Math.floor(index / 16))[index % 16] = {
    channel: learnedNote.channel,
    note: learnedNote.note,
    kind: learnedNote.kind,
    inputId: learnedNote.inputId,
  };
  saveMidi();
  status(`Assigned ${learnedNote.kind === "cc" ? "CC" : "note"} ${learnedNote.note} to pad ${labels[index % 16]}.`);
  learnedNote = null;
  render();
}
function assignControl(id: string) {
  if (!learnedNote) {
    status("Play a MIDI note or move a controller first.");
    return;
  }
  const expected = ["master-volume", "bpm"].includes(id)
    ? "cc"
    : learnedNote.kind;
  if (learnedNote.kind !== expected) {
    status(
      expected === "cc"
        ? `Move a MIDI CC control for ${id === "bpm" ? "BPM" : "master volume"}.`
        : "Use a MIDI note for this control.",
    );
    return;
  }
  for (const [other, mapping] of Object.entries(controlMidi)) {
    if (
      other !== id &&
      mapping.kind === learnedNote.kind &&
      mapping.channel === learnedNote.channel &&
      mapping.note === learnedNote.note &&
      (!mapping.inputId || mapping.inputId === learnedNote.inputId)
    )
      delete controlMidi[other];
  }
  controlMidi[id] = { ...learnedNote };
  if (id === "bpm") lastBpmCc = null;
  logMidi("Control assigned", { id, mapping: controlMidi[id] });
  saveMidi();
  status(
    `MIDI ${expected === "cc" ? "CC" : "note"} ${learnedNote.note} assigned to ${id.replaceAll("-", " ")}.`,
  );
  learnedNote = null;
  render();
}
function learnTarget(event: Event) {
  if (!learning) return;
  const target = event.target as Element;
  const selectors = midiControlIds.map((id) => `#${id}`).join(",");
  const control =
    target.closest<HTMLElement>(selectors) ||
    target.closest("label")?.querySelector<HTMLElement>(selectors);
  if (!control) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type !== "click") assignControl(control.id);
}
document.addEventListener("pointerdown", learnTarget, true);
document.addEventListener("click", learnTarget, true);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter" || event.key === " ") learnTarget(event);
  },
  true,
);
$("midi-learn").onclick = async () => {
  if (learning) {
    learning = false;
    learnedNote = null;
    render();
    return;
  }
  const button = $("midi-learn");
  button.disabled = true;
  try {
    if (!navigator.requestMIDIAccess)
      throw new Error("MIDI requires a supported browser and HTTPS.");
    const [access] = await Promise.all([
      midi ? Promise.resolve(midi) : navigator.requestMIDIAccess(),
      audio(),
    ]);
    midi = access;
    midi.onstatechange = connectMidi;
    connectMidi();
    stopAll();
    learnedNote = null;
    learning = true;
    render();
    if (!midi.inputs.size) status("Connect a MIDI controller and play a note.");
  } catch (e) {
    status(`MIDI unavailable: ${(e as Error).message}`);
  } finally {
    button.disabled = false;
  }
};
$("midi-clear").onclick = () => {
  if (selected !== null) {
    midiBank(midiMappings, Math.floor(selected / 16))[selected % 16] = null;
    if (pads[selected]) pads[selected]!.midi = null;
    saveMidi();
    render();
  }
};
function setMasterVolume(value: number) {
  masterVolume = Math.round(Math.max(0, Math.min(2, value)) * 100) / 100;
  $("master-volume").value = String(masterVolume);
  if (master && context)
    master.gain.setTargetAtTime(masterVolume, context.currentTime, 0.01);
  $("master-volume-value").textContent = `${Math.round(masterVolume * 100)}%`;
  saveGeneralOptions();
}
$("general-log").onchange = (event: Event) => {
  generalLog = (event.target as HTMLInputElement).checked;
  if (generalLog) logGeneral("General logging enabled");
};
$("midi-log").onchange = (event: Event) => {
  midiLog = (event.target as HTMLInputElement).checked;
  if (midiLog) logMidi("MIDI logging enabled");
};
const generalOptionIds = new Set([
  "bpm",
  "metronome-volume",
  "metronome-on-record",
  "countdown",
  "default-mode",
  "midi-individual",
  "general-log",
  "midi-log",
]);
for (const eventName of ["input", "change"])
  document.addEventListener(eventName, (event) => {
    if (generalOptionIds.has((event.target as HTMLElement)?.id))
      saveGeneralOptions();
  });
// Browsers require a user gesture before restoring an enabled metronome can make sound.
function resumeSavedMetronome() {
  if (!metronomeEnabled || context?.state === "running" || counting) return;
  void audio()
    .then(() => {
      if (metronomeEnabled && !counting) updateMetronome();
    })
    .catch(() => status("Metronome audio is unavailable."));
}
document.addEventListener("click", resumeSavedMetronome);
document.addEventListener("keydown", resumeSavedMetronome);
document.addEventListener("click", (event) => {
  const element = (event.target as Element).closest("button, a, input, select");
  if (element) logGeneral("UI click", { id: element.id, tag: element.tagName });
});
document.addEventListener("change", (event) => {
  const element = event.target as HTMLInputElement;
  if (element?.id && element.type !== "file")
    logGeneral("Control changed", {
      id: element.id,
      value: element.type === "checkbox" ? element.checked : element.value,
    });
});
window.addEventListener("error", (event) => logGeneral("Error", event.message));
window.addEventListener("unhandledrejection", (event) =>
  logGeneral("Unhandled rejection", String(event.reason)),
);
$("master-volume").oninput = (event: Event) =>
  setMasterVolume(Number((event.target as HTMLInputElement).value));
$("default-mode").onchange = (event: Event) => {
  defaultMode = (event.target as HTMLSelectElement).value;
};
$("midi-individual").onchange = (event: Event) => {
  midiMappings.individual = (event.target as HTMLInputElement).checked;
  midiBank(midiMappings, bank);
  saveMidi();
  render();
};
$("midi-preserve").onchange = (event: Event) => {
  preserveMidi = (event.target as HTMLInputElement).checked;
  saveMidi();
};
$("midi-clear-all").onclick = () => {
  const individual = midiMappings.individual;
  midiMappings = newMidiMappings();
  midiMappings.individual = individual;
  controlMidi = {};
  lastBpmCc = null;
  for (const pad of pads) if (pad) pad.midi = null;
  learnedNote = null;
  saveMidi();
  render();
  status("MIDI mappings cleared.");
};
document.addEventListener("pointerdown", (event) => {
  if (mode !== "edit" || selected === null) return;
  const target = event.target as Element;
  if (target.closest("[data-pad], #editor, dialog")) return;
  selected = null;
  document
    .querySelectorAll("[data-pad].selected")
    .forEach((pad) => pad.classList.remove("selected"));
  renderEditor();
});
// A user gesture unlocks audio in browsers; prime it before a pad or metronome needs it.
function warmAudioOnGesture() {
  if (context?.state === "running" && audioWarmed) return;
  void audio().catch(() => {});
}
document.addEventListener("pointerdown", warmAudioOnGesture, true);
document.addEventListener("keydown", warmAudioOnGesture, true);
// Restored mappings need a fresh MIDI connection after a page reload.
let restoringMidi = false;
async function restoreSavedMidi() {
  if (!preserveMidi || midi || restoringMidi || !navigator.requestMIDIAccess)
    return;
  restoringMidi = true;
  try {
    const [access] = await Promise.all([
      navigator.requestMIDIAccess(),
      audio(),
    ]);
    midi = access;
    midi.onstatechange = connectMidi;
    connectMidi();
  } catch {
    /* The user can enable MIDI Learn to retry. */
  } finally {
    restoringMidi = false;
  }
}
document.addEventListener(
  "pointerdown",
  () => {
    void restoreSavedMidi();
  },
  { once: true },
);
document.addEventListener(
  "keydown",
  () => {
    void restoreSavedMidi();
  },
  { once: true },
);
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
    target.isContentEditable ||
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  if (e.key === "Escape") {
    stopAll();
    return;
  }
  if (target.tagName === "BUTTON" && (e.code === "Space" || e.code === "Enter"))
    return;
  if (learning) return;
  const i = keys.indexOf(e.code);
  if (i < 0) return;
  e.preventDefault();
  const index = bank * 16 + i;
  heldKeys.set(e.code, index);
  if (mode === "edit") {
    selected = index;
    render();
  }
  void trigger(index);
});
document.addEventListener("keyup", (e) => {
  const index = heldKeys.get(e.code) ?? heldButtonKeys.get(e.code);
  if (index !== undefined) {
    heldKeys.delete(e.code);
    heldButtonKeys.delete(e.code);
    release(index);
  }
});
window.addEventListener("blur", () => {
  for (const index of new Set([...heldKeys.values(), ...heldButtonKeys.values()])) release(index);
  heldKeys.clear();
  heldButtonKeys.clear();
});
window.addEventListener("pagehide", () => {
  cancelCount?.();
  metronomeEnabled = false;
  metronomeOnRecord = false;
  if (metronomeTimer) clearTimeout(metronomeTimer);
  if (queueTimer) clearTimeout(queueTimer);
  stopAll();
  void context?.close();
});
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});
initMidiTable();
$("midi-table-clear-all").onclick = () => $("midi-clear-all").click();
setupSliderReset();
render();
if (metronomeEnabled) resetBeatClock();
