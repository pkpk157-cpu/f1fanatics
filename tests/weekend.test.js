/* The GP tab's weekend logic (scripts/weekend.js): which weekend is shown,
   and how F1 Fantasy's per-player feed becomes per-session points. */
"use strict";
const assert = require("assert");
const { currentRound, sessionsOf, buildWeekend } = require("../scripts/weekend.js");
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok - " + name); };

const sched = [
  { round: 19, lock: "2026-10-31T21:00:00Z" },
  { round: 20, lock: "2026-11-07T18:00:00Z" }
];
t("shows the last weekend raced until the next one locks", () => {
  assert.strictEqual(currentRound(sched, 19, Date.parse("2026-11-06T12:00:00Z")), 19);
});
t("switches to the next weekend at its lock", () => {
  assert.strictEqual(currentRound(sched, 19, Date.parse("2026-11-07T18:00:00Z")), 20);
});
t("before any round is raced, the first weekend", () => {
  assert.strictEqual(currentRound(sched, 0, Date.parse("2026-01-01T00:00:00Z")), 19);
});

const feed = { Value: { MatchWiseStats: [{ GamedayId: 19, RaceDayWise: [
  { SessionType: "Qualifying", MatchStatus: "4", StatsWise: [{ Event: "Total", Value: 5, Frequency: "-" }, { Event: "Qualifying Position", Value: 5, Frequency: "6th" }] },
  { SessionType: "Race", MatchStatus: "4", StatsWise: [{ Event: "Total", Value: 13, Frequency: "-" }, { Event: "Race Position", Value: 10, Frequency: "5th" }, { Event: "Race position gained", Value: 1, Frequency: "1" }] },
  { SessionType: "Sprint Qualifying", MatchStatus: "4", StatsWise: [{ Event: "Total", Value: -20, Frequency: "-" }, { Event: "Race not classified ", Value: -20, Frequency: "-" }] }
] }] } };
t("per-session points and finishing positions (gained/lost are not positions)", () => {
  const x = sessionsOf(feed, 19);
  assert.deepStrictEqual(x.Q, { p: 5, pos: 6, nc: undefined, st: 4 });
  assert.strictEqual(x.R.p, 13); assert.strictEqual(x.R.pos, 5);
});
t("F1 Fantasy's 'Sprint Qualifying' is the sprint; not classified has no position", () => {
  const x = sessionsOf(feed, 19);
  assert.strictEqual(x.S.p, -20); assert.strictEqual(x.S.pos, null); assert.strictEqual(x.S.nc, true);
});
t("a round with no sessions yet gives nothing", () => {
  assert.deepStrictEqual(sessionsOf(feed, 20), {});
});
t("a constructor is never 'not classified' (its feed says so when one of its cars is)", () => {
  const x = sessionsOf(feed, 19, false);
  assert.strictEqual(x.S.nc, undefined); assert.strictEqual(x.S.pos, null);
});

// buildWeekend with F1 Fantasy mocked and OpenF1 offline
(async () => {
  global.fetch = () => Promise.reject(new Error("offline"));
  const H = 3600e3, now = Date.parse("2026-11-01T23:00:00Z");
  const schedule = [{ round: 19, name: "Mexico City Grand Prix", short: "Mexico City", lock: "2026-10-31T21:00:00Z", sessions: [
    { type: "Qualifying", key: 11400, live: 2, start: "2026-10-31T21:00:00Z", end: "2026-10-31T22:00:00Z" },
    { type: "Race", key: 11404, live: 2, start: "2026-11-01T20:00:00Z", end: "2026-11-01T22:00:00Z" }] }];
  const assets = { 1: { id: "1", type: "D", short: "NOR" }, 2: { id: "2", type: "C" } };
  const prevPts = { 1: { Q: { p: 5, pos: 6, st: 4 } }, 2: { Q: { p: 9, pos: null, st: 4 } } };
  const live = { weekend: { round: 19, final: false, pts: prevPts, sessions: [] } };
  const run = (get, lv) => buildWeekend({ get, BASE: "x", schedule, N: 19, assets, live: lv, now });

  const empty = await run(async () => ({ Value: { MatchWiseStats: [] } }), live);
  assert.deepStrictEqual(empty.pts, prevPts); n++; console.log("ok - an empty answer from F1 never wipes the points");
  assert.strictEqual(empty.ptsFinal, true); n++; console.log("ok - final only once every file has been read (empty answers are still answers)");

  let calls = 0;
  const down = await run(async () => { calls++; throw new Error("503"); }, live);
  assert.deepStrictEqual(down.pts, prevPts); assert.strictEqual(down.ptsFinal, false);
  n++; console.log("ok - F1 down: points kept, not marked final, so they're read again");
  assert.ok(calls <= 3); n++; console.log("ok - stops asking after three failures in a row");

  const settled = await run(async () => { calls = 99; throw new Error("should not be called"); }, { weekend: Object.assign({}, live.weekend, { final: true, ptsFinal: true }) });
  assert.strictEqual(settled.ptsFinal, true); n++; console.log("ok - final points are not read again");
  console.log(n + " tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
