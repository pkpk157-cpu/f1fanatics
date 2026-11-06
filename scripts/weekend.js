/* The race weekend the GP tab shows, for scripts/fetch-data.js.

   Which weekend: the last one raced, until the next one locks (teams lock at
   its first scored session); from then on, the next one.

   What it holds:
     sessions  every session of the weekend (FP1-3, sprint qualifying, sprint,
               qualifying, race) with its times, from OpenF1's public API
               (api.openf1.org). Practice and sprint qualifying don't score in
               F1 Fantasy, so for those it keeps where each driver finished,
               from OpenF1's classification once the session is over.
     pts       each driver's and constructor's F1 Fantasy points and finishing
               position per scored session (qualifying, sprint, race), from
               F1 Fantasy's public per-player feed (feeds/popup/playerstats_*).
               Provisional while the weekend is on; final once F1 has scored
               the round (it then appears in the league's per-round feed).

   It is polite: the 30-odd per-player files are read only from half an hour
   before the first scored session until the round is final, and practice
   results only once per session. Anything that fails keeps what was there. */
"use strict";

const OF1 = "https://api.openf1.org/v1";
// F1 Fantasy session types → our codes ("Sprint Qualifying" is F1 Fantasy's name for the sprint itself)
const FANTASY = { "Qualifying": "Q", "Race": "R", "Sprint Qualifying": "S" };
// OpenF1 session names → our codes and labels
const OPEN = {
  "Practice 1": ["FP1", "Practice 1"], "Practice 2": ["FP2", "Practice 2"], "Practice 3": ["FP3", "Practice 3"],
  "Sprint Qualifying": ["SQ", "Sprint Qualifying"], "Sprint Shootout": ["SQ", "Sprint Qualifying"],
  "Sprint": ["S", "Sprint"], "Qualifying": ["Q", "Qualifying"], "Race": ["R", "Race"]
};
const LABEL = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", SQ: "Sprint Qualifying", S: "Sprint", Q: "Qualifying", R: "Race" };
const ORDER = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"];
const MIN = 60 * 1000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function of1(path) {
  const res = await fetch(OF1 + path, { headers: { accept: "application/json", "user-agent": "f1fanatics-league-tracker" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("OpenF1 " + path + " answered " + res.status);
  const j = await res.json();
  await wait(400); // OpenF1's free tier asks for a few requests a second at most
  return j;
}
const ordNum = (s) => { const n = parseInt(String(s || ""), 10); return isFinite(n) && n > 0 ? n : null; };
const iso = (s) => { const t = Date.parse(s); return isFinite(t) ? new Date(t).toISOString() : null; };

// the weekend to show: the last raced, until the next one locks
function currentRound(schedule, N, now) {
  const next = schedule.find((s) => s.round === N + 1);
  if (next && next.lock && now >= Date.parse(next.lock)) return next.round;
  if (N > 0) return N;
  return schedule.length ? schedule[0].round : null;
}

// one asset's per-session points and positions for round W, from its playerstats feed
function sessionsOf(j, W) {
  const v = (j && (j.Value || j.Data && j.Data.Value)) || j || {};
  const md = (v.MatchWiseStats || []).find((g) => Number(g.GamedayId) === W);
  const out = {};
  ((md && md.RaceDayWise) || []).forEach((rd) => {
    const code = FANTASY[rd.SessionType];
    if (!code || !Array.isArray(rd.StatsWise)) return;
    let p = 0, pos = null, nc = false;
    rd.StatsWise.forEach((s) => {
      const ev = String(s.Event || "").trim();
      if (ev === "Total") p = Number(s.Value) || 0;
      else if (/ position$/i.test(ev) && !/lost|gained/i.test(ev)) pos = ordNum(s.Frequency);
      else if (/not classified/i.test(ev)) nc = true;
    });
    if (!rd.StatsWise.length) return;
    out[code] = { p, pos: nc ? null : pos, nc: nc || undefined, st: Number(rd.MatchStatus) || 0 };
  });
  return out;
}

async function buildWeekend({ get, BASE, schedule, N, assets, live, now = Date.now(), log = () => {} }) {
  const W = currentRound(schedule, N, now);
  if (!W) return null;
  const s = schedule.find((x) => x.round === W) || { round: W, sessions: [] };
  const prev = live && live.weekend && live.weekend.round === W ? live.weekend : null;
  const fantasy = s.sessions || [];

  // the sessions, from OpenF1 (once per weekend; F1 Fantasy only lists the scored ones)
  let sessions = prev && prev.sessions && prev.sessions.some((x) => /^FP|SQ/.test(x.code)) ? prev.sessions.map((x) => Object.assign({}, x)) : null;
  let meetingKey = prev ? prev.meetingKey : null;
  if (!sessions) {
    try {
      const key = (fantasy.find((x) => x.key) || {}).key;
      if (!key) throw new Error("no session key for round " + W);
      const one = await of1("/sessions?session_key=" + key);
      meetingKey = one && one[0] && one[0].meeting_key;
      if (!meetingKey) throw new Error("no OpenF1 meeting for session " + key);
      const all = await of1("/sessions?meeting_key=" + meetingKey);
      sessions = all.filter((x) => OPEN[x.session_name] && !x.is_cancelled).map((x) => ({
        code: OPEN[x.session_name][0], name: OPEN[x.session_name][1], key: x.session_key, start: iso(x.date_start), end: iso(x.date_end), pos: {}
      }));
    } catch (e) {
      log("OpenF1 sessions unavailable (" + e.message + "); using F1 Fantasy's scored sessions");
      sessions = null;
    }
  }
  if (!sessions || !sessions.length) {
    sessions = fantasy.filter((x) => FANTASY[x.type]).map((x) => ({ code: FANTASY[x.type], name: LABEL[FANTASY[x.type]], key: x.key, start: x.start, end: x.end, pos: {} }));
  }
  // F1 Fantasy's own times and live flag win for the scored sessions
  sessions.forEach((x) => {
    const f = fantasy.find((y) => (y.key && y.key === x.key) || FANTASY[y.type] === x.code);
    if (f) { x.live = f.live; if (f.start) x.start = f.start; if (f.end) x.end = f.end; }
    x.scored = !!FANTASY_CODES[x.code];
  });
  sessions.sort((a, b) => (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0) || ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

  // practice / sprint qualifying: where each driver finished, once the session is over
  const byTla = {};
  Object.values(assets).forEach((a) => { if (a.type === "D" && a.short) byTla[String(a.short).toUpperCase()] = a.id; });
  let numToId = null;
  for (const x of sessions) {
    if (x.scored || Object.keys(x.pos || {}).length || !x.end || now < Date.parse(x.end) + 5 * MIN) continue;
    try {
      if (!numToId) {
        numToId = {};
        // everyone who drove at any point in the weekend (reserves stand in at practice)
        (await of1(meetingKey ? "/drivers?meeting_key=" + meetingKey : "/drivers?session_key=" + x.key)).forEach((d) => { const id = byTla[String(d.name_acronym || "").toUpperCase()]; if (id) numToId[d.driver_number] = id; });
      }
      const res = await of1("/session_result?session_key=" + x.key);
      const pos = {};
      res.forEach((r) => { const id = numToId[r.driver_number]; if (id && r.position) pos[id] = r.position; });
      if (Object.keys(pos).length) x.pos = pos;
    } catch (e) {
      log("OpenF1 result for " + x.name + " unavailable (" + e.message + "); will try again");
    }
  }

  // points per scored session, from F1 Fantasy (polite window; final once the round is scored)
  const scored = sessions.filter((x) => x.scored && x.start);
  const firstScored = scored.length ? Math.min(...scored.map((x) => Date.parse(x.start))) : Infinity;
  const final = W <= N;
  let pts = prev ? prev.pts || {} : {};
  const settled = prev && prev.final && final && Object.keys(pts).length;
  if (!settled && now >= firstScored - 30 * MIN) {
    const fresh = {};
    let ok = 0;
    for (const id of Object.keys(assets)) {
      try {
        const j = await get(`${BASE}/popup/playerstats_${id}.json`);
        const x = sessionsOf(j, W);
        if (Object.keys(x).length) fresh[id] = x;
        ok++;
      } catch (e) {
        if (prev && prev.pts && prev.pts[id]) fresh[id] = prev.pts[id];
      }
    }
    if (ok) pts = fresh;
    else log("F1 Fantasy per-player feed unavailable; keeping the last weekend points");
  }

  return { round: W, name: s.name || "Round " + W, short: s.short, sprint: !!s.sprint, meetingKey: meetingKey || null, final, sessions, pts };
}
const FANTASY_CODES = { Q: 1, R: 1, S: 1 };

module.exports = { buildWeekend, currentRound, sessionsOf };
