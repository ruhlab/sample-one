import test from "node:test";
import assert from "node:assert/strict";
import {
  newMidiMappings,
  midiBank,
  midiFromLegacy,
  midiLabel,
  validateMidiMappings,
} from "../src/features/player-midi.ts";

test("MIDI notes follow pad positions in shared mode and can be customized per bank", () => {
  const mappings = newMidiMappings(),
    first = { note: 60, channel: 0 },
    second = { note: 64, channel: 1 };
  midiBank(mappings, 0)[2] = first;
  assert.deepEqual(midiBank(mappings, 3)[2], first);
  mappings.individual = true;
  assert.deepEqual(midiBank(mappings, 1)[2], first);
  midiBank(mappings, 1)[2] = second;
  assert.deepEqual(midiBank(mappings, 0)[2], first);
  assert.deepEqual(midiBank(mappings, 1)[2], second);
  mappings.individual = false;
  assert.deepEqual(midiBank(mappings, 1)[2], first);
  mappings.individual = true;
  assert.deepEqual(midiBank(mappings, 1)[2], second);
  assert.ok(validateMidiMappings(JSON.parse(JSON.stringify(mappings))));
  assert.equal(midiLabel(second), "E4 · 2");
});

test("older pad projects migrate their MIDI assignments and invalid data is rejected", () => {
  const pads = Array.from({ length: 32 }, () => ({
    midi: null as { note: number; channel: number } | null,
  }));
  pads[0].midi = { note: 36, channel: 9 };
  pads[16].midi = { note: 48, channel: 9 };
  const mappings = midiFromLegacy(pads);
  assert.deepEqual(midiBank(mappings, 1)[0], pads[0].midi);
  mappings.individual = true;
  assert.deepEqual(midiBank(mappings, 1)[0], pads[16].midi);
  mappings.shared[0] = { note: 128, channel: 0 };
  assert.equal(validateMidiMappings(mappings), false);
});

test("a MIDI CC button activates once per press and resets on release", async () => {
  const { ccPressed } = await import("../src/features/player-midi.ts");
  const held = new Map<string, boolean>();
  assert.equal(ccPressed(held, "device:0:42", 127), true);
  assert.equal(ccPressed(held, "device:0:42", 127), false);
  assert.equal(ccPressed(held, "device:0:42", 0), false);
  assert.equal(ccPressed(held, "device:0:42", 127), true);
});

test("BPM MIDI movement reaches individual beats and respects limits", async () => {
  const { bpmFromCc } = await import("../src/features/player-midi.ts");
  assert.equal(bpmFromCc(120, null, 80), 120);
  assert.equal(bpmFromCc(120, 80, 81), 121);
  assert.equal(bpmFromCc(121, 81, 80), 120);
  assert.equal(bpmFromCc(239, 10, 20), 240);
  assert.equal(bpmFromCc(41, 20, 10), 40);
});

test("toggle-mode CC buttons activate on both alternating values", async () => {
  const { ccPressed } = await import("../src/features/player-midi.ts");
  const states = new Map<string, boolean>();
  assert.equal(ccPressed(states, "button", 127, true), true);
  assert.equal(ccPressed(states, "button", 127, true), false);
  assert.equal(ccPressed(states, "button", 0, true), true);
  assert.equal(ccPressed(states, "button", 0, true), false);
  assert.equal(ccPressed(states, "button", 127, true), true);
});

test("MIDI control mappings ignore matching messages from another input", async () => {
  const { claimMidiInput } = await import("../src/features/player-midi.ts");
  const learned = { inputId: "input-a" };
  assert.equal(claimMidiInput(learned, "input-a"), true);
  assert.equal(claimMidiInput(learned, "input-b"), false);
  const legacy: { inputId?: string } = {};
  assert.equal(claimMidiInput(legacy, "input-a"), true);
  assert.equal(legacy.inputId, "input-a");
  assert.equal(claimMidiInput(legacy, "input-b"), false);
});

test("pad mappings preserve input identity and accept older mappings", () => {
  const mappings = newMidiMappings();
  midiBank(mappings, 0)[0] = { channel: 0, note: 60, inputId: "input-a" };
  midiBank(mappings, 0)[1] = { channel: 0, note: 61 };
  assert.ok(validateMidiMappings(JSON.parse(JSON.stringify(mappings))));
  mappings.shared[0] = { channel: 0, note: 60, inputId: "" };
  assert.equal(validateMidiMappings(mappings), false);
});

test("pad mappings accept CC assignments while rejecting invalid MIDI types", () => {
  const mappings = newMidiMappings();
  mappings.shared[0] = { channel: 2, note: 74, kind: "cc" };
  assert.equal(validateMidiMappings(mappings), true);
  assert.equal(midiLabel(mappings.shared[0]!), "CC 74 · 3");
  (mappings.shared[0] as any).kind = "pitch-bend";
  assert.equal(validateMidiMappings(mappings), false);
});
