#!/usr/bin/env node
/* compute.js against a real snapshot of the league (after round 19, taken
   3 Nov 2026), plus the states F1's feeds pass through after a race.
   Run: node tests/compute.test.js */
"use strict";
const assert = require("assert");
const F1F = require("../compute.js");
const fixture = () => JSON.parse(JSON.stringify(require("./fixtures/league-r19.json")));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok - " + name); };

test("snapshot verifies cleanly", () => {
  const v = F1F.verify(fixture());
  assert.deepStrictEqual(v.errors, []);
  assert.deepStrictEqual(v.warnings, []);
  assert.strictEqual(v.sync, "ok");
  assert.strictEqual(v.notes.length, 1); // the manager who joined late
});

test("list_2 is per-round: rounds sum to the standings total", () => {
  const d = fixture(), M = F1F.build(d);
  M.managers.filter((m) => !m.preJoin).forEach((m) => {
    const s = M.rounds.reduce((a, r) => a + m.pts[r], 0);
    assert.strictEqual(s, m.total, m.name);
    assert.strictEqual(m.cum[M.N], m.total);
  });
});

test("late joiner: earlier points carried, rank unknowable before joining", () => {
  const M = F1F.build(fixture());
  const k = M.managers.find((m) => m.preJoin);
  assert.ok(k, "fixture has a late joiner");
  assert.strictEqual(k.joinRound, 4);
  assert.strictEqual(k.preJoin, 876);
  assert.strictEqual(k.cum[1], null);
  assert.strictEqual(k.cum[3], 876);
  assert.strictEqual(k.cum[M.N], k.total);
  assert.strictEqual(k.rankAt[1], null);
  assert.ok(k.rankAt[4] >= 1);
  assert.strictEqual(k.played, M.N - 3);
});

test("standings and ranks", () => {
  const M = F1F.build(fixture());
  M.managers.forEach((m, i) => {
    assert.strictEqual(m.rank, m.feedRank, m.name + " rank agrees with F1");
    if (i) assert.ok(M.managers[i - 1].total >= m.total);
    assert.strictEqual(m.rankAt[M.N], m.rank);
  });
  assert.strictEqual(M.leader.gapLeader, 0);
});

test("round ranks, wins and records are consistent", () => {
  const M = F1F.build(fixture());
  M.roundInfo.forEach((ri) => {
    const w = M.managers.filter((m) => m.roundRank[ri.round] === 1);
    assert.deepStrictEqual(w.map((m) => m.id).sort(), ri.winners.map((m) => m.id).sort());
    w.forEach((m) => assert.strictEqual(m.pts[ri.round], ri.high));
  });
  const totalWins = M.managers.reduce((a, m) => a + m.wins, 0);
  assert.ok(totalWins >= M.N); // ties share a win
  assert.strictEqual(M.records.top[0].pts, Math.max(...M.roundInfo.map((r) => r.high)));
  M.managers.forEach((m) => { assert.ok(m.best.pts >= m.worst.pts); assert.ok(m.bestRank <= m.worstRank); });
});

test("team value is the seven picks at that round's prices", () => {
  const d = fixture(), M = F1F.build(d);
  const m = M.managers[0], r = M.N;
  const exp = Math.round(m.team_[r].reduce((a, id) => a + d.prices[r][id], 0) * 10) / 10;
  assert.strictEqual(m.teamValue[r], exp);
  M.managers.forEach((x) => assert.ok(x.currentValue > 50 && x.currentValue < 250, x.name));
});

test("ownership counts current picks", () => {
  const d = fixture(), M = F1F.build(d);
  const total = M.ownership.reduce((a, o) => a + o.count, 0);
  assert.strictEqual(total, d.managers.reduce((a, m) => a + m.picks.length, 0));
  M.managers.forEach((m) => assert.strictEqual(m.picks.length, 7));
});

test("standings a round behind the rounds: totals include the new round", () => {
  const d = fixture();
  d.managers.forEach((m) => { m.total -= m.rounds[d.roundsPlayed] ? m.rounds[d.roundsPlayed].pts : 0; });
  const v = F1F.verify(d);
  assert.strictEqual(v.sync, "standings-behind");
  const M = F1F.build(d), ref = F1F.build(fixture());
  M.managers.forEach((m) => assert.strictEqual(m.total, ref.managers.find((x) => x.id === m.id).total));
});

test("rounds a round behind the standings is reported, not mis-summed", () => {
  const d = fixture();
  d.managers.forEach((m) => { m.total += 100; });
  d.generatedAt = new Date(Date.parse(d.schedule.find((s) => s.round === d.roundsPlayed + 1).race) + 8 * 3600e3).toISOString();
  assert.strictEqual(F1F.verify(d).sync, "rounds-behind");
  d.generatedAt = new Date(Date.parse(d.schedule.find((s) => s.round === d.roundsPlayed).race) + 8 * 3600e3).toISOString();
  assert.strictEqual(F1F.verify(d).sync, "mismatch");
});

test("verify catches a broken standings order", () => {
  const d = fixture();
  d.managers[1].total = d.managers[0].total + 50;
  assert.ok(F1F.verify(d).errors.length >= 1);
});

test("league XP: pool, race XP and the 25:18:15 season split", () => {
  const M = F1F.build(fixture());
  const P = F1F.prizes(M, { entry: 5000, perRound: 500, split: [25, 18, 15] });
  assert.strictEqual(P.pot, 50000);
  assert.strictEqual(P.totalRounds, 23);
  assert.strictEqual(P.roundPool, 11500);
  assert.strictEqual(P.seasonPool, 38500);
  assert.deepStrictEqual(P.seasonPrizes, [16595, 11948, 9957]);
  assert.strictEqual(P.seasonPrizes.reduce((a, b) => a + b), 38500);
  const race = M.managers.reduce((a, m) => a + P.by[m.id].race, 0);
  assert.ok(Math.abs(race - M.N * 500) < 1e-6, "every round's 500 is paid out exactly once");
  const proj = M.managers.reduce((a, m) => a + P.by[m.id].projected, 0);
  assert.strictEqual(proj, 38500);
  assert.strictEqual(P.by[M.managers[0].id].projected, 16595);
});

test("tied final places share their XP", () => {
  const d = fixture();
  d.managers[1].total = d.managers[0].total; // 1st and 2nd level
  const M = F1F.build(d);
  const P = F1F.prizes(M, { entry: 5000, perRound: 500, split: [25, 18, 15] });
  const a = P.by[d.managers[0].id].projected, b = P.by[d.managers[1].id].projected;
  assert.strictEqual(a, b);
  assert.strictEqual(a + b, 16595 + 11948);
});

console.log(n + " tests passed");
