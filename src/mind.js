export const MODES = ["vesper", "researcher", "developer", "tutor", "sports", "creative"];

const BRIEFS = {
  vesper: "Friendly everyday companion. Warm, plain, and short enough to say aloud. Handle the topic in front of you without a lecture.",
  researcher: "Research lead. Lead with what the sources confirm, then what they leave out. Put numbers only in the written detail.",
  developer: "Programming partner. Name the bug or the change, then the smallest next step. Prefer a short code-shaped detail over a tour of the language.",
  tutor: "Tutor. Teach one step, check it, then say what to try next. A study plan is a short ordered list in the written detail.",
  sports: "Sports analyst. Talk about the match, the player, and the comparison already in the transcript. Scores and stats only when a source states them.",
  creative: "Creative partner. Give one strong option, then one variation. Keep the spoken line performable.",
};

export function modeBrief(mode) {
  return BRIEFS[MODES.includes(mode) ? mode : "vesper"];
}

export function systemPrompt(mode) {
  return `You are Vesper, a personal voice assistant on Midnight Signal.
Mode: ${modeBrief(mode)}
You can help with everyday questions, science, math, engineering, software, history, news, business, learning, health (general information only, never a diagnosis), entertainment, sports, travel, food, planning, and creative work.
Conversation context is the transcript, the topic, and saved notes. Follow-up questions refer to that context. Do not ask the listener to repeat names already in the transcript.
Pronouns and phrases like "that player", "the other opener", and "compare them" refer to the transcript, the topic, and earlier sources. Do not ask for a name that is already there. A new subject replaces the old topic.
The spoken reply is 1 to 3 sentences. Put the comparison, steps, or extra detail in "detail".
Current events, scores, prices, weather, releases, and "latest" claims may use ONLY the search results and page text in the user message. If search failed or the results do not contain the fact, set stance to "unknown" and say you could not verify it. Never invent a source, score, date, statistic, or quote.
Health answers stay general and tell the listener to ask a clinician for personal medical decisions.
Reply ONLY with JSON:
{
  "reply": "1 to 3 spoken sentences. No markdown.",
  "detail": "optional extra for the screen, or empty",
  "expression": "listen|speak|wary|smile|startled|grief",
  "gesture": "still|lean|point|recoil|hush|reach",
  "topic": "3 to 8 words naming what this turn is about",
  "followups": ["short question", "short question"],
  "stance": "fact|mixed|unknown",
  "memoryNote": ""
}
Keep memoryNote empty. The server saves notes only when the listener asks.
If the listener interrupted you, acknowledge the cut and answer their new words.`;
}

export function needsLive(text) {
  const said = String(text ?? "");
  return /\b(latest|today|tonight|yesterday|current|breaking|news|score|scores|standings|fixture|fixtures|who won|weather|price|stock|release|released|tournament|headline|this week|right now|happening|updates?|perform(?:ed|ance)?)\b/i.test(said);
}

export function isSmallTalk(text) {
  return /^(?:hi|hello|hey|thanks|thank you|ok|okay|yes|no|cool|good morning|good night)[.!?\s]*$/i.test(String(text ?? "").trim());
}

export function isFollowUp(text) {
  return /\b(it|its|it's|that|this|those|them|they|their|he|she|him|her|his|hers|previous|compare|comparison|which one|better|worse|the other|the same|opener|batter|bowler|that player)\b/i.test(String(text ?? ""));
}

export function shouldSearch(utterance, state = {}) {
  if (isSmallTalk(utterance)) return false;
  if (needsLive(utterance)) return true;
  return Boolean(state.lastLive && state.topic && isFollowUp(utterance));
}

export function searchFollow(utterance, state = {}) {
  return Boolean(state.topic && isFollowUp(utterance) && (state.lastLive || needsLive(utterance)));
}

export function detectMode(text) {
  const said = String(text ?? "");
  if (/\b(bug|debug|code|function|javascript|python|typescript|stack trace|compile|regex|api)\b/i.test(said)) return "developer";
  if (/\b(cricket|ipl|batter|bowler|innings|opener|football|soccer|nba|fixture|match)\b/i.test(said)) return "sports";
  if (/\b(study plan|quiz me|teach me|lesson|homework|explain)\b/i.test(said)) return "tutor";
  if (/\b(poem|short story|brainstorm|write a|lyrics)\b/i.test(said)) return "creative";
  if (/\b(research|sources|cite|paper)\b/i.test(said)) return "researcher";
  return "";
}

export function searchQuery(utterance, topic, followUp) {
  const said = clip(utterance, 160);
  if (!(followUp && topic)) return said;
  if (/\b(cricket|batter|bowler|opener|innings|ipl|match)\b/i.test(`${topic} ${said}`)) return clip(`${topic} cricket stats`, 180);
  const cleaned = said.replace(/\b(him|her|them|they|he|she|his|hers|that|this|it|the other|compare|comparison)\b/gi, " ").replace(/\s+/g, " ").trim();
  return clip(`${topic} ${cleaned || said}`, 180);
}

export function memoryCommand(text) {
  const raw = String(text ?? "").trim();
  const forget = raw.match(/^(?:please\s+)?forget\s+(.+)$/i);
  if (forget) return { op: "forget", text: clip(forget[1], 180) };
  if (/^(?:please\s+)?(?:save|remember)(?:\s+(?:that|this))?(?:\s+(?:comparison|answer|research|note|it))?\.?$/i.test(raw)) {
    return { op: "save-last", kind: "note" };
  }
  const note = raw.match(/^(?:please\s+)?(?:note|make a note)(?:\s+that)?\s+(.+)$/i);
  if (note) return { op: "save", kind: "note", text: clip(note[1], 400) };
  const save = raw.match(/^(?:please\s+)?(?:remember|save)(?:\s+that|\s+this)?\s+(.+)$/i);
  if (save) return { op: "save", kind: "memory", text: clip(save[1], 400) };
  return null;
}

export function pageRequest(text) {
  const match = String(text ?? "").match(/\b(?:summar(?:y|ize|ise)|read this page|read)\b[\s\S]{0,80}(https?:\/\/\S+)/i);
  return match ? safePublicUrl(match[1]) : "";
}

export function safePublicUrl(raw) {
  const href = cleanUrl(String(raw ?? "").replace(/[),.;]+$/, ""));
  if (!href) return "";
  let url;
  try { url = new URL(href); } catch { return ""; }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return "";
  if (host.includes(":")) return "";
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "";
  }
  return url.toString();
}

export function isSensitive(text) {
  const said = String(text ?? "");
  return /\b(password|passcode|api key|secret|ssn|social security|credit card|cvv)\b/i.test(said)
    || /\b\d{13,19}\b/.test(said)
    || /sk-[a-z0-9]{10,}/i.test(said);
}

export function calculate(input) {
  const s = String(input ?? "").replace(/\s+/g, "");
  if (!s || !/^[\d.+\-*/()%]+$/.test(s)) throw new Error("plain arithmetic only");
  let i = 0;
  const primary = () => {
    if (s[i] === "(") {
      i += 1;
      const value = add();
      if (s[i] !== ")") throw new Error("plain arithmetic only");
      i += 1;
      return value;
    }
    const match = /^-?\d*\.?\d+/.exec(s.slice(i));
    if (!match || match[0] === "-" || match[0] === "." || match[0] === "-.") throw new Error("plain arithmetic only");
    i += match[0].length;
    return Number(match[0]);
  };
  const mul = () => {
    let value = primary();
    while (s[i] === "*" || s[i] === "/" || s[i] === "%") {
      const op = s[i];
      i += 1;
      const right = primary();
      if ((op === "/" || op === "%") && right === 0) throw new Error("divide by zero");
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  const add = () => {
    let value = mul();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i];
      i += 1;
      const right = mul();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = add();
  if (i !== s.length || !Number.isFinite(value)) throw new Error("plain arithmetic only");
  return Math.round(value * 1e9) / 1e9;
}

const LENGTH = { km: 1000, m: 1, cm: 0.01, mi: 1609.344, mile: 1609.344, miles: 1609.344, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254 };
const MASS = { kg: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.0283495, ounce: 0.0283495, ounces: 0.0283495 };

export function convert(amount, from, to) {
  const left = String(from || "").toLowerCase();
  const right = String(to || "").toLowerCase();
  const number = Number(amount);
  if (!Number.isFinite(number)) throw new Error("I need a number to convert");
  if ((left === "c" || left === "f") && (right === "c" || right === "f")) {
    const celsius = left === "c" ? number : (number - 32) * 5 / 9;
    const out = right === "c" ? celsius : celsius * 9 / 5 + 32;
    return Math.round(out * 100) / 100;
  }
  const family = LENGTH[left] && LENGTH[right] ? LENGTH : MASS[left] && MASS[right] ? MASS : null;
  if (!family) throw new Error("I can convert length, weight, and C or F");
  return Math.round((number * family[left] / family[right]) * 10000) / 10000;
}

export function parseReminder(text, now) {
  const match = String(text ?? "").match(/\bremind me(?: to)? (.+?) in (\d{1,4}) (minute|minutes|hour|hours)\b/i);
  if (!match) return null;
  const count = Number(match[2]);
  const ms = /hour/i.test(match[3]) ? count * 3_600_000 : count * 60_000;
  if (ms < 60_000 || ms > 14 * 24 * 3_600_000) return null;
  return { text: clip(match[1], 140), when: now + ms };
}

export function linkRequest(text) {
  const match = String(text ?? "").match(/\b(?:open|go to)\s+(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}\S*)/i);
  if (!match) return "";
  return cleanUrl(match[1].replace(/[),.;]+$/, ""));
}

export function allowTurn(stamps, now, limit = 24, windowMs = 60_000) {
  const next = (Array.isArray(stamps) ? stamps : []).filter((stamp) => now - stamp < windowMs);
  if (next.length >= limit) return { ok: false, stamps: next };
  next.push(now);
  return { ok: true, stamps: next };
}

export function dropMemory(list, phrase) {
  const needle = String(phrase ?? "").trim().toLowerCase();
  const items = Array.isArray(list) ? list : [];
  if (!needle) return { list: items, removed: 0 };
  const next = items.filter((item) => !String(item.text || "").toLowerCase().includes(needle));
  return { list: next, removed: items.length - next.length };
}

export function parseDuck(html) {
  const blocks = String(html ?? "").split('class="result__a"').slice(1);
  const out = [];
  for (const block of blocks) {
    const href = /href="([^"]+)"/.exec(block)?.[1] || "";
    const close = block.indexOf("</a>");
    const open = block.indexOf(">");
    const title = open >= 0 && close > open ? strip(block.slice(open + 1, close)) : "";
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const url = cleanUrl(href);
    if (!url || !title) continue;
    out.push({ title: title.slice(0, 140), url, snippet: snippet ? strip(snippet[1]).slice(0, 280) : "", date: "" });
    if (out.length === 5) break;
  }
  return out;
}

export function mapBrave(data) {
  const rows = Array.isArray(data?.web?.results) ? data.web.results : [];
  return rows.slice(0, 5).map((item) => ({
    title: clip(item.title, 140),
    url: cleanUrl(item.url),
    snippet: clip(item.description, 280),
    date: clip(item.age || item.page_age || "", 40),
  })).filter((item) => item.title && item.url);
}

export async function searchWeb(query, options = {}) {
  const fetcher = options.fetcher || fetch;
  const q = clip(query, 180);
  if (!q) return [];
  if (options.braveKey) {
    const response = await fetcher(`https://api.search.brave.com/res/v1/web/search?count=5&q=${encodeURIComponent(q)}`, {
      headers: { accept: "application/json", "x-subscription-token": options.braveKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Search failed (${response.status})`);
    return mapBrave(await response.json());
  }
  try {
    const rows = await duckSearch(q, fetcher);
    if (rows.length) return rows;
  } catch (error) {
    const backup = await wikiSearch(q, fetcher).catch(() => []);
    if (backup.length) return backup;
    throw error;
  }
  return wikiSearch(q, fetcher);
}

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function duckSearch(q, fetcher) {
  const response = await fetcher("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      "user-agent": BROWSER,
    },
    body: new URLSearchParams({ q }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return parseDuck(await response.text());
}

async function wikiSearch(q, fetcher) {
  const response = await fetcher(`https://en.wikipedia.org/w/rest.php/v1/search/page?limit=5&q=${encodeURIComponent(q)}`, {
    headers: { accept: "application/json", "user-agent": "MidnightSignal/2.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const data = await response.json();
  return (Array.isArray(data.pages) ? data.pages : []).slice(0, 5).map((page) => ({
    title: clip(page.title, 140),
    url: cleanUrl(`https://en.wikipedia.org/wiki/${page.key || page.title}`),
    snippet: clip(String(page.description || page.excerpt || "").replace(/<[^>]+>/g, " "), 280),
    date: "",
  })).filter((item) => item.title && item.url);
}

export function cleanUrl(raw) {
  let href = decode(String(raw ?? "").trim());
  if (!href) return "";
  if (href.startsWith("//")) href = `https:${href}`;
  if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
  try {
    const url = new URL(href);
    const wrapped = url.searchParams.get("uddg");
    const finalUrl = wrapped ? new URL(wrapped) : url;
    if (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") return "";
    return finalUrl.toString();
  } catch {
    return "";
  }
}

function strip(value) {
  return decode(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decode(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}
