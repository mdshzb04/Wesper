import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fallbackTurn, parseBrain } from "./session.js";
import {
  MODES,
  allowTurn,
  calculate,
  cleanUrl,
  convert,
  detectMode,
  dropMemory,
  isSensitive,
  linkRequest,
  memoryCommand,
  modeBrief,
  pageRequest,
  parseReminder,
  safePublicUrl,
  searchFollow,
  searchQuery,
  searchWeb,
  shouldSearch,
  systemPrompt,
} from "./mind.js";
import { askKind, cricketCard, cricketQuestion, footballQuestion, loadFootball, speakStored, usesStoredMatch } from "./sports.js";

const sessions = new Map();
const STORE = new URL("../data/memory.json", import.meta.url);

export function compactKey(value) {
  return String(value || "").replace(/\s+/g, "");
}

export function publicFailure(error) {
  const text = error instanceof Error ? error.message : "OpenAI failed";
  if (/sk-|bearer|authorization|api[_-]?key/i.test(text)) return "the server key is unreadable";
  return text.replace(/\s+/g, " ").slice(0, 180);
}

function key(name) {
  return compactKey(process.env[name]);
}

function voice() {
  return process.env.ASSEMBLYAI_VOICE_ID || "49c443a4-8a1d-5f7e-b70b-98bdbd9823c3";
}

function model() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function loadStore() {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}

function persistMemory(id, memory) {
  if (process.env.VERCEL) return;
  const store = loadStore();
  store[id] = memory.slice(-30);
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(STORE, JSON.stringify(store));
}

function sanitize(raw) {
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((line) => line && (line.role === "listener" || line.role === "vesper") && typeof line.text === "string")
    .slice(-16)
    .map((line) => ({ role: line.role, text: line.text.slice(0, 600) }));
  const memory = (Array.isArray(raw.memory) ? raw.memory : [])
    .filter((item) => item && typeof item.text === "string" && !isSensitive(item.text))
    .slice(-30)
    .map((item) => ({
      id: String(item.id || randomUUID()).slice(0, 80),
      text: item.text.slice(0, 400),
      kind: item.kind === "note" || item.kind === "reminder" ? item.kind : "memory",
      at: Number(item.at) || Date.now(),
      ...(Number(item.when) ? { when: Number(item.when) } : {}),
    }));
  return {
    history,
    memory,
    topic: String(raw.topic || "").slice(0, 80),
    lastLive: Boolean(raw.lastLive),
    lastWritten: String(raw.lastWritten || "").slice(0, 500),
    mode: MODES.includes(raw.mode) ? raw.mode : "vesper",
    modeLock: Boolean(raw.modeLock),
    sources: cleanSources(raw.sources),
    match: cleanMatch(raw.match),
    stamps: (Array.isArray(raw.stamps) ? raw.stamps : []).map(Number).filter(Number.isFinite).slice(-24),
  };
}

function cleanMatch(raw) {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const batters = (Array.isArray(raw.batters) ? raw.batters : []).slice(0, 11).map((batter) => ({
    name: String(batter.name || "").slice(0, 60),
    side: String(batter.side || "").slice(0, 40),
    runs: String(batter.runs ?? "").slice(0, 8),
    balls: String(batter.balls ?? "").slice(0, 8),
    fours: String(batter.fours ?? "").slice(0, 4),
    sixes: String(batter.sixes ?? "").slice(0, 4),
    dismissal: String(batter.dismissal || "").slice(0, 40),
  })).filter((batter) => batter.name);
  return {
    id: String(raw.id).slice(0, 24),
    sport: raw.sport === "football" ? "football" : "cricket",
    name: String(raw.name || "").slice(0, 80),
    competition: String(raw.competition || "").slice(0, 80),
    when: String(raw.when || "").slice(0, 40),
    status: String(raw.status || "").slice(0, 40),
    summary: String(raw.summary || "").slice(0, 280),
    url: cleanUrl(raw.url),
    batters,
  };
}

function cleanSources(list) {
  return (Array.isArray(list) ? list : []).slice(0, 5).map((item) => ({
    title: String(item?.title || "").slice(0, 140),
    url: cleanUrl(item?.url),
    snippet: String(item?.snippet || "").slice(0, 280),
    date: String(item?.date || "").slice(0, 40),
  })).filter((item) => item.title && item.url);
}

function publicState(state) {
  return {
    history: state.history,
    memory: state.memory,
    topic: state.topic,
    lastLive: state.lastLive,
    lastWritten: state.lastWritten,
    mode: state.mode,
    modeLock: state.modeLock,
    sources: state.sources,
    match: state.match,
    stamps: state.stamps,
  };
}

function sessionFor(header, body) {
  const given = typeof header === "string" ? header : "";
  const id = /^[a-zA-Z0-9-]{8,80}$/.test(given) ? given : randomUUID();
  if (body?.state && typeof body.state === "object") {
    const state = sanitize(body.state);
    sessions.set(id, state);
    return { id, state };
  }
  if (!sessions.has(id)) {
    const saved = loadStore()[id];
    sessions.set(id, sanitize({ memory: Array.isArray(saved) ? saved : [] }));
  }
  return { id, state: sessions.get(id) };
}

function blankTurn(reply, extra = {}) {
  return {
    reply,
    expression: "listen",
    gesture: "still",
    memoryNote: "",
    beat: "tool",
    detail: "",
    followups: [],
    stance: "fact",
    sources: [],
    searchError: "",
    openUrl: "",
    ...extra,
  };
}

function localTool(state, utterance, now) {
  const command = memoryCommand(utterance);
  if (command?.op === "save-last") {
    const text = String(state.lastWritten || [...state.history].reverse().find((line) => line.role === "vesper")?.text || "").trim();
    if (!text) return blankTurn("There is no answer to save yet.", { stance: "unknown" });
    if (isSensitive(text)) return blankTurn("I will not store that. It looks like a secret.", { stance: "unknown" });
    state.memory = state.memory.concat({ id: randomUUID(), text: text.slice(0, 400), kind: "note", at: now }).slice(-30);
    return blankTurn("Saved. It stays on your list until you delete it.", { expression: "smile" });
  }
  if (command?.op === "save") {
    if (isSensitive(command.text)) return blankTurn("I will not store that. It looks like a secret.", { stance: "unknown" });
    state.memory = state.memory.concat({ id: randomUUID(), text: command.text.slice(0, 400), kind: command.kind, at: now }).slice(-30);
    return blankTurn(command.kind === "note" ? "Noted. You can delete it whenever you want." : "Saved. You can forget it whenever you want.", { expression: "smile" });
  }
  if (command?.op === "forget") {
    const dropped = dropMemory(state.memory, command.text);
    state.memory = dropped.list;
    return blankTurn(dropped.removed ? "Forgotten." : "I did not have that saved.", { stance: dropped.removed ? "fact" : "unknown" });
  }
  const spokenMath = utterance.replace(/\btimes\b/gi, "*").replace(/\bdivided by\b/gi, "/").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-");
  const math = spokenMath.match(/^(?:what is|calculate|calc)\s+([0-9().+\-*/%\s]+)$/i);
  if (math) {
    try {
      return blankTurn(`${math[1].replace(/\s+/g, " ").trim()} is ${calculate(math[1])}.`);
    } catch (error) {
      return blankTurn(error.message, { stance: "unknown" });
    }
  }
  const units = utterance.match(/^(?:convert|what is)\s+(-?\d+(?:\.\d+)?)\s*([a-z]+)\s+(?:to|into)\s+([a-z]+)\b/i);
  if (units) {
    try {
      return blankTurn(`${units[1]} ${units[2]} is ${convert(units[1], units[2], units[3])} ${units[3]}.`);
    } catch (error) {
      return blankTurn(error.message, { stance: "unknown" });
    }
  }
  const reminder = parseReminder(utterance, now);
  if (reminder) {
    state.memory = state.memory.concat({ id: randomUUID(), text: reminder.text, kind: "reminder", at: now, when: reminder.when }).slice(-30);
    return blankTurn(`I will remind you to ${reminder.text}. It is on the saved list.`, { expression: "smile" });
  }
  const url = linkRequest(utterance);
  if (url) return blankTurn("The link is on screen. Open it only if you want to.", { openUrl: url });
  return null;
}

function listed(sources) {
  return sources.length
    ? sources.map((item, index) => `${index + 1}. ${item.title} — ${item.url}${item.date ? ` — ${item.date}` : ""} — ${item.snippet}`).join("\n")
    : "(none)";
}

async function pageExcerpt(start) {
  let url = start;
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/html,text/plain", "user-agent": "MidnightSignal/2.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = safePublicUrl(new URL(response.headers.get("location") || "", url).toString());
      if (!next) throw new Error("Page redirect was refused");
      url = next;
      continue;
    }
    if (!response.ok) throw new Error(`Page failed (${response.status})`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 500_000) throw new Error("Page is too large to summarize");
    const html = (await response.text()).slice(0, 80_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3500);
    if (!text) throw new Error("Page had no readable text");
    return text;
  }
  throw new Error("Page redirect was refused");
}

async function openaiTurn(state, utterance, interrupted, sources, searchError, earlier, page) {
  const notes = state.memory.map((item) => `- ${item.text}`).join("\n") || "(none)";
  const user = `Mode: ${state.mode} (${modeBrief(state.mode)})
Topic: ${state.topic || "(none yet)"}
Saved by the listener:
${notes}

Transcript:
${state.history.map((line) => `${line.role}: ${line.text}`).join("\n") || "(channel just opened)"}

Earlier sources from this conversation:
${listed(earlier)}
New search results, the only source for new facts:
${listed(sources)}
Page text: ${page || "(none)"}
Search error: ${searchError || "none"}

Listener just said: ${utterance}
Interrupted your last line: ${interrupted ? "yes" : "no"}
Answer this latest sentence. Do not repeat your previous reply.`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      authorization: `Bearer ${key("OPENAI_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(state.mode) },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const data = await response.json();
  return parseBrain(data.choices?.[0]?.message?.content || "");
}

function json(status, body) {
  return { status, body };
}

async function sportsAnswer(utterance, state) {
  const kind = askKind(utterance);
  const cricket = cricketQuestion(utterance);
  const football = footballQuestion(utterance);
  try {
    if (usesStoredMatch(utterance, state.match)) {
      const spoken = speakStored(kind, state.match);
      const missed = spoken.reply.startsWith("The scorecard does not");
      return {
        ...spoken,
        match: state.match,
        stance: missed ? "unknown" : "fact",
        source: "scores",
        sources: state.match.url ? [{ title: state.match.name, url: state.match.url, snippet: state.match.summary, date: state.match.when }] : [],
      };
    }
    if (football) {
      const card = await loadFootball();
      return { ...card, stance: card.match ? "fact" : "unknown", source: card.match ? "scores" : "fallback", searchError: card.match ? "" : "No live football match" };
    }
    if (cricket) {
      const card = await cricketCard(kind);
      return { ...card, stance: "fact", source: "scores" };
    }
  } catch (error) {
    if (cricket || football) {
      const message = publicFailure(error);
      return {
        reply: `I could not read the scoreboard (${message}). I will not guess the score.`,
        detail: "",
        topic: "Live scores",
        stance: "unknown",
        source: "fallback",
        sources: [],
        searchError: message,
      };
    }
  }
  return null;
}

export async function dispatch({ method, pathname, headers = {}, body = {} }) {
  const header = headers["x-session"] || headers["X-Session"] || "";
  if (pathname === "/api/status" && method === "GET") {
    return json(200, {
      assemblyai: Boolean(key("ASSEMBLYAI_API_KEY")),
      openai: Boolean(key("OPENAI_API_KEY")),
      model: model(),
      search: key("BRAVE_SEARCH_API_KEY") ? "brave" : "news",
      sports: "espn",
    });
  }

  if (pathname === "/api/stt-token" && method === "GET") {
    if (!key("ASSEMBLYAI_API_KEY")) return json(503, { error: "ASSEMBLYAI_API_KEY is missing on the server" });
    const upstream = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=480", {
      headers: { authorization: key("ASSEMBLYAI_API_KEY") },
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !data.token) return json(upstream.status || 502, { error: "AssemblyAI refused the streaming token" });
    return json(200, { token: data.token, expires_in_seconds: data.expires_in_seconds || 480 });
  }

  if (pathname === "/api/mode" && method === "POST") {
    const mode = MODES.includes(body.mode) ? body.mode : "";
    if (!mode) return json(400, { error: "Pick Vesper, Researcher, Developer, Tutor, Sports Analyst, or Creative" });
    const { id, state } = sessionFor(header, body);
    state.mode = mode;
    state.modeLock = mode !== "vesper";
    return json(200, { sessionId: id, mode, state: publicState(state), items: state.memory });
  }

  if (pathname === "/api/memory" && method === "GET") {
    const { id, state } = sessionFor(header, body);
    return json(200, { sessionId: id, items: state.memory, state: publicState(state) });
  }

  if (pathname === "/api/memory" && method === "POST") {
    const text = String(body.text || "").trim().slice(0, 400);
    if (!text) return json(400, { error: "Nothing to save" });
    if (isSensitive(text)) return json(400, { error: "That looks like a secret. I will not store it." });
    const { id, state } = sessionFor(header, body);
    const existing = body.id ? state.memory.find((item) => item.id === String(body.id)) : null;
    if (body.id && !existing) return json(404, { error: "That note is gone" });
    if (existing) existing.text = text;
    else state.memory = state.memory.concat({ id: randomUUID(), text, kind: body.kind === "note" ? "note" : "memory", at: Date.now() }).slice(-30);
    persistMemory(id, state.memory);
    return json(200, { sessionId: id, items: state.memory, state: publicState(state) });
  }

  if (pathname === "/api/memory" && method === "DELETE") {
    const { id, state } = sessionFor(header, body);
    state.memory = state.memory.filter((item) => item.id !== body.id);
    persistMemory(id, state.memory);
    return json(200, { sessionId: id, items: state.memory, state: publicState(state) });
  }

  if (pathname === "/api/turn" && method === "POST") {
    const utterance = String(body.utterance || "").trim().slice(0, 600);
    if (!utterance) return json(400, { error: "Say something first" });
    const { id, state } = sessionFor(header, body);
    const gate = allowTurn(state.stamps, Date.now());
    state.stamps = gate.stamps;
    if (!gate.ok) return json(429, { error: "Too many questions. Wait a minute and ask again." });
    const interrupted = Boolean(body.interrupted);
    const tool = localTool(state, utterance, Date.now());
    let turn = tool;
    let source = tool ? "tool" : "openai";
    let sources = [];
    let searchError = "";
    let earlier = [];
    let follow = false;
    if (!tool) {
      if (!state.modeLock) {
        const picked = detectMode(utterance);
        if (picked) state.mode = picked;
      }
      earlier = state.sources || [];
      follow = searchFollow(utterance, state);
      const sports = await sportsAnswer(utterance, state);
      if (sports) {
        turn = blankTurn(sports.reply, { detail: sports.detail || "", topic: sports.topic || "", stance: sports.stance || "fact" });
        source = sports.source;
        sources = sports.sources || [];
        searchError = sports.searchError || "";
        if (sports.match) state.match = cleanMatch(sports.match);
        state.lastLive = true;
        if (turn.topic) state.topic = turn.topic;
        state.lastWritten = [turn.reply, turn.detail].filter(Boolean).join("\n").slice(0, 500);
      } else {
      const live = shouldSearch(utterance, state);
      const pageUrl = pageRequest(utterance);
      let page = "";
      if (pageUrl) {
        try {
          page = await pageExcerpt(pageUrl);
          sources = [{ title: "Page", url: pageUrl, snippet: page.slice(0, 280), date: "" }];
        } catch (error) {
          searchError = publicFailure(error);
        }
      } else if (live) {
        try {
          sources = await searchWeb(searchQuery(utterance, state.topic, follow), { braveKey: key("BRAVE_SEARCH_API_KEY") });
        } catch (error) {
          searchError = publicFailure(error);
        }
      }
      if (sources.length) state.sources = sources;
      if (!key("OPENAI_API_KEY")) {
        turn = fallbackTurn(utterance, interrupted);
        source = "fallback";
      } else {
        try {
          turn = await openaiTurn(state, utterance, interrupted, sources, searchError, earlier, page);
          const previous = [...state.history].reverse().find((line) => line.role === "vesper")?.text;
          if (previous && turn.reply === previous) {
            turn = await openaiTurn(state, `${utterance}\nDo not repeat your previous answer. Use the search results for this question.`, interrupted, sources, searchError, earlier, page);
          }
        } catch (error) {
          const message = publicFailure(error);
          console.error("turn fallback", message);
          turn = fallbackTurn(utterance, interrupted);
          turn.reply = `I could not reach the model (${message}). I will not guess news or scores.`;
          source = "fallback";
        }
      }
      state.lastLive = live || Boolean(pageUrl);
      if (turn.topic) state.topic = turn.topic;
      state.lastWritten = [turn.reply, turn.detail].filter(Boolean).join("\n").slice(0, 500);
      }
    } else {
      persistMemory(id, state.memory);
    }
    const shown = sources.length ? sources : (follow ? earlier : []);
    state.history.push({ role: "listener", text: utterance });
    state.history.push({ role: "vesper", text: turn.reply });
    state.history = state.history.slice(-16);
    delete turn.action;
    delete turn.memoryNote;
    return json(200, {
      sessionId: id,
      source,
      mode: state.mode,
      ...turn,
      topic: turn.topic || state.topic,
      items: state.memory,
      sources: shown,
      searchError,
      state: publicState(state),
    });
  }

  if (pathname === "/api/tts" && method === "POST") {
    if (!key("ASSEMBLYAI_API_KEY")) return json(503, { error: "ASSEMBLYAI_API_KEY is missing on the server" });
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return json(400, { error: "Nothing to speak" });
    const upstream = await fetch("https://tts.us.assemblyai.com/v1/speech", {
      method: "POST",
      headers: {
        authorization: key("ASSEMBLYAI_API_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify({ text, voice_id: voice(), container: "wav", stream: false }),
    });
    if (!upstream.ok) return json(upstream.status || 502, { error: "AssemblyAI speech failed" });
    const audio = Buffer.from(await upstream.arrayBuffer());
    return { status: 200, body: audio, headers: { "content-type": upstream.headers.get("content-type") || "audio/wav" } };
  }

  return json(404, { error: "not found" });
}
