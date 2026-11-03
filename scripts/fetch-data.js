#!/usr/bin/env node
/* Builds data.json from F1 Fantasy's public feeds. Run by the "Update F1 data"
   workflow every ten minutes; no login, no key, no proxy.

     list_1_{league}_0_1.json         standings + each manager's current picks
     list_2_{league}_{round}_1.json   one round's points per manager (per-race,
                                      not cumulative); 403 = not raced yet
     drivers/{round}_en.json          every driver and constructor: price for
                                      that round, points scored in it, and the
                                      whole game's selection percentage
     schedule/raceday_en.json         the calendar

   F1 down or busy is not a failure: the data already live stays live, the
   script says why on stdout and sets skip=true for the workflow, and the run
   stays green. A fault in this script itself still fails the run.

   data.json is only rewritten when something in it actually changed, so the
   repository gets a commit when F1 publishes something, not every ten minutes.

   Usage: node scripts/fetch-data.js [--out data.json] [--league 1583310] */
"use strict";
const fs = require("fs");
const path = require("path");
const CONFIG = require("../config.js");
const F1F = require("../compute.js");

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : dflt; };
const ROOT = path.join(__dirname, "..");
const OUT = path.resolve(ROOT, arg("out", "data.json"));
const LEAGUE = String(arg("league", process.env.LEAGUE_ID || CONFIG.leagueId));
const BASE = "https://fantasy.formula1.com/feeds";
const MAX_ROUNDS = 30;

class Unavailable extends Error {}

// The feeds sit behind a CDN; a query string asks it for a fresh copy instead
// of whatever it cached up to a few minutes ago.
const bust = () => "?_=" + Math.floor(Date.now() / 60000);

async function get(url, { allow403 = false } = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url + bust(), {
        headers: { "accept": "application/json", "user-agent": "f1fanatics-league-tracker" },
        signal: AbortSignal.timeout(20000)
      });
      if (res.status === 403 && allow403) return null;
      if (!res.ok) throw new Unavailable(url + " answered " + res.status);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (e) { throw new Unavailable(url + " did not return JSON"); }
    } catch (e) {
      last = e instanceof Unavailable ? e : new Unavailable(url + ": " + (e.cause && e.cause.code || e.message));
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw last;
}

const dec = (s) => { try { return decodeURIComponent(String(s || "")); } catch (e) { return String(s || ""); } };
const feedTime = (j) => { const t = (j && (j.FeedTime || (j.Data && j.Data.FeedTime))) || null; return t && t.UTCTime ? new Date(t.UTCTime + " UTC").toISOString() : null; };

function parseSchedule(j) {
  const rows = (j && j.Data && (j.Data.Value || j.Data.fixtures)) || [];
  const by = new Map();
  for (const x of rows) {
    const r = Number(x.GamedayId);
    if (!r) continue;
    const s = by.get(r) || { round: r, name: x.MeetingName, location: x.MeetingLocation, country: x.CountryName, sessions: [] };
    s.sessions.push({ type: x.SessionType, start: x.SessionStartDateISO8601 });
    by.set(r, s);
  }
  return [...by.values()].sort((a, b) => a.round - b.round).map((s) => {
    const starts = s.sessions.map((x) => Date.parse(x.start)).filter((t) => isFinite(t));
    const race = s.sessions.find((x) => x.type === "Race");
    return {
      round: s.round,
      name: s.name,
      short: (s.name || "").replace(/ Grand Prix$/, "") || "Round " + s.round,
      location: s.location,
      country: s.country,
      sprint: s.sessions.some((x) => /sprint/i.test(x.type)),
      // teams lock at the first scored session of the weekend
      lock: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
      race: race && isFinite(Date.parse(race.start)) ? new Date(race.start).toISOString() : null
    };
  });
}

async function main() {
  const t0 = Date.now();
  const standings = await get(`${BASE}/leaderboard/privateleague/list_1_${LEAGUE}_0_1.json`);
  const board = standings && standings.Value && standings.Value.leaderboard;
  if (!Array.isArray(board) || !board.length) throw new Unavailable("the standings feed came back empty");

  const schedJson = await get(`${BASE}/schedule/raceday_en.json`);
  const schedule = parseSchedule(schedJson);

  // Rounds raced so far: list_2 answers 403 until a round has been scored.
  const rounds = [];
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const j = await get(`${BASE}/leaderboard/privateleague/list_2_${LEAGUE}_${r}_1.json`, { allow403: true });
    if (!j) break;
    rounds.push(j.Value && j.Value.leaderboard || []);
  }
  const N = rounds.length;

  // Prices and asset points: one feed per round, plus the next round's prices
  // if F1 has set them.
  const prices = {}, assetPoints = {}, assets = {};
  let ownershipGlobal = {}, driversTime = null;
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const j = await get(`${BASE}/drivers/${r}_en.json`, { allow403: true });
    if (!j) { if (r <= N) throw new Unavailable("no drivers feed for round " + r + ", which has been raced"); break; }
    const list = (j.Data && j.Data.Value) || [];
    if (!list.length) break;
    prices[r] = {};
    if (r <= N) assetPoints[r] = {};
    ownershipGlobal = {};
    driversTime = feedTime(j);
    for (const p of list) {
      const id = String(p.PlayerId);
      prices[r][id] = Number(p.Value);
      if (r <= N) assetPoints[r][id] = Number(p.GamedayPoints);
      const pct = p.SelectedPercentage === "" || p.SelectedPercentage == null ? null : Number(p.SelectedPercentage);
      ownershipGlobal[id] = isFinite(pct) ? pct : null;
      // the newest feed wins for names and teams (drivers do change seats)
      assets[id] = {
        id,
        type: p.PositionName === "CONSTRUCTOR" ? "C" : "D",
        name: p.PositionName === "CONSTRUCTOR" ? p.FUllName : (p.DisplayName || p.FUllName),
        full: p.FUllName,
        short: p.DriverTLA || (p.FUllName || "").slice(0, 3).toUpperCase(),
        team: p.TeamName || p.FUllName,
        teamId: String(p.TeamId || id),
        active: String(p.IsActive) === "1"
      };
    }
  }
  if (!Object.keys(prices).length) throw new Unavailable("the drivers feed came back empty");

  const managers = board.map((e) => {
    const id = String(e.social_id);
    const m = {
      id,
      name: dec(e.user_name).trim(),
      team: dec(e.team_name).trim(),
      rank: Number(e.cur_rank),
      total: Number(e.cur_points),
      picks: (e.user_team || []).map(String),
      rounds: {}
    };
    rounds.forEach((lb, i) => {
      const x = lb.find((y) => String(y.social_id) === id);
      if (x) m.rounds[i + 1] = { pts: Number(x.cur_points), rank: Number(x.cur_rank), team: (x.user_team || []).map(String) };
    });
    return m;
  }).sort((a, b) => a.rank - b.rank);

  // A manager who left the league can still sit in an old round; they are not
  // in the standings, so they are not in the tracker.
  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    league: { id: LEAGUE, name: CONFIG.leagueName, season: CONFIG.season },
    feedTimes: { standings: feedTime(standings), drivers: driversTime, schedule: feedTime(schedJson) },
    roundsPlayed: N,
    schedule,
    assets,
    prices,
    assetPoints,
    ownershipGlobal,
    managers
  };
  data.checks = F1F.verify(data);

  // Shrinking history means a feed hiccup, not F1 un-racing a Grand Prix.
  let live = null;
  try { live = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { /* first run */ }
  if (live && live.league && live.league.id === LEAGUE && (live.roundsPlayed || 0) > N) {
    throw new Unavailable("F1 returned " + N + " rounds but " + live.roundsPlayed + " are already published — keeping those");
  }
  if (live && live.league && live.league.id === LEAGUE && live.managers && live.managers.length > managers.length + 2) {
    throw new Unavailable("F1 returned " + managers.length + " managers, " + live.managers.length + " are already published — keeping those");
  }

  // Only rewrite when the content changed: stamps aside, same data = no commit.
  const strip = (d) => JSON.stringify(Object.assign({}, d, { generatedAt: null, feedTimes: null, checks: null }));
  if (live && strip(live) === strip(data)) {
    console.log("No change from F1 (" + N + " rounds, " + managers.length + " managers) in " + (Date.now() - t0) + "ms");
    output("changed", "false");
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(data) + "\n");
  console.log("Wrote " + path.relative(ROOT, OUT) + ": " + N + " rounds, " + managers.length + " managers, " +
    Object.keys(assets).length + " drivers/constructors, prices to round " + Math.max(...Object.keys(prices).map(Number)) +
    " in " + (Date.now() - t0) + "ms");
  output("changed", "true");
}

function output(k, v) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, k + "=" + String(v).replace(/[\r\n]+/g, " ") + "\n");
}

main().catch((e) => {
  if (e instanceof Unavailable) {
    const why = "F1 unavailable, the last data stays live: " + e.message;
    console.log(why);
    output("skip", "true");
    output("reason", why);
    return;
  }
  console.error(e);
  process.exit(1);
});
