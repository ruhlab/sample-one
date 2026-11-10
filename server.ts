/** SAMPLE/ONE — Bun static server (no bundler / build required). */
const port = Number(Bun.env.PORT ?? 3000);
const hostname = Bun.env.HOST ?? "127.0.0.1";

// Explicit allowlist avoids path traversal and provides predictable responses.
const files = new Map([
  ["/", { filename: "index.html", mime: "text/html; charset=utf-8" }],
  ["/index.html", { filename: "index.html", mime: "text/html; charset=utf-8" }],
  ["/drum.wav", { filename: "drum.wav", mime: "audio/wav" }],
  ["/signalsmith-stretch.mjs", { filename: "node_modules/signalsmith-stretch/SignalsmithStretch.mjs", mime: "text/javascript; charset=utf-8" }],
  ["/distortion-worklet.js", { filename: "distortion-worklet.js", mime: "text/javascript; charset=utf-8" }],
  ["/resample-worker.js", { filename: "resample-worker.js", mime: "text/javascript; charset=utf-8" }],
  ["/app.js", { filename: "app.js", mime: "text/javascript; charset=utf-8" }],
  ["/fallback.css", { filename: "fallback.css", mime: "text/css; charset=utf-8" }],
  ["/favicon.svg", { filename: "favicon.svg", mime: "image/svg+xml" }],
  ["/apple-touch-icon.png", { filename: "apple-touch-icon.png", mime: "image/png" }],
  ["/social-card.png", { filename: "social-card.png", mime: "image/png" }],
]);

const server = Bun.serve({
  port,
  hostname,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      return Response.json({ ok: true, application: "sample-one" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const item = files.get(pathname);
    if (!item) return new Response("Not Found", { status: 404 });

    const asset = Bun.file(`${import.meta.dir}/${item.filename}`);
    if (!(await asset.exists())) {
      console.error(`Missing asset: ${item.filename}`);
      return new Response(`Missing asset: ${item.filename}`, { status: 500 });
    }

    return new Response(request.method === "HEAD" ? null : asset, {
      headers: {
        "Content-Type": item.mime,
        "Cache-Control": "no-store",
      },
    });
  },
});

console.log(`SAMPLE/ONE ready at ${server.url}`);
console.log(`Health check: http://127.0.0.1:${port}/health`);
