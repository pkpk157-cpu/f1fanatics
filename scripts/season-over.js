#!/usr/bin/env node
/* Prints "true" once the season is over: three days after the last race in
   data.json's calendar once every round is scored (time for late corrections
   to land), or two weeks after it regardless. Prints "false"
   otherwise, and also whenever it can't tell, so the clock never stops by
   mistake. Used by the heartbeat and the updater's backstop schedule.

   Usage: node scripts/season-over.js [data.json] */
"use strict";
const fs = require("fs");
const path = require("path");
const GRACE_MS = 3 * 24 * 3600 * 1000;
let over = false;
try {
  const d = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "data.json"), "utf8"));
  const times = (d.schedule || []).map((s) => Date.parse(s.race || s.lock)).filter((t) => isFinite(t));
  const N = d.roundsPlayed || 0;
  if (times.length) {
    const since = Date.now() - Math.max(...times);
    // every round scored and three days gone, or two weeks gone regardless
    over = (N >= d.schedule.length && since > GRACE_MS) || since > 14 * 24 * 3600 * 1000;
  }
} catch (e) { /* can't tell: keep going */ }
console.log(over ? "true" : "false");
