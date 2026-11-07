import test from "node:test";
import assert from "node:assert/strict";
import { compactKey, dispatch, publicFailure } from "./backend.js";

test("a broken key never reaches the listener", () => {
  assert.equal(compactKey("sk-test\nmore"), "sk-testmore");
  const leaked = publicFailure(new Error('Headers.append: "Bearer sk-test\\nabc"'));
  assert.equal(leaked.includes("sk-"), false);
  assert.match(leaked, /unreadable/);
});

test("missing routes answer with JSON, not an HTML page", async () => {
  const missing = await dispatch({ method: "GET", pathname: "/api/missing" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "not found");
  const empty = await dispatch({ method: "POST", pathname: "/api/turn", body: {} });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /Say something/);
});

test("a turn keeps the client conversation on a fresh process", async () => {
  const first = await dispatch({
    method: "POST",
    pathname: "/api/turn",
    body: { utterance: "what is 6 times 7", state: { history: [], memory: [], mode: "vesper" } },
  });
  assert.equal(first.body.reply, "6 * 7 is 42.");
  const second = await dispatch({
    method: "POST",
    pathname: "/api/memory",
    body: { text: "I prefer TypeScript", state: first.body.state },
  });
  assert.equal(second.body.items.at(-1).text, "I prefer TypeScript");
  assert.equal(second.body.state.history.at(-1).text, "6 * 7 is 42.");
});
