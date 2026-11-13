/** Prime the sample and metronome audio paths without producing audible output. */
export function warmPlayerAudio(
  context: AudioContext,
  destination: AudioNode,
): void {
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  const sample = context.createBufferSource();
  const click = context.createOscillator();
  gain.gain.value = 0;
  sample.buffer = context.createBuffer(1, 128, context.sampleRate);
  sample.connect(gain);
  click.connect(gain);
  gain.connect(pan);
  pan.connect(destination);
  let remaining = 2;
  const done = () => {
    if (--remaining !== 0) return;
    sample.disconnect();
    click.disconnect();
    gain.disconnect();
    pan.disconnect();
  };
  sample.onended = done;
  click.onended = done;
  const now = context.currentTime;
  sample.start(now);
  click.start(now);
  click.stop(now + 0.02);
}
