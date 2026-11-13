/** Return the buffer-space endpoint for a loop in beats. */
export function loopCutEnd(
  duration: number,
  rate: number,
  bpm: number,
  beats: number,
): number {
  const samplesPerBeat = (60 / bpm) * rate;
  const beatCount =
    beats || Math.max(1, Math.floor((duration + 1e-9) / samplesPerBeat));
  return beatCount * samplesPerBeat;
}

/** Buffer offset at the current beat, preserving the loop's original launch phase. */
export function loopCutOffset(
  position: number,
  startBeat: number,
  loopEnd: number,
  rate: number,
  bpm: number,
): number {
  const loopBeats = ((loopEnd / rate) * bpm) / 60;
  const elapsed = Math.max(0, position - startBeat);
  return (((elapsed % loopBeats) * 60) / bpm) * rate;
}
