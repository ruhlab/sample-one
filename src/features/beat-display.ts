/** Show the beat only during a loop, metronome, or recording/count-in. */
export function shouldShowBeat(
  running: boolean,
  metronome: boolean,
  recording: boolean,
  playingLoop: boolean,
): boolean {
  return running && (metronome || recording || playingLoop);
}

/** A new loop starts a fresh beat clock only when no loop or metronome is running. */
export function shouldResetForLoop(
  startingLoop: boolean,
  loopRunning: boolean,
  metronomeRunning: boolean,
): boolean {
  return startingLoop && !loopRunning && !metronomeRunning;
}

export function displayBeatIndex(beat: number, firstBeat: number): number {
  return (((beat - firstBeat) % 4) + 4) % 4;
}

/** Pending starts and recordings keep the beat clock alive even before a loop sounds. */
export function shouldStopIdleClock(
  held: boolean,
  metronome: boolean,
  recording: boolean,
  queued: boolean,
  loopExists: boolean,
): boolean {
  return !held && !metronome && !recording && !queued && !loopExists;
}
