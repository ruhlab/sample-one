/** Package the app and its runtime assets into a single portable HTML file. */
import { mkdir } from 'node:fs/promises';

const read = (path: string) => Bun.file(new URL(path, import.meta.url));
const text = async (path: string) => read(path).text();
const data = async (path: string) => Buffer.from(await read(path).arrayBuffer()).toString('base64');
let html = await text('./index.html');
const css = await text('./fallback.css');
let app = await text('./app.js');
const scripts = {
  resampler: await data('./resample-worker.js'),
  distortion: await data('./distortion-worklet.js'),
  stretch: await data('./node_modules/signalsmith-stretch/SignalsmithStretch.mjs'),
};
for (const [path, replacement] of [
  ["'./resample-worker.js'", '__sampleAssets.resampler'],
  ["'./distortion-worklet.js'", '__sampleAssets.distortion'],
  ["'./signalsmith-stretch.mjs'", '__sampleAssets.stretch'],
  ["'./drum.wav'", '__sampleAssets.example'],
] as const) {
  if (!app.includes(path)) throw new Error(`Missing runtime reference ${path}`);
  app = app.replaceAll(path, replacement);
}
const assetScript = `const __sampleAssets = (() => {
  const url = (base64, type) => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], {type}));
  return { resampler:url(${JSON.stringify(scripts.resampler)}, 'text/javascript'), distortion:url(${JSON.stringify(scripts.distortion)}, 'text/javascript'), stretch:url(${JSON.stringify(scripts.stretch)}, 'text/javascript'), example:'data:audio/wav;base64,${await data('./drum.wav')}' };
})();\n${app}`;
const appData = Buffer.from(assetScript).toString('base64');
html = html.replace('<link rel="stylesheet" href="./fallback.css" />', `<style>${css}</style>`);
// The local stylesheet is sufficient; keep the standalone build independent of the CDN.
html = html.replace(/  <!-- Load Tailwind from its CDN[^]*?<\/script>\n/, '');
html = html.replace('./favicon.svg', `data:image/svg+xml;base64,${await data('./favicon.svg')}`);
html = html.replace('./apple-touch-icon.png', `data:image/png;base64,${await data('./apple-touch-icon.png')}`);
html = html.replace('<script src="./app.js" defer></script>', `<script>const s=document.createElement('script');s.src=URL.createObjectURL(new Blob([Uint8Array.from(atob('${appData}'),c=>c.charCodeAt(0))],{type:'text/javascript'}));document.body.appendChild(s);</script>`);
if (html.includes('src="./app.js"') || html.includes('href="./fallback.css"')) throw new Error('Failed to inline application assets');
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await Bun.write(new URL('./dist/index.html', import.meta.url), html);
console.log('Built dist/index.html');
