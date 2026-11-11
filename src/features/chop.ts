export function createChopFeature({
  state,
  els,
  duration,
  clamp,
  range,
  snapshot,
  stopPad,
  renderPads,
  playRange,
  exportWav,
  updateUI,
  toast,
  secs,
}) {
  function makeSlice(start, end) {
    if (end - start < 0.015) return null;
    return {
      id: state.nextId++,
      start,
      end,
      fadeIn: 0,
      fadeOut: 0,
      name: `Slice ${String(state.nextId - 1).padStart(2, "0")}`,
    };
  }
  function selectedSlice() {
    return (
      state.slices.find((slice) => slice.id === state.selectedSliceId) || null
    );
  }
  function selectSlice(id, edge = null) {
    state.selectedSliceId = id;
    state.selectedSliceEdge = edge;
    const slice = selectedSlice();
    if (slice) state.cursor = edge ? slice[edge] : slice.start;
    renderSlices();
  }
  function linkedBoundaries(time) {
    return state.slices.flatMap((slice) =>
      ["start", "end"]
        .filter((edge) => Math.abs(slice[edge] - time) < 1e-7)
        .map((edge) => ({ id: slice.id, edge, time: slice[edge] })),
    );
  }
  function moveBoundaries(linked, value) {
    let min = 0,
      max = duration();
    for (const item of linked) {
      const slice = state.slices.find((s) => s.id === item.id);
      if (!slice) continue;
      if (item.edge === "start") max = Math.min(max, slice.end - 0.015);
      else min = Math.max(min, slice.start + 0.015);
    }
    const t = clamp(value, min, max);
    for (const item of linked) {
      const slice = state.slices.find((s) => s.id === item.id);
      if (slice) slice[item.edge] = t;
    }
    return t;
  }
  function renderSlices() {
    const ids = new Set(state.slices.map((slice) => slice.id));
    for (const id of state.padConfig.keys())
      if (!ids.has(id)) state.padConfig.delete(id);
    for (const id of state.padVoices.keys()) if (!ids.has(id)) stopPad(id);
    state.bank = Math.min(
      state.bank,
      Math.max(0, Math.ceil(state.slices.length / 16) - 1),
    );
    renderPads();
    const selected = selectedSlice();
    if (!selected) {
      state.selectedSliceId = null;
      state.selectedSliceEdge = null;
    }
    els.sliceInspector.hidden = !selected;
    if (selected) {
      if (document.activeElement !== els.sliceStart)
        els.sliceStart.value = selected.start.toFixed(3);
      if (document.activeElement !== els.sliceEnd)
        els.sliceEnd.value = selected.end.toFixed(3);
      els.sliceStart.max = String(duration());
      els.sliceEnd.max = String(duration());
      for (const edge of ["In", "Out"]) {
        const value = Math.round((selected["fade" + edge] || 0) * 1000),
          max = Math.max(1, Math.round((selected.end - selected.start) * 1000));
        els.sliceInspector.querySelector("#sliceFade" + edge).max = max;
        els.sliceInspector.querySelector("#sliceFade" + edge + "Slider").max =
          max;
        els.sliceInspector.querySelector("#sliceFade" + edge).value = String(
          Math.min(value, max),
        );
        els.sliceInspector.querySelector("#sliceFade" + edge + "Slider").value =
          String(Math.min(value, max));
      }
    }
    const container = els.slices;
    container.replaceChildren();
    if (!state.slices.length) {
      const empty = document.createElement("div");
      empty.className =
        "flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-[#39464b] text-center text-[12px] text-[#687f84]";
      empty.textContent = "Your slices will appear here";
      container.appendChild(empty);
    }
    state.slices.forEach((slice, index) => {
      const row = document.createElement("div");
      row.className =
        "slice-row" + (slice.id === state.selectedSliceId ? " active" : "");
      const detail = document.createElement("button");
      detail.className = "min-w-0 text-left";
      detail.type = "button";
      const title = document.createElement("div");
      title.className = "text-[12px] font-bold text-[#d8e9dc]";
      title.textContent = `${String(index + 1).padStart(2, "0")} · ${slice.name}`;
      const time = document.createElement("div");
      time.className = "time mt-1 text-[10px] text-[#80979a]";
      time.textContent = `${secs(slice.start)} → ${secs(slice.end)}   (${secs(slice.end - slice.start)})`;
      detail.append(title, time);
      detail.setAttribute("aria-label", `Select ${slice.name}`);
      detail.addEventListener("click", () => selectSlice(slice.id));
      const actions = document.createElement("div");
      actions.className = "flex gap-1";
      const audition = document.createElement("button");
      audition.className = "mini";
      audition.type = "button";
      audition.textContent = "▶";
      audition.title = "Play slice";
      audition.setAttribute("aria-label", `Play ${slice.name}`);
      audition.addEventListener("click", () => {
        selectSlice(slice.id);
        playRange(slice.start, slice.end, { slice });
      });
      const rename = document.createElement("button");
      rename.className = "mini";
      rename.type = "button";
      rename.textContent = "✎";
      rename.title = "Rename slice";
      rename.setAttribute("aria-label", `Rename ${slice.name}`);
      rename.addEventListener("click", () => {
        const input = document.createElement("input");
        input.className = "field slice-rename";
        input.type = "text";
        input.maxLength = 65;
        input.value = slice.name;
        input.setAttribute("aria-label", `New name for ${slice.name}`);
        detail.replaceWith(input);
        input.focus();
        input.select();
        let finished = false;
        const finish = (save) => {
          if (finished) return;
          finished = true;
          const name = input.value.trim();
          if (save && name && name !== slice.name) {
            snapshot();
            slice.name = name;
          }
          renderSlices();
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        });
        input.addEventListener("blur", () => finish(true));
      });
      const wav = document.createElement("button");
      wav.className = "mini";
      wav.type = "button";
      wav.textContent = "WAV";
      wav.title = "Download this slice";
      wav.setAttribute("aria-label", `Export ${slice.name}`);
      wav.addEventListener("click", () =>
        exportWav(slice.start, slice.end, `${state.name}-${slice.name}`, slice),
      );
      const remove = document.createElement("button");
      remove.className = "mini";
      remove.type = "button";
      remove.title = "Remove slice";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${slice.name}`);
      remove.addEventListener("click", () => {
        snapshot();
        state.slices = state.slices.filter((s) => s.id !== slice.id);
        renderSlices();
        updateUI();
      });
      actions.append(audition, rename, wav, remove);
      row.append(detail, actions);
      if (slice.id === state.selectedSliceId)
        row.appendChild(els.sliceInspector);
      row.dataset.id = String(slice.id);
      container.appendChild(row);
    });
    updateUI();
  }
  function highlightSlice(id) {
    els.slices
      .querySelectorAll(".slice-row")
      .forEach((row) =>
        row.classList.toggle("active", row.dataset.id === String(id)),
      );
  }
  function addSlice() {
    if (!state.buffer) return;
    const [a, b] = range();
    const s = makeSlice(a, b);
    if (!s) {
      toast("Select at least 15 ms of audio.");
      return;
    }
    snapshot();
    state.slices.push(s);
    state.slices.sort((a, b) => a.start - b.start);
    renderSlices();
    toast("Selection added to the slice library.");
  }
  function equalChops(count) {
    if (!state.buffer) return;
    const [start, end] = range(),
      len = (end - start) / count;
    if (len < 0.015) {
      toast("Selection is too short for that many slices.");
      return;
    }
    snapshot();
    state.slices = [];
    for (let i = 0; i < count; i++)
      state.slices.push(makeSlice(start + i * len, start + (i + 1) * len));
    renderSlices();
    toast(`Created ${count} equal slices from the selection.`);
  }
  function splitAtCursor() {
    if (!state.buffer) return;
    const at = state.cursor;
    const slices = state.slices.length
      ? state.slices
      : [{ start: 0, end: duration() }];
    const index = slices.findIndex(
      (s) => s.start + 0.015 < at && s.end - 0.015 > at,
    );
    if (index < 0) {
      toast("Move the playhead inside a slice to split it.");
      return;
    }
    snapshot();
    const current = slices[index];
    const a = makeSlice(current.start, at),
      b = makeSlice(at, current.end);
    state.slices.splice(index, 1, a, b);
    renderSlices();
    toast("Slice split at playhead.");
  }
  function transientChops() {
    if (!state.buffer) return;
    const input = state.buffer,
      [start, end] = range(),
      sr = input.sampleRate;
    const win = Math.max(64, Math.round(sr * 0.012)); // 12 ms RMS analysis window
    const begin = Math.floor(start * sr),
      finish = Math.ceil(end * sr);
    const channels = Array.from(
      { length: Math.min(2, input.numberOfChannels) },
      (_, i) => input.getChannelData(i),
    );
    const levels = [];
    for (let i = begin; i < finish; i += win) {
      const stop = Math.min(i + win, finish);
      let sum = 0;
      for (let j = i; j < stop; j++) {
        let sample = 0;
        for (let k = 0; k < channels.length; k++) sample += channels[k][j];
        sample /= channels.length;
        sum += sample * sample;
      }
      levels.push(Math.sqrt(sum / Math.max(1, stop - i)));
    }
    if (levels.length < 2) {
      toast("Not enough audio to detect transients.");
      return;
    }
    const sorted = [...levels].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)] || 0;
    const sensitivity = Number(els.transientSensitivity.value) / 100;
    const floor = Math.max(
      0.004 + (1 - sensitivity) * 0.022,
      p80 * (0.13 + (1 - sensitivity) * 0.3),
    );
    const rise = 2.25 - sensitivity,
      attack = 1.3 - sensitivity * 0.28;
    const onsets = [start];
    let previous = start;
    // This is a lightweight energy-onset heuristic, not a full spectral-flux detector.
    for (let i = 3; i < levels.length - 1; i++) {
      const prior = (levels[i - 1] + levels[i - 2] + levels[i - 3]) / 3;
      const now = levels[i];
      const t = start + (i * win) / sr;
      if (t - previous < 0.095) continue;
      if (now > floor && now > prior * rise && now > levels[i - 1] * attack) {
        onsets.push(t);
        previous = t;
        if (onsets.length >= 32) break;
      }
    }
    if (onsets.length === 1) {
      toast(
        "No strong transients found. Try equal slices or a more percussive sample.",
      );
      return;
    }
    snapshot();
    state.slices = [];
    for (let i = 0; i < onsets.length; i++) {
      const s = makeSlice(onsets[i], onsets[i + 1] ?? end);
      if (s) state.slices.push(s);
    }
    renderSlices();
    toast(`Detected ${state.slices.length} transient-based slices.`);
  }

  return {
    selectedSlice,
    selectSlice,
    linkedBoundaries,
    moveBoundaries,
    renderSlices,
    highlightSlice,
    addSlice,
    equalChops,
    splitAtCursor,
    transientChops,
  };
}
