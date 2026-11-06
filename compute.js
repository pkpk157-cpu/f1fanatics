/* F1 Fanatics — every number the app shows, derived from data.json.

   One primitive drives everything: each manager's points in each round
   (list_2 is per-race, NOT a running total — checked against list_1 when the
   project started: the 19 rounds summed to list_1's total for every manager
   with a full history). Standings, rank by round, form, records, team value
   and ownership all come out of that plus the picks and prices.

   Loads in the browser (window.F1F) and in Node (require), so the runner's
   verify step and the app agree on every figure by construction. */
(function (root) {
  "use strict";

  function num(x) { var n = Number(x); return isFinite(n) ? n : null; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdev(a) {
    if (a.length < 2) return null;
    var m = mean(a), v = 0;
    for (var i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    return Math.sqrt(v / (a.length - 1));
  }
  // Competition ranking ("1224"): equal scores share a rank.
  function rankBy(items, key) {
    var s = items.slice().sort(function (a, b) { return key(b) - key(a); });
    var out = new Map(), prev = null, rank = 0;
    s.forEach(function (it, i) {
      var k = key(it);
      if (k !== prev) { rank = i + 1; prev = k; }
      out.set(it, rank);
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Reconciliation: list_1 totals against the per-round list_2 scores. */
  /* ------------------------------------------------------------------ */

  // How list_1 (standings) and list_2 (rounds) line up right now. F1 does not
  // publish both at the same instant after a race, so for a few minutes one
  // can be a round ahead of the other. Managers with a complete round history
  // decide it; a manager who joined late has points from before joining that
  // the league feed never shows, so they cannot.
  // fill in what a damaged or partial data.json leaves out, so nothing below throws
  function tidy(data) {
    if (!data || typeof data !== "object") return data;
    if (!Array.isArray(data.managers)) data.managers = [];
    data.managers.forEach(function (m) { if (!m.rounds || typeof m.rounds !== "object") m.rounds = {}; });
    data.roundsPlayed = Number(data.roundsPlayed) || 0;
    return data;
  }
  function reconcile(data) {
    tidy(data);
    var N = data.roundsPlayed || 0;
    var full = data.managers.filter(function (m) {
      for (var r = 1; r <= N; r++) if (!m.rounds[r]) return false;
      return true;
    });
    function sumTo(m, n) { var s = 0; for (var r = 1; r <= n; r++) s += m.rounds[r] ? m.rounds[r].pts : 0; return s; }
    if (!full.length || !N) return { state: "ok", full: full.length, lagRound: null };
    var allMatch = full.every(function (m) { return Math.abs(sumTo(m, N) - m.total) < 0.01; });
    if (allMatch) return { state: "ok", full: full.length, lagRound: null };
    var behind = N > 1 && full.every(function (m) { return Math.abs(sumTo(m, N - 1) - m.total) < 0.01; });
    if (behind) return { state: "standings-behind", full: full.length, lagRound: N };
    // The next round has been raced and the standings already count it.
    var nextRaced = (data.schedule || []).some(function (s) {
      return s.round === N + 1 && s.race && Date.parse(s.race) < Date.parse(data.generatedAt);
    });
    if (nextRaced) return { state: "rounds-behind", full: full.length, lagRound: N + 1 };
    return { state: "mismatch", full: full.length, lagRound: null };
  }

  /* ------------------------------------------------------------------ */
  /* Checks. Run by scripts/verify-data.js on every update, embedded in  */
  /* data.json, and shown in the app's About sheet.                      */
  /* ------------------------------------------------------------------ */
  function verify(data) {
    tidy(data);
    var errors = [], warnings = [], notes = [];
    if (!data || !Array.isArray(data.managers) || !data.managers.length) {
      errors.push("no managers in the standings");
      return { ok: false, errors: errors, warnings: warnings, notes: notes };
    }
    var N = data.roundsPlayed || 0;
    var assets = data.assets || {};

    // standings order agrees with totals
    var byRank = data.managers.slice().sort(function (a, b) { return a.rank - b.rank; });
    for (var i = 1; i < byRank.length; i++) {
      if (byRank[i].total > byRank[i - 1].total + 0.001)
        errors.push("rank " + byRank[i].rank + " (" + byRank[i].name + ") has more points than rank " + byRank[i - 1].rank);
    }
    var ids = new Set();
    data.managers.forEach(function (m) {
      if (ids.has(m.id)) errors.push("manager " + m.id + " appears twice");
      ids.add(m.id);
    });

    // rounds are contiguous and every manager present in a round is in the standings
    for (var r = 1; r <= N; r++) {
      var present = data.managers.filter(function (m) { return m.rounds[r]; }).length;
      if (!present) errors.push("round " + r + " has no scores");
    }

    // per-manager reconciliation
    var rec = reconcile(data);
    data.managers.forEach(function (m) {
      var known = 0, missing = [];
      for (var r = 1; r <= N; r++) { if (m.rounds[r]) known += m.rounds[r].pts; else missing.push(r); }
      var diff = Math.round((m.total - known) * 100) / 100;
      var hand = Object.keys(m.rounds).filter(function (r) { return m.rounds[r].manual; });
      if (hand.length) notes.push(m.name + ": round" + (hand.length > 1 ? "s " : " ") + hand.join(", ") + " entered by hand (the league feed doesn't have them); they add up to the points F1 counts in their total");
      if (!missing.length) {
        if (diff !== 0 && rec.state === "ok") warnings.push(m.name + ": rounds 1–" + N + " sum to " + known + " but the standings say " + m.total);
      } else {
        notes.push(m.name + " is missing from round" + (missing.length > 1 ? "s " : " ") + missing.join(", ") +
          " of the league feed (joined the league later); " + diff + " points from before then are counted in their total");
      }
      // picks resolve and have the right shape
      var team = m.picks || [];
      var d = 0, c = 0;
      team.forEach(function (id) {
        var a = assets[id];
        if (!a) warnings.push(m.name + ": pick " + id + " is not in the drivers feed");
        else if (a.type === "D") d++; else c++;
      });
      if (team.length && (d !== 5 || c !== 2)) warnings.push(m.name + ": current team has " + d + " drivers and " + c + " constructors");
    });
    if (rec.state === "standings-behind") warnings.push("round " + N + " scores are out but the standings have not caught up yet; totals shown include round " + N);
    if (rec.state === "rounds-behind") warnings.push("the standings include round " + (N + 1) + " but its per-round scores are not published yet");
    if (rec.state === "mismatch") warnings.push("standings totals and per-round scores disagree for some managers");

    // prices for every round played
    for (var p = 1; p <= N; p++) if (!data.prices || !data.prices[p]) warnings.push("no prices for round " + p);

    // the schedule agrees about what has been raced
    (data.schedule || []).forEach(function (s) {
      if (s.round > N && s.race && Date.parse(s.race) + 6 * 3600e3 < Date.parse(data.generatedAt))
        notes.push("round " + s.round + " (" + s.name + ") has been raced but F1 has not published its league scores yet");
    });

    return { ok: !errors.length, errors: errors, warnings: warnings, notes: notes, sync: rec.state };
  }

  /* ------------------------------------------------------------------ */
  /* The model the app renders.                                          */
  /* ------------------------------------------------------------------ */
  function build(data) {
    tidy(data);
    var N = data.roundsPlayed || 0;
    var rounds = [];
    for (var r = 1; r <= N; r++) rounds.push(r);
    var sched = {};
    (data.schedule || []).forEach(function (s) { sched[s.round] = s; });
    var rec = reconcile(data);
    var assets = data.assets || {};
    var priceRounds = Object.keys(data.prices || {}).map(Number).sort(function (a, b) { return a - b; });
    var latestPriceRound = priceRounds.length ? priceRounds[priceRounds.length - 1] : null;

    var managers = data.managers.map(function (src) {
      var m = {
        id: String(src.id), name: String(src.name || ""), team: String(src.team || ""), picks: (src.picks || []).slice(),
        feedRank: src.rank, feedTotal: src.total,
        pts: {}, team_: {}, cum: {}, rankAt: {}, roundRank: {}, teamValue: {}, transfers: {}
      };
      var known = 0, lastMissing = 0;
      rounds.forEach(function (r) {
        var x = src.rounds[r];
        if (x) { m.pts[r] = x.pts; if (x.team && x.team.length) m.team_[r] = x.team; known += x.pts; }
        else { m.pts[r] = null; lastMissing = r; }
      });
      // Totals: list_1, plus the newest round if the standings are a round behind.
      m.total = src.total + (rec.state === "standings-behind" && m.pts[N] != null ? m.pts[N] : 0);
      m.joinRound = null;
      rounds.forEach(function (r) { if (m.joinRound == null && m.pts[r] != null) m.joinRound = r; });
      m.preJoin = lastMissing ? Math.round((m.total - known) * 100) / 100 : 0;
      // Cumulative total after each round. Without gaps, a running sum. With
      // gaps (joined late), counted back from the total, which is exact for
      // every round after the last gap and unknowable before it.
      if (!lastMissing) {
        var run = 0;
        rounds.forEach(function (r) { run += m.pts[r]; m.cum[r] = run; });
      } else {
        var after = 0;
        for (var k = N; k >= 1; k--) {
          m.cum[k] = k >= lastMissing ? m.total - after : null;
          if (m.pts[k] != null) after += m.pts[k];
        }
      }
      return m;
    });

    // league rank after each round, and rank within the round
    rounds.forEach(function (r) {
      var withCum = managers.filter(function (m) { return m.cum[r] != null; });
      var rk = rankBy(withCum, function (m) { return m.cum[r]; });
      managers.forEach(function (m) { m.rankAt[r] = rk.has(m) ? rk.get(m) : null; });
      var played = managers.filter(function (m) { return m.pts[r] != null; });
      var rr = rankBy(played, function (m) { return m.pts[r]; });
      managers.forEach(function (m) { m.roundRank[r] = rr.has(m) ? rr.get(m) : null; });
    });

    // final standings: by total, ties share a rank
    var finalRank = rankBy(managers, function (m) { return m.total; });
    managers.forEach(function (m) { m.rank = finalRank.get(m); });
    managers.sort(function (a, b) { return a.rank - b.rank || a.name.localeCompare(b.name); });
    var leader = managers[0];

    managers.forEach(function (m, i) {
      var played = rounds.filter(function (r) { return m.pts[r] != null; });
      var vals = played.map(function (r) { return m.pts[r]; });
      m.played = played.length;
      m.avg = mean(vals);
      m.median = median(vals);
      m.sd = stdev(vals);
      m.last = N ? m.pts[N] : null;
      m.gapLeader = leader.total - m.total;
      m.gapAbove = i > 0 ? managers[i - 1].total - m.total : null;
      m.gapBelow = i < managers.length - 1 ? m.total - managers[i + 1].total : null;
      var best = null, worst = null;
      played.forEach(function (r) {
        if (!best || m.pts[r] > best.pts) best = { round: r, pts: m.pts[r] };
        if (!worst || m.pts[r] < worst.pts) worst = { round: r, pts: m.pts[r] };
      });
      m.best = best; m.worst = worst;
      m.wins = played.filter(function (r) { return m.roundRank[r] === 1; }).length;
      m.podiums = played.filter(function (r) { return m.roundRank[r] <= 3; }).length;
      m.lastPlace = played.filter(function (r) {
        var n = managers.filter(function (x) { return x.pts[r] != null; }).length;
        return n > 1 && m.roundRank[r] === n;
      }).length;
      var l3 = played.slice(-3).map(function (r) { return m.pts[r]; });
      var l5 = played.slice(-5).map(function (r) { return m.pts[r]; });
      m.form3 = mean(l3);
      m.form5 = mean(l5);
      m.formVsAvg = m.form5 != null && m.avg != null ? m.form5 - m.avg : null;
      m.formRanks = played.slice(-5).map(function (r) { return m.roundRank[r]; });
      // rank movement over the last round: positive = climbed
      var prev = N > 1 ? m.rankAt[N - 1] : null;
      m.move = prev != null && m.rankAt[N] != null ? prev - m.rankAt[N] : null;
      var ranks = rounds.map(function (r) { return m.rankAt[r]; }).filter(function (x) { return x != null; });
      m.bestRank = ranks.length ? Math.min.apply(null, ranks) : null;
      m.worstRank = ranks.length ? Math.max.apply(null, ranks) : null;
      m.roundsLeading = rounds.filter(function (r) { return m.rankAt[r] === 1; }).length;

      // team value: the seven picks at that round's prices
      played.forEach(function (r) {
        var pr = data.prices && data.prices[r];
        var t = m.team_[r];
        if (pr && t && t.length && t.every(function (id) { return pr[id] != null; }))
          m.teamValue[r] = round1(sum(t.map(function (id) { return pr[id]; })));
        else m.teamValue[r] = null;
      });
      var lp = latestPriceRound != null ? data.prices[latestPriceRound] : null;
      m.currentValue = lp && m.picks.length && m.picks.every(function (id) { return lp[id] != null; })
        ? round1(sum(m.picks.map(function (id) { return lp[id]; }))) : null;
      var firstVal = null;
      played.forEach(function (r) { if (firstVal == null && m.teamValue[r] != null) firstVal = m.teamValue[r]; });
      m.valueGain = m.currentValue != null && firstVal != null ? round1(m.currentValue - firstVal) : null;

      // transfers: picks changed from one round to the next
      var tot = 0, prevTeam = null;
      rounds.forEach(function (r) {
        var t = m.team_[r];
        if (!t) { m.transfers[r] = null; prevTeam = null; return; }
        if (!prevTeam) { m.transfers[r] = null; prevTeam = t; return; }
        var ps = new Set(prevTeam);
        var n = t.filter(function (id) { return !ps.has(id); }).length;
        m.transfers[r] = n; tot += n; prevTeam = t;
      });
      m.totalTransfers = tot;
      worked(m);

    });

    // Boosts and chips, worked out from the scores. F1 doesn't publish them; a round's score is
    // its seven picks' points, plus the boosted driver once more (2x) or twice more (x3 Boost),
    // minus 10 per extra transfer. Only answers the numbers allow in exactly one way are kept:
    //   boost[r]  {id, x: 2 | 3}  when exactly one driver explains the score
    //   chips     {name: round}   x3 Boost (a single 3x fit), No Negative (fits only once the
    //             negatives are wiped), Limitless (3+ changes, then the old team comes back),
    //             Wildcard (4+ changes, no penalty, not reverted); a chip seen in more than one
    //             round is dropped. Autopilot and Final Fix leave no trace in the numbers.
    function worked(m) {
      var ap = data.assetPoints || {}, seen = {};
      m.boost = {};
      var same = function (a, b) { return !!(a && b && a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; })); };
      var add = function (c, r) { (seen[c] = seen[c] || []).push(r); };
      rounds.forEach(function (r) {
        var t = m.team_[r], P = ap[r];
        if (!t || !t.length || !P || m.pts[r] == null) return;
        var pts = function (id) { return Number(P[id]) || 0; };
        var drv = t.filter(function (id) { return assets[id] && assets[id].type === "D"; });
        var diff = m.pts[r] - t.reduce(function (s, id) { return s + pts(id); }, 0);
        var prev = m.team_[r - 1], next = m.team_[r + 1];
        var changed = prev ? t.filter(function (id) { return prev.indexOf(id) < 0; }).length : 0;
        // the penalty the changes allow: 2 free transfers a race (3 with one carried over), -10 each beyond;
        // none at all if a Wildcard or Limitless made them free
        var pOK = function (p) { return p === 0 || (p >= Math.max(0, changed - 3) && p <= Math.max(0, changed - 2)); };
        var fits = [];
        drv.forEach(function (id) { for (var k = 1; k <= 2; k++) for (var p = 0; p <= 4; p++) if (pOK(p) && k * pts(id) - 10 * p === diff) fits.push({ id: id, k: k, p: p }); });
        var reverted = !!(prev && next && same(next, prev));
        if (fits.length === 1) {
          m.boost[r] = { id: fits[0].id, x: fits[0].k + 1 };
          if (fits[0].k === 2) add("x3 Boost", r);
          if (changed >= 4 && fits[0].p === 0 && !reverted) add("Wildcard", r);
        }
        if (prev && changed >= 3 && reverted) add("Limitless", r);
        if (!fits.length) {
          var neg = t.reduce(function (s, id) { return s + Math.max(0, -pts(id)); }, 0), nn = [];
          if (neg > 0) drv.forEach(function (id) { var q = Math.max(0, pts(id)); for (var k = 1; k <= 2; k++) for (var p = 0; p <= 4; p++) if (pOK(p) && k * q - 10 * p + neg === diff) nn.push(id); });
          if (nn.length) {
            add("No Negative", r);
            if (nn.every(function (id) { return id === nn[0]; })) m.boost[r] = { id: nn[0], x: 2 };
          }
        }
      });
      m.chips = {};
      Object.keys(seen).forEach(function (c) { if (seen[c].length === 1) m.chips[c] = seen[c][0]; });
    }

    // Dream team: the best five drivers and two constructors of each round as
    // F1 Fantasy scored them, top driver boosted 2x, no cost cap, at that
    // round's prices.
    function teamOfWeek(r) {
      var pts = (data.assetPoints || {})[r], pr = (data.prices || {})[r] || {};
      if (!pts) return null;
      var all = Object.keys(pts).filter(function (id) { return assets[id]; }).map(function (id) { return { id: id, pts: pts[id], price: pr[id] }; });
      var pick = function (type, n) {
        return all.filter(function (x) { return assets[x.id].type === type; })
          .sort(function (a, b) { return b.pts - a.pts || (a.price || 0) - (b.price || 0); }).slice(0, n);
      };
      var d = pick("D", 5), c = pick("C", 2);
      var list = d.concat(c);
      // F1's own Team of the Week boosts its best driver 2x; so does this
      var boosted = d.length ? d[0].id : null;
      return { drivers: d, constructors: c, boosted: boosted,
        pts: sum(list.map(function (x) { return x.pts; })) + (d.length ? d[0].pts : 0),
        cost: round1(sum(list.map(function (x) { return x.price || 0; }))) };
    }

    // per-round summary
    var roundInfo = rounds.map(function (r) {
      var played = managers.filter(function (m) { return m.pts[r] != null; });
      var vals = played.map(function (m) { return m.pts[r]; });
      var hi = vals.length ? Math.max.apply(null, vals) : null, lo = vals.length ? Math.min.apply(null, vals) : null;
      var s = sched[r] || {};
      return {
        round: r, name: s.name || "Round " + r, short: s.short || ("R" + r), sprint: !!s.sprint, date: s.race || null,
        avg: mean(vals), high: hi, low: lo, count: played.length,
        winners: played.filter(function (m) { return m.pts[r] === hi; }),
        totw: teamOfWeek(r),
        losers: played.filter(function (m) { return m.pts[r] === lo; })
      };
    });
    managers.forEach(function (m) {
      m.aboveAvg = rounds.filter(function (r, i) { return m.pts[r] != null && m.pts[r] > roundInfo[i].avg; }).length;
    });

    // records
    var all = [];
    managers.forEach(function (m) { rounds.forEach(function (r) { if (m.pts[r] != null) all.push({ m: m, round: r, pts: m.pts[r] }); }); });
    var top = all.slice().sort(function (a, b) { return b.pts - a.pts || a.round - b.round; }).slice(0, 10);
    var bottom = all.slice().sort(function (a, b) { return a.pts - b.pts || a.round - b.round; }).slice(0, 10);
    var climbs = [];
    managers.forEach(function (m) {
      for (var r = 2; r <= N; r++) {
        if (m.rankAt[r] != null && m.rankAt[r - 1] != null) climbs.push({ m: m, round: r, delta: m.rankAt[r - 1] - m.rankAt[r], from: m.rankAt[r - 1], to: m.rankAt[r] });
      }
    });
    var rises = climbs.filter(function (c) { return c.delta > 0; }).sort(function (a, b) { return b.delta - a.delta || a.round - b.round; }).slice(0, 5);
    var falls = climbs.filter(function (c) { return c.delta < 0; }).sort(function (a, b) { return a.delta - b.delta || a.round - b.round; }).slice(0, 5);

    // ownership: current picks across the league, against the whole game
    var owners = {};
    managers.forEach(function (m) { m.picks.forEach(function (id) { (owners[id] = owners[id] || []).push(m); }); });
    var seasonCount = {};
    managers.forEach(function (m) { rounds.forEach(function (r) { (m.team_[r] || []).forEach(function (id) { seasonCount[id] = (seasonCount[id] || 0) + 1; }); }); });
    var managerRounds = sum(managers.map(function (m) { return m.played; }));
    var lp2 = latestPriceRound != null ? data.prices[latestPriceRound] : {};
    var lastPts = data.assetPoints || {};
    var ownership = Object.keys(assets).map(function (id) {
      var a = assets[id];
      var tot = 0, scored = 0;
      rounds.forEach(function (r) { var p = lastPts[r] && lastPts[r][id]; if (p != null) { tot += p; scored++; } });
      return {
        id: id, asset: a, owners: owners[id] || [], count: (owners[id] || []).length,
        pct: managers.length ? (owners[id] || []).length / managers.length * 100 : 0,
        global: data.ownershipGlobal ? num(data.ownershipGlobal[id]) : null,
        seasonPct: managerRounds ? (seasonCount[id] || 0) / managerRounds * 100 : 0,
        seasonCount: seasonCount[id] || 0,
        price: lp2 && lp2[id] != null ? lp2[id] : null,
        seasonPts: scored ? tot : null,
        lastPts: N && lastPts[N] && lastPts[N][id] != null ? lastPts[N][id] : null,
        active: a.active !== false
      };
    });
    ownership.sort(function (a, b) { return b.count - a.count || b.seasonPct - a.seasonPct || (b.price || 0) - (a.price || 0); });

    var next = null;
    (data.schedule || []).forEach(function (s) { if (!next && s.round > N) next = s; });

    return {
      data: data, N: N, rounds: rounds, roundInfo: roundInfo, managers: managers, leader: leader,
      sync: rec, priceRound: latestPriceRound,
      records: { top: top, bottom: bottom, rises: rises, falls: falls },
      ownership: ownership,
      drivers: ownership.filter(function (o) { return o.asset.type === "D"; }),
      constructors: ownership.filter(function (o) { return o.asset.type === "C"; }),
      next: next,
      remaining: (data.schedule || []).filter(function (s) { return s.round > N; }).length
    };
  }

  /* ------------------------------------------------------------------ */
  /* Prize money: entry x managers is the pot; each round's top scorer   */
  /* takes perRound (ties split it); the rest goes to the season's top   */
  /* three in the ratio cfg.split (tied places share their prizes).      */
  /* ------------------------------------------------------------------ */
  function splitExact(total, weights) {
    // whole amounts that add up exactly (largest remainder)
    var w = sum(weights), raw = weights.map(function (x) { return total * x / w; });
    var out = raw.map(Math.floor), left = total - sum(out);
    raw.map(function (x, i) { return { i: i, f: x - Math.floor(x) }; }).sort(function (a, b) { return b.f - a.f; })
      .slice(0, left).forEach(function (x) { out[x.i]++; });
    return out;
  }
  function prizes(M, cfg) {
    if (!cfg) return null;
    var players = M.managers.length;
    var totalRounds = Math.max(M.N, (M.data.schedule || []).length);
    var pot = cfg.entry * players;
    var roundPool = cfg.perRound * totalRounds;
    var seasonPool = Math.max(0, pot - roundPool);
    var seasonPrizes = splitExact(seasonPool, cfg.split || [1]);
    var by = {};
    M.managers.forEach(function (m) { by[m.id] = { m: m, race: 0, raceWins: [], projected: 0 }; });
    var payouts = M.roundInfo.map(function (ri) {
      var each = ri.winners.length ? cfg.perRound / ri.winners.length : 0;
      ri.winners.forEach(function (w) { by[w.id].race += each; by[w.id].raceWins.push({ round: ri.round, amount: each, shared: ri.winners.length > 1 }); });
      return { round: ri.round, winners: ri.winners, each: each };
    });
    // if the season ended now: places by rank, ties share the places they cover
    var groups = {};
    M.managers.forEach(function (m) { (groups[m.rank] = groups[m.rank] || []).push(m); });
    Object.keys(groups).forEach(function (rk) {
      var g = groups[rk], start = Number(rk), pool = 0;
      for (var p = start; p < start + g.length; p++) if (p <= seasonPrizes.length) pool += seasonPrizes[p - 1];
      g.forEach(function (m) { by[m.id].projected = pool / g.length; });
    });
    M.managers.forEach(function (m) {
      var x = by[m.id];
      x.total = x.race + x.projected;
      x.net = x.total - cfg.entry;
    });
    return {
      cfg: cfg, players: players, pot: pot, totalRounds: totalRounds,
      roundPool: roundPool, roundsPaid: M.N * cfg.perRound, roundsLeft: totalRounds - M.N,
      seasonPool: seasonPool, seasonPrizes: seasonPrizes, payouts: payouts, by: by
    };
  }

  /* Hand-entered round scores for rounds the league feed is missing (a late
     joiner). Applied only when they fill the gap exactly: the manager's
     known rounds plus these must equal F1's total for them. Returns what
     happened, for the checks. */
  function applyManualRounds(data, manual) {
    tidy(data);
    var out = [];
    if (!manual) return out;
    Object.keys(manual).forEach(function (id) {
      var m = data.managers.find(function (x) { return x.id === String(id); });
      if (!m) { out.push({ id: id, ok: false, why: "not in the standings" }); return; }
      var add = manual[id], rounds = Object.keys(add).map(Number).filter(function (r) { return r >= 1 && r <= (data.roundsPlayed || 0) && !m.rounds[r]; });
      if (!rounds.length) { out.push({ id: id, name: m.name, ok: true, applied: [], why: "nothing missing" }); return; }
      var known = 0; Object.keys(m.rounds).forEach(function (r) { known += m.rounds[r].pts; });
      var missing = 0; for (var r = 1; r <= data.roundsPlayed; r++) if (!m.rounds[r]) missing++;
      var given = rounds.reduce(function (a, r) { return a + Number(add[r]); }, 0);
      if (rounds.length !== missing || Math.abs(known + given - m.total) > 0.01) {
        out.push({ id: id, name: m.name, ok: false, why: "hand-entered rounds add up to " + given + " but F1's total leaves " + (m.total - known) });
        return;
      }
      rounds.forEach(function (r) { m.rounds[r] = { pts: Number(add[r]), rank: null, team: [], manual: true }; });
      out.push({ id: id, name: m.name, ok: true, applied: rounds });
    });
    return out;
  }

  var CHIPS = ["Limitless", "Wildcard", "Final Fix", "Autopilot", "x3 Boost", "No Negative"];
  var F1F = { CHIPS: CHIPS, build: build, applyManualRounds: applyManualRounds, prizes: prizes, splitExact: splitExact, verify: verify, reconcile: reconcile, mean: mean, median: median, stdev: stdev, rankBy: rankBy };
  if (typeof module !== "undefined" && module.exports) module.exports = F1F;
  else root.F1F = F1F;
})(this);
