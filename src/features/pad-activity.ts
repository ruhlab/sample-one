export type PadActivity = "idle" | "waiting" | "playing";

/** A padded loop remains active while its playback position is beyond the source audio. */
export function padActivity(
  voice: { started: boolean; offset: number; audioDuration: number } | null,
  queuedStart: boolean,
  pending: boolean,
): PadActivity {
  if (voice)
    return voice.started && voice.offset < voice.audioDuration
      ? "playing"
      : "waiting";
  return queuedStart || pending ? "waiting" : "idle";
}

/** Leave a brief visual gap at the end of a full loop; audio is unaffected. */
export function loopDisplayDuration(
  audioDuration: number,
  loopEnd: number,
  rate: number,
): number {
  if (loopEnd <= 0) return audioDuration;
  const gap = Math.min(0.05 * rate, loopEnd * 0.15);
  return Math.min(audioDuration, loopEnd - gap);
}
