# SAMPLE/ONE

A browser-based sampler for capturing audio, editing and chopping samples, building an ordered FX chain, and playing slices with a keyboard or MIDI controller. Audio processing stays on the device.

## Development

Install [Bun](https://bun.sh/), then run:

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:3000/` to choose the sampler or pad player. The projects are also available directly at `/sampler.html` and `/player.html`. Development requests rebuild the app from `src`, so refresh after making changes. `bun run start` builds once and serves the result. Set `PORT` or `HOST` to override the server defaults. The `/health` endpoint reports server status.

Tailwind CSS is installed locally and compiled at build time. The app does not load Tailwind from a CDN. Browser capture, AudioWorklet and MIDI features require localhost or HTTPS; availability depends on the browser and OS.

## Build and test

```sh
bun run build    # create the three HTML pages and dist/assets/drum.wav
bun test         # run audio utility tests
bun run typecheck # check TypeScript
bun fmt          # format project files
bun fmt --check  # check formatting without writing files
```

The TypeScript configuration is currently permissive; parts of the existing UI and shared state still need more specific types.

Each HTML page embeds its app, compiled styles, workers, audio worklets, Signalsmith Stretch and icons. The example audio is loaded separately from `assets/drum.wav`; deploy it alongside the HTML. The social preview image must also be hosted separately.

GitHub Pages deploys via `.github/workflows/pages.yml` on pushes to `main` or manual runs. In repository settings, select **Pages → Build and deployment → Source → GitHub Actions**. The workflow builds the standalone HTML and publishes `src/assets/social-card.png` alongside it.

## Projects

Use the import and export icons in either workstation header to save or reopen a project ZIP. The archive contains a versioned `project.json` and lossless float audio data; sampler and pad-player projects are specific to their respective workstations. Audio inputs need to be reconnected after reopening. Project files remain on your device.

In the pad player, importing a sampler slice ZIP into an occupied kit offers a choice to replace the kit or fill empty pads, adding banks as needed. With no pad selected, general options control master volume, the default playback mode for newly loaded pads, and MIDI mapping. MIDI assignments are shared by pad position across banks by default; individual-bank mappings and browser-local persistence are optional. Player projects include the master, default mode, and MIDI mappings. The general panel also offers BPM, a metronome, and a four-beat recording count-in. Metronome and count-in clicks are heard through the output but excluded from recorded WAVs. In MIDI Learn, assign notes or CC buttons to transport controls and MIDI CC knobs to master volume and BPM. BPM follows controller movement in one-BPM steps. Select momentary or toggle CC button behavior to match your controller. General Log and MIDI Log enable diagnostic messages in the browser console. General options are automatically saved in browser localStorage; MIDI assignments are stored only when MIDI preservation is enabled. A restored enabled metronome starts after the first user interaction, as required by browser audio policies.

## Features

- **Pad player:** load individual audio files or a sampler-exported ZIP into independent pads, edit their controls, perform with keyboard or MIDI, and record the mix to stereo WAV. Kits remain in memory until the page is left or reloaded. Recording uses AudioWorklet and requires a compatible browser on localhost or HTTPS.
- **Capture:** record tab or input audio, import a file, or load the example.
- **Editor:** select and edit audio, move and stretch the sound within a timeline, estimate BPM, and audition an ordered FX chain. Effects include EQ, pitch, resampling, reverb, delay, distortion and compression. Applied effects remain editable from the retained source.
- **Chop:** create equal or transient slices, move boundaries, rename slices, set fades, and export WAV or ZIP.
- **Play:** trigger slices using 4×4 keyboard pads or MIDI, with one-shot, loop and gate modes. Additional slices appear in banks.
- **Export:** WAV at 8, 16 or 24-bit PCM or 32-bit float, with optional mono downmix.

Pitch and tempo stretching use Signalsmith Stretch; see `src/THIRD_PARTY_NOTICES.md`. BPM and transient detection are estimates, and the Vinyl Sim compressor is an approximation rather than a verified hardware model. Projects remain in memory for the current session.

## Project structure

```text
src/index.html                 Application markup and metadata
src/main.ts                    Application orchestration and event wiring
src/state.ts                   In-memory session state
src/features/                  Capture, chop, FX, waveform and Play UI
src/audio/                     Audio processing and WAV/ZIP serialization
src/audio/worklets/            AudioWorklet processors
src/audio/workers/             Resampling worker
src/styles/                    Tailwind entry and application styles
src/assets/                    Example audio and sharing assets
scripts/build.ts               Tailwind compilation and standalone bundling
scripts/server.ts              Local development and static server
test/                          Audio utility tests
```
