#!/usr/bin/env node
/* Prints "true" while a scored session (qualifying, sprint, race) is on or
   just finished, so the heartbeat polls F1 every few minutes instead of every
   ten: from 5 minutes before a session starts until 40 minutes after it ends
   (F1 keeps adjusting points just after the flag), or whenever F1 Fantasy
   marks a session live. Prints "false" otherwise, and whenever it can't tell.

   Usage: node scripts/session-live.js [data.json] */
"use strict";
const fs = require("fs");
const path = require("path");
const MIN = 60 * 1000;
let live = false;
try {
  const d = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "data.json"), "utf8"));
  const now = Date.now();
  (d.schedule || []).forEach((r) => (r.sessions || []).forEach((s) => {
    const a = Date.parse(s.start), b = Date.parse(s.end) || a + 2 * 60 * MIN;
    if (s.live === 1 || (isFinite(a) && now >= a - 5 * MIN && now <= b + 40 * MIN)) live = true;
  }));
} catch (e) { /* can't tell: normal pace */ }
console.log(live ? "true" : "false");
