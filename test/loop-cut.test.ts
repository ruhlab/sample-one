import { expect, test } from "bun:test";
import { loopCutEnd, loopCutOffset } from "../src/features/loop-cut.ts";

test("loop cut trims to whole beats at the current tempo and playback rate", () => {
  expect(loopCutEnd(4.3, 1, 120, 0)).toBe(4);
  expect(loopCutEnd(4.3, 1, 120, 4)).toBe(2);
  expect(loopCutEnd(4.3, 2, 120, 4)).toBe(4);
  expect(loopCutEnd(4.3, 1, 60, 4)).toBe(4);
  expect(loopCutEnd(1, 1, 120, 4)).toBe(2);
  expect(loopCutEnd(0.3, 1, 120, 0)).toBe(0.5);
  expect(loopCutEnd(1, 1, 120, 0.5)).toBe(0.25);
  expect(loopCutEnd(1, 1, 120, 0.0625)).toBe(0.03125);
});

test("loop offset keeps its launch phase when the tempo changes", () => {
  expect(loopCutOffset(10.5, 7, 4, 1, 120)).toBe(1.75);
  expect(loopCutOffset(10.5, 7, 8, 1, 60)).toBe(3.5);
  expect(loopCutOffset(12.5, 7, 4, 1, 120)).toBe(2.75);
  expect(loopCutOffset(7.5, 7, 4, 2, 120)).toBe(0.5);
});
