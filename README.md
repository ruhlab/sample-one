# SAMPLE/ONE

Run `bun run build` to create a self-contained `dist/index.html` containing the app, its audio engines, example audio, and icons. Serve the file over HTTPS (or localhost) for browser audio and MIDI permissions.

GitHub Pages is deployed by `.github/workflows/pages.yml` on pushes to `main` or by manually running the workflow. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The workflow builds the standalone HTML and also publishes `social-card.png`, which social networks need as a separate public file.

A single-sample waveform editor and capture tool that runs entirely in a browser. Minimal, responsive UI styled with **Tailwind CSS v4 Play CDN** plus a small custom stylesheet. There is **no framework and no build step**. Bun serves the app and the locally installed Signalsmith Stretch audio engine.

## Run

```bash
cd sample-one
npm ci
bun run dev
```

Open **http://localhost:3000** in Chrome or Edge. For a stable server without watch mode: `bun run start`. Override port with `PORT=4321 bun run start`.

The UI loads immediately and works **without Internet access** using a locally bundled fallback stylesheet (`fallback.css`). Tailwind CSS v4 is also loaded from its **CDN asynchronously** when reachable, so a slow or blocked CDN won't prevent the app from rendering. The Play CDN is intended for prototypes, not production deployments.

### Troubleshooting: page seems stuck loading

1. Make sure you're in the unzipped project directory (`sample-one`), not its parent.
2. Run `bun run start`, then open **http://127.0.0.1:3000/** (note: `http`, not `https`).
3. Open **http://127.0.0.1:3000/health**. It should respond with `{"ok":true,"application":"sample-one"}`.
4. In browser DevTools > Network, check `/`, `/app.js`, and `/fallback.css`: all should return status `200`. Tailwind's CDN is optional.
5. If port 3000 is occupied, run `PORT=4321 bun run start` and use **http://127.0.0.1:4321/**. You can check `lsof -i :3000` on macOS to see what is listening.

For development watching, use `bun run dev`. Both commands use the same Bun server code.

## Features

- **Capture a browser tab:** Click **Share tab / screen**, select the tab, **enable tab audio sharing**, start music in the other tab, then press **Record sample**. The screen-sharing API requests a video track but only the audio is recorded; video is discarded. You can stop recording with the same button.
- **Record from an input:** Use **Audio input** to choose a microphone, physical audio interface or a virtual audio loopback device such as BlackHole. This is how desktop Spotify or other desktop apps can be routed into a browser when native system-audio capture isn't available.
- **Import audio:** Select or drag-and-drop an audio file. Import depends on formats supported by your browser's `decodeAudioData` (typically WAV, MP3, OGG, M4A; FLAC varies).
- **Waveform editor:** Drag on the waveform to define a selection; drag selection edges in Editor or slice boundaries in Chop to adjust them; click to place the playhead. Double-click to select all. Zoom and scroll to inspect the sample.
- **Edit:** Set IN/OUT at cursor, crop to selection, delete a selection (ripple edit), peak normalize to ~−0.2 dBFS, undo last eight destructive edits.
- **Edit:** Set selection boundaries precisely in seconds; crop, delete, reverse, or silence the selection. Use the five-band parametric EQ, adjust pitch (semitones and cents) and speed, and apply reverb, delay, distortion, or compression. Resampling, pitch/time, EQ, reverb, delay, distortion, and compression form an editable whole-sample chain rendered from the retained source. The compressor offers Clean, VCA-style, variable-mu-style, digital, three-band, opto-style and FET-style modes, plus an SP-303-inspired Vinyl Sim mode with compression, noise, wow/flutter and level controls (not an exact hardware emulation). Reverb offers Room, Hall, Chamber and Plate models; delay offers Digital, Analog, Tape and stereo Ping-pong modes. Reverb and delay convert mono to stereo, and their tails are limited to the sample duration. Enable effects and use Play all or Play selection and Loop to audition changes, then Apply chain to commit them together. Disable and apply active effects before using destructive edits. Pitch/time uses Signalsmith Stretch (MIT; see THIRD_PARTY_NOTICES.md) and may introduce artifacts, especially at extreme settings; slice positions follow speed changes. Normalize affects the whole sample; edits support undo.
- **Chop:** Add selection as slice, split an existing slice at the cursor, create 2/4/8/16 or a custom number of equal slices, or detect energy-based transients with adjustable sensitivity (simple heuristic). Select a slice or marker to edit its boundaries and individual fades; slice playback and WAV/ZIP exports include these fades. Shared boundaries move together.
- **Listen / export:** Play entire audio or selection; audition individual slices; export whole recording, selection or individual slices as 16-bit PCM WAV; export all slices to a ZIP with WAV files.
- **Play:** Use the 4×4 pads with `1 2 3 4`, `Q W E R`, `A S D F`, and `Z X C V`; additional slices appear in banks of 16. Each slice supports one-shot, toggle loop, and hold-to-play gate modes. MIDI learn assigns a MIDI note and channel to a pad; MIDI support requires a compatible browser and a secure context. Pad settings last for the current session.
- **Keyboard:** `Space` plays/stops selection, `R` toggles recording when connected outside Play, `Esc` stops audio, `Cmd/Ctrl+Z` undoes destructive edit. Pad shortcuts apply on the Play tab and do not fire while editing an input.

## Limitations & notes

- Recording requires `localhost` or HTTPS, a supported browser, and explicit user selection/permission.
- Browser tab audio works best in Chrome / Edge. Availability of **whole-system audio** depends on Chrome version, OS and audio capture controls. On unsupported setups use a loopback device. Some DRM-protected or restricted content may be blocked from capture.
- The browser **does not save projects**. Download WAV / ZIP before closing or refreshing.
- Recording stops automatically after **three minutes** to limit memory consumption. Processing large imported files may use significant memory.
- Transient detection is an energy onset approximation rather than a full beat-detection algorithm. Slice markers are non-destructive; crop/delete reset the slice set since the audio timeline changes.
- Sampling commercially released music may require permission, especially for redistribution.

## Architecture

```
index.html     UI + optional asynchronous Tailwind CDN + custom styling
fallback.css   Locally served responsive utilities for offline/slow-CDN use
app.js         Client-side Web Audio, capture, waveform editing, WAV/ZIP export
distortion-worklet.js  Real-time and offline distortion processor
resample-worker.js     Windowed-sinc sample-rate conversion
server.ts      Tiny Bun static server
package.json   bun run dev / bun run start
```

## API notes

- Tab capture: `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
- Microphone / virtual audio: `navigator.mediaDevices.getUserMedia({ audio: ... })`.
- Recording: `MediaRecorder` audio-only stream; decoded to `AudioBuffer` on stop.
- Playback: Signalsmith Stretch AudioWorklet for the editor transport; `AudioBufferSourceNode` for pads and slice audition.
- Export: 8-bit PCM, 16-bit PCM, 24-bit PCM, or 32-bit float WAV and uncompressed ZIP, with optional mono downmix; the working sample rate is set by enabling resampling and applying the FX chain. Export bit depth and channels are download settings.

All audio processing happens locally. No samples are uploaded to the Bun server.
