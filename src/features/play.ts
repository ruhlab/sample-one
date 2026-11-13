export function createPlayFeature({
  state,
  $,
  audioContext,
  sliceBuffer,
  toast,
  clamp,
  duration,
}) {
  const padKeys = [
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "KeyQ",
    "KeyW",
    "KeyE",
    "KeyR",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyF",
    "KeyZ",
    "KeyX",
    "KeyC",
    "KeyV",
  ];
  const padLabels = [
    "1",
    "2",
    "3",
    "4",
    "Q",
    "W",
    "E",
    "R",
    "A",
    "S",
    "D",
    "F",
    "Z",
    "X",
    "C",
    "V",
  ];
  const visibleSlices = () =>
    state.slices.slice(state.bank * 16, state.bank * 16 + 16);
  function configFor(id) {
    if (!state.padConfig.has(id))
      state.padConfig.set(id, { mode: "one-shot", midi: null });
    return state.padConfig.get(id);
  }
  function updatePadLights() {
    document
      .querySelectorAll<HTMLButtonElement>(".pad-trigger[data-id]")
      .forEach((button) => {
        const active = state.padVoices.has(Number(button.dataset.id));
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
  }
  function stopPad(id) {
    state.padPending.delete(id);
    const voice = state.padVoices.get(id);
    if (!voice) return;
    state.padVoices.delete(id);
    try {
      voice.node.onended = null;
      voice.node.stop();
      voice.node.disconnect();
      voice.gain.disconnect();
    } catch {}
    updatePadLights();
  }
  function stopPads() {
    state.padPending.clear();
    for (const id of [...state.padVoices.keys()]) stopPad(id);
    state.heldKeys.clear();
    state.heldMidi.clear();
  }
  async function triggerPad(id) {
    const slice = visibleSlices().find((item) => item.id === id);
    if (
      !slice ||
      !state.buffer ||
      state.tab !== "play" ||
      state.recorder?.state === "recording" ||
      state.recordBusy
    )
      return;
    const config = configFor(id);
    if (
      config.mode === "loop" &&
      (state.padVoices.has(id) || state.padPending.has(id))
    ) {
      stopPad(id);
      return;
    }
    stopPad(id);
    const token = {};
    state.padPending.set(id, token);
    try {
      const ac = await audioContext();
      if (
        state.padPending.get(id) !== token ||
        state.tab !== "play" ||
        !visibleSlices().some((s) => s.id === id)
      )
        return;
      state.padPending.delete(id);
      const node = ac.createBufferSource(),
        gain = ac.createGain();
      node.buffer = sliceBuffer(slice);
      gain.gain.value = 0.86;
      node.connect(gain);
      gain.connect(ac.destination);
      const voice = { node, gain };
      state.padVoices.set(id, voice);
      node.onended = () => {
        if (state.padVoices.get(id) === voice) {
          state.padVoices.delete(id);
          updatePadLights();
        }
        try {
          node.disconnect();
          gain.disconnect();
        } catch {}
      };
      if (config.mode === "loop") {
        node.loop = true;
        node.loopStart = 0;
        node.loopEnd = node.buffer.duration;
        node.start(0);
      } else node.start(0);
      updatePadLights();
    } catch (error) {
      state.padPending.delete(id);
      toast(error.message || "Cannot play this slice.");
    }
  }
  function releasePad(id) {
    if (configFor(id).mode === "gate") stopPad(id);
  }
  function padWaveform(slice) {
    if (!state.peaks || !state.buffer) return null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("pad-wave");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const { lo, hi } = state.peaks,
      n = lo.length,
      first = clamp(Math.floor((slice.start / duration()) * n), 0, n - 1),
      last = clamp(Math.ceil((slice.end / duration()) * n), first + 1, n);
    let d = "";
    for (let x = 0; x < 120; x++) {
      const a = Math.min(
          last - 1,
          first + Math.floor((x * (last - first)) / 120),
        ),
        b = Math.min(
          last,
          Math.max(a + 1, first + Math.ceil(((x + 1) * (last - first)) / 120)),
        );
      let min = 1,
        max = -1;
      for (let i = a; i < b; i++) {
        min = Math.min(min, lo[i]);
        max = Math.max(max, hi[i]);
      }
      d += `M${x + 0.5} ${50 - max * 36}V${50 - min * 36}`;
    }
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", ".8");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    return svg;
  }
  function renderPads() {
    const grid = $("pad-grid");
    if (!grid) return;
    const slices = visibleSlices(),
      banks = Math.max(1, Math.ceil(state.slices.length / 16));
    $("bank-label").textContent = `Bank ${state.bank + 1} / ${banks}`;
    $("bank-prev").disabled = state.bank === 0;
    $("bank-next").disabled = state.bank >= banks - 1;
    grid.replaceChildren();
    for (let i = 0; i < 16; i++) {
      const slice = slices[i],
        card = document.createElement("div");
      card.className = "pad-card";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "pad-trigger";
      trigger.disabled = !slice;
      trigger.setAttribute(
        "aria-label",
        slice
          ? `Play ${slice.name}, key ${padLabels[i]}`
          : `Empty pad ${padLabels[i]}`,
      );
      const key = document.createElement("span");
      key.className = "pad-key";
      key.textContent = padLabels[i];
      const top = document.createElement("span");
      top.className = "pad-top";
      top.appendChild(key);
      const name = document.createElement("span");
      name.className = "pad-name";
      name.textContent = slice ? slice.name : "Empty";
      trigger.append(top, name);
      card.appendChild(trigger);
      if (slice) {
        const waveform = padWaveform(slice);
        if (waveform) trigger.prepend(waveform);
        trigger.dataset.id = String(slice.id);
        trigger.setAttribute("aria-pressed", "false");
        trigger.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          trigger.setPointerCapture(event.pointerId);
          triggerPad(slice.id);
        });
        trigger.addEventListener("pointerup", () => releasePad(slice.id));
        trigger.addEventListener("pointercancel", () => releasePad(slice.id));
        trigger.addEventListener("keydown", (event) => {
          if (event.code === "Space" || event.code === "Enter") {
            if (!event.repeat) {
              event.preventDefault();
              triggerPad(slice.id);
            }
          }
        });
        trigger.addEventListener("keyup", (event) => {
          if (event.code === "Space" || event.code === "Enter") {
            event.preventDefault();
            releasePad(slice.id);
          }
        });
        const config = configFor(slice.id),
          controls = document.createElement("div");
        controls.className = "pad-controls";
        if (config.midi) {
          const note = config.midi.note,
            names = [
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
          const midi = document.createElement("span");
          midi.className = "pad-midi";
          midi.textContent = `${names[note % 12]}${Math.floor(note / 12) - 1} · ${config.midi.channel + 1}`;
          midi.title = `MIDI note ${note}, channel ${config.midi.channel + 1}`;
          top.appendChild(midi);
          trigger.setAttribute(
            "aria-label",
            `Play ${slice.name}, key ${padLabels[i]}, MIDI note ${note}, channel ${config.midi.channel + 1}`,
          );
        }
        const select = document.createElement("select");
        select.className = "field";
        select.setAttribute("aria-label", `Playback mode for ${slice.name}`);
        for (const [value, label] of [
          ["one-shot", "One-shot"],
          ["loop", "Loop"],
          ["gate", "Gate"],
        ]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
        select.value = config.mode;
        select.addEventListener("change", () => {
          stopPad(slice.id);
          config.mode = select.value;
        });
        const learn = document.createElement("button");
        learn.type = "button";
        learn.className =
          "btn btn-quiet btn-sm" +
          (state.midiLearning === slice.id ? " learning" : "");
        learn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v7m4-7v7m4-7v7M8 13h8"/></svg>';
        learn.title =
          state.midiLearning === slice.id
            ? "Listening for MIDI note"
            : "MIDI learn";
        learn.setAttribute("aria-label", `Learn MIDI note for ${slice.name}`);
        learn.addEventListener("click", () => learnMidi(slice.id));
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "btn btn-quiet btn-sm";
        clear.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7"/></svg>';
        clear.title = "Clear MIDI note";
        clear.disabled = !config.midi;
        clear.setAttribute("aria-label", `Clear MIDI note for ${slice.name}`);
        clear.addEventListener("click", () => {
          config.midi = null;
          renderPads();
        });
        controls.append(select, learn, clear);
        card.appendChild(controls);
      }
      grid.appendChild(card);
    }
    updatePadLights();
  }
  async function learnMidi(id) {
    if (!navigator.requestMIDIAccess) {
      toast(
        "MIDI is not supported in this browser. Try Chrome or Edge on a secure connection.",
      );
      return;
    }
    state.midiLearning = id;
    renderPads();
    try {
      if (!state.midi) {
        state.midi = await navigator.requestMIDIAccess();
        state.midi.onstatechange = connectMidiInputs;
      }
      connectMidiInputs();
      if (!state.midi.inputs.size)
        toast("Connect a MIDI controller, then play a note.");
    } catch (error) {
      state.midiLearning = null;
      renderPads();
      toast("MIDI access was denied or unavailable.");
    }
  }
  async function restoreMidi() {
    if (!navigator.requestMIDIAccess) return false;
    try {
      if (!state.midi) state.midi = await navigator.requestMIDIAccess();
      state.midi.onstatechange = connectMidiInputs;
      connectMidiInputs();
      return true;
    } catch {
      return false;
    }
  }
  function connectMidiInputs() {
    if (state.midi)
      for (const input of state.midi.inputs.values())
        input.onmidimessage = handleMidi;
  }
  function handleMidi(event) {
    const [status, note, velocity] = event.data,
      kind = status & 0xf0,
      channel = status & 15;
    if (kind !== 0x90 && kind !== 0x80) return;
    const down = kind === 0x90 && velocity > 0,
      key = `${event.target.id}:${channel}:${note}`;
    if (down && state.midiLearning !== null) {
      const id = state.midiLearning;
      state.midiLearning = null;
      if (state.slices.some((slice) => slice.id === id)) {
        configFor(id).midi = { channel, note };
      }
      renderPads();
      return;
    }
    if (!down) {
      const ids = state.heldMidi.get(key) || [];
      state.heldMidi.delete(key);
      ids.forEach(releasePad);
      return;
    }
    if (state.tab !== "play" || state.heldMidi.has(key)) return;
    const ids = visibleSlices()
      .filter((slice) => {
        const midi = configFor(slice.id).midi;
        return midi && midi.channel === channel && midi.note === note;
      })
      .map((slice) => slice.id);
    state.heldMidi.set(key, ids);
    ids.forEach(triggerPad);
  }

  return {
    padKeys,
    padLabels,
    visibleSlices,
    configFor,
    stopPad,
    stopPads,
    triggerPad,
    releasePad,
    renderPads,
    restoreMidi,
  };
}
