# SAMPLE/ONE

A browser-based sampler for capturing audio, editing and chopping samples, building an ordered FX chain, and playing slices with a keyboard or MIDI controller. Audio processing stays on the device.

## Development

Install [Bun](https://bun.sh/) and Node.js, then run:

```sh
npm ci
bun run dev
```

Open `http://127.0.0.1:3000/`. Development requests rebuild the app from `src`, so refresh after making changes. `bun run start` builds once and serves the result. Set `PORT` or `HOST` to override the server defaults. The `/health` endpoint reports server status.

Tailwind CSS is installed locally and compiled at build time. The app does not load Tailwind from a CDN. Browser capture, AudioWorklet and MIDI features require localhost or HTTPS; availability depends on the browser and OS.

## Build and test

```sh
bun run build    # create dist/index.html and dist/assets/drum.wav
npm test         # run audio utility tests
npm run typecheck # check TypeScript
```

The TypeScript configuration is currently permissive; parts of the existing UI and shared state still need more specific types.

The HTML embeds the app, compiled styles, workers, audio worklets, Signalsmith Stretch and icons. The example audio is loaded separately from `assets/drum.wav`; deploy it alongside the HTML. The social preview image must also be hosted separately.

GitHub Pages deploys via `.github/workflows/pages.yml` on pushes to `main` or manual runs. In repository settings, select **Pages → Build and deployment → Source → GitHub Actions**. The workflow builds the standalone HTML and publishes `src/assets/social-card.png` alongside it.

## Features

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
