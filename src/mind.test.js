import test from "node:test";
import assert from "node:assert/strict";
import { calculate, convert, detectMode, dropMemory, isFollowUp, isSensitive, linkRequest, mapBrave, memoryCommand, needsLive, parseDuck, parseReminder, safePublicUrl, searchFollow, searchQuery, searchWeb, shouldSearch } from "./mind.js";

test("live questions search, and a follow-up keeps the topic", () => {
  assert.equal(needsLive("Tell me about the latest OpenAI model"), true);
  assert.equal(needsLive("what is photosynthesis"), false);
  assert.equal(needsLive("What's happening in Indian cricket?"), true);
  assert.equal(shouldSearch("hello", { lastLive: true, topic: "Indian cricket" }), false);
  assert.equal(shouldSearch("How did India's top batter perform?", {}), true);
  assert.equal(shouldSearch("Compare him with the other opener.", { lastLive: true, topic: "Indian cricket" }), true);
  assert.equal(isFollowUp("Compare it with the previous one"), true);
  assert.equal(isFollowUp("Compare him with the other opener."), true);
  assert.equal(searchFollow("Compare him with the other opener.", { lastLive: true, topic: "Indian cricket" }), true);
  assert.equal(searchQuery("Which one is better for coding?", "latest OpenAI model", true), "latest OpenAI model Which one is better for coding?");
  assert.equal(searchQuery("Compare him with the other opener.", "Abhishek Sharma performance", true), "Abhishek Sharma performance cricket stats");
  assert.equal(detectMode("What's happening in Indian cricket?"), "sports");
  assert.equal(detectMode("debug this stack trace"), "developer");
  assert.equal(detectMode("what is photosynthesis"), "");
  assert.equal(safePublicUrl("http://127.0.0.1/secret"), "");
  assert.equal(safePublicUrl("https://example.com/docs"), "https://example.com/docs");
});

test("arithmetic and conversion stay inside a safe parser", () => {
  assert.equal(calculate("12 * (8 + 1)"), 108);
  assert.throws(() => calculate("process.exit()"), /arithmetic/);
  assert.equal(convert(10, "km", "m"), 10000);
  assert.equal(convert(32, "f", "c"), 0);
});

test("memory is explicit and secrets are refused", () => {
  assert.deepEqual(memoryCommand("remember that I prefer TypeScript"), { op: "save", kind: "memory", text: "I prefer TypeScript" });
  assert.deepEqual(memoryCommand("Save that comparison."), { op: "save-last", kind: "note" });
  assert.equal(memoryCommand("what is the weather") , null);
  assert.equal(isSensitive("remember my password is hunter2"), true);
  const dropped = dropMemory([{ id: "1", text: "I prefer TypeScript" }, { id: "2", text: "likes cricket" }], "typescript");
  assert.equal(dropped.removed, 1);
  assert.equal(dropped.list[0].text, "likes cricket");
});

test("reminders, links, and search results are parsed, not invented", () => {
  const reminder = parseReminder("remind me to stretch in 5 minutes", 1_000);
  assert.equal(reminder.text, "stretch");
  assert.equal(reminder.when, 1_000 + 300_000);
  assert.equal(linkRequest("open example.com/docs"), "https://example.com/docs");
  const html = `<a class="result__a" href="https://example.com/a">Latest &amp; model</a><a class="result__snippet">A <b>score</b> of 2&#x27;0.</a>`;
  const [row] = parseDuck(html);
  assert.equal(row.title, "Latest & model");
  assert.equal(row.snippet, "A score of 2'0.");
  assert.equal(row.url, "https://example.com/a");
  const brave = mapBrave({ web: { results: [{ title: "Match", url: "https://scores.example/1", description: "2 to 1", age: "2 hours ago" }] } });
  assert.equal(brave[0].date, "2 hours ago");
});

test("a blocked web index falls back to Wikipedia", async () => {
  const rows = await searchWeb("latest movie", {
    fetcher: async (url) => {
      if (String(url).includes("duckduckgo")) return { ok: false, status: 403, text: async () => "" };
      return { ok: true, json: async () => ({ pages: [{ title: "Film", key: "Film", description: "A movie" }] }) };
    },
  });
  assert.equal(rows[0].url, "https://en.wikipedia.org/wiki/Film");
});

test("search uses the injected fetcher and reports a failed provider", async () => {
  const ok = await searchWeb("cricket score", {
    fetcher: async () => ({ ok: true, text: async () => `<a class="result__a" href="https://example.com/score">Score</a><a class="result__snippet">Live board</a>` }),
  });
  assert.equal(ok[0].url, "https://example.com/score");
  await assert.rejects(
    () => searchWeb("news", { braveKey: "test", fetcher: async () => ({ ok: false, status: 429, json: async () => ({}) }) }),
    /429/,
  );
});
