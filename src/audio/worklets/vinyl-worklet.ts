// An original vinyl-style dynamics effect, not a model derived from Roland firmware.
class VinylProcessor extends AudioWorkletProcessor {
  envelope: number;
  reduction: number;
  reductionMemory: number;
  phase: number;
  seed: number;
  noiseLow: number;
  click: number;
  write: number;
  samples: number;
  delayLength: number;
  delay: Float32Array[];
  static get parameterDescriptors() {
    return [
      {
        name: "comp",
        defaultValue: 0.6,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "noise",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "wow",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "level",
        defaultValue: 0.8,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "mix",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }
  constructor() {
    super();
    this.envelope = 0;
    this.reduction = 0;
    this.reductionMemory = 0;
    this.phase = 0;
    this.seed = 0x31415926;
    this.noiseLow = 0;
    this.click = 0;
    this.write = 0;
    this.samples = 0;
    this.delayLength = Math.ceil(sampleRate * 0.012) + 4;
    this.delay = [];
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0],
      tone = inputs[1]?.length ? inputs[1] : input,
      output = outputs[0];
    if (!output.length) return true;
    const comp = parameters.comp[0],
      noise = parameters.noise[0],
      wow = parameters.wow[0],
      level = parameters.level[0],
      mix = parameters.mix[0];
    while (this.delay.length < output.length)
      this.delay.push(new Float32Array(this.delayLength));
    const detectorAttack = Math.exp(-1 / (sampleRate * 0.001)),
      detectorRelease = Math.exp(-1 / (sampleRate * 0.06));
    const clickDecay = Math.exp(-1 / (sampleRate * 0.001));
    const attack = Math.exp(-1 / (sampleRate * (0.006 - 0.003 * comp)));
    const fastRelease = Math.exp(-1 / (sampleRate * 0.11)),
      slowRelease = Math.exp(-1 / (sampleRate * 0.32)),
      memoryCoeff = Math.exp(-1 / (sampleRate * 0.3));
    const threshold = -8 - 18 * comp,
      ratio = 1 + 5 * comp,
      knee = 8,
      drive = 1 + 0.28 * comp;
    const makeup = Math.pow(10, (3.2 * comp) / 20),
      normalizer = 1 / drive;
    for (let i = 0; i < output[0].length; i++) {
      let peak = 0;
      for (let c = 0; c < output.length; c++)
        peak = Math.max(peak, Math.abs((tone[c] || tone[0])?.[i] || 0));
      const detector = peak > this.envelope ? detectorAttack : detectorRelease;
      this.envelope = detector * this.envelope + (1 - detector) * peak;
      const db = 20 * Math.log10(Math.max(this.envelope, 1e-8)),
        over = db - threshold;
      let gainDb = 0;
      if (over > knee / 2) gainDb = (1 / ratio - 1) * over;
      else if (over > -knee / 2)
        gainDb = ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
      const target = -gainDb;
      this.reductionMemory =
        memoryCoeff * this.reductionMemory + (1 - memoryCoeff) * target;
      const density = Math.min(1, this.reductionMemory / 12),
        release = fastRelease + (slowRelease - fastRelease) * density;
      const coefficient = target > this.reduction ? attack : release;
      this.reduction =
        coefficient * this.reduction + (1 - coefficient) * target;
      const gain = makeup * Math.pow(10, -this.reduction / 20);
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      const white = this.seed / 2147483648 - 1;
      this.noiseLow = 0.985 * this.noiseLow + 0.015 * white;
      if (noise > 0 && this.seed / 4294967296 < (noise * 18) / sampleRate)
        this.click = white * 0.7;
      this.click *= clickDecay;
      const surface =
        (white * 0.22 + this.noiseLow * 0.5 + this.click) * noise * 0.12;
      const time = this.phase / sampleRate;
      const modulation =
        wow *
        (0.0035 * Math.sin(2 * Math.PI * 0.55 * time) +
          0.0004 * Math.sin(2 * Math.PI * 6.2 * time));
      const delaySamples = wow > 0 ? (0.004 + modulation) * sampleRate : 0;
      for (let c = 0; c < output.length; c++) {
        const x = (input[c] || input[0])?.[i] || 0;
        const colored = (tone[c] || tone[0])?.[i] || 0,
          compressed = colored * gain;
        let wet =
          compressed +
          comp *
            0.35 *
            (Math.tanh(compressed * drive) * normalizer - compressed) +
          surface;
        const ring = this.delay[c];
        ring[this.write] = wet;
        if (delaySamples > 0 && this.samples >= Math.ceil(delaySamples) + 1) {
          const read =
              (this.write - delaySamples + this.delayLength) % this.delayLength,
            lo = Math.floor(read),
            frac = read - lo;
          wet =
            ring[lo] * (1 - frac) + ring[(lo + 1) % this.delayLength] * frac;
        }
        output[c][i] = x * (1 - mix) + wet * level * mix;
      }
      this.write = (this.write + 1) % this.delayLength;
      this.samples++;
      this.phase++;
    }
    return true;
  }
}
registerProcessor("sample-one-vinyl", VinylProcessor);
