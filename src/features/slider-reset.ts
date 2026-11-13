/** Reset static and dynamically created sliders to their declared defaults. */
export function setupSliderReset() {
  document.addEventListener("dblclick", (event) => {
    const slider = event.target;
    if (
      !(slider instanceof HTMLInputElement) ||
      slider.type !== "range" ||
      slider.disabled ||
      slider.classList.contains("midi-target")
    )
      return;
    event.preventDefault();
    slider.value =
      slider.defaultValue ||
      String((Number(slider.min || 0) + Number(slider.max || 100)) / 2);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
