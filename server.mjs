import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createServer as createViteServer } from "vite";
import { dispatch } from "./src/backend.js";

loadEnv(new URL("./.env", import.meta.url));

const PORT = Number(process.env.PORT || 8787);

function loadEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "cache-control": "no-store",
    ...headers,
    ...(typeof body === "string" || Buffer.isBuffer(body) ? {} : { "content-type": "application/json; charset=utf-8" }),
  });
  res.end(payload);
}

function readJson(req, limit = 120_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const body = req.method === "GET" || req.method === "HEAD" ? {} : await readJson(req);
  const result = await dispatch({
    method: req.method,
    pathname: url.pathname,
    headers: req.headers,
    body,
  });
  send(res, result.status, result.body, result.headers || {});
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      if (res.headersSent) return;
      const status = error.status || 500;
      send(res, status, { error: status === 500 ? "The channel dropped" : error.message });
    });
    return;
  }
  vite.middlewares(req, res, () => {
    if (!res.headersSent) send(res, 404, "not found", { "content-type": "text/plain" });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Midnight Signal http://127.0.0.1:${PORT}`);
});
