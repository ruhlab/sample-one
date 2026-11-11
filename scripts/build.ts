/** Build the browser app and its separately loaded example audio. */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const file = (path: string) => Bun.file(new URL(path, root));
const text = (path: string) => file(path).text();
const data = async (path: string) =>
  Buffer.from(await file(path).arrayBuffer()).toString("base64");

const cssProcess = Bun.spawn(
  [
    "bun",
    "node_modules/@tailwindcss/cli/dist/index.mjs",
    "-i",
    "src/styles/tailwind.css",
    "--minify",
  ],
  { cwd: fileURLToPath(root), stdout: "pipe", stderr: "pipe" },
);
const [tailwind, cssError, cssExit] = await Promise.all([
  new Response(cssProcess.stdout).text(),
  new Response(cssProcess.stderr).text(),
  cssProcess.exited,
]);
if (cssExit !== 0) throw new Error(`Tailwind build failed: ${cssError}`);

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/main.ts", root))],
  target: "browser",
  format: "iife",
  minify: true,
});
if (!result.success)
  throw new AggregateError(result.logs, "JavaScript build failed");
const app = await result.outputs[0].text();
async function compiledScript(path: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL(path, root))],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!result.success)
    throw new AggregateError(result.logs, `Unable to compile ${path}`);
  return Buffer.from(await result.outputs[0].arrayBuffer()).toString("base64");
}
const scripts = {
  resampler: await compiledScript("src/audio/workers/resample-worker.ts"),
  distortion: await compiledScript("src/audio/worklets/distortion-worklet.ts"),
  vinyl: await compiledScript("src/audio/worklets/vinyl-worklet.ts"),
  stretch: await data(
    "node_modules/signalsmith-stretch/SignalsmithStretch.mjs",
  ),
};
const bootstrap = `globalThis.__sampleAssets = (() => {
  const url = (base64, type) => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], {type}));
  return {resampler:url(${JSON.stringify(scripts.resampler)},'text/javascript'),distortion:url(${JSON.stringify(scripts.distortion)},'text/javascript'),vinyl:url(${JSON.stringify(scripts.vinyl)},'text/javascript'),stretch:url(${JSON.stringify(scripts.stretch)},'text/javascript'),example:'./assets/drum.wav'};
})();\n${app}`;
const appData = Buffer.from(bootstrap).toString("base64");
let html = await text("src/index.html");
const replacements: [string, string][] = [
  [
    '<link rel="stylesheet" href="./styles/app.css" />',
    `<style>${tailwind}\n${await text("src/styles/app.css")}</style>`,
  ],
  [
    "./assets/favicon.svg",
    `data:image/svg+xml;base64,${await data("src/assets/favicon.svg")}`,
  ],
  [
    "./assets/apple-touch-icon.png",
    `data:image/png;base64,${await data("src/assets/apple-touch-icon.png")}`,
  ],
  [
    '<script type="module" src="./main.ts"></script>',
    `<script>const s=document.createElement('script');s.src=URL.createObjectURL(new Blob([Uint8Array.from(atob('${appData}'),c=>c.charCodeAt(0))],{type:'text/javascript'}));document.body.appendChild(s);</script>`,
  ],
];
for (const [from, to] of replacements) {
  if (!html.includes(from))
    throw new Error(`Missing HTML build marker: ${from}`);
  html = html.replace(from, to);
}
const notices = (await text("src/THIRD_PARTY_NOTICES.md")).replaceAll(
  "--",
  "- -",
);
html = html.replace("</head>", `<!--\n${notices}\n-->\n</head>`);
await mkdir(new URL("dist/", root), { recursive: true });
await mkdir(new URL("dist/assets/", root), { recursive: true });
await Bun.write(new URL("dist/index.html", root), html);
await Bun.write(
  new URL("dist/assets/drum.wav", root),
  file("src/assets/drum.wav"),
);
console.log("Built dist/index.html and dist/assets/drum.wav");
