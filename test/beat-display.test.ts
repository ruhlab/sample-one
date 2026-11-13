import { expect, test } from "bun:test";
import { shouldShowBeat, shouldResetForLoop, displayBeatIndex, shouldStopIdleClock } from "../src/features/beat-display.ts";

test("beat display follows loops, metronome and recording", () => {
  expect(shouldShowBeat(true, false, false, false)).toBe(false);
  expect(shouldShowBeat(true, false, false, true)).toBe(true);
  expect(shouldShowBeat(true, true, false, false)).toBe(true);
  expect(shouldShowBeat(true, false, true, false)).toBe(true);
  expect(shouldShowBeat(false, true, true, true)).toBe(false);
});

test("first loop resets an idle clock but not a running loop or metronome", () => {
  expect(shouldResetForLoop(true, false, false)).toBe(true);
  expect(shouldResetForLoop(true, true, false)).toBe(false);
  expect(shouldResetForLoop(true, false, true)).toBe(false);
  expect(shouldResetForLoop(false, false, false)).toBe(false);
});

test("first visible beat uses the first LED even after a delayed start", () => {
  expect([3, 4, 5, 6, 7].map((beat) => displayBeatIndex(beat, 3))).toEqual([0, 1, 2, 3, 0]);
});

test("the idle clock stops, but pending loops, metronome, and recording keep it running", () => {
  expect(shouldStopIdleClock(false, false, false, false, false)).toBe(true);
  expect(shouldStopIdleClock(false, false, false, true, false)).toBe(false);
  expect(shouldStopIdleClock(false, false, false, false, true)).toBe(false);
  expect(shouldStopIdleClock(false, true, false, false, false)).toBe(false);
  expect(shouldStopIdleClock(false, false, true, false, false)).toBe(false);
  expect(shouldStopIdleClock(true, false, false, false, false)).toBe(false);
});
