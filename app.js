/* F1 Fanatics — the app. Reads data.json, builds the model with compute.js,
   renders five tabs and two sheets. No framework, no build step. */
(function () {
  "use strict";
  var CONFIG = window.F1F_CONFIG;
  var F1F = window.F1F;
  var TABS = ["league", "races", "gp", "trends", "you", "picks", "stats"];
  var OLD_TABS = { standings: "league" };
  // each tab is split into sub-tabs; only the chosen one is drawn
  var SUBS = {
    league: [["table", "Standings"], ["prizes", "XP"]],
    races: [["list", "Races"], ["grid", "Race grid"]],
    you: [["season", "Season"], ["team", "Team"], ["picks", "Picks"], ["rivals", "Rivals"]],
    trends: [["rank", "Position"], ["total", "Points"], ["gap", "Gap"]],
    stats: [["records", "Records"], ["weekends", "Weekends"], ["honours", "Honours"], ["moves", "Movement"], ["value", "Value"]],
    picks: [["drivers", "Drivers"], ["constructors", "Constructors"], ["trusted", "Trusted"]],
    gp: [["weekend", "Weekend"]]
  };
  // tabs reached from the menu (or a single page): no pill row of sub-tabs
  var NO_SUBTABS = { league: 1, stats: 1, picks: 1, gp: 1 };
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

  var S = { data: null, model: null, me: null, hl: null, tab: "league", sub: {}, fetchedAt: 0 };
  // saved settings, ignored if a browser kept something unreadable
  (function () {
    var me = load("me"), sub = load("sub");
    S.me = typeof me === "string" && me ? me : null;
    S.sub = sub && typeof sub === "object" && !Array.isArray(sub) ? sub : {};
  })();

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
  // only plain hex colours ever reach a style attribute
  var HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
  function teamColor(t) {
    var c = S.data && S.data.teamColors && S.data.teamColors[t];
    return HEX.test(c || "") ? c : TEAM_COLORS[t] || "#888";
  }
  // black or white text, whichever reads better on a team colour
  function ink(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ""); if (!m) return "#fff";
    var c = [m[1], m[2], m[3]].map(function (x) { x = parseInt(x, 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return L > 0.36 ? "#0b0b0d" : "#fff";
  }
  function tc(hex) { hex = HEX.test(hex || "") ? hex : "#888"; return "--tc:" + hex + ";--ink:" + ink(hex); }
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
    if (ph) return '<img class="' + (cls || "") + '" src="' + esc(ph) + '" alt="" loading="lazy" decoding="async" data-ini="' + initials(a) + '" />';
    return '<span class="' + (cls || "") + ' noimg">' + initials(a) + "</span>";
  }
  function splitName(a) {
    if (!a) return { first: "", last: "?" };
    if (a.type === "C") return { first: "", last: a.name };
    return { first: a.first || (a.full || a.name).split(" ").slice(0, -1).join(" "), last: a.last || (a.full || a.name).split(" ").slice(-1)[0] };
  }
  function signedMoney(v) { return v == null || v === 0 ? "" : '<span class="' + (v > 0 ? "up" : "down") + '">' + (v > 0 ? "▲" : "▼") + "$" + fmt(Math.abs(v), 1) + "m</span>"; }

  // marks your own name wherever managers are listed
  function youTag() { return ' <span class="you">You</span>'; }
  // a manager's initials in a circle, in a colour of their own (the same everywhere); yours has a red ring
  function avatar(m, cls) {
    var p = String(m.name || "?").trim().split(/\s+/), ini = (p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "");
    var h = 0, id = String(m.id); for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return '<span class="av' + (cls ? " " + cls : "") + (isMe(m) ? " me" : "") + '" style="--avh:' + h + '" aria-hidden="true">' + esc(ini.toUpperCase()) + "</span>";
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
  function whoCell(m) {
    return '<td class="l who"><div class="whw">' + avatar(m, "sm") + '<div class="whn"><div class="n">' + esc(m.name) +
      '</div><div class="t">' + (isMe(m) ? '<span class="you">You</span>' : "") + esc(m.team) + "</div></div></div></td>";
  }

  /* ---------------- data ---------------- */
  function fetchData() {
    return fetch(CONFIG.dataUrl + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("data.json " + r.status); return r.text(); })
      .then(function (t) {
        var d = JSON.parse(t);
        if (!d || typeof d !== "object") throw new Error("data.json is empty");
        Object.defineProperty(d, "_raw", { value: t }); // kept for offline once it has proved good
        return d;
      });
  }
  function cachedData() {
    var c = load("data");
    return c && typeof c === "object" ? Object.assign(c, { _offline: true }) : null;
  }
  // Fresh data if it can be shown; otherwise the last good copy on this phone.
  function loadData() {
    return fetchData().then(setData).catch(function (e) {
      var c = cachedData();
      if (!c) throw e;
      return setData(c);
    });
  }
  // Builds the model first and only switches over (and saves the copy kept for
  // offline) when that works, so a bad download can't replace good data.
  function setData(d) {
    if (S.data && S.data.generatedAt === d.generatedAt && !!S.data._offline === !!d._offline) { S.fetchedAt = Date.now(); return false; }
    d.league = d.league && typeof d.league === "object" ? d.league : {};
    if (!d.league.season) d.league.season = CONFIG.season;
    var model = F1F.build(d);
    if (!model.managers.length || !model.leader) throw new Error("no managers in the data");
    var prizes = CONFIG.xp ? F1F.prizes(model, { entry: CONFIG.xp.stake, perRound: CONFIG.xp.perRace, split: CONFIG.xp.split }) : null;
    var oldLeader = S.model && S.model.leader && S.model.leader.id;
    S.data = d; S.model = model; S.prizes = prizes; S.fetchedAt = Date.now(); S.first = null; S.codes = null; chartScroll = {};
    if (S.me && !byId(S.me)) S.me = null;
    // highlighted lines: drop managers who left; start again if the lead changed hands
    if (S.hl) S.hl = oldLeader !== model.leader.id ? null : S.hl.filter(function (id) { return byId(id); });
    if (d._raw) { try { localStorage.setItem("f1f.data", d._raw); } catch (e) {} }
    return true;
  }
  function refresh(force) {
    if (!force && Date.now() - S.fetchedAt < REFRESH_MS) return;
    loadData().then(function (changed) { if (changed) render(); }).catch(function () {});
  }

  /* ---------------- header & banner ---------------- */
  function renderChrome() {
    var M = S.model, d = S.data;
    var gl = document.querySelector("#tabs .gp-l"), gw = gpRound();
    if (gl && gw) { var gs = (d.schedule || []).find(function (x) { return x.round === gw; }); gl.textContent = gs ? abbr(gs.short || gs.name) : "GP"; }
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
    var M = S.model, n = M.managers.length;
    // last five finishes and the places moved this round
    var form = function (m) {
      var mv = m.move > 0 ? '<span class="up">▲' + m.move + "</span>" : m.move < 0 ? '<span class="down">▼' + -m.move + "</span>" : "";
      return '<span class="form mini">' + m.formRanks.map(function (r) { return formChip(r, n); }).join("") + "</span>" + (mv ? " " + mv : "");
    };
    return SUB("table") + podiumBoard({
      title: lbToggle("table"), unit: "PTS",
      entries: M.managers.map(function (m) {
        var gap = m.gapLeader ? ' <span class="gap">−' + fmt(m.gapLeader) + "</span>" : "";
        return { m: m, rank: m.rank, value: fmt(m.total), extra: form(m) + gap, sub: form(m) + gap };
      })
    });
  }
  function d0(ri) { return ri ? S.data.league.season + " " + ri.name : "round " + S.model.N; }
  function figs(list) {
    return '<section class="figs">' + list.map(function (f) {
      return '<div class="fig"><b' + (f.cls ? ' class="' + f.cls + '"' : "") + ">" + f.v + "</b><span>" + esc(f.k) + "</span>" + (f.d ? "<small>" + esc(f.d) + "</small>" : "") + "</div>";
    }).join("") + "</section>";
  }

  function lastFirst(m) { var p = m.name.split(" "); return { first: p.length > 1 ? p.slice(0, -1).join(" ") : "", last: p[p.length - 1] }; }

  /* round result, like F1's race-result graphic: podium 2-1-3, then the rest */
  /* the podium board (round results and XP): 2-1-3, big numerals, name below, then 4th onwards */
  function podiumBoard(o) {
    var card = function (e, place) {
      if (!e) return "";
      var n = lastFirst(e.m);
      return '<div class="pod p' + place + " " + medal(e.rank) + (isMe(e.m) ? " me" : "") + '" data-m="' + esc(e.m.id) + '">' +
        '<div class="pod-img"><span class="pod-num">' + e.rank + "</span></div>" +
        '<div class="pod-name">' + (n.first ? '<span class="fn">' + esc(n.first) + "</span>" : "") + "<b>" + esc(n.last) + "</b>" + (isMe(e.m) ? youTag() : "") + '<span class="pt">' + esc(e.m.team) + "</span>" +
        '<span class="pp"><b>' + e.value + "</b> " + esc(o.unit) + "</span>" + (e.extra ? '<span class="pex">' + e.extra + "</span>" : "") + "</div></div>";
    };
    var top = o.entries.slice(0, 3), rest = o.entries.slice(3);
    var h = '<section class="result"><div class="result-h">' + (o.prev != null ? '<button class="rnav" data-round-nav="' + o.prev + '"' + (o.prevOff ? " disabled" : "") + ' aria-label="Previous round">‹</button>' : "") +
      '<div class="result-t">' + o.title + "</div>" +
      (o.next != null ? '<button class="rnav" data-round-nav="' + o.next + '"' + (o.nextOff ? " disabled" : "") + ' aria-label="Next round">›</button>' : "") + "</div>";
    h += '<div class="podium">' + card(top[1], 2) + card(top[0], 1) + card(top[2], 3) + "</div>";
    if (rest.length) h += '<div class="rlist">' + rest.map(function (e) {
      return '<div class="rrow' + (isMe(e.m) ? " me" : "") + '" data-m="' + esc(e.m.id) + '"><div class="rpos">' + e.rank + '</div><div class="rname rav">' + avatar(e.m) + '<div class="rnt"><b class="nmw"><span class="nmt">' + esc(e.m.name) + "</span>" + (isMe(e.m) ? youTag() : "") +
        "</b><small>" + e.sub + "</small></div></div>" + '<div class="rpts"><b>' + e.value + "</b>" + esc(o.unit) + "</div></div>";
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

  // the Points / XP switch on the League board (the two views stay separate routes, so the choice is remembered)
  function lbToggle(on) {
    return '<span class="lbt" role="tablist">' + [["table", "Points"], ["prizes", "XP"]].map(function (x) {
      return '<a href="#league/' + x[0] + '" role="tab"' + (x[0] === on ? ' class="on" aria-selected="true"' : ' aria-selected="false"') + ">" + x[1] + "</a>";
    }).join("") + '</span> <span class="sl">/</span> ' + esc(String(S.data.league.season));
  }

  function viewPrizes() {
    var P = S.prizes, M = S.model;
    if (!P) return "";
    // ordered by XP earned so far (race XP + the season XP if it ended now); ties share a place
    var rows = M.managers.slice().sort(function (a, b) { return P.by[b.id].total - P.by[a.id].total || a.rank - b.rank; });
    var rk = F1F.rankBy(rows, function (m) { return Math.round(P.by[m.id].total); });
    var places = P.seasonPrizes.length, cut = M.managers.filter(function (m) { return m.rank <= places; });
    var cutPts = cut.length ? Math.min.apply(null, cut.map(function (m) { return m.total; })) : null;
    // how each total is made: race wins and their XP, plus the season XP their place is on track for
    var h = SUB("prizes") + podiumBoard({
      title: lbToggle("prizes"), unit: "XP",
      entries: rows.map(function (m) { return { m: m, rank: rk.get(m), value: cur(P.by[m.id].total, true), sub: esc(m.team) }; })
    });
    // how each total is made: races won, the race XP they paid, the season XP their place is on track for
    h += '<section class="card"><div class="tblwrap"><table class="xpt"><thead><tr><th class="l">Manager</th><th>Wins</th><th>Race</th><th>' + (M.remaining ? "On track" : "Won") + "</th><th>Total</th></tr></thead><tbody>";
    rows.forEach(function (m) {
      var x = P.by[m.id], n = x.raceWins.length, sh = x.raceWins.filter(function (w) { return w.shared; }).length;
      var track = m.rank <= places
        ? cur(x.projected, true) + "<small>" + ordM(m.rank) + "</small>"
        : '<span class="muted">–</span>' + (cutPts != null && M.remaining ? "<small>" + fmt(cutPts - m.total) + " off " + ordinal(places) + "</small>" : "");
      h += '<tr class="click" data-m="' + esc(m.id) + '"><td class="l"><span class="nmw">' + avatar(m, "xs") + '<span class="nmt">' + esc(firstName(m)) + "</span></span></td>" +
        "<td>" + (n ? n + (sh ? "<small>" + sh + " shared</small>" : "") : '<span class="muted">0</span>') + "</td>" +
        "<td>" + (x.race ? cur(x.race, true) : '<span class="muted">0</span>') + "</td>" +
        "<td>" + track + '</td><td class="tot">' + cur(x.total, true) + "</td></tr>";
    });
    h += "</tbody></table></div></section>";
    var paid = P.payouts.reduce(function (s, x) { return s + (x.winners.length ? P.cfg.perRound : 0); }, 0);
    h += figs([
      { k: "XP pool", v: cur(P.pot, true), d: P.players + " × " + fmt(P.cfg.entry) },
      { k: "Race XP", v: cur(paid, true), d: "of " + cur(P.roundPool, true) },
      { k: "Races left", v: fmt(P.roundsLeft), d: cur(P.roundsLeft * P.cfg.perRound) },
      { k: "Season XP", v: cur(P.seasonPool, true), d: "top " + places }
    ]);
    return h;
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
      var rn = Number(s.round) || 0;
      var pos = '<div class="rpos"><span>' + rn + "</span>" + (date ? "<small>" + esc(date) + "</small>" : "") + (s.sprint ? '<em class="spr">Sprint</em>' : "") + "</div>";
      if (done) {
        // the round's top three, F1-style: position and the first three letters of the surname
        var top = M.managers.filter(function (m) { return m.roundRank[s.round] != null && m.roundRank[s.round] <= 3; })
          .sort(function (a, b) { return a.roundRank[s.round] - b.roundRank[s.round] || a.name.localeCompare(b.name); });
        h += '<div class="rrow" data-r="' + rn + '">' + pos + '<div class="rname"><b>' + esc(s.name) + "</b>" +
          '<span class="top3">' + top.map(function (m) {
            var k = m.roundRank[s.round];
            return '<span class="pc"><i class="' + medal(k) + '">' + k + "</i>" + esc(code(m)) + "</span>";
          }).join("") + "</span>" +
          '</div><div class="rpts"><b>' + fmt(ri.high) + "</b>PTS</div></div>";
      } else {
        var next = M.next && M.next.round === s.round;
        var locked = next && s.lock && Date.now() >= Date.parse(s.lock);
        var raced = next && s.race && Date.now() > Date.parse(s.race) + 2 * 3600e3;
        var lock = next && !locked && s.lock ? "<small>locks in " + until(s.lock) + "</small>" : "";
        // the weekend underway (or raced and waiting for F1's scores) opens the GP tab
        h += (locked ? '<a class="rrow todo next on" href="#gp">' : '<div class="rrow todo' + (next ? " next" : "") + '">') + pos + '<div class="rname"><b>' + esc(s.name) + "</b>" +
          (lock ? '<span class="top3">' + lock + "</span>" : "") +
          '</div><div class="rpts">' + (next ? "<b>" + (raced ? "SCORING" : locked ? "NOW" : "NEXT") + "</b>" : "") + "</div>" + (locked ? "</a>" : "</div>");
      }
    });
    return h + "</div></section>";
  }
  function roundSheet(r) {
    if (r < 1 || r > S.model.N) return;
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
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><td class="l"><span class="nmw">' + avatar(m, "xs") + '<b class="nmt">' + esc(firstName(m)) + "</b>" + (isMe(m) ? youTag() : "") + "</span></td>";
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
  // F1-style three-letter code from the surname (HAM, VER); if two clash, first initial + two letters
  function code(m) {
    if (!S.codes) {
      var sur = function (x) { var p = x.name.trim().split(/\s+/); return (p[p.length - 1] || "?").replace(/[^A-Za-zÀ-ž]/g, "").toUpperCase() || "?"; };
      var count = {}, used = {};
      S.codes = {};
      S.model.managers.forEach(function (x) { var c = sur(x).slice(0, 3); count[c] = (count[c] || 0) + 1; });
      S.model.managers.forEach(function (x) {
        var sn = sur(x), c = sn.slice(0, 3);
        if (count[c] > 1) c = (x.name.charAt(0) + sn.slice(0, 2)).toUpperCase();
        // still taken: walk further into the surname, then number it
        for (var i = 3; used[c] && i < sn.length; i++) c = sn.slice(0, 2) + sn.charAt(i);
        for (var k = 2; used[c]; k++) c = sn.slice(0, 2) + k;
        used[c] = true;
        S.codes[x.id] = c;
      });
    }
    return S.codes[m.id] || "?";
  }
  // first names, with a surname initial where two managers share one; worked out once per data
  function firstName(m) {
    if (!S.first) {
      var count = {}, first = function (x) { return x.name.split(" ")[0]; };
      S.first = {};
      S.model.managers.forEach(function (x) { count[first(x)] = (count[first(x)] || 0) + 1; });
      S.model.managers.forEach(function (x) {
        var f = first(x), p = x.name.split(" ");
        S.first[x.id] = count[f] > 1 && p[1] ? f + " " + p[1].charAt(0) + "." : f;
      });
    }
    return S.first[m.id] || m.name;
  }

  function viewTrends() {
    var card = function (k) { return SUB(k) + '<section class="card"><div class="chartbox" data-chart="' + k + '"></div></section>' + chipsHtml(); };
    return card("rank") + card("total") + card("gap");
  }
  // Highlighted lines: the leader and you to start with; tap names (or a line) to add or remove, "All" for everyone.
  var HL_COLORS = ["#ff453a", "#f08c00", "#30d158", "#bf5af2", "#ff6fae", "#5e5ce6", "#b08850", "#00b8b0", "#6fbf3a", "#e0784a"];
  function hlSet() {
    var M = S.model;
    if (!M.leader) return [];
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

  function chartSeries(kind) {
    var M = S.model;
    var leadCum = {};
    M.rounds.forEach(function (r) {
      var best = null;
      M.managers.forEach(function (m) { if (m.cum[r] != null && (best == null || m.cum[r] > best)) best = m.cum[r]; });
      leadCum[r] = best;
    });
    return M.managers.map(function (m) {
      var vals = {};
      M.rounds.forEach(function (r) {
        if (kind === "rank") vals[r] = m.rankAt[r];
        else if (kind === "gap") vals[r] = m.cum[r] == null ? null : leadCum[r] - m.cum[r];
        else if (kind === "total") vals[r] = m.cum[r];
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
      // vertical labels need about 12px each: when races are closer, label every second (or third) race, counted back from the latest
      var every = vert ? Math.max(1, Math.ceil(12 / step)) : 1, nR = rounds.length;
      xi.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + xH + '" width="' + W + '" height="' + xH + '" aria-hidden="true"><g class="axis xr">' +
        rounds.map(function (r, i) {
          if ((nR - 1 - i) % every) return "";
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
  function valLabel(kind, v) { return kind === "rank" ? ordinal(v) : kind === "gap" ? (v ? "−" + fmt(v) : "lead") : fmt(v); }
  function pathOf(pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" "); }
  function niceStep(span, n) { var raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; }
  function niceMax(v) { if (v <= 0) return 0; var s = niceStep(v, 4); return Math.ceil(v / s) * s; }
  function niceMin(v) { if (v >= 0) { var s = niceStep(v || 1, 4); return Math.max(0, Math.floor(v / s) * s); } var s2 = niceStep(-v, 2); return Math.floor(v / s2) * s2; }
  function niceTicks(lo, hi, n) { var s = niceStep(hi - lo, n), out = []; for (var v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(Math.round(v * 100) / 100); return out; }

  /* ---------------- GP: the race weekend, session by session ---------------- */
  // the last weekend raced, until the next one locks; then the next one
  function gpRound() {
    var M = S.model, sched = S.data.schedule || [];
    var next = sched.find(function (s) { return s.round === M.N + 1; });
    if (next && next.lock && Date.now() >= Date.parse(next.lock)) return next.round;
    return M.N || (sched[0] ? sched[0].round : null);
  }
  var GP_CODE = { "Qualifying": "Q", "Race": "R", "Sprint Qualifying": "S" };
  var GP_NAME = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", SQ: "Sprint Qualifying", S: "Sprint", Q: "Qualifying", R: "Race" };
  function gpWeekend() {
    var W = gpRound(); if (!W) return null;
    var s = (S.data.schedule || []).find(function (x) { return x.round === W; }) || { round: W, name: "Round " + W };
    var wk = S.data.weekend && S.data.weekend.round === W ? S.data.weekend : null;
    var sessions = wk && wk.sessions && wk.sessions.length ? wk.sessions : (s.sessions || []).filter(function (x) { return GP_CODE[x.type]; }).map(function (x) {
      return { code: GP_CODE[x.type], name: GP_NAME[GP_CODE[x.type]], start: x.start, end: x.end, live: x.live, scored: true, pos: {} };
    });
    return { W: W, s: s, wk: wk, sessions: sessions, pts: (wk && wk.pts) || {}, final: W <= S.model.N };
  }
  // upcoming / live / done, from F1 Fantasy's live flag where it has one, else the clock
  function gpState(x) {
    var now = Date.now(), a = Date.parse(x.start), b = Date.parse(x.end);
    if (x.live === 1) return "live";
    if (x.live === 2) return "done";
    if (isFinite(a) && now < a) return "upcoming";
    if (isFinite(b) && now <= b + 10 * 60000) return "live";
    return "done";
  }
  function gpLive() {
    var g = S.model && S.data && gpWeekend();
    return !!g && g.sessions.some(function (x) { return gpState(x) === "live"; });
  }
  function gpPill(state, g, x) {
    if (state === "live") return '<span class="gpp live"><i></i>Live</span>';
    if (state === "upcoming") return '<span class="gpp up">' + esc(when(x.start, { weekday: "short", hour: "2-digit", minute: "2-digit" })) + "</span>";
    if (!x.scored) return '<span class="gpp done">Done</span>';
    return g.final ? '<span class="gpp final">Final</span>' : '<span class="gpp prov">Provisional</span>';
  }
  function viewGP() {
    var M = S.model, g = gpWeekend();
    if (!g) return SUB("weekend") + '<div class="empty">No race weekend yet.</div>';
    var me = S.me && byId(S.me);
    var states = g.sessions.map(gpState);
    var live = states.indexOf("live") >= 0, started = states.some(function (x) { return x !== "upcoming"; });
    var scoredDone = g.sessions.filter(function (x, i) { return x.scored && states[i] !== "upcoming"; });
    var head = '<section class="result gp-h"><div class="result-h"><div class="result-t"><span class="lime">R' + g.W + '</span> <span class="sl">/</span> ' + esc(String(g.s.short || g.s.name).toUpperCase()) +
      "</div></div><div class=\"gp-sub\">" + (live ? '<span class="gpp live"><i></i>Live</span>' : g.final ? '<span class="gpp final">Final</span>' : started ? '<span class="gpp prov">Provisional</span>' : '<span class="gpp up">Upcoming</span>') +
      (g.s.sprint ? '<span class="gpp up">Sprint weekend</span>' : "") + "</div></section>";
    if (!me) return SUB("weekend") + head + '<section class="card youpick"><h2>Which team is yours?</h2>' + teamSelect() + "</section>";

    var team = (g.W <= M.N && me.team_[g.W] && me.team_[g.W].length ? me.team_[g.W] : me.picks).slice();
    var isD = function (id) { return (assetOf(id) || {}).type === "D"; };
    var wkPts = function (id) {
      var x = g.pts[id]; if (!x) return null;
      var t = 0, any = false;
      Object.keys(x).forEach(function (c) { t += x[c].p || 0; any = true; });
      return any ? t : null;
    };
    var anyPts = team.some(function (id) { return wkPts(id) != null; });
    var prov = team.reduce(function (t, id) { return t + (wkPts(id) || 0); }, 0);
    var official = g.final ? me.pts[g.W] : null;
    var total = official != null ? official : anyPts ? prov : null;
    var totalLabel = "Points";
    var rr = g.final ? me.roundRank[g.W] : null;

    var h = SUB("weekend") + head;
    h += '<section class="card"><div class="totw-h"><div><div class="k">' + totalLabel + '</div><div class="v gp-total">' + (total == null ? "–" : fmt(total)) + "</div></div>" +
      '<div class="ttl"><b>Your team</b><span>' + esc(g.s.name) + "</span></div>" +
      '<div class="r"><div class="k">' + (rr ? "In the round" : "Sessions") + '</div><div class="v">' + (rr ? ordM(rr) : scoredDone.length + "/" + g.sessions.filter(function (x) { return x.scored; }).length) + "</div></div></div>" +
      teamGrid(team.filter(isD).map(function (id) { return { id: id }; }), team.filter(function (id) { return !isD(id); }).map(function (id) { return { id: id }; }),
        function (x) { var p = wkPts(x.id); return p == null ? {} : { pts: p }; }) + "</section>";

    // every session, in order
    g.sessions.forEach(function (x, i) {
      var st = states[i];
      h += '<section class="card gp-s' + (st === "live" ? " is-live" : "") + '"><div class="gp-sh"><b>' + esc(x.name || GP_NAME[x.code] || x.code) + "</b>" + gpPill(st, g, x) + "</div>";
      if (st === "upcoming") { h += "</section>"; return; }
      if (!x.scored) {
        // practice / sprint qualifying: where your drivers finished
        var pos = x.pos || {}, drv = team.filter(isD);
        var have = drv.filter(function (id) { return pos[id]; }).sort(function (a, b) { return pos[a] - pos[b]; });
        h += have.length ? '<div class="gp-pos">' + have.map(function (id) {
          var a = assetOf(id);
          return '<span class="gpd" style="' + tc(teamColor(a.team)) + '"><b class="t' + medal(pos[id]) + '">P' + pos[id] + "</b>" + esc(a.short || splitName(a).last) + "</span>";
        }).join("") + (have.length < drv.length ? drv.filter(function (id) { return !pos[id]; }).map(function (id) { return '<span class="gpd out">' + esc(assetOf(id).short || "") + " –</span>"; }).join("") : "") + "</div>"
          : '<div class="gp-wait">' + (st === "live" ? "On track now" : "Results shortly after the session") + "</div>";
        h += "</section>";
        return;
      }
      // qualifying / sprint / race: each pick's points (and where a driver finished)
      var rows = team.map(function (id) { var v = (g.pts[id] || {})[x.code]; return { id: id, v: v }; });
      var got = rows.some(function (r) { return r.v; });
      if (!got) { h += '<div class="gp-wait">' + (st === "live" ? "Points appear as F1 scores the session" : "Waiting for F1's points") + "</div></section>"; return; }
      rows.sort(function (a, b) { return ((b.v && b.v.p) || 0) - ((a.v && a.v.p) || 0); });
      var sum = rows.reduce(function (t, r) { return t + ((r.v && r.v.p) || 0); }, 0);
      h += '<div class="gp-rows">' + rows.map(function (r) {
        var a = assetOf(r.id) || { name: "?", team: "" }, n = splitName(a);
        var where = r.v && r.v.nc ? "NC" : r.v && r.v.pos ? "P" + r.v.pos : "";
        return '<div class="gpr" style="' + tc(teamColor(a.team)) + '"><span class="ctile">' + (a.type === "C" ? pic(r.id, "logo", "clogo") : pic(r.id, "head", "chead")) + '</span><span class="cnm">' + esc(n.last) +
          '</span><span class="gpw' + (r.v && r.v.pos ? " t" + medal(r.v.pos) : "") + '">' + where + '</span><b class="' + (r.v && r.v.p < 0 ? "down" : "") + '">' + (r.v ? fmt(r.v.p) : "–") + "</b></div>";
      }).join("") + '</div><div class="gp-sum"><span>' + esc(x.name || GP_NAME[x.code]) + '</span><b>' + fmt(sum) + " pts</b></div></section>";
    });
    return h;
  }

  function viewStats() {
    var M = S.model, h = "";
    var n = M.managers.length;

    // Records
    h += SUB("records");
    h += '<div class="grid two">';
    h += '<section class="card"><h2>Highest rounds</h2><div class="rows ranked">' +
      M.records.top.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round), fmt(x.pts)); }).join("") + "</div></section>";
    h += '<section class="card"><h2>Lowest rounds</h2><div class="rows ranked">' +
      M.records.bottom.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round), fmt(x.pts)); }).join("") + "</div></section>";
    h += "</div><div style=\"height:14px\"></div>";

    // Best / worst weekends per manager + consistency
    h += SUB("weekends");
    h += '<section class="card"><h2>Best &amp; worst weekends</h2>';
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
    h += '<section class="card"><h2>Round honours</h2>';
    h += '<div class="tblwrap"><table><thead><tr><th class="l">Manager</th><th>Wins</th><th>Top 3</th><th>Last</th><th>Above avg</th><th>Led after</th></tr></thead><tbody>';
    M.managers.slice().sort(function (a, b) { return b.wins - a.wins || b.podiums - a.podiums || a.rank - b.rank; }).forEach(function (m) {
      h += '<tr class="click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '">' + whoCell(m) + '<td class="num">' + m.wins + "</td><td>" + m.podiums + "</td><td>" + m.lastPlace +
        "</td><td>" + m.aboveAvg + "/" + m.played + "</td><td>" + m.roundsLeading + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // Movement
    h += SUB("moves");
    h += '<div class="grid two">';
    h += '<section class="card"><h2>Biggest climbs</h2><div class="rows ranked">' +
      (M.records.rises.length ? M.records.rises.map(function (x, i) { return recRow(i + 1, x.m, roundLabel(x.round) + " · " + ordinal(x.from) + " → " + ordinal(x.to), '<span class="up">▲' + x.delta + "</span>"); }).join("") : '<div class="empty">None yet.</div>') + "</div></section>";
    h += '<section class="card"><h2>Biggest drops</h2><div class="rows ranked">' +
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
    h += '<section class="card"><h2>Team value &amp; transfers</h2>';
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
    return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + rk + "</div>" + avatar(m) + '<div class="main"><div class="n nmw"><span class="nmt">' + esc(m.name) + "</span>" + (isMe(m) ? youTag() : "") +
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
    var d = $("sheet"), Mo = window.F1FMotion;
    if (Mo) Mo.cancelClose(d);
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
    d.querySelector(".sheet-inner").scrollTop = 0;
    if (Mo) try { Mo.enter($("sheetBody"), 0); } catch (e) {}
  }
  function shutDialog(d) { if (d.open) { if (d.close) d.close(); else d.removeAttribute("open"); } }
  function closeSheet() { var d = $("sheet"); if (window.F1FMotion) window.F1FMotion.close(d, function () { shutDialog(d); }); else shutDialog(d); }

  /* a manager's season, in parts: the sheet shows them all, the Your profile tab one per sub-tab */
  function managerParts(m) {
    var M = S.model, n = M.managers.length, P = {};
    var o = {}; M.ownership.forEach(function (x) { o[x.id] = x; });
    P.head = "<h1>" + esc(m.name) + (isMe(m) ? youTag() : "") + '</h1><p class="lede">' + esc(m.team) + " · " + ordinal(m.rank) + " · " + fmt(m.total) + " pts" +
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
      return '<div class="row click" data-m="' + esc(x.id) + '"><div class="rk"><span class="' + "t" + medal(x.rank) + '">' + x.rank + "</span></div>" + avatar(x) + '<div class="main"><div class="n">' + lbl + ": " + esc(x.name) +
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
    var cmp = isMe(m) ? "" : '<button type="button" class="cmp-btn" data-compare="' + esc(m.id) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M17 4v16M3 8h8M13 16h8" /></svg>Compare with ' + (S.me && byId(S.me) ? "you" : "your team") + "</button>";
    openSheet(P.head + cmp + P.tiles + P.team + P.rounds);
  }

  /* ---------------- compare: you and another manager ---------------- */
  // both teams side by side for a chosen race, then the season in numbers
  function compareSheet(otherId) {
    var M = S.model, b = byId(otherId), a = S.me && byId(S.me);
    if (!b) return;
    if (!a || a === b) {
      openSheet("<h1>Compare</h1>" + '<section class="card youpick"><h2>Which team is yours?</h2>' + teamSelect() + "</section>");
      S.cmp = { b: b.id, pending: true };
      return;
    }
    var last = null;
    M.rounds.forEach(function (r) { if (a.pts[r] != null || b.pts[r] != null) last = r; });
    S.cmp = { a: a.id, b: b.id, r: last };
    var side = function (m, cls) {
      return '<div class="cmp-side ' + cls + '"><div class="cmp-rk"><span class="t' + medal(m.rank) + '">' + ordinal(m.rank) + "</span></div>" +
        '<div class="cmp-nm">' + esc(firstName(m)) + "</div><small>" + esc(m.team) + '</small><b class="cmp-pts">' + fmt(m.total) + "</b></div>";
    };
    var h = "<h1>Compare</h1>" + '<section class="cmp-h">' + side(a, "a") + '<div class="cmp-vs">VS</div>' + side(b, "b") + "</section>";
    if (last != null) {
      h += '<section class="card"><div class="cmp-bar"><h2>Teams</h2><select class="select cmpRound" aria-label="Race">' +
        M.rounds.slice().reverse().map(function (r) {
          return '<option value="' + r + '"' + (r === last ? " selected" : "") + ">R" + r + " · " + esc(M.roundInfo[r - 1].short) + "</option>";
        }).join("") + '</select></div><div id="cmpTeams">' + compareTeams(a, b, last) + "</div></section>";
    }
    h += compareForm(a, b);
    h += compareSeason(a, b);
    openSheet(h);
    var fc = document.querySelector("#sheet .fchart");
    if (fc) fc.scrollLeft = fc.scrollWidth; // open at the latest race
  }

  // Form: points each race as paired bars, then league position as two lines
  function compareForm(a, b) {
    var M = S.model, rounds = M.rounds.filter(function (r) { return a.pts[r] != null || b.pts[r] != null; });
    if (!rounds.length) return "";
    var G = 58, padX = 14, W = padX * 2 + rounds.length * G;
    var barTop = 22, barH = 130, posTop = barTop + barH + 46, posH = 96, axisY = posTop + posH + 34, H = axisY + 8;
    var hi = Math.max.apply(null, rounds.map(function (r) { return Math.max(a.pts[r] || 0, b.pts[r] || 0); })) || 1;
    var lo = Math.min(0, Math.min.apply(null, rounds.map(function (r) { return Math.min(a.pts[r] || 0, b.pts[r] || 0); })));
    var n = M.managers.length;
    var cx = function (i) { return padX + i * G + G / 2; };
    var by = function (v) { return barTop + barH - (v - lo) / (hi - lo) * barH; };
    var py = function (rk) { return posTop + (n > 1 ? (rk - 1) / (n - 1) : 0) * posH; };
    var g = '<svg class="fsvg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Form">';
    var zero = by(0);
    rounds.forEach(function (r, i) {
      [[a, "a", -11], [b, "b", 11]].forEach(function (x) {
        var v = x[0].pts[r];
        if (v == null) return;
        var X = cx(i) + x[2], top = Math.min(by(v), zero), h = Math.max(2, Math.abs(by(v) - zero));
        g += '<rect class="fb' + x[1] + '" x="' + (X - 9) + '" y="' + top.toFixed(1) + '" width="18" height="' + h.toFixed(1) + '" rx="4"/>';
        g += '<text class="fv" x="' + X + '" y="' + (Math.min(by(v), zero) - 5).toFixed(1) + '">' + fmt(v) + "</text>";
      });
      g += '<text class="fx" x="' + cx(i) + '" y="' + axisY + '">' + esc(abbr(roundName(r))) + "</text>";
    });
    // positions: the better of the two is labelled above its dot, the other below
    [[a, "a"], [b, "b"]].forEach(function (x) {
      var pts = [];
      rounds.forEach(function (r, i) { var rk = x[0].rankAt[r]; if (rk != null) pts.push([cx(i), py(rk), rk, r]); });
      if (pts.length > 1) g += '<path class="fl' + x[1] + '" d="' + pathOf(pts.map(function (p) { return [p[0], p[1]]; })) + '"/>';
      pts.forEach(function (p) {
        var other = (x[0] === a ? b : a).rankAt[p[3]];
        var above = other == null || p[2] < other || (p[2] === other && x[1] === "a");
        g += '<circle class="fd' + x[1] + '" cx="' + p[0] + '" cy="' + p[1].toFixed(1) + '" r="5"/>';
        g += '<text class="fp" x="' + p[0] + '" y="' + (above ? p[1] - 10 : p[1] + 19).toFixed(1) + '">' + ordinal(p[2]) + "</text>";
      });
    });
    g += "</svg>";
    var key = function (m, k) { return '<span class="fk"><i class="fk' + k + '"></i>' + esc(firstName(m)) + "</span>"; };
    return '<section class="card"><h2>Form</h2><div class="fkeys">' + key(a, "a") + key(b, "b") + '</div><div class="fwrap"><span class="fh" style="top:0">Points a race</span><span class="fh" style="top:' + (posTop - 38) + 'px">League position</span>' +
      '<div class="fchart">' + g + "</div></div></section>";
  }

  function compareTeams(a, b, r) {
    var pts = (S.data.assetPoints || {})[r] || {};
    var ta = a.team_[r] || [], tb = b.team_[r] || [];
    var byPts = function (x, y) { return (pts[y] || 0) - (pts[x] || 0); };
    var cell = function (id, same) {
      if (!id) return '<div class="cpick none"></div>';
      var A = assetOf(id) || { name: "?", type: "D", team: "" }, n = splitName(A);
      return '<div class="cpick' + (same ? " same" : "") + '" style="' + tc(teamColor(A.team)) + '">' +
        '<span class="ctile">' + (A.type === "C" ? pic(id, "logo", "clogo") : pic(id, "head", "chead")) + '</span><span class="cnm">' + esc(n.last) + "</span><b>" + fmt(pts[id]) + "</b></div>";
    };
    var block = function (type) {
      var A = ta.filter(function (id) { return (assetOf(id) || {}).type === type; });
      var B = tb.filter(function (id) { return (assetOf(id) || {}).type === type; });
      var same = A.filter(function (id) { return B.indexOf(id) >= 0; }).sort(byPts);
      var onlyA = A.filter(function (id) { return same.indexOf(id) < 0; }).sort(byPts);
      var onlyB = B.filter(function (id) { return same.indexOf(id) < 0; }).sort(byPts);
      var rows = same.map(function (id) { return cell(id, true) + cell(id, true); });
      for (var i = 0; i < Math.max(onlyA.length, onlyB.length); i++) rows.push(cell(onlyA[i]) + cell(onlyB[i]));
      return rows.join("");
    };
    var known = function (m) { return (m.team_[r] || []).length > 0; };
    var note = function (m) { return m.pts[r] == null ? "Not in the league yet" : "Team not published for this round"; };
    var h = "";
    if (!known(a) || !known(b)) {
      h += '<div class="cmp-grid">' + [a, b].map(function (m) { return known(m) ? "<div></div>" : '<div class="cpick none wide">' + esc(note(m)) + "</div>"; }).join("") + "</div>";
    }
    if (known(a) || known(b)) h += '<div class="cmp-grid">' + block("D") + '</div><div class="cmp-div"></div><div class="cmp-grid">' + block("C") + "</div>";
    var pa = a.pts[r], pb = b.pts[r], win = pa != null && pb != null ? (pa > pb ? "a" : pb > pa ? "b" : "") : "";
    var tot = function (m, k) {
      return '<div class="cmp-tot ' + k + (win === k ? " win" : "") + '"><b>' + fmt(m.pts[r]) + "</b><small>" + (m.roundRank[r] ? ordM(m.roundRank[r]) + " in the round" : "–") + "</small></div>";
    };
    return h + '<div class="cmp-grid">' + tot(a, "a") + tot(b, "b") + "</div>";
  }

  function compareSeason(a, b) {
    var M = S.model, W = S.prizes ? S.prizes.by : {};
    var h2h = { a: 0, b: 0 };
    M.rounds.forEach(function (r) { if (a.pts[r] == null || b.pts[r] == null) return; if (a.pts[r] > b.pts[r]) h2h.a++; else if (b.pts[r] > a.pts[r]) h2h.b++; });
    var net = function (m) { return W[m.id] ? W[m.id].net : null; };
    // [label, a, b, which is better ("high", "low" or none), shown as]
    var rows = [
      ["Position", a.rank, b.rank, "low", function (v) { return ordM(v); }],
      ["Points", a.total, b.total, "high"],
      ["Rounds won head to head", h2h.a, h2h.b, "high"],
      ["Average", a.avg, b.avg, "high"],
      ["Best round", a.best && a.best.pts, b.best && b.best.pts, "high"],
      ["Worst round", a.worst && a.worst.pts, b.worst && b.worst.pts, "high"],
      ["Round wins", a.wins, b.wins, "high"],
      ["Top-3 finishes", a.podiums, b.podiums, "high"],
      ["Highest position", a.bestRank, b.bestRank, "low", function (v) { return ordM(v); }],
      ["Team value", a.currentValue, b.currentValue, "high", money],
      ["Transfers", a.totalTransfers, b.totalTransfers, ""],
      ["Net XP", net(a), net(b), "high", function (v) { return v == null ? "–" : (v >= 0 ? "+" : "") + cur(v, true); }]
    ];
    return '<section class="card"><h2>Season</h2><div class="cmp-tbl">' + rows.map(function (x) {
      var f = x[4] || function (v) { return fmt(v); }, va = x[1], vb = x[2], wa = false, wb = false;
      if (x[3] && va != null && vb != null && f(va) !== f(vb)) { wa = x[3] === "high" ? va > vb : va < vb; wb = !wa; }
      return '<div class="cmp-row"><span class="v a' + (wa ? " win" : "") + '">' + f(va) + '</span><span class="k">' + esc(x[0]) + '</span><span class="v b' + (wb ? " win" : "") + '">' + f(vb) + "</span></div>";
    }).join("") + "</div></section>";
  }

  function teamSelect() {
    return '<select class="select meSelect" aria-label="Select your team"><option value="">Select your team…</option>' +
      S.model.managers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (isMe(m) ? " selected" : "") + ">" + esc(m.name) + " — " + esc(m.team) + "</option>";
      }).join("") + "</select>";
  }

  /* Your profile: your season, one part per sub-tab */
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
      return '<div class="row click' + (isMe(m) ? " me" : "") + '" data-m="' + esc(m.id) + '"><div class="rk">' + m.rank + "</div>" + avatar(m) + '<div class="main"><div class="n nmw"><span class="nmt">' + esc(m.name) + "</span>" + (isMe(m) ? youTag() : "") + '</div><div class="t">' + esc(m.team) + "</div></div></div>";
    }).join("") : '<div class="empty">Nobody in the league.</div>') + "</div></section>";
    openSheet(h);
  }

  /* ---------------- burger menu ---------------- */
  var ICON = {
    records: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />',
    weekends: '<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />',
    honours: '<circle cx="12" cy="14" r="6" /><path d="M8.5 3h7l-2 5.2M8.5 3l2 5.2M12 11.5v5" />',
    moves: '<path d="M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4" />',
    value: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" />',
    drivers: '<circle cx="12" cy="8" r="4.5" /><path d="M5 21c1-4.5 3.8-7 7-7s6 2.5 7 7M7.5 8h9" />',
    constructors: '<path d="M3 15h18l-2-5h-4l-1.5-3h-3L9 10H5zM6.5 18.5a1.8 1.8 0 1 0 0-.1M17.5 18.5a1.8 1.8 0 1 0 0-.1" />',
    trusted: '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z" />',
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
    [["stats", "Stats"], ["picks", "Picks"]].forEach(function (g) {
      var cur = S.tab === g[0] ? S.sub[g[0]] : null;
      h += '<div class="dr-h">' + g[1] + "</div>" + SUBS[g[0]].map(function (x) {
        return drItem({ icon: x[0], title: x[1], href: "#" + g[0] + "/" + x[0], on: x[0] === cur });
      }).join("");
    });
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
    if (window.F1FMotion) window.F1FMotion.cancelClose(d);
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
  }
  function closeDrawer() { var d = $("drawer"); if (window.F1FMotion) window.F1FMotion.close(d, function () { shutDialog(d); }); else shutDialog(d); }

  /* ---------------- settings ---------------- */
  function themeNow() { return document.documentElement.getAttribute("data-theme") || "dark"; }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    save("theme", t);
    var light = t === "light" || (t === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", light ? "#f2f2f7" : "#050506");
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
    var fn = { league: function () { return viewStandings() + viewPrizes(); }, races: viewRaces, you: viewYou, trends: viewTrends, gp: viewGP, stats: viewStats, picks: viewPicks }[S.tab];
    var cur = S.sub[S.tab] || SUBS[S.tab][0][0];
    // Stats is reached from the menu, which lists every section, so no pill row there
    $("subtabs").innerHTML = NO_SUBTABS[S.tab] ? "" : SUBS[S.tab].map(function (x) {
      return '<a href="#' + S.tab + "/" + x[0] + '" class="' + (x[0] === cur ? "on" : "") + '"' + (x[0] === cur ? ' aria-current="page"' : "") + ">" + esc(x[1]) + "</a>";
    }).join("");
    var on = $("subtabs").querySelector(".on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
    try {
      v.innerHTML = pickSub(fn(), cur);
      hydrateCharts(v);
    } catch (e) {
      if (window.console) console.error(e);
      v.innerHTML = '<div class="empty">This page couldn\'t be shown. Try another tab, or reopen the app.</div>';
    }
    // motion: a new page arrives from the side you're heading to; a refresh of the same page doesn't move
    var key = S.tab + "/" + cur, Mo = window.F1FMotion;
    if (Mo) {
      try {
        if (key !== S.lastView) {
          var a = TABS.indexOf(S.tab), b = S.lastView ? TABS.indexOf(S.lastView.split("/")[0]) : a;
          Mo.enter(v, a === b ? 0 : a > b ? 1 : -1);
        }
        Mo.toggle(v);
        Mo.tabs($("tabs"));
      } catch (e) { if (window.console) console.error(e); }
    }
    S.lastView = key;
  }
  function hydrateCharts(root) {
    root.querySelectorAll(".chartbox").forEach(function (box) {
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
    var cb = e.target.closest("[data-compare]");
    if (cb) { compareSheet(cb.getAttribute("data-compare")); return; }
    var t = e.target.closest("[data-focus],[data-m],[data-r],[data-a],[data-theme-set],[data-open],[data-round-nav]");
    if (!t) return;
    if (t.hasAttribute("data-round-nav")) {
      var nr = Number(t.getAttribute("data-round-nav"));
      if (nr >= 1 && nr <= S.model.N) roundSheet(nr);
      return;
    }
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
      S.me = e.target.value || null; save("me", S.me); S.hl = null; render();
      if ($("drawer").open) $("drawerBody").innerHTML = drawerHtml();
      // picked from the compare sheet: carry on to the comparison
      if (S.cmp && S.cmp.pending && $("sheet").open && S.me) { S.cmp.pending = false; if (S.me === S.cmp.b) managerSheet(S.cmp.b); else compareSheet(S.cmp.b); }
    }
    if (e.target.classList && e.target.classList.contains("cmpRound") && S.cmp) {
      var a = byId(S.cmp.a), b = byId(S.cmp.b), r = Number(e.target.value), box = $("cmpTeams");
      if (a && b && box && r >= 1 && r <= S.model.N) { S.cmp.r = r; box.innerHTML = compareTeams(a, b, r); if (window.F1FMotion) window.F1FMotion.swap(box); }
    }
  });
  $("sheetClose").addEventListener("click", closeSheet);
  // Escape (and Android back) close with the same animation
  $("sheet").addEventListener("cancel", function (e) { e.preventDefault(); closeSheet(); });
  $("drawer").addEventListener("cancel", function (e) { e.preventDefault(); closeDrawer(); });
  if (window.F1FMotion) {
    var Mo = window.F1FMotion;
    Mo.swipeToClose($("sheet"), $("sheet").querySelector(".sheet-inner"), function () { shutDialog($("sheet")); });
    Mo.presses();
    Mo.header(document.querySelector(".topbar"));
    document.addEventListener("click", function (e) { if (e.target.closest("#tabs a, .lbt a, [data-compare], .subtabs a")) Mo.haptic(); });
    window.addEventListener("resize", function () { Mo.tabs($("tabs")); });
  }
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
  setInterval(function () {
    if (!S.model || document.hidden) return;
    if (gpLive() || Date.now() - S.fetchedAt >= REFRESH_MS) refresh(true);
    if (S.tab === "gp") render(); else renderChrome();
  }, 60 * 1000);

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
  Promise.all([loadData(), photosReady]).then(function () { hideSplash(); route(); }, function (e) {
    hideSplash();
    if (window.console) console.error(e);
    $("view").innerHTML = '<div class="empty">Couldn\'t load the league data. Check your connection and reopen the app.</div>';
    $("subline").textContent = "Offline";
  });
  // a picture that can't load (offline, or gone) becomes the initials
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-ini")) return;
    var span = document.createElement("span");
    span.className = (img.className ? img.className + " " : "") + "noimg";
    span.textContent = img.getAttribute("data-ini");
    img.replaceWith(span);
  }, true);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  window.__f1f = S; // for tests and the curious
})();
