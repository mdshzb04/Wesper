export const EXPRESSIONS = ["listen", "speak", "wary", "smile", "startled", "grief"];
export const GESTURES = ["still", "lean", "point", "recoil", "hush", "reach"];
export const ACTIONS = ["none", "wave", "dance", "jump", "backflip", "closer"];
export const TRANSFORM_AFTER_MS = 20_000;

export function validateAction(name) {
  return ACTIONS.includes(name) ? name : "none";
}

export function actionFromSpeech(text) {
  const said = String(text ?? "").toLowerCase();
  if (/\bback\s*flips?\b|\bbackflip\b/.test(said)) return "backflip";
  if (/\bdanc\w*\b/.test(said)) return "dance";
  if (/\bwaves?\b|\bwaving\b/.test(said)) return "wave";
  if (/\bjumps?\b|\bjumping\b/.test(said)) return "jump";
  if (/\bcome closer\b|\bstep closer\b|\bcloser\b/.test(said)) return "closer";
  return "none";
}

export function chooseAction(modelAction, utterance) {
  const said = actionFromSpeech(utterance);
  if (said !== "none") return said;
  return validateAction(modelAction);
}

export function dueForBody(clock, now) {
  return Boolean(clock?.startedAt) && !clock.revealed && now - clock.startedAt >= TRANSFORM_AFTER_MS;
}

export function parseBrain(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("brain returned no JSON object");
  const data = JSON.parse(raw.slice(start, end + 1));
  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!reply) throw new Error("brain returned an empty reply");
  return {
    reply: reply.slice(0, 500),
    expression: EXPRESSIONS.includes(data.expression) ? data.expression : "speak",
    gesture: GESTURES.includes(data.gesture) ? data.gesture : "lean",
    memoryNote: clip(data.memoryNote, 180),
    beat: clip(data.beat, 80),
    action: validateAction(data.action),
    detail: clip(data.detail, 900),
    topic: clip(data.topic, 80),
    followups: followups(data.followups),
    stance: data.stance === "fact" || data.stance === "mixed" ? data.stance : "unknown",
  };
}

export function remember(memory, note) {
  const next = Array.isArray(memory) ? memory.slice() : [];
  const line = clip(note, 180);
  if (!line) return next;
  next.push(line);
  return next.slice(-12);
}

export function fallbackTurn(utterance, interrupted) {
  const said = clip(utterance, 180) || "that";
  const expression = interrupted ? "startled" : "wary";
  const gesture = interrupted ? "hush" : "lean";
  const reply = interrupted
    ? `You cut in. I still heard “${said}”. The model is offline, so I will not guess news or scores.`
    : `I heard “${said}”. The model is offline, so I will not guess news or scores.`;
  return {
    reply,
    expression,
    gesture,
    memoryNote: "",
    beat: "offline",
    action: "none",
    detail: "",
    topic: "",
    followups: [],
    stance: "unknown",
  };
}

export function acceptGeneration(current, mine) {
  return current === mine;
}

function followups(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clip(item, 80)).filter(Boolean).slice(0, 2);
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}
