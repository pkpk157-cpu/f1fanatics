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

test("hand-entered rounds fill a late joiner's gap only when they add up", () => {
  const d = fixture();
  const res = F1F.applyManualRounds(d, { "185065214": { 1: 204, 2: 505, 3: 167 } });
  assert.ok(res[0].ok && res[0].applied.length === 3);
  const M = F1F.build(d);
  const k = M.managers.find((m) => m.id === "185065214");
  assert.strictEqual(k.preJoin, 0);
  assert.strictEqual(k.cum[2], 709);
  assert.strictEqual(k.rankAt[2], 1);
  assert.strictEqual(M.roundInfo[1].winners[0].id, "185065214"); // China: 505
  assert.strictEqual(k.transfers[4], null); // team before joining is unknown
  assert.deepStrictEqual(F1F.verify(d).warnings, []);

  const bad = fixture();
  const r2 = F1F.applyManualRounds(bad, { "185065214": { 1: 204, 2: 500, 3: 167 } });
  assert.strictEqual(r2[0].ok, false);
  assert.ok(!bad.managers.find((m) => m.id === "185065214").rounds[1], "wrong numbers are not applied");
});

// boosts and chips worked out from the scores (synthetic league: one manager, 4 rounds)
(() => {
  const A = { D1: { type: "D", short: "AAA" }, D2: { type: "D", short: "BBB" }, D3: { type: "D", short: "CCC" }, D4: { type: "D", short: "DDD" }, D5: { type: "D", short: "EEE" },
    D6: { type: "D", short: "FFF" }, D7: { type: "D", short: "GGG" }, D8: { type: "D", short: "HHH" }, C1: { type: "C" }, C2: { type: "C" }, C3: { type: "C" } };
  Object.keys(A).forEach((id) => { A[id].id = id; A[id].name = id; A[id].team = "T"; });
  const team1 = ["D1", "D2", "D3", "D4", "D5", "C1", "C2"], team3 = ["D6", "D7", "D8", "D4", "D5", "C3", "C2"];
  const ap = {
    1: { D1: 33, D2: 10, D3: 5, D4: 2, D5: 1, C1: 20, C2: 10 },   // 81 + D1 again (2x) = 114 (33 can only be D1 once more)
    2: { D1: 12, D2: 12, D3: 5, D4: 2, D5: 1, C1: 20, C2: 10 },   // 62 + 12: D1 or D2? ambiguous
    3: { D6: 25, D7: 3, D8: 1, D4: 2, D5: 1, C3: 10, C2: 10 },    // 52 + 2*25 (x3) = 102, after 4 changes then back: Limitless
    4: { D1: 20, D2: -8, D3: 5, D4: 2, D5: 1, C1: 10, C2: 10 }    // 40, negatives wiped (+8) and D1 boosted (+20) = 68
  };
  const rounds = { 1: { pts: 114, rank: 1, team: team1 }, 2: { pts: 74, rank: 1, team: team1 }, 3: { pts: 102, rank: 1, team: team3 }, 4: { pts: 68, rank: 1, team: team1 } };
  const data = { roundsPlayed: 4, schedule: [], assets: A, prices: {}, assetPoints: ap,
    managers: [{ id: "x", name: "Test Manager", team: "T", rank: 1, total: 358, picks: team1, rounds }] };
  const m = F1F.build(data).managers[0];
  test("boost: one driver explains the score", () => assert.deepStrictEqual(m.boost[1], { id: "D1", x: 2 }));
  test("boost: two drivers explain it equally, so none is claimed", () => assert.strictEqual(m.boost[2], undefined));
  test("x3 Boost: a single 3x fit; Limitless: big change, then the old team is back", () => {
    assert.deepStrictEqual(m.boost[3], { id: "D6", x: 3 });
    assert.strictEqual(m.chips["x3 Boost"], 3); assert.strictEqual(m.chips.Limitless, 3); assert.strictEqual(m.chips.Wildcard, undefined);
  });
  test("No Negative: the score only fits with the negatives wiped", () => { assert.strictEqual(m.chips["No Negative"], 4); assert.deepStrictEqual(m.boost[4], { id: "D1", x: 2 }); });
  test("chips that leave no trace are never claimed", () => { assert.strictEqual(m.chips.Autopilot, undefined); assert.strictEqual(m.chips["Final Fix"], undefined); });
})();

console.log(n + " tests passed");
