/* The GP tab's weekend logic (scripts/weekend.js): which weekend is shown,
   and how F1 Fantasy's per-player feed becomes per-session points. */
"use strict";
const assert = require("assert");
const { currentRound, sessionsOf } = require("../scripts/weekend.js");
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
console.log(n + " tests passed");
