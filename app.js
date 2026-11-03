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
  // F1's own 2026 team colours from data.json, these only as a fallback
  function teamColor(t) { return (S.data && S.data.teamColors && S.data.teamColors[t]) || TEAM_COLORS[t] || "#888"; }
  // black or white text, whichever reads better on a team colour
  function ink(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ""); if (!m) return "#fff";
    var c = [m[1], m[2], m[3]].map(function (x) { x = parseInt(x, 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return L > 0.36 ? "#0b0b0d" : "#fff";
  }
  function tc(hex) { return "--tc:" + hex + ";--ink:" + ink(hex); }
  function assetOf(id) { return (S.data && S.data.assets && S.data.assets[id]) || null; }
  function priceNow(id) { var M = S.model, p = M && M.priceRound != null ? S.data.prices[M.priceRound] : null; return p && p[id] != null ? p[id] : null; }
  function priceMove(id) {
    var M = S.model; if (!M || M.priceRound == null) return null;
    var a = S.data.prices[M.priceRound], b = S.data.prices[M.priceRound - 1];
    return a && b && a[id] != null && b[id] != null ? Math.round((a[id] - b[id]) * 10) / 10 : null;
  }
  function initials(a) {
    if (!a) return "?";
    if (a.type === "C") return esc(a.name.split(" ").map(function (w) { return w.charAt(0); }).join("").slice(0, 3));
    return esc(a.short || "?");
  }
  // a picture from photos/ (mirrored by the photos workflow), or initials
  function pic(id, kind, cls) {
    var a = assetOf(id), ph = S.photos && S.photos[id] && S.photos[id][kind];
    if (ph) return '<img class="' + (cls || "") + '" src="' + esc(ph) + '" alt="" loading="lazy" decoding="async" />';
    return '<span class="' + (cls || "") + ' noimg">' + initials(a) + "</span>";
  }
  function splitName(a) {
    if (!a) return { first: "", last: "?" };
    if (a.type === "C") return { first: "", last: a.name };
    return { first: a.first || (a.full || a.name).split(" ").slice(0, -1).join(" "), last: a.last || (a.full || a.name).split(" ").slice(-1)[0] };
  }
  function signedMoney(v) { return v == null || v === 0 ? "" : '<span class="' + (v > 0 ? "up" : "down") + '">' + (v > 0 ? "▲" : "▼") + "$" + fmt(Math.abs(v), 1) + "m</span>"; }

  /* F1-graphic standings row: red position, team-colour bar, red points block */
  function standRow(o) {
    return '<div class="srow' + (o.me ? " me" : "") + (o.lead ? " lead" : "") + '"' + (o.attr || "") + ' style="' + tc(o.color) + '">' +
      '<div class="spos">' + esc(o.pos) + "</div>" +
      '<div class="sbar">' + (o.face || "") + '<div class="snm"><div class="sname">' + o.name + "</div>" + (o.sub ? '<div class="ssub">' + o.sub + "</div>" : "") + "</div></div>" +
      '<div class="spts"><span class="num">' + o.pts + "</span>" + (o.ptsSub ? "<small>" + o.ptsSub + "</small>" : "") + "</div></div>";
  }
  function managerName(m) {
    var p = m.name.split(" "), last = p.length > 1 ? p.pop() : p[0], first = p.length ? p.join(" ") : "";
    return (first ? '<span class="fn">' + esc(first) + "</span> " : "") + "<b>" + esc(last) + "</b>" + (isMe(m) ? ' <span class="pill me">you</span>' : "");
  }

  /* team-builder / Team of the Week card */
  function assetCard(id, o) {
    o = o || {};
    var a = assetOf(id); if (!a) return "";
    var n = splitName(a), col = teamColor(a.team);
    var img = a.type === "C" ? pic(id, "car", "acar") + pic(id, "logo", "alogo") : pic(id, "head", "ahead");
    return '<div class="acard ' + (a.type === "C" ? "con" : "drv") + '" data-a="' + esc(id) + '" style="' + tc(col) + '">' +
      (o.boost ? '<span class="boost">' + esc(o.boost) + "</span>" : "") +
      '<div class="aimg">' + img + "</div>" +
      '<div class="aname' + (n.last.length > 9 ? " xlong" : n.last.length > 7 ? " long" : "") + '">' + (n.first ? '<span class="fn">' + esc(n.first.charAt(0)) + ".</span> " : "") + "<b>" + esc(n.last) + "</b></div>" +
      '<div class="ameta"><span>' + money(o.price != null ? o.price : priceNow(id)) + "</span>" + (o.move !== false ? signedMoney(priceMove(id)) : "") + (o.extra ? '<span class="muted">' + o.extra + "</span>" : "") + "</div>" +
      (o.pts != null ? '<div class="apts">' + fmt(o.pts) + " pts" + (o.ptsNote ? " <small>" + esc(o.ptsNote) + "</small>" : "") + "</div>" : "") +
      "</div>";
  }
  function teamGrid(drivers, constructors, opt) {
    return '<div class="pitch"><div class="prow">' + drivers.map(function (x) { return assetCard(x.id, opt(x)); }).join("") + '</div><div class="pline"></div><div class="prow">' +
      constructors.map(function (x) { return assetCard(x.id, opt(x)); }).join("") + "</div></div>";
  }

  /* list row with a photo tile, F1 Fantasy "my team" style */
  function assetRow(id, right, sub, attr) {
    var a = assetOf(id); if (!a) return "";
    var n = splitName(a);
    var img = a.type === "C" ? pic(id, "car", "tcar") : pic(id, "head", "thead");
    return '<div class="arow"' + (attr || ' data-a="' + esc(id) + '"') + ' style="' + tc(teamColor(a.team)) + '"><div class="tile2">' + img +
      (a.type === "C" ? "" : '<span class="tla">' + esc(a.short || "") + "</span>") + '</div><div class="anm">' +
      (n.first ? '<span class="fn">' + esc(n.first) + "</span>" : "") + "<b>" + esc(n.last) + "</b>" + (sub ? '<small>' + sub + "</small>" : "") + "</div>" +
      '<div class="apill">' + right + "</div></div>";
  }
  function assetLabel(a, withTeam) {
    if (!a) return "?";
    return a.type === "C" ? esc(a.name) : esc(a.name) + (withTeam ? ' <span class="muted">· ' + esc(a.team) + "</span>" : "");
  }

  // shade for a round rank: brighter red = higher in the round
  function heat(rank, n) {
    if (rank == null || n < 2) return "";
    var t = (n - rank) / (n - 1);
    var a = 0.06 + t * t * 0.7;
    return "background: rgba(var(--heat), " + a.toFixed(2) + ")" + (t > 0.8 ? "; color: #fff" : "");
  }
  function formChip(rank, n) {
    if (rank == null) return '<span style="background:var(--fill);color:var(--faint)">–</span>';
    var t = n > 1 ? (n - rank) / (n - 1) : 1;
    // timing-screen colours: purple = won the round, green = top third, red = bottom third
    var col = rank === 1 ? "var(--purple)" : t >= 0.67 ? "#1f9d47" : t <= 0.33 ? "#d6302a" : "var(--chip-mid)";
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
    document.querySelectorAll("#tabs a").forEach(function (a) {
      var on = a.dataset.tab === S.tab;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var T = { standings: ["Standings", "Overall league table"], races: ["Races", "Every round, every manager"], trends: ["Trends", "How the season has moved"],
      stats: ["Stats", "Records, form and consistency"], picks: ["Picks", "Who the league is backing"] }[S.tab];
    $("pageTitle").innerHTML = esc(T[0]) + "<small>" + esc(T[1]) + "</small>";
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

    h += '<section class="board"><div class="board-h"><div class="board-t">League standings</div><div class="board-s">Points after the ' + esc(d0(lastInfo)) + "</div></div>";
    M.managers.forEach(function (m) {
      var star = m.star ? assetOf(m.star.id) : null;
      var mv = m.move > 0 ? '<span class="up">▲' + m.move + "</span>" : m.move < 0 ? '<span class="down">▼' + -m.move + "</span>" : "";
      h += standRow({
        pos: m.rank, me: isMe(m), lead: m === M.leader, attr: ' data-m="' + esc(m.id) + '"',
        color: star ? teamColor(star.team) : "#3a3a40",
        face: m.star ? pic(m.star.id, "head", "sface") : "",
        name: managerName(m),
        sub: esc(m.team) + (lastInfo ? " · " + esc(abbr(lastInfo.short)) + " " + fmt(m.last) : "") + (mv ? " " + mv : ""),
        pts: fmt(m.total), ptsSub: m.gapLeader ? "−" + fmt(m.gapLeader) : ""
      });
    });
    h += '<p class="board-note">Each row wears the team colours of that manager\'s top-scoring driver in ' + esc(lastInfo ? lastInfo.name : "the last round") + ". ▲▼ = places moved. Tap a manager for their season.</p></section>";

    // quick form glance
    h += '<section class="card"><h2>Form guide</h2><p class="sub">Finishing position within each of the last five rounds, newest on the right. Purple = won the round, green = top third, red = bottom third.</p><div class="rows">';
    M.managers.slice().sort(function (a, b) { return b.form5 - a.form5; }).forEach(function (m, i) {
      h += '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + (i + 1) + '</div><div class="main"><div class="n">' + esc(m.name) +
        '</div><div class="t">last 5 avg ' + fmt(m.form5) + " (" + signed(m.formVsAvg) + " vs season)" + '</div></div><div class="form">' +
        m.formRanks.map(function (r) { return formChip(r, M.managers.length); }).join("") + "</div></div>";
    });
    h += "</div></section>";
    return h;
  }
  function d0(ri) { return ri ? S.data.league.season + " " + ri.name : "round " + S.model.N; }
  function tile(k, v, d) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + (d || "") + "</div></div>"; }

  // a manager's top-scoring driver in a round: their face and colours for it
  function starOf(m, r) {
    var pts = (S.data.assetPoints || {})[r] || {}, best = null;
    (m.team_[r] || []).forEach(function (id) { var a = assetOf(id); if (a && a.type === "D" && pts[id] != null && (best == null || pts[id] > pts[best])) best = id; });
    return best;
  }
  function lastFirst(m) { var p = m.name.split(" "); return { first: p.length > 1 ? p.slice(0, -1).join(" ") : "", last: p[p.length - 1] }; }

  /* round result, like F1's race-result graphic: podium 2-1-3, then the rest */
  function podiumHtml(r, nav) {
    var M = S.model, ri = M.roundInfo[r - 1];
    if (!ri) return "";
    var list = M.managers.filter(function (m) { return m.pts[r] != null; }).sort(function (a, b) { return a.roundRank[r] - b.roundRank[r] || a.name.localeCompare(b.name); });
    var top = list.slice(0, 3), rest = list.slice(3);
    var card = function (m, place) {
      if (!m) return "";
      var sid = starOf(m, r), a = sid ? assetOf(sid) : null, col = a ? teamColor(a.team) : "#3a3a40", n = lastFirst(m);
      return '<div class="pod p' + place + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '" style="' + tc(col) + '">' +
        '<div class="pod-img"><span class="pod-num">' + m.roundRank[r] + "</span>" + (sid ? pic(sid, "head", "pod-face") : "") +
        '<span class="pod-pts"><b>' + fmt(m.pts[r]) + "</b>PTS</span></div>" +
        '<div class="pod-name">' + (place === 1 ? '<span class="fn">' + esc(n.first) + "</span>" : "") + "<b>" + esc(n.last) + "</b></div></div>";
    };
    var h = '<section class="result">';
    h += '<div class="result-h">' + (nav ? '<button class="rnav" data-round-nav="' + (r - 1) + '"' + (r <= 1 ? " disabled" : "") + ' aria-label="Previous round">‹</button>' : "") +
      '<div class="result-t"><span class="lime">ROUND ' + r + '</span> <span class="sl">/</span> ' + esc(ri.short.toUpperCase()) + "</div>" +
      (nav ? '<button class="rnav" data-round-nav="' + (r + 1) + '"' + (r >= M.N ? " disabled" : "") + ' aria-label="Next round">›</button>' : "") + "</div>";
    h += '<div class="podium">' + card(top[1], 2) + card(top[0], 1) + card(top[2], 3) + "</div>";
    if (rest.length) {
      h += '<div class="rlist">' + rest.map(function (m) {
        var after = m.rankAt[r], before = r > 1 ? m.rankAt[r - 1] : null, mv = after != null && before != null ? before - after : null;
        return '<div class="rrow' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rpos">' + m.roundRank[r] + '</div><div class="rname"><b>' + esc(m.name) +
          "</b><small>" + esc(m.team) + (after ? " · " + ordinal(after) + " overall" : "") + (mv ? ' <span class="' + (mv > 0 ? "up" : "down") + '">' + (mv > 0 ? "▲" : "▼") + Math.abs(mv) + "</span>" : "") +
          '</small></div><div class="rpts"><b>' + fmt(m.pts[r]) + "</b>PTS</div></div>";
      }).join("") + "</div>";
    }
    h += '<div class="result-f">League average ' + fmt(ri.avg) + (nav ? ' · <a href="#" data-r="' + r + '">full round ›</a>' : "") + "</div></section>";
    return h;
  }

  function viewRaces() {
    var M = S.model, h = "";
    if (S.podR == null || S.podR > M.N || S.podR < 1) S.podR = M.N;
    h += podiumHtml(S.podR, true);
    h += '<section class="card"><h2>Race by race</h2><p class="sub">Points each round. The brighter the red, the higher they finished in that round; gold outline = round winner.</p>';
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
    h += '<div class="legend">Top of the round <span class="ramp" style="background:linear-gradient(90deg, rgba(var(--heat),.76), rgba(var(--heat),.06))"></span> bottom</div>';
    if (M.managers.some(function (m) { return m.preJoin; })) {
      h += '<p class="sub" style="margin-top:8px">· = not in the league yet. ' + M.managers.filter(function (m) { return m.preJoin; }).map(function (m) {
        return esc(m.name) + " joined from round " + m.joinRound + "; their " + fmt(m.preJoin) + " points before that count in the total";
      }).join(". ") + ".</p>";
    }
    h += "</section>";

    h += '<section class="board"><div class="board-h"><div class="board-t">Round winners</div><div class="board-s">Top score in the league each round · tap for the full result</div></div>';
    M.roundInfo.slice().reverse().forEach(function (ri) {
      var w = ri.winners[0];
      // the winning team's best driver that round, for the colours and the face
      var best = null, pts = (S.data.assetPoints || {})[ri.round] || {};
      if (w) (w.team_[ri.round] || []).forEach(function (id) { var a = assetOf(id); if (a && a.type === "D" && pts[id] != null && (!best || pts[id] > pts[best])) best = id; });
      h += standRow({
        pos: ri.round, attr: ' data-r="' + ri.round + '"', me: ri.winners.some(isMe),
        color: best ? teamColor(assetOf(best).team) : "#3a3a40",
        face: best ? pic(best, "head", "sface") : "",
        name: "<b>" + esc(ri.short) + "</b>",
        sub: "🏆 " + esc(ri.winners.map(function (m) { return m.name; }).join(" & ")) + " · avg " + fmt(ri.avg) + (ri.sprint ? " · sprint" : ""),
        pts: fmt(ri.high)
      });
    });
    h += "</section>";
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
    var weekPrices = M.priceRound > M.N ? "this week's" : "current";
    // template
    var tD = M.drivers.filter(function (o) { return o.count; }).slice(0, 5), tC = M.constructors.filter(function (o) { return o.count; }).slice(0, 2);
    var tv = tD.concat(tC).reduce(function (s, o) { return s + (o.price || 0); }, 0);
    h += '<section class="card"><div class="totw-h"><div><div class="k">Cost</div><div class="v">' + money(tv) + '</div></div><div class="ttl"><b>The league template</b><span>most-owned five drivers + two constructors</span></div><div class="r"><div class="k">Owned by</div><div class="v">' + n + "</div></div></div>" +
      teamGrid(tD, tC, function (o) { return { price: o.price, extra: o.count + "/" + n + " own" }; }) +
      '<p class="sub" style="margin:12px 0 0">Teams as F1 last published them (round ' + M.N + ") at " + weekPrices + " prices. Changes for the next race show once it's scored.</p></section>";

    h += ownershipCard("Drivers", M.drivers, n);
    h += ownershipCard("Constructors", M.constructors, n);

    // differentials
    var diffs = M.ownership.filter(function (o) { return o.count === 1; });
    h += '<section class="card"><h2>Differentials</h2><p class="sub">Picks only one manager in the league owns.</p><div class="alist">' +
      (diffs.length ? diffs.map(function (o) {
        var m = o.owners[0];
        return assetRow(o.id, '<span class="k">' + esc(m.name.split(" ")[0]) + "</span>", money(o.price) + (o.global != null ? " · " + o.global + "% overall" : ""));
      }).join("") : '<div class="empty">None — everyone owns something someone else does.</div>') + "</div></section>";

    // season-long
    var season = M.ownership.filter(function (o) { return o.seasonCount; }).slice().sort(function (a, b) { return b.seasonPct - a.seasonPct; }).slice(0, 10);
    h += '<section class="card"><h2>Most trusted this season</h2><p class="sub">Share of all manager-rounds a pick was in a team, rounds 1–' + M.N + '.</p><div class="alist">' +
      season.map(function (o) {
        return assetRow(o.id, '<b>' + fmt(o.seasonPct) + "%</b>", '<span class="minibar"><i style="width:' + o.seasonPct.toFixed(1) + '%"></i></span>');
      }).join("") + "</div></section>";
    return h;
  }
  function ownershipCard(title, list, n) {
    var rows = list.filter(function (o) { return o.count || (o.global && o.active); });
    return '<section class="card"><h2>' + title + '</h2><p class="sub">Owned in the league now, against the share of all F1 Fantasy teams. Tap for owners.</p><div class="alist">' +
      rows.map(function (o) {
        return assetRow(o.id, "<b>" + o.count + "/" + n + '</b><span class="k">' + (o.global != null ? o.global + "% all" : "") + "</span>",
          money(o.price) + " " + signedMoney(priceMove(o.id)) + '<span class="minibar"><i style="width:' + o.pct.toFixed(1) + '%"></i>' +
          (o.global != null ? '<em style="left:' + Math.min(100, o.global) + '%"></em>' : "") + "</span>");
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
    var lp = (S.data.assetPoints || {})[M.N] || {};
    var drv = m.picks.filter(function (id) { return (assetOf(id) || {}).type === "D"; }).map(function (id) { return { id: id }; });
    var con = m.picks.filter(function (id) { return (assetOf(id) || {}).type === "C"; }).map(function (id) { return { id: id }; });
    h += '<section class="card"><div class="totw-h"><div><div class="k">Team value</div><div class="v">' + money(m.currentValue) + '</div></div><div class="ttl"><b>Current team</b><span>as used in ' + esc(roundName(M.N)) +
      '</span></div><div class="r"><div class="k">' + esc(abbr(roundName(M.N))) + ' points</div><div class="v">' + fmt(m.last) + "</div></div></div>" +
      teamGrid(drv, con, function (x) { return { pts: lp[x.id], extra: (o[x.id] ? o[x.id].count + "/" + n + " own" : "") }; }) +
      '<p class="sub" style="margin:12px 0 0">Prices are ' + (M.priceRound > M.N ? "this week's" : "current") + " with the change since last round; points are F1 Fantasy's for " + esc(roundName(M.N)) + " before any Boost or chip.</p></section>";
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
    h += podiumHtml(r, false);
    // dream team: the best possible seven that round
    if (ri.totw) {
      var t = ri.totw;
      h += '<section class="card totw"><div class="totw-h"><div><div class="k">Cost</div><div class="v">' + money(t.cost) + '</div></div><div class="ttl"><b>Dream team</b><span>Round ' + r + " · " + esc(ri.short) +
        '</span></div><div class="r"><div class="k">Points</div><div class="v">' + fmt(t.pts) + "</div></div></div>" +
        teamGrid(t.drivers, t.constructors, function (x) {
          var b = x.id === t.boosted;
          return { price: x.price, move: false, pts: b ? x.pts * 2 : x.pts, boost: b ? "2×" : "" };
        }) +
        '<p class="sub" style="margin:12px 0 0">The best five drivers and two constructors of the round, top driver boosted 2×, no cost cap. Beat ' +
        (t.pts > ri.high ? "the league's best (" + fmt(ri.high) + ") by " + fmt(t.pts - ri.high) : "by " + esc(ri.winners[0].name)) + ".</p></section>";
    }
    var pts = S.data.assetPoints && S.data.assetPoints[r];
    if (pts) {
      var top = Object.keys(pts).filter(function (id) { return assetOf(id); }).sort(function (a, b) { return pts[b] - pts[a]; });
      var own = {}; list.forEach(function (m) { (m.team_[r] || []).forEach(function (id) { own[id] = (own[id] || 0) + 1; }); });
      h += '<section class="card"><h2>Who scored</h2><p class="sub">F1 Fantasy points this round (before any Boost) and how many in the league had them.</p><div class="alist">' +
        top.slice(0, 10).map(function (id) {
          return assetRow(id, "<b>" + fmt(pts[id]) + '</b><span class="k">pts</span>', "owned by " + (own[id] || 0) + "/" + list.length);
        }).join("") + "</div></section>";
    }
    openSheet(h);
  }

  function assetSheet(id) {
    var M = S.model, o = M.ownership.find(function (x) { return x.id === id; });
    if (!o) return;
    var a = o.asset;
    var nm = splitName(a);
    var h = '<div class="ahero" style="' + tc(teamColor(a.team)) + '">' + (a.type === "C" ? pic(id, "car", "hcar") : pic(id, "head", "hhead")) +
      '<div class="ahero-t">' + (nm.first ? '<span class="fn">' + esc(nm.first) + "</span>" : "") + "<b>" + esc(nm.last) + "</b><small>" + (a.type === "C" ? "Constructor" : esc(a.team)) + " · " + money(o.price) + " " + signedMoney(priceMove(id)) + "</small></div></div>" +
      '<p class="lede">' + (o.global != null ? "In " + o.global + "% of all F1 Fantasy teams" : "") + "</p>";
    h += '<section class="hero">' + tile("League owners", o.count + "/" + M.managers.length, fmt(o.pct) + "%") + tile("Season points", fmt(o.seasonPts), "rounds 1–" + M.N) +
      tile("Last round", fmt(o.lastPts), esc(roundName(M.N))) + tile("Season share", fmt(o.seasonPct) + "%", "of manager-rounds") + "</section>";
    h += '<section class="card"><h2>Owned by</h2><div class="rows">' + (o.owners.length ? o.owners.map(function (m) {
      return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + m.rank + '</div><div class="main"><div class="n">' + esc(m.name) + '</div><div class="t">' + esc(m.team) + "</div></div></div>";
    }).join("") : '<div class="empty">Nobody in the league.</div>') + "</div></section>";
    openSheet(h);
  }

  /* ---------------- settings ---------------- */
  function themeNow() { return document.documentElement.getAttribute("data-theme") || "dark"; }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    save("theme", t);
    var light = t === "light" || (t === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", light ? "#f2f2f7" : "#050506");
    if (S.model) render();
  }
  function settingsSheet() {
    var M = S.model, R = window.F1F_RULES, t = themeNow();
    var h = '<h1>Settings</h1><p class="lede">' + esc((S.data.league && S.data.league.name) || CONFIG.leagueName) + " · league " + esc(S.data.league.id) + "</p>";

    h += '<div class="group-h">Your team</div><div class="group card" style="padding:14px">' +
      '<select class="select" id="meSelect" aria-label="Select your team"><option value="">Select your team…</option>' +
      M.managers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (isMe(m) ? " selected" : "") + ">" + esc(m.name) + " — " + esc(m.team) + "</option>";
      }).join("") + '</select><p class="sub" style="margin:8px 2px 0">You\'re highlighted in every table and chart. Saved on this device only.</p></div>';

    h += '<div class="group-h">Appearance</div><div class="group card" style="padding:14px"><div class="seg" role="radiogroup" aria-label="Theme">' +
      [["dark", "Dark"], ["light", "Light"], ["system", "Auto"]].map(function (o) {
        return '<button role="radio" aria-checked="' + (t === o[0]) + '" class="' + (t === o[0] ? "on" : "") + '" data-theme-set="' + o[0] + '">' + o[1] + "</button>";
      }).join("") + '</div><p class="sub" style="margin:8px 2px 0">Auto follows your phone\'s light or dark setting.</p></div>';

    if (R) {
      h += '<div class="group-h">Game rules · F1 Fantasy 2026</div><div class="group card rules" style="padding:0">' +
        R.sections.map(function (sec) {
          return "<details><summary>" + esc(sec.title) + '</summary><div class="body">' +
            (sec.intro ? "<p>" + esc(sec.intro) + "</p>" : "") +
            '<table class="rtable"><tbody>' + sec.rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +
            (sec.notes || []).map(function (n) { return '<p style="margin-top:8px">' + esc(n) + "</p>"; }).join("") +
            "</div></details>";
        }).join("") +
        '<div class="src">From F1 Fantasy\'s official game rules, checked ' + esc(R.checked) + '. <a href="' + esc(R.source) + '" target="_blank" rel="noopener">Full rules ↗</a></div></div>';
    }

    h += '<div class="group-h">About</div><div class="group card" style="padding:0">' +
      '<button class="item" data-open="info"><span class="lab">About the data<small>Where it comes from, freshness and checks</small></span><span class="chev">›</span></button></div>';
    openSheet(h);
    var sel = $("meSelect");
    if (sel) sel.addEventListener("change", function () { S.me = sel.value || null; save("me", S.me); render(); });
  }

  function infoSheet() {
    var d = S.data, c = d.checks || F1F.verify(d), M = S.model;
    var h = '<img class="logo" src="logo.webp" alt="F1 Fanatics Fantasy League" width="180" height="180" /><h1>About the data</h1><p class="lede">League ' + esc(d.league.id) + " · " + esc(d.league.season) + " season</p>";
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
    var tab = TABS.indexOf(parts[0]) >= 0 ? parts[0] : "standings";
    var moved = tab !== S.tab;
    S.tab = tab;
    render();
    if (moved) window.scrollTo(0, 0);
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
    var t = e.target.closest("[data-focus],[data-m],[data-r],[data-a],[data-theme-set],[data-open],[data-round-nav]");
    if (!t) return;
    if (t.hasAttribute("data-round-nav")) {
      var nr = Number(t.getAttribute("data-round-nav"));
      if (nr >= 1 && nr <= S.model.N) {
        S.podR = nr;
        var box = t.closest(".result"), tmp = document.createElement("div");
        tmp.innerHTML = podiumHtml(nr, true);
        box.replaceWith(tmp.firstChild);
      }
      return;
    }
    if (t.tagName === "A" && t.hasAttribute("data-r")) e.preventDefault();
    if (t.hasAttribute("data-theme-set")) {
      applyTheme(t.getAttribute("data-theme-set"));
      t.parentNode.querySelectorAll("button").forEach(function (b) { var on = b === t; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
      return;
    }
    if (t.hasAttribute("data-open")) { if (t.getAttribute("data-open") === "info") infoSheet(); return; }
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
  $("settingsBtn").addEventListener("click", function () { if (S.model) settingsSheet(); });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var onScheme = function () { if (themeNow() === "system") applyTheme("system"); };
    if (mq.addEventListener) mq.addEventListener("change", onScheme); else if (mq.addListener) mq.addListener(onScheme);
  }
  applyTheme(themeNow());
  window.addEventListener("hashchange", route);
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (S.tab === "trends") hydrateCharts($("view")); }, 150); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(false); });
  setInterval(function () { if (!document.hidden) refresh(true); }, REFRESH_MS);
  setInterval(function () { if (S.model && !document.hidden) renderChrome(); }, 60 * 1000);

  // which pictures the photos workflow has mirrored; none yet = initials
  var photosReady = fetch("photos/index.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; }).then(function (p) { S.photos = p || {}; });
  Promise.all([fetchData(), photosReady]).then(function (r) { setData(r[0]); route(); }).catch(function (e) {
    $("view").innerHTML = '<div class="empty">Couldn\'t load the league data (' + esc(e.message) + "). Pull to refresh or try again shortly.</div>";
    $("subline").textContent = "Offline";
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  window.__f1f = S; // for tests and the curious
})();
