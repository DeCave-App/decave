import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const dist = path.join(root, "dist");
const port = Number(process.env.DECAVE_ACCEPTANCE_PORT ?? 4175);
const mime = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

const server = http.createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const candidate = path.resolve(dist, `.${requestPath}`);
    const insideDist = candidate === dist || candidate.startsWith(`${dist}${path.sep}`);
    const target = insideDist ? candidate : path.join(dist, "index.html");
    let body;
    let contentType;
    try {
      body = await fs.readFile(target);
      contentType = mime[path.extname(target)] ?? "application/octet-stream";
    } catch {
      body = await fs.readFile(path.join(dist, "index.html"));
      contentType = "text/html";
    }
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end("acceptance static server error");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`acceptance static server listening on http://127.0.0.1:${port}/`));
