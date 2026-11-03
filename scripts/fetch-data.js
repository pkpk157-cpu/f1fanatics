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

// One run must never hang on a slow F1: past this budget it gives up and the
// live data stays (a skip, not a failure).
const T_START = Date.now(), BUDGET_MS = 4 * 60 * 1000;

// The feeds sit behind a CDN; a query string asks it for a fresh copy instead
// of whatever it cached up to a few minutes ago.
const bust = () => "?_=" + Math.floor(Date.now() / 60000);

// allowMissing: a 403 or 404 means "not published yet" and returns null
async function get(url, { allowMissing = false } = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (Date.now() - T_START > BUDGET_MS) throw new Unavailable("F1 is too slow right now (over " + BUDGET_MS / 60000 + " minutes)");
    try {
      const res = await fetch(url + bust(), {
        headers: { "accept": "application/json", "user-agent": "f1fanatics-league-tracker" },
        signal: AbortSignal.timeout(15000)
      });
      if ((res.status === 403 || res.status === 404) && allowMissing) return null;
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
const feedTime = (j) => { const t = (j && (j.FeedTime || (j.Data && j.Data.FeedTime))) || null; const d = t && t.UTCTime ? new Date(t.UTCTime + " UTC") : null; return d && isFinite(d) ? d.toISOString() : null; };

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

  for (const e of board) {
    if (e.social_id == null || !isFinite(Number(e.cur_points)) || !isFinite(Number(e.cur_rank)) || e.cur_points === "" || e.cur_rank === "") {
      throw new Unavailable("the standings feed has a row without points or a rank");
    }
  }

  let live = null;
  try { live = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { /* first run */ }
  if (live && !(live.league && live.league.id === LEAGUE)) live = null;

  // An empty calendar is a feed hiccup: keep the one already published.
  const schedJson = await get(`${BASE}/schedule/raceday_en.json`);
  let schedule = parseSchedule(schedJson);
  if (!schedule.length) {
    if (live && live.schedule && live.schedule.length) schedule = live.schedule;
    else throw new Unavailable("the calendar feed came back empty");
  }
  const LAST = Math.min(MAX_ROUNDS, schedule.length);

  // Rounds raced so far: list_2 answers 403 (or 404, or an empty board) until
  // a round has been scored. Never beyond the calendar.
  const rounds = [];
  for (let r = 1; r <= LAST; r++) {
    const j = await get(`${BASE}/leaderboard/privateleague/list_2_${LEAGUE}_${r}_1.json`, { allowMissing: true });
    const lb = j && j.Value && Array.isArray(j.Value.leaderboard) ? j.Value.leaderboard : [];
    if (!lb.length) break;
    rounds.push(lb);
  }
  const N = rounds.length;

  // Prices and asset points: one feed per round, plus the next round's prices
  // if F1 has set them.
  const prices = {}, assetPoints = {}, assets = {};
  let ownershipGlobal = {}, driversTime = null;
  for (let r = 1; r <= LAST; r++) {
    const j = await get(`${BASE}/drivers/${r}_en.json`, { allowMissing: true });
    const list = (j && j.Data && Array.isArray(j.Data.Value)) ? j.Data.Value : [];
    if (!list.length) { if (r <= N) throw new Unavailable("no drivers feed for round " + r + ", which has been raced"); break; }
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
        first: p.FirstName || "",
        last: p.LastName || "",
        ref: p.DriverReference || "",
        team: p.TeamName || p.FUllName,
        teamId: String(p.TeamId || id),
        active: String(p.IsActive) === "1"
      };
    }
  }
  if (!Object.keys(prices).length) throw new Unavailable("the drivers feed came back empty");

  // Team colours and image sources, from the image config F1 Fantasy's own
  // site uses (feeds/cloudinary/config.json). Cosmetic: if it's unavailable,
  // the last published values stay. scripts/fetch-photos.js mirrors the
  // images into photos/ so the app never loads them from F1.
  let teamColors = null;
  try {
    const img = await get(`${BASE}/cloudinary/config.json`);
    const square = (img && img.players && img.players["stat-view"]) || {};
    const base = img.cloudinaryBaseUrl || "https://media.formula1.com/image/upload";
    const ver = img.cloudinaryEnvVersion || "v1";
    const slug = (x) => String(x || "").toLowerCase().replace(/\s+/g, "");
    teamColors = {};
    for (const id of Object.keys(assets)) {
      const a = assets[id], t = slug(a.team), y = CONFIG.season;
      const c = /\/b_rgb:([0-9a-fA-F]{6})\//.exec(square[id] || "");
      if (c) teamColors[a.team] = "#" + c[1].toLowerCase();
      if (a.type === "D" && a.ref) {
        const r = slug(a.ref);
        const front = `common/f1/${y}/${t}/${r}/${y}${t}${r}front.png`;
        // transparent head-and-shoulders, square, from the top of the portrait
        a.img = { head: [`${base}/ar_1:1,c_crop,g_north,w_1000/c_scale,w_320/${ver}/${front}`, square[id]].filter(Boolean) };
      } else if (a.type === "C") {
        a.img = {
          car: [`${base}/c_scale,w_720/${ver}/common/f1/${y}/${t}/${y}${t}carright.png`],
          logo: [`${base}/c_scale,h_120/${ver}/common/f1/${y}/${t}/${y}${t}logowhitefr.png`]
        };
      }
    }
    for (const [team, col] of Object.entries(teamColors)) if (!col) delete teamColors[team];
  } catch (e) {
    console.log("image config unavailable (" + e.message + "); keeping the last team colours and images");
  }

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
    teamColors: teamColors || {},
    managers
  };
  // rounds a late joiner is missing, entered by hand in config.js
  F1F.applyManualRounds(data, CONFIG.manualRounds).forEach((x) => {
    if (!x.ok) console.log("::warning::manual rounds for " + (x.name || x.id) + " not used: " + x.why);
    else if (x.applied && x.applied.length) console.log("manual rounds for " + x.name + ": " + x.applied.join(", "));
  });
  data.checks = F1F.verify(data);

  // Shrinking history means a feed hiccup, not F1 un-racing a Grand Prix.
  if (live && (live.roundsPlayed || 0) > N) {
    throw new Unavailable("F1 returned " + N + " rounds but " + live.roundsPlayed + " are already published — keeping those");
  }
  if (live && live.managers && live.managers.length > managers.length + 2) {
    throw new Unavailable("F1 returned " + managers.length + " managers, " + live.managers.length + " are already published — keeping those");
  }

  // Image config unavailable this run: carry the last good colours and photos.
  if (!teamColors && live && live.teamColors) {
    data.teamColors = live.teamColors;
    for (const id of Object.keys(assets)) if (live.assets && live.assets[id] && live.assets[id].img) assets[id].img = live.assets[id].img;
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
