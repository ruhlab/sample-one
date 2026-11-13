import { expect, test } from "bun:test";
import {
  beatInterval,
  crossesBeatBoundary,
  triggerBeat,
  nextBeatAtTempo,
  queueWakeBeat,
  rebaseBeat,
} from "../src/features/beat-interval.ts";

test("beat intervals use supported values", () => {
  expect(beatInterval(0.0625)).toBe(0.0625);
  expect(beatInterval(0.125)).toBe(0.125);
  expect(beatInterval(3)).toBe(3);
  expect(beatInterval(-2)).toBe(0);
  expect(beatInterval(3.6)).toBe(4);
  expect(beatInterval(9999)).toBe(16);
  expect(beatInterval(undefined, 1)).toBe(1);
});

test("intervals follow the shared beat clock, including delayed ticks", () => {
  expect(crossesBeatBoundary(1, 1, 1)).toBe(true);
  expect(crossesBeatBoundary(1, 1, 4)).toBe(false);
  expect(crossesBeatBoundary(4, 1, 4)).toBe(true);
  expect(crossesBeatBoundary(3, 2, 4)).toBe(true);
  expect(crossesBeatBoundary(15, 1, 16)).toBe(false);
  expect(crossesBeatBoundary(16, 1, 16)).toBe(true);
  expect(crossesBeatBoundary(0, 1, 0)).toBe(false);
});

test("trigger delay follows the selected boundary", () => {
  expect(triggerBeat(2.1, 1, 0.25)).toBe(3.25);
  expect(triggerBeat(2.1, 0.125, 0)).toBe(2.125);
  expect(triggerBeat(2, 4, 2)).toBe(6);
  expect(triggerBeat(2.25, 0, 0.5)).toBe(2.75);
});

test("tempo changes preserve the beat position for queued delays", () => {
  expect(nextBeatAtTempo(1000, 1250, 120, 60)).toBe(1500);
  expect(nextBeatAtTempo(1000, 1250, 120, 240)).toBe(1125);
  expect(nextBeatAtTempo(1000, 900, 120, 60)).toBe(800);
});

test("group starts wake early for audio scheduling without advancing stops", () => {
  expect(queueWakeBeat(4, 120, true)).toBeCloseTo(3.95);
  expect(queueWakeBeat(4, 60, true)).toBeCloseTo(3.975);
  expect(queueWakeBeat(4, 120, false)).toBe(4);
});

test("timing edits recompute a queued or playing pad from its original press", () => {
  const pressedAt = 5.2;
  expect(triggerBeat(pressedAt, 1, 2)).toBe(8);
  expect(triggerBeat(pressedAt, 1, 0.5)).toBe(6.5);
  expect(triggerBeat(pressedAt, 4, 0.5)).toBe(8.5);
  expect(triggerBeat(pressedAt, 0, 0)).toBe(pressedAt);
});

test("resetting the clock preserves relative queued and playing beat positions", () => {
  const position = 17.25;
  expect(rebaseBeat(18, position)).toBe(0.75);
  expect(rebaseBeat(16, position)).toBe(-1.25);
  expect(rebaseBeat(position, position)).toBe(0);
});

test("an idle group launch starts the first quantized beat at zero", () => {
  const position = -40 / (60000 / 101);
  expect(
    [0, 0, 1, 0.25].map((delay) => triggerBeat(position, 1, delay)),
  ).toEqual([0, 0, 1, 0.25]);
});
