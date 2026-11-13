export type MidiNote = { channel: number; note: number; inputId?: string; kind?: "note" | "cc" };
export type MidiMappings = {
  individual: boolean;
  shared: (MidiNote | null)[];
  banks: Record<string, (MidiNote | null)[]>;
};
const empty = () => Array<MidiNote | null>(16).fill(null);
export function newMidiMappings(): MidiMappings {
  return { individual: false, shared: empty(), banks: {} };
}
export function midiBank(
  mappings: MidiMappings,
  bank: number,
): (MidiNote | null)[] {
  if (!mappings.individual) return mappings.shared;
  return (mappings.banks[bank] ||= mappings.shared.map((note) =>
    note ? { ...note } : null,
  ));
}
export function validateMidiMappings(value: any): value is MidiMappings {
  const valid = (notes: any) =>
    Array.isArray(notes) &&
    notes.length === 16 &&
    notes.every(
      (entry: any) =>
        entry === null ||
        (entry &&
          (entry.kind === undefined || entry.kind === "note" || entry.kind === "cc") &&
          Number.isInteger(entry.note) &&
          entry.note >= 0 &&
          entry.note <= 127 &&
          Number.isInteger(entry.channel) &&
          entry.channel >= 0 &&
          entry.channel <= 15 &&
          (entry.inputId === undefined ||
            (typeof entry.inputId === "string" && entry.inputId.length > 0))),
    );
  return (
    !!value &&
    typeof value.individual === "boolean" &&
    valid(value.shared) &&
    !!value.banks &&
    typeof value.banks === "object" &&
    !Array.isArray(value.banks) &&
    Object.entries(value.banks).every(
      ([key, notes]) => /^(0|[1-9]\d*)$/.test(key) && valid(notes),
    )
  );
}
export function midiFromLegacy(
  pads: { midi?: MidiNote | null }[],
): MidiMappings {
  const mappings = newMidiMappings();
  for (let i = 0; i < pads.length; i++) {
    const note = pads[i]?.midi;
    if (note) (mappings.banks[Math.floor(i / 16)] ||= empty())[i % 16] = note;
  }
  mappings.shared = (
    mappings.banks[0] ||
    Object.values(mappings.banks)[0] ||
    empty()
  ).map((note) => (note ? { ...note } : null));
  return mappings;
}
export function midiLabel(midi: MidiNote): string {
  if (midi.kind === "cc") return `CC ${midi.note} · ${midi.channel + 1}`;
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  return `${names[midi.note % 12]}${Math.floor(midi.note / 12) - 1} · ${midi.channel + 1}`;
}

/** Momentary CC buttons emit a nonzero press followed by a zero release. */
export function ccPressed(
  states: Map<string, boolean>,
  key: string,
  value: number,
  toggleMode = false,
): boolean {
  const pressed = value > 0,
    previous = states.get(key);
  if (toggleMode) {
    states.set(key, pressed);
    return previous === undefined ? pressed : pressed !== previous;
  }
  if (pressed) states.set(key, true);
  else states.delete(key);
  return pressed && previous !== true;
}

/** Treat absolute CC changes as relative steps so every BPM remains reachable. */
export function bpmFromCc(
  bpm: number,
  previous: number | null,
  current: number,
): number {
  if (previous === null) return bpm;
  return Math.max(40, Math.min(240, bpm + current - previous));
}

/** Old mappings bind to the first input that sends the matching MIDI message. */
export function claimMidiInput(
  mapping: { inputId?: string },
  inputId: string,
): boolean {
  if (!inputId) return false;
  if (!mapping.inputId) mapping.inputId = inputId;
  return mapping.inputId === inputId;
}
