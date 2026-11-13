import { expect, test } from "bun:test";
import {
  groupTargets,
  nextGroupState,
  groupSurvivor,
} from "../src/features/player-groups.ts";

test("play all resolves every loaded group member across banks once", () => {
  const pads = Array(18).fill(null);
  pads[0] = { group: "1" };
  pads[2] = { group: "2" };
  pads[17] = { group: "1" };
  expect(groupTargets(pads, 0, true)).toEqual([0, 17]);
  expect(groupTargets(pads, 17, true)).toEqual([0, 17]);
  expect(groupTargets(pads, 0, false)).toEqual([0]);
  expect(groupTargets(pads, 1, true)).toEqual([1]);
});

test("group toggles share one state while members start and stop at different times", () => {
  expect(nextGroupState(undefined, false)).toBe(true);
  expect(nextGroupState(true, true)).toBe(false); // Some members are active or queued.
  expect(nextGroupState(false, true)).toBe(true); // A delayed stop is still pending.
  expect(nextGroupState(true, false)).toBe(true); // One-shots have all ended.
  expect(nextGroupState(undefined, true)).toBe(false); // Already-playing group members.
});

test("switching to an exclusive group keeps the edited or most recently started member", () => {
  expect(groupSurvivor([0, 1, 4], [0, 1], 0)).toBe(0);
  expect(groupSurvivor([0, 1, 4], [0, 1])).toBe(1);
  expect(groupSurvivor([4], [], 0)).toBe(4);
  expect(groupSurvivor([], [])).toBeUndefined();
});

test("re-enabling a mixed playing and queued group restarts every member on one launch", async () => {
  const { groupTogglePlan } = await import("../src/features/player-groups.ts");
  const { triggerBeat } = await import("../src/features/beat-interval.ts");
  const members = [
    { index: 0, playing: true },
    { index: 1, playing: false },
    { index: 2, playing: true },
    { index: 3, playing: false },
  ];
  expect(groupTogglePlan(false, members).map((entry) => entry.action)).toEqual([
    "stop",
    "cancel",
    "stop",
    "cancel",
  ]);
  expect(groupTogglePlan(true, members).map((entry) => entry.action)).toEqual([
    "restart",
    "restart",
    "restart",
    "restart",
  ]);
  const origin = 5.3;
  expect([0, 0, 1, 0.25].map((delay) => triggerBeat(origin, 1, delay))).toEqual(
    [6, 6, 7, 6.25],
  );
});
