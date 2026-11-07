import { dispatch } from "../src/backend.js";

export const maxDuration = 60;

function pathnameOf(req) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) return url.pathname;
  const slug = req.query?.path;
  const tail = Array.isArray(slug) ? slug.join("/") : "";
  return `/api/${tail}`;
}

function parsedBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.length ? JSON.parse(body.toString("utf8")) : {};
  if (typeof body === "string") body = body ? JSON.parse(body) : {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body;
}

export default async function handler(req, res) {
  try {
    const result = await dispatch({
      method: req.method,
      pathname: pathnameOf(req),
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? {} : parsedBody(req),
    });
    res.statusCode = result.status;
    res.setHeader("cache-control", "no-store");
    if (Buffer.isBuffer(result.body)) {
      res.setHeader("content-type", result.headers?.["content-type"] || "audio/wav");
      res.end(result.body);
      return;
    }
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result.body ?? {}));
  } catch (error) {
    const status = error.status || 500;
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: status === 500 ? "The channel dropped" : error.message }));
  }
}
