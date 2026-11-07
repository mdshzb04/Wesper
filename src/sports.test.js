import test from "node:test";
import assert from "node:assert/strict";
import { askKind, battersFromSummary, menIndiaSeries, speakStored, topIndianBatters, usesStoredMatch } from "./sports.js";

const match = {
  id: "1539438",
  sport: "cricket",
  name: "New Zealand v India",
  competition: "India in New Zealand ODI Series 2026/27",
  when: "2026-11-07T02:00Z",
  status: "Final",
  summary: "New Zealand 134 (41/47 ov). India 113/7 (26 ov, target 110). India won.",
  url: "https://www.espn.com/cricket/match/_/gameId/1539438",
  batters: [
    { name: "RG Sharma", side: "India", runs: "23", balls: "28", fours: "2", sixes: "2", dismissal: "caught" },
    { name: "Shubman Gill", side: "India", runs: "0", balls: "1", fours: "0", sixes: "0", dismissal: "caught" },
    { name: "V Kohli", side: "India", runs: "7", balls: "7", fours: "1", sixes: "0", dismissal: "caught" },
    { name: "DJ Mitchell", side: "New Zealand", runs: "55", balls: "70", fours: "4", sixes: "1", dismissal: "caught" },
  ],
};

test("India scorecards keep the same two batters across follow-ups", () => {
  assert.equal(menIndiaSeries("India Women in England ODI Series"), false);
  assert.equal(menIndiaSeries("India in New Zealand ODI Series 2026/27"), true);
  assert.deepEqual(topIndianBatters(match.batters).map((batter) => batter.name), ["RG Sharma", "V Kohli"]);
  assert.equal(usesStoredMatch("Who were the top two Indian batters in that match?", match), true);
  assert.equal(askKind("Compare their performances using the scorecard."), "compare");
  const named = speakStored("batters", match);
  const compared = speakStored("compare", match);
  assert.match(named.reply, /RG Sharma/);
  assert.match(named.reply, /V Kohli/);
  assert.match(compared.reply, /23 off 28/);
  assert.match(compared.reply, /7 off 7/);
  assert.doesNotMatch(compared.detail, /55/);
});

test("batting cards ignore bowling rows", () => {
  const rows = battersFromSummary({
    matchcards: [
      { headline: "Bowling", teamName: "India", playerDetails: [{ playerName: "Bowler", runs: "1" }] },
      { headline: "Batting", teamName: "India", playerDetails: [{ playerName: "RG Sharma", runs: "23", ballsFaced: "28", fours: "2", sixes: "2", dismissal: "caught" }] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "RG Sharma");
});
