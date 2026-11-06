#!/usr/bin/env node
/* Every source file parses, every workflow is valid YAML, and sw.js's BUILD
   matches the app files. Run by .github/workflows/ci.yml on every push. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let bad = 0;
const fail = (f, why) => { bad++; console.log("FAIL " + f + " — " + why); };

const js = ["app.js", "motion.js", "compute.js", "config.js", "rules.js", "sw.js"]
  .concat(fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".js")).map((f) => "scripts/" + f))
  .concat(fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".js")).map((f) => "tests/" + f));
js.forEach((f) => {
  try { new vm.Script(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^#!.*\n/, ""), { filename: f }); }
  catch (e) { fail(f, e.message); }
});

["manifest.json", "data.json"].forEach((f) => {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (e) { fail(f, e.message); }
});

let yaml = null;
try { yaml = require("js-yaml"); } catch (e) { console.log("(js-yaml not installed; workflows checked crudely)"); }
const wf = path.join(ROOT, ".github/workflows");
fs.readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).forEach((f) => {
  const src = fs.readFileSync(path.join(wf, f), "utf8");
  if (/\t/.test(src)) fail(f, "contains a tab");
  if (yaml) {
    try { const d = yaml.load(src); if (!d || !d.jobs || !Object.keys(d.jobs).length) fail(f, "no jobs"); }
    catch (e) { fail(f, e.message.split("\n")[0]); }
  } else if (!/^jobs:/m.test(src)) fail(f, "no jobs: block");
});

// every file the page and the worker load exists
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
[...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).forEach((f) => {
  if (!fs.existsSync(path.join(ROOT, f))) fail("index.html", "references missing " + f);
});

try { execFileSync(process.execPath, [path.join(__dirname, "stamp-sw.js"), "--check"], { stdio: "inherit" }); }
catch (e) { fail("sw.js", "BUILD is stale — run node scripts/stamp-sw.js"); }

console.log(bad ? bad + " problem(s)" : "All sources OK (" + js.length + " scripts)");
process.exit(bad ? 1 : 0);
