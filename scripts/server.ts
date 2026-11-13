/** Serve the built app locally; development requests rebuild from source. */
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const port = Number(Bun.env.PORT ?? 3000);
const hostname = Bun.env.HOST ?? "127.0.0.1";
const development = Bun.env.SAMPLE_ONE_DEV === "1";
let pendingBuild: Promise<void> | undefined;
function build(): Promise<void> {
  if (!pendingBuild)
    pendingBuild = (async () => {
      const process = Bun.spawn(["bun", "run", "build"], {
        cwd: fileURLToPath(root),
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await process.exited) !== 0) throw new Error("Build failed");
    })().finally(() => {
      pendingBuild = undefined;
    });
  return pendingBuild;
}
const files = new Map([
  ["/", ["dist/index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["dist/index.html", "text/html; charset=utf-8"]],
  ["/sampler.html", ["dist/sampler.html", "text/html; charset=utf-8"]],
  ["/player.html", ["dist/player.html", "text/html; charset=utf-8"]],
  ["/assets/drum.wav", ["dist/assets/drum.wav", "audio/wav"]],
  ["/social-card.png", ["src/assets/social-card.png", "image/png"]],
]);
if (!development) await build();
const server = Bun.serve({
  port,
  hostname,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health")
      return Response.json(
        { ok: true, application: "sample-one" },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const item = files.get(pathname);
    if (!item) return new Response("Not Found", { status: 404 });
    try {
      if (development && (pathname === "/" || pathname.endsWith(".html")))
        await build();
    } catch {
      return new Response("Build failed. Check server output.", {
        status: 500,
      });
    }
    const asset = fileFor(item[0]);
    if (!(await asset.exists()))
      return new Response("Missing asset", { status: 500 });
    return new Response(request.method === "HEAD" ? null : asset, {
      headers: { "Content-Type": item[1], "Cache-Control": "no-store" },
    });
  },
});
function fileFor(path: string) {
  return Bun.file(new URL(path, root));
}
console.log(`SAMPLE/ONE ready at ${server.url}`);
