/* F1 Fanatics — service worker.

   The app shell (page, styles, scripts, icons) opens from the phone, every
   file from one stored release, and never waits on the network. A new release
   is fetched in the background and takes over on the next open.

   BUILD is a hash of the release's files, written by scripts/stamp-sw.js and
   checked on every push: it changes when, and only when, the app does — not
   when the data updater publishes a new data.json. data.json is never cached
   here; app.js keeps its own last copy for offline. */
const BUILD = "0a0a170be862";
const CACHE = "f1f-" + BUILD;
// Driver photos, kept across releases: they don't change with one.
const PHOTOS = "f1fphotos";
const ASSETS = [
  "./index.html", "./styles.css", "./config.js", "./compute.js", "./rules.js", "./motion.js", "./app.js",
  "./manifest.json", "./icon-192.png", "./favicon-64.png", "./logo.webp",
  "./fonts/titillium-700.woff2", "./fonts/titillium-900.woff2"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: "no-cache" })).then((res) => {
        if (!res.ok) throw new Error(a + " " + res.status);
        return c.put(a, res);
      }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("f1f-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const SHELL = new Set(ASSETS.map((a) => new URL(a, self.location).pathname));
const INDEX = new URL("./index.html", self.location).pathname;
SHELL.add(new URL("./", self.location).pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/data.json")) return;
  // A photo's URL carries its version (?v=…): a new version replaces the old
  // copy instead of piling up beside it.
  if (/\/photos\/[^/]+\.webp$/.test(url.pathname)) {
    e.respondWith(caches.open(PHOTOS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        c.keys().then((keys) => Promise.all(keys.filter((k) => new URL(k.url).pathname === url.pathname).map((k) => c.delete(k))))
          .then(() => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))));
    return;
  }
  // Which photos exist: the newest list when online, the last one offline.
  if (url.pathname.endsWith("/photos/index.json")) {
    e.respondWith(caches.open(PHOTOS).then((c) => fetch(req).then((res) => {
      if (res.ok) c.put(url.pathname, res.clone()).catch(() => {});
      return res;
    }).catch(() => c.match(url.pathname).then((hit) => hit || Response.json({})))));
    return;
  }
  if (!SHELL.has(url.pathname)) return;
  const key = url.pathname.endsWith("/") ? INDEX : url.pathname;
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(key, { ignoreSearch: true }).then((hit) => hit || fetch(req)))
  );
});
