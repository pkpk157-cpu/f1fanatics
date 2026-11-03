#!/usr/bin/env node
/* Writes BUILD in sw.js: a hash of every file the worker stores for a
   release, so phones pick up a new release exactly when the app changes.
     node scripts/stamp-sw.js          write it
     node scripts/stamp-sw.js --check  exit 1 if it is out of date
   check-sources.js runs the check on every push. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const SW = path.join(ROOT, "sw.js");
const src = fs.readFileSync(SW, "utf8");
const list = /const ASSETS = \[([\s\S]*?)\];/.exec(src);
if (!list) throw new Error("sw.js: no ASSETS list");
const files = [...list[1].matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
const h = crypto.createHash("sha256");
files.forEach((f) => { h.update(f + "\0"); h.update(fs.readFileSync(path.join(ROOT, f))); h.update("\0"); });
h.update(src.replace(/const BUILD = "[^"]*";/, ""));
const build = h.digest("hex").slice(0, 12);
const cur = (/const BUILD = "([^"]*)";/.exec(src) || [])[1];
if (process.argv.includes("--check")) {
  if (cur !== build) { console.log("sw.js BUILD is " + cur + ", the files make it " + build + ": run node scripts/stamp-sw.js"); process.exit(1); }
  console.log("sw.js BUILD " + build + " matches the release");
} else {
  fs.writeFileSync(SW, src.replace(/const BUILD = "[^"]*";/, 'const BUILD = "' + build + '";'));
  console.log("sw.js BUILD " + build);
}
