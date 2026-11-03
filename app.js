/* F1 Fanatics — the app. Reads data.json, builds the model with compute.js,
   renders five tabs and two sheets. No framework, no build step. */
(function () {
  "use strict";
  var CONFIG = window.F1F_CONFIG;
  var F1F = window.F1F;
  var TABS = ["standings", "races", "trends", "stats", "picks"];
  var REFRESH_MS = 5 * 60 * 1000;

  var S = { data: null, model: null, me: load("me"), focus: null, tab: "standings", fetchedAt: 0 };

  /* ---------------- small helpers ---------------- */
  function load(k) { try { return JSON.parse(localStorage.getItem("f1f." + k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem("f1f." + k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return "–";
    return Number(n).toLocaleString("en-GB", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function signed(n, d) { if (n == null) return "–"; return (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n), d); }
  function money(n) { return n == null ? "–" : "$" + fmt(n, 1) + "m"; }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function when(iso, opts) {
    if (!iso) return "";
    return new Date(iso).toLocaleString(undefined, opts || { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function ago(iso) {
    if (!iso) return "";
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400 * 2) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }
  function until(iso) {
    var s = (Date.parse(iso) - Date.now()) / 1000;
    if (s <= 0) return "now";
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m + "m";
  }
  function byId(id) { return S.model.managers.find(function (m) { return m.id === id; }); }
  function isMe(m) { return S.me && m.id === S.me; }
  function roundName(r) { var i = S.model.roundInfo[r - 1]; return i ? i.short : "R" + r; }

  var TEAM_COLORS = {
    "Mercedes": "#00a19c", "Ferrari": "#e8002d", "McLaren": "#ff8000", "Red Bull Racing": "#3671c6",
    "Aston Martin": "#229971", "Alpine": "#0093cc", "Williams": "#1868db", "Racing Bulls": "#6692ff",
    "Haas F1 Team": "#9c9fa2", "Audi": "#b4b4b4", "Cadillac": "#c9a227", "Kick Sauber": "#52e252"
  };
  function teamColor(t) { return TEAM_COLORS[t] || "#888"; }
  function assetLabel(a, withTeam) {
    if (!a) return "?";
    return a.type === "C" ? esc(a.name) : esc(a.name) + (withTeam ? ' <span class="muted">· ' + esc(a.team) + "</span>" : "");
  }

  // shade for a round rank: green for the top of the round, red for the bottom
  function heat(rank, n) {
    if (rank == null || n < 2) return "";
    var t = (n - rank) / (n - 1);
    var a = Math.abs(t - 0.5) * 2 * 0.5 + 0.06;
    return "background: rgba(var(" + (t >= 0.5 ? "--heat-hi" : "--heat-lo") + "), " + a.toFixed(2) + ")";
  }
  function formChip(rank, n) {
    if (rank == null) return '<span style="background:var(--surface-2);color:var(--faint)">–</span>';
    var t = n > 1 ? (n - rank) / (n - 1) : 1;
    var col = t >= 0.67 ? "var(--up)" : t <= 0.33 ? "var(--down)" : "var(--faint)";
    return '<span style="background:' + col + '" title="' + ordinal(rank) + ' in the round">' + rank + "</span>";
  }
  function moveCell(mv) {
    if (mv == null) return '<td class="mv same">–</td>';
    if (mv > 0) return '<td class="mv up" title="Up ' + mv + '">▲' + mv + "</td>";
    if (mv < 0) return '<td class="mv down" title="Down ' + -mv + '">▼' + -mv + "</td>";
    return '<td class="mv same" title="No change">–</td>';
  }
  function whoCell(m) {
    return '<td class="l who"><div class="n">' + esc(m.name) + (isMe(m) ? ' <span class="pill me">you</span>' : "") +
      '</div><div class="t">' + esc(m.team) + "</div></td>";
  }

  /* ---------------- data ---------------- */
  function fetchData() {
    return fetch(CONFIG.dataUrl + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("data.json " + r.status); return r.json(); })
      .then(function (d) {
        try { localStorage.setItem("f1f.data", JSON.stringify(d)); } catch (e) {}
        return d;
      })
      .catch(function (e) {
        var cached = load("data");
        if (cached) return Object.assign(cached, { _offline: true });
        throw e;
      });
  }
  function setData(d) {
    var changed = !S.data || S.data.generatedAt !== d.generatedAt || !!S.data._offline !== !!d._offline;
    S.data = d;
    S.model = F1F.build(d);
    S.fetchedAt = Date.now();
    if (S.me && !byId(S.me)) S.me = null;
    return changed;
  }
  function refresh(force) {
    if (!force && Date.now() - S.fetchedAt < REFRESH_MS) return;
    fetchData().then(function (d) { if (setData(d)) render(); }).catch(function () {});
  }

  /* ---------------- header & banner ---------------- */
  function renderChrome() {
    var M = S.model, d = S.data;
    $("leagueName").textContent = (d.league && d.league.name) || CONFIG.leagueName;
    $("subline").textContent = d.league.season + " · Round " + M.N + " of " + (M.N + M.remaining) +
      " · updated " + ago(d.generatedAt);
    $("meBtn").classList.toggle("on", !!S.me);
    document.querySelectorAll("#tabs a").forEach(function (a) { a.classList.toggle("active", a.dataset.tab === S.tab); });
    var msgs = [];
    if (d._offline) msgs.push("Offline — showing the last data this phone saw.");
    if (M.sync.state === "standings-behind") msgs.push("Round " + M.N + " scores are in; F1's standings haven't caught up yet, so totals here include them already.");
    if (M.sync.state === "rounds-behind") msgs.push("F1's standings include " + (M.next ? M.next.name : "the latest round") + ", but its race-by-race scores aren't published yet. Totals are F1's; round stats stop at round " + M.N + ".");
    if (M.sync.state === "mismatch") msgs.push("F1's standings and per-round scores don't agree right now. Totals are F1's own; tap ⓘ for details.");
    var b = $("banner");
    b.hidden = !msgs.length;
    b.textContent = msgs.join(" ");
  }

  /* ---------------- views ---------------- */
  function viewStandings() {
    var M = S.model, h = "";
    var lastInfo = M.roundInfo[M.N - 1];
    var me = S.me && byId(S.me);
    h += '<section class="hero">';
    h += tile("Leader", esc(M.leader.name), fmt(M.leader.total) + " pts · " + (M.managers[1] ? "+" + fmt(M.leader.total - M.managers[1].total) + " clear" : ""));
    if (lastInfo) h += tile("Top score, " + esc(lastInfo.short), lastInfo.winners.map(function (m) { return esc(m.name); }).join(", "), fmt(lastInfo.high) + " pts · league avg " + fmt(lastInfo.avg));
    if (M.next) {
      var open = M.next.lock && Date.parse(M.next.lock) > Date.now();
      h += tile("Next: " + esc(M.next.short) + (M.next.sprint ? " (sprint)" : ""), open ? until(M.next.lock) : "Under way",
        open ? "locks " + when(M.next.lock, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "awaiting F1's scores");
    }
    else h += tile("Season", "Complete", M.N + " rounds");
    var above = me ? M.managers[M.managers.indexOf(me) - 1] : null;
    if (me) h += tile("You", ordinal(me.rank) + " · " + fmt(me.total), above ? fmt(me.gapAbove) + " behind " + esc(above.name) : "Top of the league");
    else h += tile("Season", M.N + " / " + (M.N + M.remaining), M.remaining + " rounds to go");
    h += "</section>";

    h += '<section class="card"><h2>Overall standings</h2><p class="sub">After ' + esc(lastInfo ? lastInfo.name : "round " + M.N) +
      ". ▲▼ = places moved in the last round. Tap a manager for their season.</p>";
    h += '<div class="tblwrap"><table><thead><tr><th class="c">#</th><th class="c"></th><th class="l">Manager</th><th title="Points in the last round">' +
      (lastInfo ? '<span title="' + esc(lastInfo.name) + '">' + esc(abbr(lastInfo.short)) + "</span>" : "Last") + '</th><th>Total</th><th title="Behind the leader">Gap</th></tr></thead><tbody>';
    M.managers.forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><td class="pos">' + m.rank + "</td>" + moveCell(m.move) + whoCell(m) +
        '<td style="' + heat(m.roundRank[M.N], lastInfo ? lastInfo.count : 0) + '">' + fmt(m.last) + '</td><td class="num">' + fmt(m.total) +
        '</td><td class="muted">' + (m.gapLeader ? "−" + fmt(m.gapLeader) : "—") + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // quick form glance
    h += '<section class="card"><h2>Form guide</h2><p class="sub">Finishing position within each of the last five rounds (1 = top score of the round), newest on the right.</p><div class="rows">';
    M.managers.slice().sort(function (a, b) { return b.form5 - a.form5; }).forEach(function (m, i) {
      h += '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + (i + 1) + '</div><div class="main"><div class="n">' + esc(m.name) +
        '</div><div class="t">last 5 avg ' + fmt(m.form5) + " (" + signed(m.formVsAvg) + " vs season)" + '</div></div><div class="form">' +
        m.formRanks.map(function (r) { return formChip(r, M.managers.length); }).join("") + "</div></div>";
    });
    h += "</div></section>";
    return h;
  }
  function tile(k, v, d) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + (d || "") + "</div></div>"; }

  function viewRaces() {
    var M = S.model, h = "";
    h += '<section class="card"><h2>Race by race</h2><p class="sub">Points each round. Shaded by finishing position within the round; gold outline = round winner.</p>';
    h += '<div class="tblwrap"><table class="heat"><thead><tr><th class="l">Manager</th>';
    M.roundInfo.forEach(function (ri) { h += '<th class="rd" title="' + esc(ri.name) + '">' + esc(abbr(ri.short)) + "<br>" + ri.round + "</th>"; });
    h += '<th>Total</th></tr></thead><tbody>';
    M.managers.forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><td class="l"><b>' + esc(firstName(m)) + "</b></td>";
      M.roundInfo.forEach(function (ri) {
        var p = m.pts[ri.round];
        if (p == null) { h += '<td class="cell none" title="Not in the league yet">·</td>'; return; }
        h += '<td class="cell' + (m.roundRank[ri.round] === 1 ? " win" : "") + '" style="' + heat(m.roundRank[ri.round], ri.count) + '" title="' +
          esc(m.name + " — " + ri.name + ": " + p + " pts, " + ordinal(m.roundRank[ri.round]) + " of " + ri.count) + '">' + fmt(p) + "</td>";
      });
      h += '<td class="tot">' + fmt(m.total) + "</td></tr>";
    });
    h += '<tr><td class="l muted">League avg</td>';
    M.roundInfo.forEach(function (ri) { h += '<td class="muted">' + fmt(ri.avg) + "</td>"; });
    h += "<td></td></tr></tbody></table></div>";
    h += '<div class="legend">Top of the round <span class="ramp" style="background:linear-gradient(90deg, rgba(var(--heat-hi),.56), rgba(var(--heat-hi),.06), rgba(var(--heat-lo),.06), rgba(var(--heat-lo),.56))"></span> bottom</div>';
    if (M.managers.some(function (m) { return m.preJoin; })) {
      h += '<p class="sub" style="margin-top:8px">· = not in the league yet. ' + M.managers.filter(function (m) { return m.preJoin; }).map(function (m) {
        return esc(m.name) + " joined from round " + m.joinRound + "; their " + fmt(m.preJoin) + " points before that count in the total";
      }).join(". ") + ".</p>";
    }
    h += "</section>";

    h += '<section class="card"><h2>Rounds</h2><p class="sub">Newest first. Tap a round for its full result.</p><div class="rows">';
    M.roundInfo.slice().reverse().forEach(function (ri) {
      h += '<div class="row click" data-r="' + ri.round + '"><div class="rk">' + ri.round + '</div><div class="main"><div class="n">' + esc(ri.name) +
        (ri.sprint ? ' <span class="pill">sprint</span>' : "") + '</div><div class="t">' +
        ri.winners.map(function (m) { return "🏆 " + esc(m.name); }).join(", ") + " · avg " + fmt(ri.avg) + " · low " + fmt(ri.low) +
        '</div></div><div class="big">' + fmt(ri.high) + "</div></div>";
    });
    h += "</div></section>";
    return h;
  }
  function abbr(s) {
    var A = { "Australian": "AUS", "Chinese": "CHN", "Japanese": "JPN", "Miami": "MIA", "Canadian": "CAN", "Monaco": "MON", "Barcelona": "BCN",
      "Austrian": "AUT", "British": "GBR", "Belgian": "BEL", "Hungarian": "HUN", "Dutch": "NED", "Italian": "ITA", "Spanish": "ESP", "Azerbaijan": "AZE",
      "Bahrain": "BHR", "Saudi Arabian": "KSA", "Singapore": "SGP", "United States": "USA", "Mexico City": "MEX", "São Paulo": "BRA", "Las Vegas": "LVG",
      "Qatar": "QAT", "Abu Dhabi": "ABU", "Emilia Romagna": "EMI", "Madrid": "MAD" };
    return A[s] || String(s).slice(0, 3).toUpperCase();
  }
  function firstName(m) {
    var f = m.name.split(" ")[0];
    var clash = S.model.managers.filter(function (x) { return x.name.split(" ")[0] === f; }).length > 1;
    return clash ? m.name.split(" ").slice(0, 1).join(" ") + " " + (m.name.split(" ")[1] || "").charAt(0) + "." : f;
  }

  function viewTrends() {
    var M = S.model, h = "";
    h += chipsHtml();
    h += '<section class="card"><h2>League position by round</h2><p class="sub">Where each manager stood after every round.</p><div class="chartbox" data-chart="rank"></div>' + keyHtml() + "</section>";
    h += '<section class="card"><h2>Points behind the leader</h2><p class="sub">The gap to whoever was top after each round. 0 = leading.</p><div class="chartbox" data-chart="gap"></div>' + keyHtml() + "</section>";
    h += '<section class="card"><h2>Points per round</h2><p class="sub">Each round\'s score; the dashed line is the league average.</p><div class="chartbox" data-chart="pts"></div>' + keyHtml() + "</section>";
    h += '<section class="card"><h2>Team value ($m)</h2><p class="sub">The seven picks at each round\'s prices. Teams start at $100m; cash in the bank isn\'t published. A one-round spike is the Limitless chip.</p><div class="chartbox" data-chart="value"></div>' + keyHtml() + "</section>";
    return h;
  }
  function chipsHtml() {
    var M = S.model;
    return '<section class="card"><h2>Highlight a manager</h2><p class="sub">Gold = leader' + (S.me ? ", blue = you" : "") + ", red = the one you pick.</p><div class=\"chips\">" +
      M.managers.map(function (m) {
        var cls = m.id === S.focus ? " on" : isMe(m) ? " me" : m === M.leader ? " lead" : "";
        return '<button class="chip' + cls + '" data-focus="' + esc(m.id) + '">' + esc(m.name) + "</button>";
      }).join("") + "</div></section>";
  }
  function keyHtml() {
    var M = S.model, k = [];
    k.push('<span><i style="background:var(--gold)"></i>' + esc(M.leader.name) + "</span>");
    if (S.me && S.me !== M.leader.id) k.push('<span><i style="background:var(--me)"></i>' + esc(byId(S.me).name) + "</span>");
    if (S.focus && S.focus !== S.me && S.focus !== M.leader.id) k.push('<span><i style="background:var(--accent)"></i>' + esc(byId(S.focus).name) + "</span>");
    k.push('<span><i style="background:var(--series-muted)"></i>everyone else</span>');
    return '<div class="key">' + k.join("") + "</div>";
  }

  function chartSeries(kind, only) {
    var M = S.model;
    var leadCum = {};
    M.rounds.forEach(function (r) {
      var best = null;
      M.managers.forEach(function (m) { if (m.cum[r] != null && (best == null || m.cum[r] > best)) best = m.cum[r]; });
      leadCum[r] = best;
    });
    return M.managers.filter(function (m) { return !only || m.id === only; }).map(function (m) {
      var vals = {};
      M.rounds.forEach(function (r) {
        if (kind === "rank") vals[r] = m.rankAt[r];
        else if (kind === "gap") vals[r] = m.cum[r] == null ? null : leadCum[r] - m.cum[r];
        else if (kind === "pts") vals[r] = m.pts[r];
        else if (kind === "value") vals[r] = m.teamValue[r];
      });
      return { id: m.id, label: m.name, vals: vals };
    });
  }

  // A plain SVG line chart, drawn at the box's real width so text stays legible.
  function lineChart(box, kind, opts) {
    opts = opts || {};
    var M = S.model;
    var series = chartSeries(kind);
    var W = Math.max(280, box.clientWidth || 600), H = opts.height || (W < 500 ? 230 : 270);
    var padL = 34, padR = W < 500 ? 70 : 96, padT = 10, padB = 26;
    var rounds = M.rounds;
    if (!rounds.length) { box.innerHTML = '<div class="empty">No rounds yet.</div>'; return; }
    var all = [];
    series.forEach(function (s) { rounds.forEach(function (r) { if (s.vals[r] != null) all.push(s.vals[r]); }); });
    var invert = kind === "rank" || kind === "gap";
    var lo, hi;
    if (kind === "rank") { lo = 1; hi = M.managers.length; }
    else if (kind === "gap") { lo = 0; hi = niceMax(Math.max.apply(null, all)); }
    else { lo = niceMin(Math.min.apply(null, all)); hi = niceMax(Math.max.apply(null, all)); }
    if (hi === lo) hi = lo + 1;
    var x = function (r) { return padL + (rounds.length === 1 ? 0 : (r - rounds[0]) / (rounds[rounds.length - 1] - rounds[0]) * (W - padL - padR)); };
    var y = function (v) { var t = (v - lo) / (hi - lo); return invert ? padT + t * (H - padT - padB) : H - padB - t * (H - padT - padB); };
    var ticks = kind === "rank" ? M.managers.map(function (m, i) { return i + 1; }).filter(function (v) { return M.managers.length <= 12 || v === 1 || v % 2 === 0; })
      : niceTicks(lo, hi, 5);
    var g = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opts.label || kind) + '">';
    g += '<g class="grid">';
    ticks.forEach(function (t) { g += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>'; });
    g += '</g><g class="axis">';
    ticks.forEach(function (t) { g += '<text x="' + (padL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + (kind === "value" ? fmt(t) : fmt(t)) + "</text>"; });
    var step = rounds.length > 14 && W < 600 ? 3 : rounds.length > 10 ? 2 : 1;
    rounds.forEach(function (r, i) { if (i % step === 0 || i === rounds.length - 1) g += '<text x="' + x(r) + '" y="' + (H - 8) + '" text-anchor="middle">' + r + "</text>"; });
    g += "</g>";
    if (kind === "pts") {
      var avg = rounds.map(function (r) { return [x(r), y(M.roundInfo[r - 1].avg)]; });
      g += '<path d="' + pathOf(avg) + '" fill="none" stroke="var(--text)" stroke-opacity=".5" stroke-dasharray="4 4" stroke-width="1.4"/>';
    }
    var role = function (s) {
      if (s.id === S.focus) return "focus";
      if (s.id === S.me) return "mine";
      if (s.id === M.leader.id) return "lead";
      return "";
    };
    var order = series.slice().sort(function (a, b) { return (role(a) ? 1 : 0) - (role(b) ? 1 : 0) || (role(a) === "focus") - (role(b) === "focus"); });
    var labels = [];
    order.forEach(function (s) {
      var segs = [], cur = [];
      rounds.forEach(function (r) {
        if (s.vals[r] == null) { if (cur.length) segs.push(cur); cur = []; }
        else cur.push([x(r), y(s.vals[r])]);
      });
      if (cur.length) segs.push(cur);
      var d = segs.map(pathOf).join(" ");
      var cls = role(s);
      g += '<path class="series ' + cls + '" d="' + d + '"/>';
      g += '<path class="hit" d="' + d + '" data-focus="' + esc(s.id) + '"><title>' + esc(s.label) + "</title></path>";
      if (cls) {
        var lastR = null; rounds.forEach(function (r) { if (s.vals[r] != null) lastR = r; });
        if (lastR != null) {
          var col = cls === "focus" ? "var(--accent)" : cls === "mine" ? "var(--me)" : "var(--gold)";
          g += '<circle class="dot" cx="' + x(lastR) + '" cy="' + y(s.vals[lastR]) + '" r="3.5" stroke="' + col + '"/>';
          labels.push({ y: y(s.vals[lastR]), x: x(lastR) + 8, text: shortName(s.label) + " " + valLabel(kind, s.vals[lastR]), col: col });
        }
      }
    });
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    labels.forEach(function (l) { g += '<text class="endlabel" x="' + l.x + '" y="' + (l.y + 4) + '" style="fill:' + l.col + '">' + esc(l.text) + "</text>"; });
    g += "</svg>";
    box.innerHTML = g;
  }
  function valLabel(kind, v) { return kind === "rank" ? ordinal(v) : kind === "gap" ? (v ? "−" + fmt(v) : "lead") : kind === "value" ? fmt(v, 1) : fmt(v); }
  function shortName(n) { var p = n.split(" "); return p[0] + (p[1] ? " " + p[1].charAt(0) + "." : ""); }
  function pathOf(pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" "); }
  function niceStep(span, n) { var raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; }
  function niceMax(v) { if (v <= 0) return 0; var s = niceStep(v, 4); return Math.ceil(v / s) * s; }
  function niceMin(v) { if (v >= 0) { var s = niceStep(v || 1, 4); return Math.max(0, Math.floor(v / s) * s); } var s2 = niceStep(-v, 2); return Math.floor(v / s2) * s2; }
  function niceTicks(lo, hi, n) { var s = niceStep(hi - lo, n), out = []; for (var v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(Math.round(v * 100) / 100); return out; }

  function viewStats() {
    var M = S.model, h = "";
    var n = M.managers.length;

    // Records
    h += '<div class="grid two">';
    h += '<section class="card"><h2>Highest rounds</h2><p class="sub">Best single-round scores this season.</p><div class="rows">' +
      M.records.top.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round), fmt(x.pts)); }).join("") + "</div></section>";
    h += '<section class="card"><h2>Lowest rounds</h2><p class="sub">The weekends to forget.</p><div class="rows">' +
      M.records.bottom.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round), fmt(x.pts)); }).join("") + "</div></section>";
    h += "</div><div style=\"height:14px\"></div>";

    // Best / worst weekends per manager + consistency
    h += '<section class="card"><h2>Best &amp; worst weekends</h2><p class="sub">Per manager. SD = how much their score swings round to round (lower = steadier).</p>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Best</th><th class="l"></th><th>Worst</th><th class="l"></th><th>Avg</th><th>Median</th><th>SD</th></tr></thead><tbody>';
    M.managers.forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) +
        '<td class="num up">' + fmt(m.best && m.best.pts) + '</td><td class="l muted small">' + (m.best ? esc(roundName(m.best.round)) : "") +
        '</td><td class="num down">' + fmt(m.worst && m.worst.pts) + '</td><td class="l muted small">' + (m.worst ? esc(roundName(m.worst.round)) : "") +
        "</td><td>" + fmt(m.avg, 1) + "</td><td>" + fmt(m.median) + "</td><td>" + fmt(m.sd) + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // Honours
    h += '<section class="card"><h2>Round honours</h2><p class="sub">Round wins (top score of the round, ties shared), top-three finishes, last places, rounds above the league average, and rounds spent top of the standings.</p>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Wins</th><th>Top 3</th><th>Last</th><th>Above avg</th><th>Led after</th></tr></thead><tbody>';
    M.managers.slice().sort(function (a, b) { return b.wins - a.wins || b.podiums - a.podiums || a.rank - b.rank; }).forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + '<td class="num">' + m.wins + "</td><td>" + m.podiums + "</td><td>" + m.lastPlace +
        "</td><td>" + m.aboveAvg + "/" + m.played + "</td><td>" + m.roundsLeading + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // Form
    h += '<section class="card"><h2>Form</h2><p class="sub">Average over the last 3 and 5 rounds, against the manager\'s own season average.</p>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th class="c">Last 5 (round finish)</th><th>L3</th><th>L5</th><th>Season</th><th>vs season</th></tr></thead><tbody>';
    M.managers.slice().sort(function (a, b) { return b.form5 - a.form5; }).forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + '<td class="c"><span class="form">' + m.formRanks.map(function (r) { return formChip(r, n); }).join("") +
        '</span></td><td>' + fmt(m.form3) + '</td><td class="num">' + fmt(m.form5) + "</td><td>" + fmt(m.avg) + '</td><td class="' + (m.formVsAvg >= 0 ? "up" : "down") + '">' + signed(m.formVsAvg) + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // Movement
    h += '<div class="grid two">';
    h += '<section class="card"><h2>Biggest climbs</h2><p class="sub">Places gained in the standings in a single round.</p><div class="rows">' +
      (M.records.rises.length ? M.records.rises.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round) + " · " + ordinal(x.from) + " → " + ordinal(x.to), '<span class="up">▲' + x.delta + "</span>"); }).join("") : '<div class="empty">None yet.</div>') + "</div></section>";
    h += '<section class="card"><h2>Biggest drops</h2><p class="sub">Places lost in a single round.</p><div class="rows">' +
      (M.records.falls.length ? M.records.falls.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round) + " · " + ordinal(x.from) + " → " + ordinal(x.to), '<span class="down">▼' + -x.delta + "</span>"); }).join("") : '<div class="empty">None yet.</div>') + "</div></section>";
    h += "</div><div style=\"height:14px\"></div>";

    h += '<section class="card"><h2>Highs &amp; lows in the table</h2><p class="sub">Best and worst league position after any round, and where they are now.</p>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Now</th><th>Best</th><th>Worst</th><th>Last round</th></tr></thead><tbody>';
    M.managers.forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + '<td class="num">' + ordinal(m.rank) + '</td><td class="up">' + (m.bestRank ? ordinal(m.bestRank) : "–") +
        '</td><td class="down">' + (m.worstRank ? ordinal(m.worstRank) : "–") + "</td>" + moveCell(m.move) + "</tr>";
    });
    h += "</tbody></table></div></section>";

    // Team value & transfers
    h += '<section class="card"><h2>Team value &amp; transfers</h2><p class="sub">Value = the seven current picks at ' + (M.priceRound > M.N ? "this week's" : "the latest") +
      ' prices; gain is against their first team. Changes = picks swapped between rounds (chips like Wildcard and Limitless count too).</p>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Value</th><th>Gain</th><th>Changes</th><th>Per round</th></tr></thead><tbody>';
    M.managers.slice().sort(function (a, b) { return (b.currentValue || 0) - (a.currentValue || 0); }).forEach(function (m) {
      var rds = Math.max(1, m.played - 1);
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + '<td class="num">' + money(m.currentValue) + '</td><td class="' + (m.valueGain >= 0 ? "up" : "down") + '">' +
        (m.valueGain == null ? "–" : signed(m.valueGain, 1)) + "</td><td>" + m.totalTransfers + "</td><td>" + fmt(m.totalTransfers / rds, 1) + "</td></tr>";
    });
    h += "</tbody></table></div></section>";
    return h;
  }
  function roundLabel(r) { var i = S.model.roundInfo[r - 1]; return "R" + r + " " + (i ? i.short : ""); }
  function recRow(rk, m, sub, big) {
    return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + rk + '</div><div class="main"><div class="n">' + esc(m.name) +
      '</div><div class="t">' + esc(sub) + '</div></div><div class="big">' + big + "</div></div>";
  }

  function viewPicks() {
    var M = S.model, h = "", n = M.managers.length;
    var asOf = "Teams as F1 last published them (round " + M.N + "). Changes made for the next race show up once it's scored.";
    // template
    var tD = M.drivers.filter(function (o) { return o.count; }).slice(0, 5), tC = M.constructors.filter(function (o) { return o.count; }).slice(0, 2);
    h += '<section class="card"><h2>The league template</h2><p class="sub">The five most-owned drivers and two most-owned constructors. ' + esc(asOf) + '</p><div class="team">' +
      tD.concat(tC).map(function (o) { return assetChip(o, o.count + "/" + n); }).join("") + "</div>";
    var tv = tD.concat(tC).reduce(function (s, o) { return s + (o.price || 0); }, 0);
    h += '<p class="sub" style="margin:10px 0 0">Costs ' + money(tv) + " at " + (M.priceRound > M.N ? "this week's" : "current") + " prices.</p></section>";

    h += ownershipCard("Drivers", M.drivers, n);
    h += ownershipCard("Constructors", M.constructors, n);

    // differentials
    var diffs = M.ownership.filter(function (o) { return o.count === 1; });
    h += '<section class="card"><h2>Differentials</h2><p class="sub">Picks only one manager in the league owns.</p><div class="rows">' +
      (diffs.length ? diffs.map(function (o) {
        var m = o.owners[0];
        return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-a="' + esc(o.id) + '"><span class="teamdot" style="background:' + teamColor(o.asset.team) + '"></span><div class="main"><div class="n">' +
          assetLabel(o.asset, true) + '</div><div class="t">' + esc(m.name) + " · " + money(o.price) + " · " + (o.global != null ? o.global + "% overall" : "") + '</div></div></div>';
      }).join("") : '<div class="empty">None — everyone owns something someone else does.</div>') + "</div></section>";

    // season-long
    var season = M.ownership.filter(function (o) { return o.seasonCount; }).slice().sort(function (a, b) { return b.seasonPct - a.seasonPct; }).slice(0, 12);
    h += '<section class="card"><h2>Most trusted this season</h2><p class="sub">Share of all manager-rounds a pick was in a team, rounds 1–' + M.N + '.</p><div class="bars">' +
      season.map(function (o) {
        return '<div class="bar" data-a="' + esc(o.id) + '"><div class="lbl"><span class="teamdot" style="background:' + teamColor(o.asset.team) + '"></span><div style="min-width:0"><div class="nm">' + esc(o.asset.name) +
          '</div><div class="tm">' + esc(o.asset.type === "C" ? "Constructor" : o.asset.team) + '</div></div></div><div class="track"><div class="fill" style="width:' + o.seasonPct.toFixed(1) + "%;background:" + teamColor(o.asset.team) +
          '"></div></div><div class="val">' + fmt(o.seasonPct) + "%</div></div>";
      }).join("") + "</div></section>";
    return h;
  }
  function assetChip(o, extra) {
    return '<span class="asset" data-a="' + esc(o.id) + '"><span class="teamdot" style="background:' + teamColor(o.asset.team) + '"></span><b>' + esc(o.asset.type === "C" ? o.asset.name : o.asset.short) +
      '</b><span class="pr">' + money(o.price) + (extra ? " · " + extra : "") + "</span></span>";
  }
  function ownershipCard(title, list, n) {
    var rows = list.filter(function (o) { return o.count || (o.global && o.active); });
    return '<section class="card"><h2>' + title + ' — league ownership</h2><p class="sub">Bar = share of the league\'s current teams; the dark tick = share across the whole game. Tap for owners.</p><div class="bars">' +
      rows.map(function (o) {
        return '<div class="bar" data-a="' + esc(o.id) + '"><div class="lbl"><span class="teamdot" style="background:' + teamColor(o.asset.team) + '"></span><div style="min-width:0"><div class="nm">' + esc(o.asset.name) +
          '</div><div class="tm">' + (o.asset.type === "C" ? "" : esc(o.asset.team) + " · ") + money(o.price) + '</div></div></div><div class="track"><div class="fill" style="width:' + o.pct.toFixed(1) + "%;background:" + teamColor(o.asset.team) +
          '"></div>' + (o.global != null ? '<div class="gmark" style="left:calc(' + Math.min(100, o.global) + '% - 1px)" title="' + o.global + '% of all F1 Fantasy teams"></div>' : "") +
          '</div><div class="val">' + o.count + "/" + n + "</div></div>";
      }).join("") + "</div></section>";
  }

  /* ---------------- sheets ---------------- */
  function openSheet(html) {
    $("sheetBody").innerHTML = html;
    var d = $("sheet");
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
    d.querySelector(".sheet-inner").scrollTop = 0;
    hydrateCharts(d);
  }
  function closeSheet() { var d = $("sheet"); if (d.open) { if (d.close) d.close(); else d.removeAttribute("open"); } }

  function managerSheet(id) {
    var M = S.model, m = byId(id);
    if (!m) return;
    var n = M.managers.length;
    var o = {}; M.ownership.forEach(function (x) { o[x.id] = x; });
    var h = "<h1>" + esc(m.name) + (isMe(m) ? ' <span class="pill me">you</span>' : "") + '</h1><p class="lede">' + esc(m.team) + " · " + ordinal(m.rank) + " of " + n +
      (m.gapLeader ? " · " + fmt(m.gapLeader) + " behind the leader" : " · leading") + "</p>";
    h += '<section class="hero">' + tile("Total", fmt(m.total), "avg " + fmt(m.avg, 1) + " a round") + tile("Last round", fmt(m.last), m.roundRank[M.N] ? ordinal(m.roundRank[M.N]) + " in " + esc(roundName(M.N)) : "") +
      tile("Best weekend", fmt(m.best && m.best.pts), m.best ? esc(roundLabel(m.best.round)) : "") + tile("Worst weekend", fmt(m.worst && m.worst.pts), m.worst ? esc(roundLabel(m.worst.round)) : "") + "</section>";
    h += '<section class="hero">' + tile("Round wins", m.wins, m.podiums + " top-three") + tile("Form (last 5)", fmt(m.form5), signed(m.formVsAvg) + " vs season") +
      tile("Team value", money(m.currentValue), m.valueGain != null ? signed(m.valueGain, 1) + "m since round " + m.joinRound : "") + tile("Highest / lowest", (m.bestRank ? ordinal(m.bestRank) : "–") + " / " + (m.worstRank ? ordinal(m.worstRank) : "–"), "league position") + "</section>";
    h += '<section class="card"><h2>Current team</h2><p class="sub">As used in round ' + M.N + " · at " + (M.priceRound > M.N ? "this week's" : "current") + ' prices · league ownership</p><div class="team">' +
      m.picks.map(function (id) { return o[id] ? assetChip(o[id], o[id].count + "/" + n) : ""; }).join("") + "</div></section>";
    h += '<section class="card"><h2>League position</h2><div class="chartbox" data-chart="rank" data-only="' + esc(m.id) + '"></div></section>';
    if (m.preJoin) h += '<p class="sub">Joined the league from round ' + m.joinRound + "; " + fmt(m.preJoin) + " points scored before that are in the total but not in the rounds below.</p>";
    h += '<section class="card"><h2>Round by round</h2><div class="tblwrap"><table><thead><tr><th class="l">Round</th><th>Pts</th><th>Round</th><th>League</th><th>Value</th><th>Changes</th></tr></thead><tbody>';
    M.rounds.slice().reverse().forEach(function (r) {
      var ri = M.roundInfo[r - 1];
      if (m.pts[r] == null) { h += '<tr><td class="l">' + r + " · " + esc(ri.short) + '</td><td colspan="5" class="muted c">not in the league yet</td></tr>'; return; }
      h += '<tr><td class="l">' + r + " · " + esc(ri.short) + '</td><td class="num" style="' + heat(m.roundRank[r], ri.count) + '">' + fmt(m.pts[r]) + "</td><td>" + ordinal(m.roundRank[r]) +
        "</td><td>" + (m.rankAt[r] ? ordinal(m.rankAt[r]) : "–") + "</td><td>" + money(m.teamValue[r]) + "</td><td>" + (m.transfers[r] == null ? "–" : m.transfers[r]) + "</td></tr>";
    });
    h += "</tbody></table></div></section>";
    openSheet(h);
    var focusChart = $("sheet").querySelector('[data-chart="rank"]');
    if (focusChart) { var prev = S.focus; S.focus = m.id; lineChart(focusChart, "rank", { label: "League position" }); S.focus = prev; }
  }

  function roundSheet(r) {
    var M = S.model, ri = M.roundInfo[r - 1];
    if (!ri) return;
    var list = M.managers.filter(function (m) { return m.pts[r] != null; }).sort(function (a, b) { return a.roundRank[r] - b.roundRank[r]; });
    var h = "<h1>Round " + r + " · " + esc(ri.name) + '</h1><p class="lede">' + (ri.date ? when(ri.date, { day: "numeric", month: "long", year: "numeric" }) : "") + (ri.sprint ? " · sprint weekend" : "") +
      " · league average " + fmt(ri.avg, 1) + "</p>";
    h += '<section class="card"><div class="tblwrap"><table><thead><tr><th class="c">#</th><th class="l">Manager</th><th>Pts</th><th>vs avg</th><th>League after</th><th>Moved</th></tr></thead><tbody>';
    list.forEach(function (m) {
      var mv = r > 1 && m.rankAt[r - 1] != null && m.rankAt[r] != null ? m.rankAt[r - 1] - m.rankAt[r] : null;
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><td class="pos">' + m.roundRank[r] + "</td>" + whoCell(m) + '<td class="num" style="' + heat(m.roundRank[r], ri.count) + '">' + fmt(m.pts[r]) +
        '</td><td class="' + (m.pts[r] >= ri.avg ? "up" : "down") + '">' + signed(m.pts[r] - ri.avg) + "</td><td>" + (m.rankAt[r] ? ordinal(m.rankAt[r]) : "–") + "</td>" + moveCell(mv) + "</tr>";
    });
    h += "</tbody></table></div></section>";
    // what the drivers did
    var pts = S.data.assetPoints && S.data.assetPoints[r];
    if (pts) {
      var top = Object.keys(pts).map(function (id) { return { a: S.data.assets[id], p: pts[id], id: id }; }).filter(function (x) { return x.a; })
        .sort(function (a, b) { return b.p - a.p; });
      var own = {}; list.forEach(function (m) { (m.team_[r] || []).forEach(function (id) { own[id] = (own[id] || 0) + 1; }); });
      h += '<section class="card"><h2>Who scored</h2><p class="sub">F1 Fantasy points for each pick this round (before any boost), and how many in the league had them.</p><div class="rows">' +
        top.slice(0, 10).map(function (x, i) {
          return '<div class="row"><div class="rk">' + (i + 1) + '</div><span class="teamdot" style="background:' + teamColor(x.a.team) + '"></span><div class="main"><div class="n">' + assetLabel(x.a, true) +
            '</div><div class="t">owned by ' + (own[x.id] || 0) + "/" + list.length + '</div></div><div class="big">' + fmt(x.p) + "</div></div>";
        }).join("") + "</div></section>";
    }
    openSheet(h);
  }

  function assetSheet(id) {
    var M = S.model, o = M.ownership.find(function (x) { return x.id === id; });
    if (!o) return;
    var a = o.asset;
    var h = "<h1>" + esc(a.full || a.name) + '</h1><p class="lede">' + (a.type === "C" ? "Constructor" : esc(a.team)) + " · " + money(o.price) +
      (o.global != null ? " · in " + o.global + "% of all F1 Fantasy teams" : "") + "</p>";
    h += '<section class="hero">' + tile("League owners", o.count + "/" + M.managers.length, fmt(o.pct) + "%") + tile("Season points", fmt(o.seasonPts), "rounds 1–" + M.N) +
      tile("Last round", fmt(o.lastPts), esc(roundName(M.N))) + tile("Season share", fmt(o.seasonPct) + "%", "of manager-rounds") + "</section>";
    h += '<section class="card"><h2>Owned by</h2><div class="rows">' + (o.owners.length ? o.owners.map(function (m) {
      return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + m.rank + '</div><div class="main"><div class="n">' + esc(m.name) + '</div><div class="t">' + esc(m.team) + "</div></div></div>";
    }).join("") : '<div class="empty">Nobody in the league.</div>') + "</div></section>";
    openSheet(h);
  }

  function meSheet() {
    var h = '<h1>Which team is yours?</h1><p class="lede">Highlights you in every table and chart. Saved on this device only.</p><div class="picklist">' +
      S.model.managers.map(function (m) {
        return '<button class="' + (isMe(m) ? "on" : "") + '" data-me="' + esc(m.id) + '"><b>' + esc(m.name) + '</b><br><span class="muted small">' + esc(m.team) + "</span></button>";
      }).join("") + '<button data-me="">Nobody — just browsing</button></div>';
    openSheet(h);
  }

  function infoSheet() {
    var d = S.data, c = d.checks || F1F.verify(d), M = S.model;
    var h = '<h1>About the data</h1><p class="lede">League ' + esc(d.league.id) + " · " + esc(d.league.season) + " season</p>";
    h += '<section class="card"><h2>Freshness</h2><ul class="checks small">' +
      "<li>Last change published " + esc(when(d.generatedAt)) + " (" + ago(d.generatedAt) + ")</li>" +
      (d.feedTimes && d.feedTimes.standings ? "<li>F1 standings feed time: " + esc(when(d.feedTimes.standings)) + "</li>" : "") +
      (d.feedTimes && d.feedTimes.drivers ? "<li>F1 prices feed time: " + esc(when(d.feedTimes.drivers)) + "</li>" : "") +
      "<li>Checked against F1 every 10 minutes; a new version is only published when F1's numbers change.</li></ul></section>";
    h += '<section class="card"><h2>Checks</h2><ul class="checks small">' +
      "<li>" + (c.ok ? "✅" : "❌") + " Standings order and per-round scores: " + (c.sync === "ok" ? "every manager's rounds add up to their F1 total" : esc(c.sync)) + "</li>" +
      c.errors.map(function (x) { return "<li>❌ " + esc(x) + "</li>"; }).join("") +
      c.warnings.map(function (x) { return "<li>⚠️ " + esc(x) + "</li>"; }).join("") +
      c.notes.map(function (x) { return "<li>ℹ️ " + esc(x) + "</li>"; }).join("") + "</ul></section>";
    h += '<section class="card"><h2>Where it comes from</h2><p class="small">F1 Fantasy\'s public league feeds — no login: the standings with each manager\'s current team, ' +
      "each round's points per manager, and every driver and constructor's price per round. A GitHub Action fetches them, checks that the rounds add up to the standings, " +
      "and publishes one file this app reads. Team value is the seven picks at that round's prices; money in the bank and boosts (DRS, chips) aren't in the public feeds.</p>" +
      '<p class="small muted">Unofficial fan project, not affiliated with Formula 1.</p></section>';
    openSheet(h);
  }

  /* ---------------- routing & events ---------------- */
  function route() {
    var hsh = (location.hash || "").replace(/^#/, "");
    var parts = hsh.split("/");
    S.tab = TABS.indexOf(parts[0]) >= 0 ? parts[0] : "standings";
    render();
  }
  function render() {
    if (!S.model) return;
    renderChrome();
    var v = $("view");
    var fn = { standings: viewStandings, races: viewRaces, trends: viewTrends, stats: viewStats, picks: viewPicks }[S.tab];
    v.innerHTML = fn();
    hydrateCharts(v);
  }
  function hydrateCharts(root) {
    root.querySelectorAll(".chartbox").forEach(function (box) {
      if (box.dataset.only) return; // drawn by its sheet
      var k = box.dataset.chart;
      lineChart(box, k, { label: k });
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-focus],[data-m],[data-r],[data-a],[data-me]");
    if (!t) return;
    if (t.hasAttribute("data-me")) {
      S.me = t.getAttribute("data-me") || null; save("me", S.me); closeSheet(); render(); return;
    }
    if (t.hasAttribute("data-focus")) {
      var id = t.getAttribute("data-focus");
      S.focus = S.focus === id ? null : id;
      if (S.tab === "trends") { var y = window.scrollY; render(); window.scrollTo(0, y); }
      return;
    }
    if (t.hasAttribute("data-m")) managerSheet(t.getAttribute("data-m"));
    else if (t.hasAttribute("data-r")) roundSheet(Number(t.getAttribute("data-r")));
    else if (t.hasAttribute("data-a")) assetSheet(t.getAttribute("data-a"));
  });
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet")) closeSheet(); });
  $("meBtn").addEventListener("click", function () { if (S.model) meSheet(); });
  $("infoBtn").addEventListener("click", function () { if (S.model) infoSheet(); });
  $("themeBtn").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("f1f.theme", next); } catch (e) {}
  });
  window.addEventListener("hashchange", route);
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (S.tab === "trends") hydrateCharts($("view")); }, 150); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(false); });
  setInterval(function () { if (!document.hidden) refresh(true); }, REFRESH_MS);
  setInterval(function () { if (S.model && !document.hidden) renderChrome(); }, 60 * 1000);

  fetchData().then(function (d) { setData(d); route(); }).catch(function (e) {
    $("view").innerHTML = '<div class="empty">Couldn\'t load the league data (' + esc(e.message) + "). Pull to refresh or try again shortly.</div>";
    $("subline").textContent = "Offline";
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  window.__f1f = S; // for tests and the curious
})();
