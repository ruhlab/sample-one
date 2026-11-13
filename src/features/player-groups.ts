/** Resolve one press into the pads it should trigger, across all banks. */
export function groupTargets(
  pads: readonly ({ group?: string } | null)[],
  index: number,
  playAll: boolean,
): number[] {
  const group = pads[index]?.group;
  if (!group || !playAll) return [index];
  return pads.flatMap((pad, target) => (pad?.group === group ? [target] : []));
}

/** A group with no remaining voices or starts is off, even if it was previously on. */
export function nextGroupState(
  desired: boolean | undefined,
  hasActiveOrStarting: boolean,
): boolean {
  return !(hasActiveOrStarting && (desired ?? true));
}

/** Keep the explicitly changed active pad, or the most recently started active pad. */
export function groupSurvivor(
  candidates: number[],
  voiceOrder: number[],
  preferred?: number,
): number | undefined {
  if (preferred !== undefined && candidates.includes(preferred))
    return preferred;
  return (
    [...voiceOrder].reverse().find((index) => candidates.includes(index)) ??
    candidates.at(-1)
  );
}

export type GroupMemberState = { index: number; playing: boolean };
/** A new activation restarts every member; deactivation cancels waiting starts and stops playing members. */
export function groupTogglePlan(
  turnOn: boolean,
  members: GroupMemberState[],
): { index: number; action: "restart" | "stop" | "cancel" }[] {
  return members.map(({ index, playing }) => ({
    index,
    action: turnOn ? "restart" : playing ? "stop" : "cancel",
  }));
}
