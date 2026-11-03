#!/usr/bin/env node
/* Checks data.json against F1's own numbers, on every update.

   Never blocks publishing (fresh data beats stale data), but every
   disagreement shows up as a warning on the workflow run:
     - each manager's per-round scores (list_2) sum to their standings total
       (list_1); a manager who joined late is reported, not flagged
     - standings order agrees with the totals
     - every pick resolves to a driver or constructor, 5 + 2 per team
     - prices exist for every round raced
     - a round F1 has raced but not yet scored is reported
   It also recomputes the whole model the app renders, so a change to
   compute.js that throws on real data fails here before it reaches a phone.

   Exit 1 only when data.json is unreadable or the model cannot be built. */
"use strict";
const fs = require("fs");
const path = require("path");
const F1F = require("../compute.js");

const file = path.resolve(__dirname, "..", process.argv[2] || "data.json");
let data;
try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.log("::error::" + path.basename(file) + " is not readable JSON: " + e.message); process.exit(1); }

const res = F1F.verify(data);
res.errors.forEach((x) => console.log("::warning title=Data check failed::" + x));
res.warnings.forEach((x) => console.log("::warning::" + x));
res.notes.forEach((x) => console.log("note: " + x));

let model;
try { model = F1F.build(data); }
catch (e) { console.log("::error::compute.js cannot build the model from this data: " + (e.stack || e.message)); process.exit(1); }

const sumCheck = model.managers.filter((m) => m.preJoin === 0)
  .every((m) => Math.abs(Object.values(m.pts).reduce((a, b) => a + (b || 0), 0) - m.total) < 0.01);
console.log(
  (res.ok && !res.warnings.length ? "OK" : "CHECK") + ": " + model.N + " rounds, " + model.managers.length + " managers, sync=" + res.sync +
  ", per-round sums " + (sumCheck ? "match" : "DO NOT match") + " the standings; leader " + model.leader.name + " on " + model.leader.total
);
