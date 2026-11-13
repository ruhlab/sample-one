/** Select the closest supported beat value. */
export function beatInterval(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const choices = [0, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 4, 8, 16];
  return choices.reduce((best, choice) => Math.abs(choice - value) < Math.abs(best - value) ? choice : best, 0);
}

/** Whether the beats processed by a clock tick include an interval boundary. */
export function crossesBeatBoundary(firstBeat: number, beatCount: number, interval: number): boolean {
  return interval > 0 && Math.ceil(firstBeat / interval) * interval < firstBeat + beatCount;
}

/** Find the next interval boundary, then add the requested delay. */
export function triggerBeat(position: number, interval: number, delay: number): number {
  const boundary = interval ? Math.ceil((position + 1e-9) / interval) * interval : position;
  return boundary + delay;
}

/** Keep the current beat position fixed when changing tempo. */
export function nextBeatAtTempo(now: number, nextBeat: number, oldBpm: number, newBpm: number): number {
  return now + (nextBeat - now) * oldBpm / newBpm;
}

/** Wake ahead of grouped starts so the audio engine can schedule them precisely. */
export function queueWakeBeat(beat: number, bpm: number, groupedStart: boolean): number {
  return beat - (groupedStart ? 0.025 * bpm / 60 : 0);
}

/** Translate an existing beat coordinate when the clock's current position becomes zero. */
export function rebaseBeat(beat: number, previousPosition: number): number {
  return beat - previousPosition;
}
