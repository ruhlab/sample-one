import { expect, test } from "bun:test";
import {
  padActivity,
  loopDisplayDuration,
} from "../src/features/pad-activity.ts";

test("pad activity distinguishes playback, pending starts, and loop padding", () => {
  expect(padActivity(null, false, false)).toBe("idle");
  expect(padActivity(null, true, false)).toBe("waiting");
  expect(padActivity(null, false, true)).toBe("waiting");
  expect(
    padActivity({ started: false, offset: 0, audioDuration: 1 }, false, false),
  ).toBe("waiting");
  expect(
    padActivity({ started: true, offset: 0.9, audioDuration: 1 }, false, false),
  ).toBe("playing");
  expect(
    padActivity({ started: true, offset: 1.1, audioDuration: 1 }, false, false),
  ).toBe("waiting");
});

test("full and padded loops use the same transparent state between repeats", () => {
  const loopEnd = 0.297;
  const full = loopDisplayDuration(0.3, loopEnd, 1);
  const padded = loopDisplayDuration(0.252, loopEnd, 1);
  expect(full).toBeCloseTo(0.25245);
  expect(padded).toBeCloseTo(0.252);
  expect(
    padActivity(
      { started: true, offset: 0.27, audioDuration: full },
      false,
      false,
    ),
  ).toBe("waiting");
  expect(
    padActivity(
      { started: true, offset: 0.27, audioDuration: padded },
      false,
      false,
    ),
  ).toBe("waiting");
  expect(loopDisplayDuration(1, 0, 1)).toBe(1);
});
