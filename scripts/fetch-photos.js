#!/usr/bin/env node
/* Mirrors driver headshots, constructor cars and constructor logos into
   photos/, so the app never loads anything from F1's image server.

   Run by .github/workflows/photos.yml (GitHub's runners reach
   media.formula1.com; nothing else here needs to). The sources come from
   data.json, which fetch-data.js fills from F1 Fantasy's own image config.
   Needs sharp (installed by the workflow, outside the repository).

     node scripts/fetch-photos.js            fetch what's missing
     node scripts/fetch-photos.js --force    fetch everything again

   A picture that can't be fetched is skipped: the app shows initials. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "photos");
const force = process.argv.includes("--force");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
fs.mkdirSync(DIR, { recursive: true });

// the URL carries a hash of the picture, so a changed picture is a new URL
// and the app's photo cache never serves a stale one
const ref = (file) => "photos/" + file + "?v=" + crypto.createHash("sha1").update(fs.readFileSync(path.join(DIR, file))).digest("hex").slice(0, 8);

const SIZE = {
  head: (img) => img.resize(256, 256, { fit: "cover", position: "top" }),
  car: (img) => img.trim().resize({ width: 480, withoutEnlargement: true }),
  logo: (img) => img.trim().resize({ height: 72, withoutEnlargement: true })
};

async function grab(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { "user-agent": "f1fanatics-league-tracker" } });
      if (!res.ok) { console.log("  " + res.status + " " + url); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) continue;
      return buf;
    } catch (e) { console.log("  " + e.message + " " + url); }
  }
  return null;
}

(async () => {
  const index = {};
  let fetched = 0, kept = 0, failed = 0;
  for (const [id, a] of Object.entries(data.assets || {})) {
    for (const kind of Object.keys(a.img || {})) {
      const file = `${kind}-${id}.webp`;
      const out = path.join(DIR, file);
      if (!force && fs.existsSync(out)) { (index[id] = index[id] || {})[kind] = ref(file); kept++; continue; }
      const buf = await grab(a.img[kind]);
      if (!buf) { console.log("no " + kind + " for " + a.name); failed++; continue; }
      try {
        await SIZE[kind](sharp(buf)).webp({ quality: 82, alphaQuality: 90 }).toFile(out);
        (index[id] = index[id] || {})[kind] = ref(file);
        fetched++;
        console.log("ok " + kind + " " + a.name);
      } catch (e) { console.log("could not convert " + kind + " for " + a.name + ": " + e.message); failed++; }
    }
  }
  // keep pictures of anyone who has left the feed: old rounds still show them
  for (const f of fs.readdirSync(DIR)) {
    const m = /^(head|car|logo)-(\d+)\.webp$/.exec(f);
    if (m && !(index[m[2]] && index[m[2]][m[1]])) (index[m[2]] = index[m[2]] || {})[m[1]] = ref(f);
  }
  fs.writeFileSync(path.join(DIR, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`photos: ${fetched} fetched, ${kept} already here, ${failed} unavailable`);
})().catch((e) => { console.error(e); process.exit(1); });
