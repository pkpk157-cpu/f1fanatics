/* F1 Fanatics — the app. Reads data.json, builds the model with compute.js,
   renders five tabs and two sheets. No framework, no build step. */
(function () {
  "use strict";
  var CONFIG = window.F1F_CONFIG;
  var F1F = window.F1F;
  var TABS = ["league", "races", "you", "trends", "picks", "stats"];
  var OLD_TABS = { standings: "league" };
  // each tab is split into sub-tabs; only the chosen one is drawn
  var SUBS = {
    league: [["table", "Standings"], ["prizes", "XP"]],
    races: [["list", "Races"], ["grid", "Race grid"]],
    you: [["season", "Season"], ["team", "Team"], ["picks", "Picks"], ["rivals", "Rivals"]],
    trends: [["rank", "Position"], ["total", "Points"], ["gap", "Gap"]],
    stats: [["records", "Records"], ["weekends", "Weekends"], ["honours", "Honours"], ["moves", "Movement"], ["value", "Value"]],
    picks: [["drivers", "Drivers"], ["constructors", "Constructors"], ["trusted", "Trusted"]]
  };
  var MARK = "\u0001";
  function SUB(key) { return MARK + key + MARK; }
  // keep what comes before the first marker (shared by every sub-tab) and the chosen part
  function pickSub(html, key) {
    var parts = html.split(MARK);
    var out = parts[0];
    for (var i = 1; i + 1 < parts.length; i += 2) if (parts[i] === key) out += parts[i + 1];
    return out;
  }
  var REFRESH_MS = 5 * 60 * 1000;

  var S = { data: null, model: null, me: load("me"), hl: null, tab: "league", sub: load("sub") || {}, fetchedAt: 0 };

  /* ---------------- small helpers ---------------- */
  function load(k) { try { return JSON.parse(localStorage.getItem("f1f." + k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem("f1f." + k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return "–";
    return Number(n).toLocaleString("en-GB", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function cur(v, bare) { return v == null ? "–" : (v < 0 ? "−" : "") + fmt(Math.abs(Math.round(v))) + (bare ? "" : " XP"); }
  function signed(n, d) { if (n == null) return "–"; return (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n), d); }
  function money(n) { return n == null ? "–" : "$" + fmt(n, 1) + "m"; }
  // 1st gold, 2nd silver, 3rd bronze — everywhere a position is shown
  function medal(n) { return n === 1 ? "m1" : n === 2 ? "m2" : n === 3 ? "m3" : ""; }
  function ordM(n) { return n == null ? "–" : '<span class="t' + medal(n) + '">' + ordinal(n) + "</span>"; }
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
    return '<div class="srow' + (o.me ? " me" : "") + (o.lead ? " lead" : "") + (o.color ? "" : " plain") + (o.medal ? " " + medal(o.medal) : "") + '"' + (o.attr || "") + (o.color ? ' style="' + tc(o.color) + '"' : "") + ">" +
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
    // gold / silver / bronze for a top-three finish, green = rest of the top third, red = bottom third
    if (rank <= 3) return '<span class="chip-' + medal(rank) + '" title="' + ordinal(rank) + ' in the round">' + rank + "</span>";
    var col = t >= 0.67 ? "#1f9d47" : t <= 0.33 ? "#d6302a" : "var(--chip-mid)";
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
    S.prizes = CONFIG.xp ? F1F.prizes(S.model, { entry: CONFIG.xp.stake, perRound: CONFIG.xp.perRace, split: CONFIG.xp.split }) : null;
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
      a.setAttribute("href", "#" + a.dataset.tab + (S.sub[a.dataset.tab] ? "/" + S.sub[a.dataset.tab] : ""));
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var msgs = [];
    if (d._offline) msgs.push("Offline — showing the last data this phone saw.");
    if (M.sync.state === "standings-behind") msgs.push("Round " + M.N + " scores are in; F1's standings haven't caught up yet, so totals here include them already.");
    if (M.sync.state === "rounds-behind") msgs.push("F1's standings include " + (M.next ? M.next.name : "the latest round") + ", but its race-by-race scores aren't published yet. Totals are F1's; round stats stop at round " + M.N + ".");
    if (M.sync.state === "mismatch") msgs.push("F1's standings and per-round scores don't agree right now. Totals are F1's own; Settings › About the data has details.");
    var b = $("banner");
    b.hidden = !msgs.length;
    b.textContent = msgs.join(" ");
  }

  /* ---------------- views ---------------- */
  function viewStandings() {
    var M = S.model, h = "";
    var lastInfo = M.roundInfo[M.N - 1];
    h += SUB("table");
    h += '<section class="board"><div class="board-h"><div class="board-t">League standings</div><div class="board-s">Points after the ' + esc(d0(lastInfo)) + "</div></div>";
    M.managers.forEach(function (m) {
      var mv = m.move > 0 ? '<span class="up">▲' + m.move + "</span>" : m.move < 0 ? '<span class="down">▼' + -m.move + "</span>" : "";
      h += standRow({
        pos: m.rank, medal: m.rank, me: isMe(m), lead: m === M.leader, attr: ' data-m="' + esc(m.id) + '"',
        name: managerName(m),
        sub: '<span class="form mini" title="Finish in each of the last five rounds, newest on the right">' + m.formRanks.map(function (r) { return formChip(r, M.managers.length); }).join("") + "</span>" + (mv ? " " + mv : ""),
        pts: fmt(m.total), ptsSub: m.gapLeader ? "−" + fmt(m.gapLeader) : ""
      });
    });
    h += "</section>";

    return h;
  }
  function d0(ri) { return ri ? S.data.league.season + " " + ri.name : "round " + S.model.N; }
  function figs(list) {
    return '<section class="figs">' + list.map(function (f) {
      return '<div class="fig"><b' + (f.cls ? ' class="' + f.cls + '"' : "") + ">" + f.v + "</b><span>" + esc(f.k) + "</span>" + (f.d ? "<small>" + esc(f.d) + "</small>" : "") + "</div>";
    }).join("") + "</section>";
  }
  function tile(k, v, d) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + (d || "") + "</div></div>"; }

  function lastFirst(m) { var p = m.name.split(" "); return { first: p.length > 1 ? p.slice(0, -1).join(" ") : "", last: p[p.length - 1] }; }

  /* round result, like F1's race-result graphic: podium 2-1-3, then the rest */
  /* the podium board (round results and XP): 2-1-3, big numerals, name below, then 4th onwards */
  function podiumBoard(o) {
    var card = function (e, place) {
      if (!e) return "";
      var n = lastFirst(e.m);
      return '<div class="pod p' + place + " " + medal(e.rank) + (isMe(e.m) ? " me" : "") + '" data-m="' + esc(e.m.id) + '">' +
        '<div class="pod-img"><span class="pod-num">' + e.rank + "</span></div>" +
        '<div class="pod-name">' + (n.first ? '<span class="fn">' + esc(n.first) + "</span>" : "") + "<b>" + esc(n.last) + '</b><span class="pt">' + esc(e.m.team) + "</span>" +
        '<span class="pp"><b>' + e.value + "</b> " + esc(o.unit) + "</span></div></div>";
    };
    var top = o.entries.slice(0, 3), rest = o.entries.slice(3);
    var h = '<section class="result"><div class="result-h">' + (o.prev != null ? '<button class="rnav" data-round-nav="' + o.prev + '"' + (o.prevOff ? " disabled" : "") + ' aria-label="Previous round">‹</button>' : "") +
      '<div class="result-t">' + o.title + "</div>" +
      (o.next != null ? '<button class="rnav" data-round-nav="' + o.next + '"' + (o.nextOff ? " disabled" : "") + ' aria-label="Next round">›</button>' : "") + "</div>";
    h += '<div class="podium">' + card(top[1], 2) + card(top[0], 1) + card(top[2], 3) + "</div>";
    if (rest.length) h += '<div class="rlist">' + rest.map(function (e) {
      return '<div class="rrow' + (isMe(e.m) ? " me" : "") + '" data-m="' + esc(e.m.id) + '"><div class="rpos">' + e.rank + '</div><div class="rname"><b>' + esc(e.m.name) +
        "</b><small>" + e.sub + '</small></div><div class="rpts"><b>' + e.value + "</b>" + esc(o.unit) + "</div></div>";
    }).join("") + "</div>";
    return h + "</section>";
  }

  function podiumHtml(r, nav) {
    var M = S.model, ri = M.roundInfo[r - 1];
    if (!ri) return "";
    var list = M.managers.filter(function (m) { return m.pts[r] != null; }).sort(function (a, b) { return a.roundRank[r] - b.roundRank[r] || a.name.localeCompare(b.name); });
    return podiumBoard({
      title: '<span class="lime">ROUND ' + r + '</span> <span class="sl">/</span> ' + esc(ri.short.toUpperCase()),
      prev: nav ? r - 1 : null, prevOff: r <= 1, next: nav ? r + 1 : null, nextOff: r >= M.N, unit: "PTS",
      entries: list.map(function (m) {
        var after = m.rankAt[r], before = r > 1 ? m.rankAt[r - 1] : null, mv = after != null && before != null ? before - after : null;
        return { m: m, rank: m.roundRank[r], value: fmt(m.pts[r]),
          sub: esc(m.team) + (after ? " · " + ordinal(after) + " overall" : "") + (mv ? ' <span class="' + (mv > 0 ? "up" : "down") + '">' + (mv > 0 ? "▲" : "▼") + Math.abs(mv) + "</span>" : "") };
      })
    });
  }

  function viewPrizes() {
    var P = S.prizes, M = S.model;
    if (!P) return "";
    // ordered by XP earned so far (race XP + the season XP if it ended now); ties share a place
    var rows = M.managers.slice().sort(function (a, b) { return P.by[b.id].total - P.by[a.id].total || a.rank - b.rank; });
    var rk = F1F.rankBy(rows, function (m) { return Math.round(P.by[m.id].total); });
    return SUB("prizes") + podiumBoard({
      title: '<span class="lime">XP</span> <span class="sl">/</span> ' + esc(String(S.data.league.season)), unit: "XP",
      entries: rows.map(function (m) {
        var x = P.by[m.id];
        return { m: m, rank: rk.get(m), value: cur(x.total, true),
          sub: cur(x.race, true) + " race" + (x.projected ? " · " + cur(x.projected, true) + " season" : "") + ' · <span class="' + (x.net >= 0 ? "up" : "down") + '">' + (x.net >= 0 ? "+" : "") + cur(x.net, true) + " net</span>" };
      })
    });
  }

  function dreamTeam(r) {
    var ri = S.model.roundInfo[r - 1], t = ri && ri.totw;
    if (!t) return "";
    return '<section class="card totw"><div class="totw-h"><div><div class="k">Cost</div><div class="v">' + money(t.cost) + '</div></div><div class="ttl"><b>Dream team</b><span>Round ' + r + " · " + esc(ri.short) +
      '</span></div><div class="r"><div class="k">Points</div><div class="v">' + fmt(t.pts) + "</div></div></div>" +
      teamGrid(t.drivers, t.constructors, function (x) {
        var b = x.id === t.boosted;
        return { price: x.price, move: false, pts: b ? x.pts * 2 : x.pts, boost: b ? "2×" : "" };
      }) + "</section>";
  }
  function whoScored(r) {
    var M = S.model, pts = S.data.assetPoints && S.data.assetPoints[r];
    if (!pts) return "";
    var list = M.managers.filter(function (m) { return m.pts[r] != null; });
    var own = {}; list.forEach(function (m) { (m.team_[r] || []).forEach(function (id) { own[id] = (own[id] || 0) + 1; }); });
    var top = Object.keys(pts).filter(function (id) { return assetOf(id); }).sort(function (a, b) { return pts[b] - pts[a]; }).slice(0, 10);
    return '<section class="card"><h2>Who scored</h2><div class="alist">' + top.map(function (id) {
      return assetRow(id, "<b>" + fmt(pts[id]) + '</b><span class="k">pts</span>', (own[id] || 0) + "/" + list.length + " own");
    }).join("") + "</div></section>";
  }

  // every race of the season; a finished one opens its result
  function raceList() {
    var M = S.model, h = '<section class="result"><div class="result-h"><div class="result-t"><span class="lime">' + esc(String(S.data.league.season)) +
      '</span> <span class="sl">/</span> ' + (M.N + M.remaining) + " RACES</div></div><div class=\"rlist races\">";
    (S.data.schedule || []).forEach(function (s) {
      var done = s.round <= M.N, ri = done ? M.roundInfo[s.round - 1] : null;
      var date = s.race ? when(s.race, { day: "numeric", month: "short" }) : "";
      if (done) {
        h += '<div class="rrow' + (ri.winners.some(isMe) ? " me" : "") + '" data-r="' + s.round + '"><div class="rpos">' + s.round + '</div><div class="rname"><b>' + esc(s.name) +
          "</b><small>" + esc(date) + (s.sprint ? " · sprint" : "") + " · " + esc(ri.winners.map(function (m) { return m.name; }).join(" & ")) +
          '</small></div><div class="rpts"><b>' + fmt(ri.high) + "</b>PTS</div></div>";
      } else {
        var next = M.next && M.next.round === s.round;
        h += '<div class="rrow todo' + (next ? " next" : "") + '"><div class="rpos">' + s.round + '</div><div class="rname"><b>' + esc(s.name) +
          "</b><small>" + esc(date) + (s.sprint ? " · sprint" : "") + (next && s.lock && Date.parse(s.lock) > Date.now() ? " · locks in " + until(s.lock) : "") +
          '</small></div><div class="rpts">' + (next ? "<b>NEXT</b>" : "") + "</div></div>";
      }
    });
    return h + "</div></section>";
  }
  function roundSheet(r) {
    if (r < 1 || r > S.model.N) return;
    S.podR = r;
    openSheet(podiumHtml(r, true) + dreamTeam(r) + whoScored(r));
  }

  function viewRaces() {
    var M = S.model, h = "";
    h += SUB("list") + raceList();
    h += SUB("grid");
    h += '<section class="card"><div class="tblwrap"><table class="heat"><thead><tr><th class="l"></th>';
    M.roundInfo.forEach(function (ri) { h += '<th class="rd click" data-r="' + ri.round + '" title="' + esc(ri.name) + '">' + esc(abbr(ri.short)) + "<br>" + ri.round + "</th>"; });
    h += '<th>Total</th></tr></thead><tbody>';
    M.managers.forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><td class="l"><b>' + esc(firstName(m)) + "</b></td>";
      M.roundInfo.forEach(function (ri) {
        var p = m.pts[ri.round], rr = m.roundRank[ri.round];
        if (p == null) { h += '<td class="cell none">·</td>'; return; }
        h += '<td class="cell' + (rr === 1 ? " win" : rr === 2 ? " sec" : rr === 3 ? " thi" : "") + '" style="' + heat(rr, ri.count) + '" title="' +
          esc(m.name + " — " + ri.name + ": " + p + " pts, " + ordinal(rr) + " of " + ri.count) + '">' + fmt(p) + "</td>";
      });
      h += '<td class="tot">' + fmt(m.total) + "</td></tr>";
    });
    h += '<tr><td class="l muted">Avg</td>';
    M.roundInfo.forEach(function (ri) { h += '<td class="muted">' + fmt(ri.avg) + "</td>"; });
    return h + "<td></td></tr></tbody></table></div></section>";
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
    var card = function (k) { return SUB(k) + '<section class="card"><div class="chartbox" data-chart="' + k + '"></div></section>' + chipsHtml(); };
    return card("rank") + card("total") + card("gap");
  }
  // Highlighted lines: the leader and you to start with; tap names (or a line) to add or remove, "All" for everyone.
  var HL_COLORS = ["#ff453a", "#ff9f0a", "#30d158", "#bf5af2", "#ff6fae", "#5e5ce6", "#c69c6d", "#00c7be", "#9be15d", "#ffb38a"];
  function hlSet() {
    var M = S.model;
    if (!S.hl) S.hl = [M.leader.id].concat(S.me && byId(S.me) && S.me !== M.leader.id ? [S.me] : []);
    return S.hl;
  }
  function lineColor(id) {
    var M = S.model;
    if (id === M.leader.id) return "var(--gold)";
    if (id === S.me) return "var(--me)";
    var others = M.managers.filter(function (m) { return m.id !== M.leader.id && m.id !== S.me; });
    var i = others.findIndex(function (m) { return m.id === id; });
    return HL_COLORS[(i < 0 ? 0 : i) % HL_COLORS.length];
  }
  function chipsHtml() {
    var M = S.model, hl = hlSet();
    var all = hl.length === M.managers.length;
    return '<div class="chips quiet"><button class="chip all' + (all ? " on" : "") + '" data-hl-all>All</button>' + M.managers.map(function (m) {
      var on = hl.indexOf(m.id) >= 0;
      return '<button class="chip' + (on ? " hl" : "") + '" data-focus="' + esc(m.id) + '"' + (on ? ' style="--c:' + lineColor(m.id) + '"' : "") + ">" +
        (on ? "<i></i>" : "") + esc(firstName(m)) + "</button>";
    }).join("") + "</div>";
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
        else if (kind === "total") vals[r] = m.cum[r];
        else if (kind === "value") vals[r] = m.teamValue[r];
      });
      return { id: m.id, label: m.name, vals: vals };
    });
  }

  // An SVG line chart with every GP named along the bottom. It scrolls when the
  // rounds don't fit, and zooms on both axes (pinch, trackpad pinch, or + / −);
  // the axes stay in place and follow the plot while it pans.
  var chartScroll = {}, chartZoom = {};
  var Z_MAX = 5;
  function lineChart(box, kind, opts) {
    opts = opts || {};
    var M = S.model, rounds = M.rounds;
    if (!rounds.length) { box.innerHTML = '<div class="empty">No rounds yet.</div>'; return; }
    var series = chartSeries(kind);
    var all = [];
    series.forEach(function (s) { rounds.forEach(function (r) { if (s.vals[r] != null) all.push(s.vals[r]); }); });
    var invert = kind === "rank" || kind === "gap";
    var lo, hi;
    if (kind === "rank") { lo = 1; hi = M.managers.length; }
    else if (kind === "gap" || kind === "total") { lo = 0; hi = niceMax(Math.max.apply(null, all)); }
    else { lo = niceMin(Math.min.apply(null, all)); hi = niceMax(Math.max.apply(null, all)); }
    if (hi === lo) hi = lo + 1;
    var axisW = 40, xH = 46, baseH = 224, padL = 14, padR = 126, padT = 12, padB = 10, maxStep = 120;
    var hl = hlSet();
    var on = function (s) { return hl.indexOf(s.id) >= 0; };
    var order = series.slice().sort(function (a, b) { return on(a) - on(b) || (a.id === S.me) - (b.id === S.me); });
    var tickLabel = function (t) { return kind === "total" && t >= 1000 ? fmt(t / 1000, t % 1000 ? 1 : 0) + "k" : fmt(t); };

    box.innerHTML = '<div class="cz"><div class="cz-y"><div class="cz-yi"></div></div><div class="cz-plot"></div><div class="cz-corner"></div><div class="cz-x"><div class="cz-xi"></div></div>' +
      '<div class="cz-tools"><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-zoom="in" aria-label="Zoom in">+</button></div></div>';
    var plot = box.querySelector(".cz-plot"), yi = box.querySelector(".cz-yi"), xi = box.querySelector(".cz-xi");
    var geo = null;

    // fully zoomed out (z = 1) every round fits the width; zooming in spreads them up to maxStep apart
    var avail = Math.max(200, plot.clientWidth || 300);
    var fitStep = rounds.length > 1 ? (avail - padL - padR) / (rounds.length - 1) : maxStep;
    var zMax = Math.max(Z_MAX, maxStep / fitStep);
    function draw(z) {
      var zy = 1 + (z - 1) * (Z_MAX - 1) / (zMax - 1 || 1);
      var step = fitStep * z;
      var W = Math.max(avail, padL + padR + (rounds.length - 1) * step), H = Math.round(baseH * zy);
      var x = function (r) { return padL + (rounds.length === 1 ? 0 : (r - rounds[0]) / (rounds[rounds.length - 1] - rounds[0]) * (W - padL - padR)); };
      var y = function (v) { var t = (v - lo) / (hi - lo); return invert ? padT + t * (H - padT - padB) : H - padB - t * (H - padT - padB); };
      var nT = Math.max(4, Math.round(5 * zy));
      var ticks = kind === "rank" ? M.managers.map(function (m, i) { return i + 1; }).filter(function (v) { return zy > 1.3 || M.managers.length <= 12 || v === 1 || v % 2 === 0; }) : niceTicks(lo, hi, nT);
      var g = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opts.label || kind) + '"><g class="grid">';
      ticks.forEach(function (t) { g += '<line x1="0" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>'; });
      g += "</g>";
      var labels = [];
      order.forEach(function (s) {
        var segs = [], cur = [];
        rounds.forEach(function (r) {
          if (s.vals[r] == null) { if (cur.length) segs.push(cur); cur = []; }
          else cur.push([x(r), y(s.vals[r])]);
        });
        if (cur.length) segs.push(cur);
        var d = segs.map(pathOf).join(" "), lit = on(s), col = lit ? lineColor(s.id) : "";
        g += '<path class="series' + (lit ? " hl" : "") + '" d="' + d + '"' + (lit ? ' style="stroke:' + col + '"' : "") + '/><path class="hit" d="' + d + '" data-focus="' + esc(s.id) + '"><title>' + esc(s.label) + "</title></path>";
        if (lit) {
          var lastR = null; rounds.forEach(function (r) { if (s.vals[r] != null) lastR = r; });
          if (lastR != null) {
            g += '<circle class="dot" cx="' + x(lastR) + '" cy="' + y(s.vals[lastR]) + '" r="3.5" stroke="' + col + '"/>';
            labels.push({ y: y(s.vals[lastR]), x: x(lastR) + 8, text: firstName(byId(s.id)) + " " + valLabel(kind, s.vals[lastR]), col: col });
          }
        }
      });
      labels.sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
      labels.forEach(function (l) { g += '<text class="endlabel" x="' + l.x + '" y="' + (l.y + 4) + '" style="fill:' + l.col + '">' + esc(l.text) + "</text>"; });
      plot.innerHTML = g + "</svg>";
      yi.innerHTML = '<svg class="chart" viewBox="0 0 ' + axisW + " " + H + '" width="' + axisW + '" height="' + H + '" aria-hidden="true"><g class="axis">' +
        ticks.map(function (t) { return '<text x="' + (axisW - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + tickLabel(t) + "</text>"; }).join("") + "</g></svg>";
      var vert = step < 34;
      xi.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + xH + '" width="' + W + '" height="' + xH + '" aria-hidden="true"><g class="axis xr">' +
        rounds.map(function (r) {
          var gp = esc(abbr(roundName(r)));
          return vert
            ? '<text transform="translate(' + (x(r) - 3.5).toFixed(1) + ' 4) rotate(90)"><tspan class="rn">' + r + "</tspan> " + gp + "</text>"
            : '<text x="' + x(r) + '" y="15" text-anchor="middle" class="rn">' + r + '</text><text x="' + x(r) + '" y="30" text-anchor="middle">' + gp + "</text>";
        }).join("") + "</g></svg>";
      geo = { W: W, H: H, z: z };
      box.querySelector('[data-zoom="out"]').disabled = z <= 1.001;
      box.querySelector('[data-zoom="in"]').disabled = z >= zMax - 0.001;
    }
    function sync() {
      yi.style.transform = "translateY(" + -plot.scrollTop + "px)";
      xi.style.transform = "translateX(" + -plot.scrollLeft + "px)";
      chartScroll[kind] = { l: plot.scrollLeft, t: plot.scrollTop };
    }
    // zoom to z, keeping the point at (fx, fy) in the visible plot where it is
    function zoomTo(z, fx, fy) {
      z = Math.max(1, Math.min(zMax, z));
      if (geo && Math.abs(z - geo.z) < 0.001) return;
      var old = geo, cx = plot.scrollLeft + fx, cy = plot.scrollTop + fy;
      draw(z);
      chartZoom[kind] = z;
      var nx = padL + (cx - padL) * (geo.W - padL - padR) / (old.W - padL - padR);
      var ny = padT + (cy - padT) * (geo.H - padT - padB) / (old.H - padT - padB);
      plot.scrollLeft = nx - fx;
      plot.scrollTop = ny - fy;
      sync();
    }

    draw(Math.min(zMax, chartZoom[kind] || 1));
    var saved = chartScroll[kind];
    plot.scrollLeft = saved ? saved.l : plot.scrollWidth;
    plot.scrollTop = saved ? saved.t : 0;
    sync();
    plot.addEventListener("scroll", sync, { passive: true });

    box.querySelectorAll("[data-zoom]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-zoom") === "in" ? 1.6 : 1 / 1.6;
        zoomTo(geo.z * f, plot.clientWidth / 2, plot.clientHeight / 2);
      });
    });
    // two-finger pinch on phones
    var pinch = null, raf = 0;
    var dist = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); };
    plot.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        var r = plot.getBoundingClientRect();
        pinch = { d: dist(e.touches), z: geo.z,
          fx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, fy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
      }
    }, { passive: true });
    plot.addEventListener("touchmove", function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var z = pinch.z * dist(e.touches) / pinch.d;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { zoomTo(z, pinch.fx, pinch.fy); });
    }, { passive: false });
    plot.addEventListener("touchend", function (e) { if (e.touches.length < 2) pinch = null; }, { passive: true });
    // trackpad pinch (reported as ctrl + wheel)
    plot.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var r = plot.getBoundingClientRect();
      zoomTo(geo.z * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
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
    h += SUB("records");
    h += '<div class="grid two">';
    h += '<section class="card"><h2>Highest rounds</h2><p class="sub">Best single-round scores this season.</p><div class="rows ranked">' +
      M.records.top.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round), fmt(x.pts)); }).join("") + "</div></section>";
    h += '<section class="card"><h2>Lowest rounds</h2><p class="sub">The weekends to forget.</p><div class="rows ranked">' +
      M.records.bottom.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round), fmt(x.pts)); }).join("") + "</div></section>";
    h += "</div><div style=\"height:14px\"></div>";

    // Best / worst weekends per manager + consistency
    h += SUB("weekends");
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
    h += SUB("honours");
    h += '<section class="card"><h2>Round honours</h2><p class="sub">Round wins (top score of the round, ties shared), top-three finishes, last places, rounds above the league average, and rounds spent top of the standings.</p>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Wins</th><th>Top 3</th><th>Last</th><th>Above avg</th><th>Led after</th></tr></thead><tbody>';
    M.managers.slice().sort(function (a, b) { return b.wins - a.wins || b.podiums - a.podiums || a.rank - b.rank; }).forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + '<td class="num">' + m.wins + "</td><td>" + m.podiums + "</td><td>" + m.lastPlace +
        "</td><td>" + m.aboveAvg + "/" + m.played + "</td><td>" + m.roundsLeading + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // Movement
    h += SUB("moves");
    h += '<div class="grid two">';
    h += '<section class="card"><h2>Biggest climbs</h2><p class="sub">Places gained in the standings in a single round.</p><div class="rows ranked">' +
      (M.records.rises.length ? M.records.rises.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round) + " · " + ordinal(x.from) + " → " + ordinal(x.to), '<span class="up">▲' + x.delta + "</span>"); }).join("") : '<div class="empty">None yet.</div>') + "</div></section>";
    h += '<section class="card"><h2>Biggest drops</h2><p class="sub">Places lost in a single round.</p><div class="rows ranked">' +
      (M.records.falls.length ? M.records.falls.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round) + " · " + ordinal(x.from) + " → " + ordinal(x.to), '<span class="down">▼' + -x.delta + "</span>"); }).join("") : '<div class="empty">None yet.</div>') + "</div></section>";
    h += "</div><div style=\"height:14px\"></div>";

    h += '<section class="card"><h2>Highest &amp; lowest position</h2>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Highest</th><th>Lowest</th></tr></thead><tbody>';
    M.managers.forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + "<td>" + ordM(m.bestRank) + '</td><td class="muted">' + (m.worstRank ? ordinal(m.worstRank) : "–") + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // Team value & transfers
    h += SUB("value");
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
    h += SUB("drivers");
    h += ownershipCard("Drivers", M.drivers, n);
    h += SUB("constructors");
    h += ownershipCard("Constructors", M.constructors, n);

    // season-long
    var season = M.ownership.filter(function (o) { return o.seasonCount; }).slice().sort(function (a, b) { return b.seasonPct - a.seasonPct; }).slice(0, 10);
    h += SUB("trusted");
    h += '<section class="card"><div class="alist">' +
      season.map(function (o) {
        return assetRow(o.id, '<b>' + fmt(o.seasonPct) + "%</b>", '<span class="minibar"><i style="width:' + o.seasonPct.toFixed(1) + '%"></i></span>');
      }).join("") + "</div></section>";
    return h;
  }
  function ownershipCard(title, list, n) {
    var rows = list.filter(function (o) { return o.count || (o.global && o.active); });
    return '<section class="card"><div class="alist">' +
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

  /* a manager's season, in parts: the sheet shows them all, the Your team tab one per sub-tab */
  function managerParts(m) {
    var M = S.model, n = M.managers.length, P = {};
    var o = {}; M.ownership.forEach(function (x) { o[x.id] = x; });
    P.head = "<h1>" + esc(m.name) + (isMe(m) ? ' <span class="pill me">you</span>' : "") + '</h1><p class="lede">' + esc(m.team) + " · " + ordinal(m.rank) + " · " + fmt(m.total) + " pts" +
      (m.gapLeader ? " · −" + fmt(m.gapLeader) : "") + "</p>";
    var W = S.prizes && S.prizes.by[m.id];
    P.tiles = figs([
      { k: "Average", v: fmt(m.avg) },
      { k: "Best", v: fmt(m.best && m.best.pts), d: m.best ? roundName(m.best.round) : "" },
      { k: "Wins", v: fmt(m.wins) },
      W ? { k: "Net XP", v: (W.net >= 0 ? "+" : "") + cur(W.net, true), cls: W.net >= 0 ? "up" : "down" } : { k: "Top 3", v: fmt(m.podiums) }
    ]);
    var lp = (S.data.assetPoints || {})[M.N] || {};
    var drv = m.picks.filter(function (id) { return (assetOf(id) || {}).type === "D"; }).map(function (id) { return { id: id }; });
    var con = m.picks.filter(function (id) { return (assetOf(id) || {}).type === "C"; }).map(function (id) { return { id: id }; });
    P.team = '<section class="card"><div class="totw-h"><div><div class="k">Team value</div><div class="v">' + money(m.currentValue) + '</div></div><div class="ttl"><b>Current team</b><span>as used in ' + esc(roundName(M.N)) +
      '</span></div><div class="r"><div class="k">' + esc(abbr(roundName(M.N))) + ' points</div><div class="v">' + fmt(m.last) + "</div></div></div>" +
      teamGrid(drv, con, function (x) { return { pts: lp[x.id] }; }) + "</section>";
    var r0 = '<section class="card"><div class="tblwrap"><table><thead><tr><th class="l">Round</th><th>Pts</th><th>Finish</th><th>League</th><th>Value</th><th>Changes</th></tr></thead><tbody>';
    M.rounds.slice().reverse().forEach(function (r) {
      var ri = M.roundInfo[r - 1];
      if (m.pts[r] == null) { r0 += '<tr><td class="l">' + r + " · " + esc(ri.short) + '</td><td colspan="5" class="muted c">not in the league yet</td></tr>'; return; }
      r0 += '<tr><td class="l">' + r + " · " + esc(ri.short) + '</td><td class="num" style="' + heat(m.roundRank[r], ri.count) + '">' + fmt(m.pts[r]) + "</td><td>" + ordM(m.roundRank[r]) +
        "</td><td>" + ordM(m.rankAt[r]) + "</td><td>" + money(m.teamValue[r]) + "</td><td>" + (m.transfers[r] == null ? "–" : m.transfers[r]) + "</td></tr>";
    });
    P.rounds = r0 + "</tbody></table></div></section>";

    // the picks that earned this manager the most, while in their team
    var earned = {}, held = {};
    M.rounds.forEach(function (r) {
      var pts = (S.data.assetPoints || {})[r] || {};
      (m.team_[r] || []).forEach(function (id) { if (pts[id] != null) { earned[id] = (earned[id] || 0) + pts[id]; held[id] = (held[id] || 0) + 1; } });
    });
    var ids = Object.keys(earned).filter(function (id) { return assetOf(id); }).sort(function (a, b) { return earned[b] - earned[a]; });
    var listOf = function (type, title) {
      var l = ids.filter(function (id) { return assetOf(id).type === type; });
      return '<section class="card"><h2>' + title + '</h2><div class="alist">' +
        l.map(function (id) { return assetRow(id, "<b>" + fmt(earned[id]) + '</b><span class="k">pts</span>', held[id] + " round" + (held[id] === 1 ? "" : "s") + " in the team"); }).join("") + "</div></section>";
    };
    P.picks = listOf("D", "Drivers") + listOf("C", "Constructors");

    // rivals: neighbours in the table, and head-to-head against everyone
    var i = M.managers.indexOf(m), above = M.managers[i - 1], below = M.managers[i + 1], back = Math.max(1, M.N - 5);
    var gapRow = function (x, lbl) {
      if (!x) return "";
      var now = x.total - m.total, then = x.cum[back] != null && m.cum[back] != null ? x.cum[back] - m.cum[back] : null;
      // from your point of view: are you catching the one ahead / holding off the one behind?
      var d = then == null ? null : Math.abs(now) - Math.abs(then), since = " since R" + back;
      var trend = d == null ? "" : d === 0 ? "no change" + since :
        lbl === "Ahead" ? (d < 0 ? "you've closed " + fmt(-d) + since : "they've pulled away by " + fmt(d) + since)
                        : (d < 0 ? "they've closed " + fmt(-d) + " on you" + since : "you've pulled away by " + fmt(d) + since);
      return '<div class="row click" data-m="' + esc(x.id) + '"><div class="rk"><span class="' + "t" + medal(x.rank) + '">' + x.rank + '</span></div><div class="main"><div class="n">' + lbl + ": " + esc(x.name) +
        '</div><div class="t">' + esc(trend) + '</div></div><div class="big ' + (now > 0 ? "down" : "up") + '">' + (now > 0 ? "−" : "+") + fmt(Math.abs(now)) + "</div></div>";
    };
    var h2h = M.managers.filter(function (x) { return x !== m; }).map(function (x) {
      var w = 0, l = 0, d = 0;
      M.rounds.forEach(function (r) { if (m.pts[r] == null || x.pts[r] == null) return; if (m.pts[r] > x.pts[r]) w++; else if (m.pts[r] < x.pts[r]) l++; else d++; });
      return { x: x, w: w, l: l, d: d };
    });
    P.rivals = '<section class="card"><h2>Either side</h2><div class="rows">' +
      (gapRow(above, "Ahead") + gapRow(below, "Behind") || '<div class="empty">Nobody either side.</div>') + "</div></section>" +
      '<section class="card"><h2>Head to head</h2><div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>W</th><th>L</th><th>T</th><th>Gap</th></tr></thead><tbody>' +
      h2h.map(function (r) {
        var g = m.total - r.x.total;
        return '<tr class="click" data-m="' + esc(r.x.id) + '">' + whoCell(r.x) + '<td class="num ' + (r.w > r.l ? "up" : r.w < r.l ? "down" : "") + '">' + r.w + "</td><td>" + r.l + "</td><td>" + r.d +
          '</td><td class="' + (g >= 0 ? "up" : "down") + '">' + signed(g) + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return P;
  }

  function managerSheet(id) {
    var m = byId(id);
    if (!m) return;
    var P = managerParts(m);
    openSheet(P.head + P.tiles + P.team + P.rounds);
  }

  function teamSelect() {
    return '<select class="select meSelect" aria-label="Select your team"><option value="">Select your team…</option>' +
      S.model.managers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (isMe(m) ? " selected" : "") + ">" + esc(m.name) + " — " + esc(m.team) + "</option>";
      }).join("") + "</select>";
  }

  /* Your team: your season, one part per sub-tab */
  function viewYou() {
    var m = S.me && byId(S.me);
    if (!m) {
      return '<section class="card youpick"><h2>Which team is yours?</h2>' +
        teamSelect() + "</section>";
    }
    var P = managerParts(m), M = S.model;
    var n = lastFirst(m);
    var head = '<section class="you-h"><div class="you-pos"><span class="' + "t" + medal(m.rank) + '">' + m.rank + '</span><small>of ' + M.managers.length + '</small></div><div class="you-name">' +
      (n.first ? '<span class="fn">' + esc(n.first) + "</span>" : "") + "<b>" + esc(n.last) + "</b><small>" + esc(m.team) + '</small></div><div class="you-pts"><b>' + fmt(m.total) + "</b><small>" +
      (m.gapLeader ? "−" + fmt(m.gapLeader) + " to 1st" : "leading") + "</small></div></section>";
    return head +
      SUB("season") + P.tiles + P.rounds +
      SUB("team") + P.team +
      SUB("picks") + P.picks +
      SUB("rivals") + P.rivals;
  }

  function assetSheet(id) {
    var M = S.model, o = M.ownership.find(function (x) { return x.id === id; });
    if (!o) return;
    var a = o.asset;
    var nm = splitName(a);
    var h = '<div class="ahero" style="' + tc(teamColor(a.team)) + '">' + (a.type === "C" ? pic(id, "car", "hcar") : pic(id, "head", "hhead")) +
      '<div class="ahero-t">' + (nm.first ? '<span class="fn">' + esc(nm.first) + "</span>" : "") + "<b>" + esc(nm.last) + "</b><small>" + (a.type === "C" ? "Constructor" : esc(a.team)) + " · " + money(o.price) + " " + signedMoney(priceMove(id)) + "</small></div></div>";
    h += figs([{ k: "Season pts", v: fmt(o.seasonPts) }, { k: roundName(M.N), v: fmt(o.lastPts) }, { k: "League", v: o.count + "/" + M.managers.length }, { k: "All teams", v: o.global != null ? o.global + "%" : "–" }]);
    h += '<section class="card"><h2>Owned by</h2><div class="rows">' + (o.owners.length ? o.owners.map(function (m) {
      return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + m.rank + '</div><div class="main"><div class="n">' + esc(m.name) + '</div><div class="t">' + esc(m.team) + "</div></div></div>";
    }).join("") : '<div class="empty">Nobody in the league.</div>') + "</div></section>";
    openSheet(h);
  }

  /* ---------------- burger menu ---------------- */
  var ICON = {
    profile: '<circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />',
    records: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />',
    weekends: '<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />',
    honours: '<circle cx="12" cy="14" r="6" /><path d="M8.5 3h7l-2 5.2M8.5 3l2 5.2M12 11.5v5" />',
    form: '<path d="M3 12h4l3-8 4 16 3-8h4" />',
    moves: '<path d="M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4" />',
    value: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" />',
    xp: '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z" />',
    h2h: '<circle cx="12" cy="12" r="9" /><path d="M8 9l8 6M16 9l-8 6" />',
    rules: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" />',
    settings: '<circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.6.66 1 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />'
  };
  function ico(k) { return '<svg class="dr-i" viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + "</svg>"; }
  function drItem(o) {
    var tag = o.href ? "a" : "button";
    return "<" + tag + ' class="dr-item' + (o.on ? " on" : "") + '"' + (o.href ? ' href="' + o.href + '" data-close="1"' : ' type="button"') + (o.attr || "") + ">" + ico(o.icon) +
      '<span class="dr-t">' + esc(o.title) + (o.sub ? "<small>" + esc(o.sub) + "</small>" : "") + "</span></" + tag + ">";
  }
  function drawerHtml() {
    var me = S.me && byId(S.me), M = S.model, h = "";
    // who you are, and the switch
    h += '<div class="dr-who">';
    if (me) {
      h += '<span class="dr-av">' + esc((me.team || me.name).trim().charAt(0).toUpperCase()) + '</span><span class="dr-id"><b>' + esc(me.team) + "</b><small>" + esc(me.name) + " · " + ordinal(me.rank) + "</small></span>" +
        '<button type="button" class="dr-change" data-toggle-team="1">Change</button>';
    } else {
      h += '<span class="dr-av">?</span><span class="dr-id"><b>Choose your team</b></span>';
    }
    h += '</div><div class="dr-select"' + (me ? " hidden" : "") + ">" + teamSelect() + "</div>";
    h += '<nav class="dr-list">';
    var cur = S.tab === "stats" ? S.sub.stats : null;
    h += '<div class="dr-h">Stats</div>' + SUBS.stats.map(function (x) {
      return drItem({ icon: x[0], title: x[1], href: "#stats/" + x[0], on: x[0] === cur });
    }).join("");
    h += '<div class="dr-sep"></div>' +
      drItem({ icon: "rules", title: "Rules", attr: ' data-open="rules"' }) +
      drItem({ icon: "settings", title: "Settings", attr: ' data-open="settings"' });
    h += "</nav>";
    h += '<div class="dr-foot"><p>' + (M.next && M.next.lock && Date.parse(M.next.lock) > Date.now() ? esc(M.next.short) + " locks in " + until(M.next.lock) : "") +
      '</p><img src="logo.webp" alt="F1 Fanatics Fantasy League" width="96" height="96" /></div>';
    return h;
  }
  function openDrawer() {
    var d = $("drawer");
    $("drawerBody").innerHTML = drawerHtml();
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
  }
  function closeDrawer() { var d = $("drawer"); if (d.open) { if (d.close) d.close(); else d.removeAttribute("open"); } }

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
    var t = themeNow();
    var h = "<h1>Settings</h1>";
    h += '<div class="group-h">Appearance</div><div class="group card" style="padding:14px"><div class="seg" role="radiogroup" aria-label="Theme">' +
      [["dark", "Dark"], ["light", "Light"], ["system", "Auto"]].map(function (o) {
        return '<button role="radio" aria-checked="' + (t === o[0]) + '" class="' + (t === o[0] ? "on" : "") + '" data-theme-set="' + o[0] + '">' + o[1] + "</button>";
      }).join("") + "</div></div>";
    h += '<div class="group-h">About</div><div class="group card" style="padding:0">' +
      '<button class="item" data-open="info"><span class="lab">About the data</span><span class="chev">›</span></button></div>';
    openSheet(h);
  }

  function rulesSheet() {
    var R = window.F1F_RULES, PZ = S.prizes, h = "<h1>Rules</h1>";
    if (PZ) {
      var c = PZ.cfg;
      h += '<div class="group-h">League XP</div><div class="group card rules" style="padding:0"><div class="body" style="padding-top:12px"><table class="rtable"><tbody>' +
        "<tr><td>Each manager</td><td>" + cur(c.entry) + "</td></tr>" +
        "<tr><td>Pool</td><td>" + cur(PZ.pot) + "</td></tr>" +
        "<tr><td>Each race, to the top scorer</td><td>" + cur(c.perRound) + "</td></tr>" +
        "<tr><td>Season, split " + c.split.join(" : ") + "</td><td>" + cur(PZ.seasonPool) + "</td></tr>" +
        "<tr><td>1st / 2nd / 3rd</td><td>" + PZ.seasonPrizes.map(function (v) { return cur(v, true); }).join(" / ") + "</td></tr>" +
        "<tr><td>Ties</td><td>shared</td></tr>" +
        "</tbody></table></div></div>";
    }
    if (R) {
      h += '<div class="group-h">F1 Fantasy 2026</div><div class="group card rules" style="padding:0">' +
        R.sections.map(function (sec) {
          return "<details><summary>" + esc(sec.title) + '</summary><div class="body">' +
            (sec.intro ? "<p>" + esc(sec.intro) + "</p>" : "") +
            '<table class="rtable"><tbody>' + sec.rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +
            (sec.notes || []).map(function (n) { return '<p style="margin-top:8px">' + esc(n) + "</p>"; }).join("") +
            "</div></details>";
        }).join("") +
        '<div class="src"><a href="' + esc(R.source) + '" target="_blank" rel="noopener">Full rules ↗</a></div></div>';
    }
    openSheet(h);
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
    var p0 = OLD_TABS[parts[0]] || parts[0];
    var tab = TABS.indexOf(p0) >= 0 ? p0 : "league";
    if (tab === "league" && /^(result|grid|winners)$/.test(parts[1] || "")) tab = "races";
    var keys = SUBS[tab].map(function (x) { return x[0]; });
    var sub = keys.indexOf(parts[1]) >= 0 ? parts[1] : keys.indexOf(S.sub[tab]) >= 0 ? S.sub[tab] : keys[0];
    var moved = tab !== S.tab || sub !== S.sub[tab];
    S.tab = tab;
    S.sub[tab] = sub;
    save("sub", S.sub);
    render();
    if (moved) window.scrollTo(0, 0);
  }
  function render() {
    if (!S.model) return;
    renderChrome();
    var v = $("view");
    var fn = { league: function () { return viewStandings() + viewPrizes(); }, races: viewRaces, you: viewYou, trends: viewTrends, stats: viewStats, picks: viewPicks }[S.tab];
    var cur = S.sub[S.tab] || SUBS[S.tab][0][0];
    // Stats is reached from the menu, which lists every section, so no pill row there
    $("subtabs").innerHTML = S.tab === "stats" ? "" : SUBS[S.tab].map(function (x) {
      return '<a href="#' + S.tab + "/" + x[0] + '" class="' + (x[0] === cur ? "on" : "") + '"' + (x[0] === cur ? ' aria-current="page"' : "") + ">" + esc(x[1]) + "</a>";
    }).join("");
    var on = $("subtabs").querySelector(".on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
    v.innerHTML = pickSub(fn(), cur);
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
    if (e.target.closest("#drawerClose")) { closeDrawer(); return; }
    if (e.target.closest("[data-toggle-team]")) {
      var box = document.querySelector("#drawer .dr-select");
      if (box) { box.hidden = !box.hidden; if (!box.hidden) { var sel = box.querySelector("select"); if (sel) sel.focus(); } }
      return;
    }
    var link = e.target.closest("#drawer a[data-close]");
    if (link) { closeDrawer(); return; } // the link itself navigates
    if (e.target.closest("[data-hl-all]")) {
      var M0 = S.model;
      S.hl = hlSet().length === M0.managers.length ? null : M0.managers.map(function (m) { return m.id; });
      if (S.tab === "trends") { var y0 = window.scrollY; render(); window.scrollTo(0, y0); }
      return;
    }
    var t = e.target.closest("[data-focus],[data-m],[data-r],[data-a],[data-theme-set],[data-open],[data-round-nav]");
    if (!t) return;
    if (t.hasAttribute("data-round-nav")) {
      var nr = Number(t.getAttribute("data-round-nav"));
      if (nr >= 1 && nr <= S.model.N) roundSheet(nr);
      return;
    }
    if (t.tagName === "A" && t.hasAttribute("data-r")) e.preventDefault();
    if (t.hasAttribute("data-theme-set")) {
      applyTheme(t.getAttribute("data-theme-set"));
      t.parentNode.querySelectorAll("button").forEach(function (b) { var on = b === t; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
      return;
    }
    if (t.hasAttribute("data-open")) {
      var what = t.getAttribute("data-open");
      if (what === "settings") { closeDrawer(); settingsSheet(); }
      else if (what === "rules") { closeDrawer(); rulesSheet(); }
      else if (what === "info") infoSheet();
      return;
    }
    if (t.hasAttribute("data-focus")) {
      var id = t.getAttribute("data-focus"), hl = hlSet(), i = hl.indexOf(id);
      if (i >= 0) hl.splice(i, 1); else hl.push(id);
      if (S.tab === "trends") { var y = window.scrollY; render(); window.scrollTo(0, y); }
      return;
    }
    if (t.hasAttribute("data-m")) managerSheet(t.getAttribute("data-m"));
    else if (t.hasAttribute("data-r")) roundSheet(Number(t.getAttribute("data-r")));
    else if (t.hasAttribute("data-a")) assetSheet(t.getAttribute("data-a"));
  });
  document.addEventListener("change", function (e) {
    if (e.target.classList && e.target.classList.contains("meSelect")) {
      S.me = e.target.value || null; save("me", S.me); render();
      if ($("drawer").open) $("drawerBody").innerHTML = drawerHtml();
    }
  });
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet")) closeSheet(); });
  $("menuBtn").addEventListener("click", function () { if (S.model) openDrawer(); });
  $("drawer").addEventListener("click", function (e) { if (e.target === $("drawer")) closeDrawer(); });
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
  // the opening screen stays at least two seconds from the first paint
  function hideSplash() {
    var el = $("splash");
    if (!el) return;
    var wait = Math.max(0, 2000 - (Date.now() - (window.F1F_T0 || Date.now())));
    setTimeout(function () { el.classList.add("done"); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600); }, wait);
  }
  Promise.all([fetchData(), photosReady]).then(function (r) { setData(r[0]); route(); hideSplash(); }).catch(function (e) {
    hideSplash();
    $("view").innerHTML = '<div class="empty">Couldn\'t load the league data (' + esc(e.message) + "). Pull to refresh or try again shortly.</div>";
    $("subline").textContent = "Offline";
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  window.__f1f = S; // for tests and the curious
})();
