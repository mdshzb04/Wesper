import { acceptGeneration } from "./session.js";

const dial = document.querySelector("#dial");
const caption = document.querySelector("#caption");
const book = document.querySelector("#book");
const status = document.querySelector("#status");
const freq = document.querySelector("#freq");
const line = document.querySelector("#line");
const micButton = document.querySelector("#mic");
const saveButton = document.querySelector("#save");
const form = document.querySelector("#composer");
const detail = document.querySelector("#detail");
const followups = document.querySelector("#followups");
const sources = document.querySelector("#sources");
const openRow = document.querySelector("#open-row");
const openLink = document.querySelector("#open-link");
const memories = document.querySelector("#memories");
let lastAnswer = "";

function downsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) output[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))];
  return output;
}

const sessionKey = "midnight-signal-session";
const stateKey = "wesper-state";
let sessionId = sessionStorage.getItem(sessionKey) || "";
let appState = loadState();

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(stateKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function keepState(next) {
  if (!next || typeof next !== "object") return;
  appState = next;
  localStorage.setItem(stateKey, JSON.stringify(appState));
}

async function readJson(response) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    const text = await response.text();
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(response.status === 404
      ? "The voice API is missing on this host. It returned a page instead of data."
      : (detail || `Request failed (${response.status})`));
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  if (data.sessionId) keepSession(data.sessionId);
  if (data.state) keepState(data.state);
  return data;
}
let generation = 0;
let phase = "idle";

function mark(next) {
  phase = next;
  document.body.dataset.phase = next;
}
let interrupted = false;
let player = null;
let inflight = null;
let ear = null;
let lastTurn = -1;
let playCtx = null;
let voiceNode = null;

function setFace(expression, gesture) {
  dial.dataset.expression = expression;
  dial.dataset.gesture = gesture;
}

function sayStatus(text) {
  status.textContent = text;
}

function writeLog(who, text) {
  const item = document.createElement("li");
  const whoEl = document.createElement("b");
  whoEl.textContent = who;
  item.append(whoEl, document.createTextNode(` ${text}`));
  book.append(item);
  book.scrollTop = book.scrollHeight;
}

function stopVoice() {
  if (voiceNode) {
    try { voiceNode.stop(); } catch { /* already stopped */ }
    voiceNode = null;
  }
  if (player) {
    player.pause();
    player.src = "";
    player = null;
  }
  if (inflight) {
    inflight.abort();
    inflight = null;
  }
}

function unlockAudio() {
  if (!playCtx) playCtx = new AudioContext();
  const buffer = playCtx.createBuffer(1, 1, playCtx.sampleRate);
  const silent = playCtx.createBufferSource();
  silent.buffer = buffer;
  silent.connect(playCtx.destination);
  silent.start();
  return playCtx.resume();
}

function speakWav(arrayBuffer, onEnded) {
  const source = playCtx.createBufferSource();
  voiceNode = source;
  return playCtx.decodeAudioData(arrayBuffer.slice(0)).then((audioBuffer) => {
    if (voiceNode !== source) return;
    source.buffer = audioBuffer;
    source.connect(playCtx.destination);
    source.onended = onEnded;
    source.start();
    mark("speaking");
    sayStatus("Speaking");
    setFace("speak", "lean");
  });
}

async function submit(utterance, fromCut) {
  const text = utterance.trim();
  if (!text) return;
  const mine = ++generation;
  stopVoice();
  mark("thinking");
  sayStatus("Thinking");
  interrupted = false;
  setFace("listen", fromCut ? "hush" : "still");
  caption.textContent = text;
  writeLog("You", text);
  const controller = new AbortController();
  inflight = controller;
  let turn;
  try {
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-session": sessionId },
      body: JSON.stringify({ utterance: text, interrupted: fromCut, state: appState }),
      signal: controller.signal,
    });
    turn = await readJson(response);
  } catch (error) {
    if (error.name === "AbortError") return;
    mark("idle");
    sayStatus(error.message || "The turn failed");
    return;
  }
  if (!acceptGeneration(generation, mine)) return;
  setFace("listen", "still");
  showTurn(turn);
  writeLog("Vesper", turn.reply);
  sayStatus("Getting her voice");
  try {
    const speech = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: turn.reply }),
      signal: controller.signal,
    });
    const speechType = speech.headers.get("content-type") || "";
    if (!speech.ok || !speechType.includes("audio") || !acceptGeneration(generation, mine)) {
      mark("idle");
      if (!speech.ok || !speechType.includes("audio")) {
        let message = "Speech did not come back";
        if (speechType.includes("application/json")) {
          const data = await speech.json().catch(() => ({}));
          if (data.error) message = data.error;
        } else if (!speech.ok) {
          message = "Speech host returned a page instead of audio";
        }
        sayStatus(message);
      }
      return;
    }
    const bytes = await speech.arrayBuffer();
    if (!acceptGeneration(generation, mine)) return;
    await speakWav(bytes, () => {
      if (!acceptGeneration(generation, mine)) return;
      mark("idle");
      setFace("listen", "still");
      sayStatus("Listening");
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    mark("idle");
    sayStatus(error.message || "Could not play speech");
  }
}

function cutCarrier() {
  if (phase !== "speaking" && phase !== "thinking") return false;
  generation += 1;
  stopVoice();
  mark("idle");
  interrupted = true;
  setFace("startled", "hush");
  sayStatus("Carrier cut. She is listening.");
  return true;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  unlockAudio();
  const text = line.value;
  line.value = "";
  void submit(text, false);
});

micButton.addEventListener("click", () => {
  unlockAudio();
  if (ear) {
    ear.stop();
    ear = null;
    micButton.textContent = "Listen";
    micButton.setAttribute("aria-pressed", "false");
    if (phase === "listening") mark("idle");
    return;
  }
  void openEar();
});

async function openEar() {
  let token;
  try {
    const response = await fetch("/api/stt-token");
    const data = await readJson(response);
    token = data.token;
  } catch (error) {
    sayStatus(error.message);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    sayStatus("Microphone blocked. Type instead.");
    return;
  }
  const params = new URLSearchParams({
    sample_rate: "16000",
    speech_model: "universal-3-6-pro",
    format_turns: "true",
    token,
  });
  const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`);
  socket.binaryType = "arraybuffer";
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  processor.onaudioprocess = (event) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const input = downsample(event.inputBuffer.getChannelData(0), context.sampleRate, 16000);
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    socket.send(pcm.buffer);
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  socket.addEventListener("message", (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type !== "Turn" || !data.transcript) return;
    caption.textContent = data.transcript;
    if (!data.end_of_turn) {
      if (phase === "speaking" || phase === "thinking") cutCarrier();
      return;
    }
    if (data.turn_order === lastTurn) return;
    lastTurn = data.turn_order;
    const wasCut = interrupted;
    interrupted = false;
    void submit(data.transcript, wasCut);
  });
  socket.addEventListener("close", () => {
    if (ear && ear.socket === socket) {
      ear.stop();
      ear = null;
      micButton.textContent = "Listen";
      micButton.setAttribute("aria-pressed", "false");
    }
  });
  ear = {
    socket,
    stop() {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Terminate" }));
      socket.close();
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
  micButton.textContent = "Stop";
  micButton.setAttribute("aria-pressed", "true");
  setFace("listen", "lean");
  if (phase === "idle") mark("listening");
  sayStatus("Listening");
}

function showTurn(turn) {
  lastAnswer = turn.reply || "";
  saveButton.disabled = !lastAnswer;
  caption.textContent = turn.reply;
  detail.textContent = turn.detail || "";
  detail.hidden = !turn.detail;
  sources.replaceChildren();
  for (const source of turn.sources || []) {
    if (!/^https?:\/\//i.test(source.url || "")) continue;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title || source.url;
    item.append(link);
    if (source.date) item.append(document.createTextNode(` · ${source.date}`));
    if (source.snippet) {
      const snippet = document.createElement("p");
      snippet.textContent = source.snippet;
      item.append(snippet);
    }
    sources.append(item);
  }
  if (turn.searchError) {
    const item = document.createElement("li");
    item.textContent = `${turn.searchError}. Live facts stay unverified.`;
    sources.append(item);
  }
  followups.replaceChildren();
  for (const ask of turn.followups || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = ask;
    button.addEventListener("click", () => {
      line.value = ask;
      form.requestSubmit();
    });
    followups.append(button);
  }
  if (turn.openUrl && /^https?:\/\//i.test(turn.openUrl)) {
    openLink.href = turn.openUrl;
    openLink.textContent = `Open ${turn.openUrl}`;
    openRow.hidden = false;
  } else {
    openRow.hidden = true;
  }
  if (turn.topic) freq.textContent = `1610 kHz · ${turn.topic}`;
  if (Array.isArray(turn.items)) renderMemory(turn.items);
}

function renderMemory(items) {
  memories.replaceChildren();
  for (const item of items || []) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const when = item.kind === "reminder" && item.when ? ` · ${new Date(item.when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
    label.textContent = `${item.text}${when}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", () => {
      void fetch("/api/memory", {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-session": sessionId },
        body: JSON.stringify({ id: item.id, state: appState }),
      }).then((response) => readJson(response)).then((data) => {
        renderMemory(data.items || []);
      }).catch((error) => sayStatus(error.message || "Could not delete that note"));
    });
    row.append(label, button);
    memories.append(row);
  }
}

function keepSession(id) {
  sessionId = id;
  sessionStorage.setItem(sessionKey, sessionId);
}

document.querySelector("#modes").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  void fetch("/api/mode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-session": sessionId },
    body: JSON.stringify({ mode: button.dataset.mode, state: appState }),
  }).then(async (response) => {
    await readJson(response);
    for (const item of document.querySelectorAll("#modes button")) item.setAttribute("aria-pressed", String(item === button));
    sayStatus(`${button.textContent} is on`);
  }).catch((error) => sayStatus(error.message));
});

saveButton.addEventListener("click", () => {
  if (!lastAnswer) return;
  void fetch("/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json", "x-session": sessionId },
    body: JSON.stringify({ text: lastAnswer, kind: "note", state: appState }),
  }).then(async (response) => {
    const data = await readJson(response);
    renderMemory(data.items || []);
    sayStatus("Saved");
  }).catch((error) => sayStatus(error.message));
});

if (Array.isArray(appState.memory) && appState.memory.length) renderMemory(appState.memory);
if (appState.mode) {
  for (const item of document.querySelectorAll("#modes button")) {
    item.setAttribute("aria-pressed", String(item.dataset.mode === appState.mode));
  }
}

fetch("/api/status")
  .then((response) => readJson(response))
  .then(async (flags) => {
    const missing = ["assemblyai", "openai"].filter((name) => !flags[name]);
    if (missing.length) sayStatus(`Server still needs ${missing.join(", ")}`);
    else sayStatus("Channel ready");
    if (!appState.memory?.length && /^[a-zA-Z0-9-]{8,80}$/.test(sessionId)) {
      const data = await readJson(await fetch("/api/memory", { headers: { "x-session": sessionId } }));
      renderMemory(data.items || []);
    }
  })
  .catch((error) => sayStatus(error.message || "Server is not answering"));
