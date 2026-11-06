/* F1 Fanatics — motion.
   Entrances, counting numbers, drawn charts, the sliding tab highlight and
   Points / XP thumb, sheets that spring up and can be swiped away, and press
   feedback. Only transform and opacity are animated, so it stays smooth on a
   phone. Everything is skipped when the phone asks for reduced motion, and
   nothing here is needed for the app to work: app.js calls it if it exists. */
(function () {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function on() { return !(mq && mq.matches); }
  function raf(f) { return (window.requestAnimationFrame || setTimeout)(f); }
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  /* ---------- a view or sheet arriving ---------- */
  var STAGGER = ".result-h, .pod, .rrow, .card, .figs, .acard, .arow, .row, .you-h, .chips, .cmp-h, .cmp-side";
  function enter(root, dir) {
    if (!root || !on()) return;
    root.classList.remove("mv-in", "mv-l", "mv-r", "mv-f");
    void root.offsetWidth; // restart the animation
    var n = 0;
    root.querySelectorAll(STAGGER).forEach(function (el) {
      // only what is on screen (or just below) gets a delay, so nothing waits long
      var r = el.getBoundingClientRect();
      el.style.setProperty("--i", r.top < window.innerHeight * 1.2 ? Math.min(n++, 16) : 0);
    });
    root.querySelectorAll(".fsvg rect").forEach(function (el, i) { el.style.setProperty("--b", i >> 1); });
    root.classList.add("mv-in", dir > 0 ? "mv-r" : dir < 0 ? "mv-l" : "mv-f");
    countUp(root);
    drawLines(root);
    clearTimeout(root._mvT);
    root._mvT = setTimeout(function () { root.classList.remove("mv-in", "mv-l", "mv-r", "mv-f"); }, 1400);
  }

  /* ---------- numbers count up to their value ---------- */
  var COUNT = ".pod-name .pp b, .rpts b, .fig b, .cmp-pts, .cmp-tot b, .xpt td.tot";
  function countUp(root) {
    root.querySelectorAll(COUNT).forEach(function (el) {
      var txt = el.textContent, m = /^([+−-]?)([\d,]+)$/.exec(txt.trim());
      if (!m) return;
      var target = parseInt(m[2].replace(/,/g, ""), 10);
      if (!(target >= 10)) return;
      var t0 = null, dur = 650 + Math.min(450, target / 60);
      el.classList.add("mv-num");
      (function step(ts) {
        if (!el.isConnected) return;
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        el.textContent = p >= 1 ? txt : m[1] + Math.round(target * easeOut(p)).toLocaleString("en-GB");
        if (p < 1) raf(step);
      })(performance.now());
    });
  }

  /* ---------- chart lines draw themselves ---------- */
  function drawLines(root) {
    root.querySelectorAll(".chart path.series, .fsvg path").forEach(function (p) {
      var len;
      try { len = p.getTotalLength(); } catch (e) { return; }
      if (!(len > 0)) return;
      p.style.transition = "none";
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      void p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset 1s cubic-bezier(.3,.7,.2,1) .1s";
      p.style.strokeDashoffset = 0;
      setTimeout(function () { p.style.transition = p.style.strokeDasharray = p.style.strokeDashoffset = ""; }, 1300);
    });
  }

  /* a part of a sheet that changed in place (the Compare race picker) */
  function swap(el) {
    if (!el || !on()) return;
    el.classList.remove("mv-swap"); void el.offsetWidth; el.classList.add("mv-swap");
  }

  /* ---------- the red highlight glides between tabs ---------- */
  function tabs(bar) {
    if (!bar) return;
    var ind = bar.querySelector(".tab-ind");
    if (!ind) { ind = document.createElement("span"); ind.className = "tab-ind"; ind.setAttribute("aria-hidden", "true"); bar.insertBefore(ind, bar.firstChild); bar.classList.add("has-ind"); }
    var a = bar.querySelector("a.active");
    if (!a) { ind.style.opacity = 0; return; }
    var first = !ind._placed;
    if (first || !on()) ind.style.transition = "none";
    ind.style.opacity = 1;
    ind.style.width = a.offsetWidth + "px";
    ind.style.height = a.offsetHeight + "px";
    ind.style.transform = "translate(" + a.offsetLeft + "px," + a.offsetTop + "px)";
    if (first || !on()) { void ind.offsetWidth; ind.style.transition = ""; }
    ind._placed = true;
  }

  /* ---------- the Points / XP thumb slides ---------- */
  var lastThumb = null;
  function toggle(root) {
    var box = root && root.querySelector(".lbt");
    if (!box) return;
    var a = box.querySelector("a.on"); if (!a) return;
    var th = document.createElement("span"); th.className = "lbt-thumb"; th.setAttribute("aria-hidden", "true");
    box.insertBefore(th, box.firstChild); box.classList.add("has-thumb");
    var to = { x: a.offsetLeft, w: a.offsetWidth };
    var from = lastThumb && on() ? lastThumb : to;
    th.style.transition = "none";
    th.style.width = from.w + "px"; th.style.transform = "translateX(" + from.x + "px)";
    void th.offsetWidth;
    th.style.transition = "";
    th.style.width = to.w + "px"; th.style.transform = "translateX(" + to.x + "px)";
    lastThumb = to;
  }

  /* ---------- sheets: spring up, animate closed, swipe down to dismiss ---------- */
  function close(d, done) {
    if (!d || !d.open) return;
    if (!on() || d._closing) { clearTimeout(d._closeT); finish(); return; }
    d._closing = true;
    d.classList.add("closing");
    d._closeT = setTimeout(finish, 230);
    function finish() {
      d._closing = false;
      d.classList.remove("closing");
      d.style.transform = ""; d.style.transition = "";
      if (done) done(); else if (d.close) d.close(); else d.removeAttribute("open");
    }
  }
  // a sheet asked to open again while it is closing: stay open
  function cancelClose(d) {
    if (!d || !d._closing) return;
    clearTimeout(d._closeT); d._closing = false;
    d.classList.remove("closing"); d.style.transform = ""; d.style.transition = "";
  }
  function swipeToClose(d, inner, done) {
    if (!d || !inner) return;
    var y0 = null, x0 = 0, dy = 0, t0 = 0, active = false;
    inner.addEventListener("touchstart", function (e) {
      if (!on() || e.touches.length !== 1 || inner.scrollTop > 0) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; t0 = Date.now(); active = false;
    }, { passive: true });
    inner.addEventListener("touchmove", function (e) {
      if (y0 == null) return;
      var y = e.touches[0].clientY - y0, x = e.touches[0].clientX - x0;
      if (!active) {
        // only a clear downward pull at the top of the sheet; sideways swipes stay with charts and tables
        if (y > 8 && y > Math.abs(x) * 1.4 && inner.scrollTop <= 0) { active = true; d.style.transition = "none"; }
        else if (Math.abs(x) > 10 || y < -4) { y0 = null; return; }
        else return;
      }
      e.preventDefault();
      dy = Math.max(0, y);
      d.style.transform = "translateY(" + (dy < 120 ? dy : 120 + (dy - 120) * 0.55) + "px)";
    }, { passive: false });
    function end() {
      if (y0 == null || !active) { y0 = null; return; }
      y0 = null; active = false;
      var v = dy / Math.max(1, Date.now() - t0);
      d.style.transition = "transform .26s cubic-bezier(.2,.8,.2,1)";
      if (dy > 110 || v > 0.7) {
        d.style.transform = "translateY(110%)";
        setTimeout(function () { d.style.transform = ""; d.style.transition = ""; if (done) done(); }, 240);
      } else {
        d.style.transform = "";
        setTimeout(function () { d.style.transition = ""; }, 280);
      }
    }
    inner.addEventListener("touchend", end, { passive: true });
    inner.addEventListener("touchcancel", end, { passive: true });
  }

  /* ---------- a tiny tap on phones that can (Android) ---------- */
  function haptic() { try { if (on() && navigator.vibrate) navigator.vibrate(6); } catch (e) {} }

  /* ---------- press feedback for anything tappable ---------- */
  var PRESS = ".rrow[data-r], .rrow[data-m], .pod, .row.click, .acard, .arow, .chip, .fig, .cmp-btn, .lbt a, .subtabs a, .dr-item, .tabbar a, .rnav, .iconbtn";
  function presses() {
    var cur = null;
    var up = function () { if (cur) { cur.classList.remove("pressed"); cur = null; } };
    document.addEventListener("pointerdown", function (e) {
      if (!on() || (e.pointerType === "mouse" && e.button !== 0)) return;
      var el = e.target.closest && e.target.closest(PRESS);
      if (!el) return;
      cur = el; el.classList.add("pressed");
    }, { passive: true });
    ["pointerup", "pointercancel", "pointerleave", "scroll"].forEach(function (ev) { document.addEventListener(ev, up, { passive: true, capture: ev === "scroll" }); });
  }

  /* ---------- the header gains depth once the page scrolls ---------- */
  function header(bar) {
    if (!bar) return;
    var ticking = false;
    var set = function () { ticking = false; bar.classList.toggle("scrolled", window.scrollY > 6); };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; raf(set); } }, { passive: true });
    set();
  }

  window.F1FMotion = { on: on, enter: enter, swap: swap, tabs: tabs, toggle: toggle, close: close, cancelClose: cancelClose, swipeToClose: swipeToClose, haptic: haptic, presses: presses, header: header };
})();
