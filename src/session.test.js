import test from "node:test";
import assert from "node:assert/strict";
import { acceptGeneration, actionFromSpeech, chooseAction, dueForBody, fallbackTurn, parseBrain, remember, validateAction } from "./session.js";

test("parseBrain keeps a spoken reply and known cues", () => {
  const turn = parseBrain(`noise {"reply":"The lamp heard you.","expression":"startled","gesture":"recoil","world":"Fog thickens.","memoryNote":"heard a bell","beat":"bell"}`);
  assert.equal(turn.reply, "The lamp heard you.");
  assert.equal(turn.expression, "startled");
  assert.equal(turn.gesture, "recoil");
  assert.equal(turn.beat, "bell");
});

test("parseBrain rejects an empty reply", () => {
  assert.throws(() => parseBrain('{"reply":"  ","expression":"smile"}'), /empty reply/);
});

test("fallback quotes the listener and remember caps the log", () => {
  const turn = fallbackTurn("the porcelain mask", false);
  assert.match(turn.reply, /porcelain mask/);
  assert.match(turn.reply, /will not guess/);
  assert.equal(turn.memoryNote, "");
  const memory = remember(["one"], "kept on purpose");
  assert.deepEqual(memory.at(-1), "kept on purpose");
  const capped = remember(Array.from({ length: 12 }, (_, i) => `m${i}`), "new");
  assert.equal(capped.length, 12);
  assert.equal(capped.at(-1), "new");
});

test("actions stay on the allowlist", () => {
  assert.equal(validateAction("dance"), "dance");
  assert.equal(validateAction("explode"), "none");
  assert.equal(validateAction("dance for me"), "none");
  assert.equal(actionFromSpeech("please do a backflip"), "backflip");
  assert.equal(chooseAction("wave", "dance for me"), "dance");
  assert.equal(chooseAction("not-a-move", "hello"), "none");
  assert.equal(fallbackTurn("wave at me", false).action, "none");
});

test("the body waits for twenty seconds of conversation", () => {
  const clock = { startedAt: 1_000, revealed: false };
  assert.equal(dueForBody(clock, 1_000 + 19_000), false);
  assert.equal(dueForBody({ startedAt: 0, revealed: false }, 30_000), false);
  assert.equal(dueForBody(clock, 1_000 + 20_000), true);
});

test("a newer generation drops a late reply", () => {
  let generation = 1;
  const mine = generation;
  generation += 1;
  assert.equal(acceptGeneration(generation, mine), false);
  assert.equal(acceptGeneration(generation, generation), true);
});
