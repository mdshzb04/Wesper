import { cleanUrl } from "./mind.js";

const DAY = 86_400_000;

export function menIndiaSeries(name) {
  const said = String(name || "");
  if (!/\bIndia\b/.test(said)) return false;
  if (/\b(Women|Under-19|Under 19|India A|unofficial|Emerging)\b/i.test(said)) return false;
  return /\b(T20I|ODI|Test)\b/.test(said);
}

export function seriesInWindow(league, now) {
  const end = Date.parse(league?.season?.endDate || "");
  if (!Number.isFinite(end)) return false;
  return end > now - 25 * DAY && end < now + 45 * DAY;
}

export function askKind(text) {
  const said = String(text || "");
  if (/\b(compare|comparison)\b/i.test(said)) return "compare";
  if (/\b(top two|top 2|who were|which batter|batter|perform)\b/i.test(said)) return "batters";
  if (/\b(most recent|last match|completed|scorecard)\b/i.test(said)) return "recent";
  return "now";
}

export function footballQuestion(text) {
  return /\b(football|soccer)\b/i.test(text) && /\b(score|scores|live|match|fixture|result|happening)\b/i.test(text);
}

export function cricketQuestion(text) {
  return /\b(cricket|batter|bowler|innings|opener|odi|t20|test match)\b/i.test(text)
    || (/\bIndia\b/.test(text) && /\b(match|score|international)\b/i.test(text));
}

export function usesStoredMatch(text, match) {
  if (!match?.id || match.sport !== "cricket") return false;
  return /\b(that match|this match|the scorecard|top two|their performance|compare them|compare their|those two|the batters)\b/i.test(text);
}

export function topIndianBatters(batters, count = 2) {
  return (Array.isArray(batters) ? batters : [])
    .filter((batter) => batter.side === "India" && batter.runs !== "")
    .sort((a, b) => Number(b.runs) - Number(a.runs) || Number(a.balls) - Number(b.balls))
    .slice(0, count);
}

function count(value, word) {
  const number = Number(value) || 0;
  return `${number} ${word}${number === 1 ? "" : "s"}`;
}

function line(batter) {
  return `${batter.name} ${batter.runs} off ${batter.balls || "unknown"} balls, ${count(batter.fours, "four")}, ${count(batter.sixes, "six")}, ${batter.dismissal || "no dismissal listed"}`;
}

export function speakStored(kind, match) {
  const leaders = topIndianBatters(match.batters);
  if (kind === "batters" || kind === "compare") {
    if (leaders.length < 2) {
      return {
        reply: "The scorecard does not list two Indian batting lines. I will not guess the figures.",
        detail: match.summary || "",
        topic: match.name || "India match",
      };
    }
    const [first, second] = leaders;
    const reply = kind === "compare"
      ? `${first.name} and ${second.name} are the top two Indian batters on this scorecard. ${first.name} made ${first.runs} off ${first.balls} balls. ${second.name} made ${second.runs} off ${second.balls} balls.`
      : `The top two Indian batters in ${match.name} were ${first.name} and ${second.name}.`;
    return {
      reply,
      detail: `${match.summary} ${line(first)}. ${line(second)}.`,
      topic: `${first.name} and ${second.name}`,
    };
  }
  return {
    reply: `${match.name} on ${match.when}. ${match.summary} Status ${match.status}.`,
    detail: match.competition,
    topic: match.name,
  };
}

function competitionName(event) {
  const slug = String(event?.season?.slug || "");
  const words = slug.replace(/^\d{4}(?:-\d{2})?-/, "").replace(/-/g, " ").trim();
  return words ? words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : "Football";
}

export function mapFootball(data) {
  return (data?.events || []).map((event) => {
    const comp = (event.competitions || [])[0] || {};
    const status = comp.status?.type || {};
    const sides = (comp.competitors || []).map((side) => ({
      name: side.team?.displayName || side.team?.abbreviation || "Team",
      score: String(side.score ?? ""),
    }));
    const summary = sides.map((side) => `${side.name} ${side.score}`).join(", ");
    return {
      id: String(event.id || ""),
      sport: "football",
      name: event.shortName || event.name || summary,
      competition: competitionName(event),
      when: String(event.date || ""),
      status: status.shortDetail || status.detail || status.state || "",
      state: status.state || "",
      summary,
      url: `https://www.espn.com/soccer/match/_/gameId/${event.id}`,
      batters: [],
    };
  }).filter((match) => match.id && match.summary);
}

export function speakFootball(matches) {
  const live = matches.filter((match) => match.state === "in");
  const chosen = (live.length ? live : []).slice(0, 4);
  if (!chosen.length) {
    return {
      reply: "No football match is in play on the scoreboard. I will not guess a score.",
      detail: "",
      topic: "Football scores",
      match: null,
      sources: [],
    };
  }
  const spoken = chosen.slice(0, 2).map((match) => `${match.competition}: ${match.summary}. Status ${match.status}.`).join(" ");
  return {
    reply: spoken,
    detail: chosen.map((match) => `${match.when} ${match.competition}: ${match.summary}. Status ${match.status}.`).join("\n"),
    topic: chosen[0].competition,
    match: chosen[0],
    sources: chosen.slice(0, 4).map((match) => ({
      title: `${match.competition}: ${match.name}`,
      url: match.url,
      snippet: `${match.summary}. Status ${match.status}.`,
      date: match.when,
    })),
  };
}

function mapCricketEvent(event, competition) {
  const comp = (event.competitions || [])[0] || {};
  const status = comp.status?.type || {};
  const sides = (comp.competitors || []).map((side) => ({
    name: side.team?.displayName || side.team?.abbreviation || "Team",
    score: String(side.score || "").trim(),
    winner: side.winner === true || side.winner === "true",
  }));
  const winner = sides.find((side) => side.winner);
  const summary = `${sides.map((side) => `${side.name} ${side.score}`).join(". ")}.${winner ? ` ${winner.name} won.` : ""}`;
  return {
    id: String(event.id || ""),
    sport: "cricket",
    name: event.name || event.shortName || competition,
    competition,
    when: String(event.date || ""),
    status: status.shortDetail || status.detail || status.state || "",
    state: status.state || "",
    summary: summary.replace(/\s+/g, " ").trim(),
    url: `https://www.espn.com/cricket/match/_/gameId/${event.id}`,
    leagueId: "",
    batters: [],
  };
}

export function battersFromSummary(summary) {
  const cards = Array.isArray(summary?.matchcards) ? summary.matchcards : [];
  const rows = [];
  for (const card of cards) {
    if (card.headline !== "Batting") continue;
    for (const player of card.playerDetails || []) {
      if (!player.playerName) continue;
      rows.push({
        name: String(player.playerName),
        side: String(card.teamName || ""),
        runs: String(player.runs ?? ""),
        balls: String(player.ballsFaced ?? ""),
        fours: String(player.fours ?? ""),
        sixes: String(player.sixes ?? ""),
        dismissal: String(player.dismissal || ""),
      });
    }
  }
  return rows;
}

async function readJson(fetcher, url) {
  const response = await fetcher(url, {
    headers: { accept: "application/json", "user-agent": "MidnightSignal/2.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Sports scores are unavailable (${response.status})`);
  return response.json();
}

export async function loadFootball(fetcher = fetch) {
  const data = await readJson(fetcher, "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard");
  return speakFootball(mapFootball(data));
}

export async function loadCricket(fetcher = fetch, now = Date.now()) {
  const dropdown = await readJson(fetcher, "https://site.api.espn.com/apis/site/v2/leagues/dropdown?sport=cricket&limit=200");
  const series = (dropdown.leagues || [])
    .filter((league) => menIndiaSeries(league.name) && seriesInWindow(league, now))
    .sort((a, b) => Math.abs(Date.parse(a.season.endDate) - now) - Math.abs(Date.parse(b.season.endDate) - now))
    .slice(0, 8);
  if (!series.length) throw new Error("No current India international series is on the scoreboard");
  const boards = await Promise.all(series.map(async (league) => {
    const board = await readJson(fetcher, `https://site.api.espn.com/apis/site/v2/sports/cricket/${league.id}/scoreboard`);
    return (board.events || []).map((event) => {
      const match = mapCricketEvent(event, league.name);
      match.leagueId = String(league.id);
      return match;
    });
  }));
  const matches = boards.flat().filter((match) => match.id);
  const completed = matches.filter((match) => match.state === "post").sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
  const live = matches.find((match) => match.state === "in");
  return { matches, completed, live };
}

export async function cricketCard(kind, fetcher = fetch, now = Date.now()) {
  const { completed, live } = await loadCricket(fetcher, now);
  const match = kind === "now" && live ? live : completed[0];
  if (!match) throw new Error("No completed or live India international match is on the scoreboard");
  const summary = await readJson(fetcher, `https://site.api.espn.com/apis/site/v2/sports/cricket/${match.leagueId}/summary?event=${match.id}`);
  match.batters = battersFromSummary(summary);
  const spoken = speakStored(kind === "now" ? "recent" : kind, match);
  return {
    reply: spoken.reply,
    detail: spoken.detail,
    topic: spoken.topic,
    match,
    sources: [{
      title: match.name,
      url: cleanUrl(match.url),
      snippet: match.summary,
      date: match.when,
    }],
  };
}
