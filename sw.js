/*
 * Mythbound service worker: makes the game installable and lets it open offline.
 * - Network first: online behaviour is unchanged; the cache is only a fallback.
 * - Only same-origin GETs inside the app scope (/mythbound/) are handled.
 *   Cross-origin requests and anything that looks like an API call are never
 *   intercepted or cached. Game saves live in localStorage, not here. WebSockets are never touched.
 * - Cloud saves (v2.1): Google sign-in and Firestore traffic (googleapis.com, gstatic.com, firebaseapp.com, google.com,
 *   googleusercontent.com, firebaseio.com) is explicitly network-only: never intercepted, never cached.
 * - Co-op (v2.2): Firestore signaling and the Realtime Database relay (firebaseio.com, firebasedatabase.app) are
 *   network-only too. WebRTC data channels and STUN never pass through a service worker.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v2.2.0";
const CACHE = `mythbound-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const PRECACHE = [
  "./", "index.html", "style.css", "manifest.webmanifest", "favicon.png",
  "vendor/three.module.min.js",
  "js/main.js", "js/config.js", "js/game.js", "js/shared.js", "js/avatar.js", "js/world.js", "js/dungeon.js",
  "js/enemies.js", "js/building.js", "js/input.js", "js/net.js", "js/ui.js",
  "js/ridge.js", "js/mine.js", "js/audio.js", "js/pets.js", "js/rpg.js", "js/story.js", "js/systems.js", "js/install.js", "assets/logo.webp",
  "js/cloud.js", "js/cloud-ui.js", "js/firebase-config.js",
  "js/coop.js", "js/coop-net.js", "js/coop-ui.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];
const NEVER = ["sw.js"];
// Auth / Firestore hosts: always straight to the network (popup + redirect sign-in, token refresh, Firestore channels).
const NETWORK_ONLY = /(^|\.)(googleapis\.com|gstatic\.com|firebaseapp\.com|firebaseio\.com|firebasedatabase\.app|firebasestorage\.app|web\.app|google\.com|googleusercontent\.com)$/i;

function handled(req) {
  const u = new URL(req.url);
  if (NETWORK_ONLY.test(u.hostname) || u.pathname.startsWith("/__/auth/")) return false; // network-only
  if (req.method !== "GET" || req.headers.has("range")) return false;
  if (u.origin !== SCOPE.origin || !u.pathname.startsWith(SCOPE.pathname)) return false;
  const rel = u.pathname.slice(SCOPE.pathname.length);
  if (NEVER.includes(rel)) return false;
  if (/(^|\/)api(\/|$)/i.test(rel) || /\.json$/i.test(rel)) return false; // never cache API/data calls
  const accept = req.headers.get("accept") || "";
  if (req.mode !== "navigate" && accept.includes("application/json")) return false;
  return true;
}
const key = (req) => { const u = new URL(req.url); u.hash = ""; if (req.mode === "navigate") u.search = ""; return u.href; };

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((p) => {
    const url = new URL(p, SCOPE).href;
    return fetch(new Request(url, { cache: "reload" })).then((r) => r.ok && c.put(url, r)).catch(() => {});
  }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("mythbound-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (!handled(req)) return; // browser handles it normally
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key(req), copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const c = await caches.open(CACHE);
      const hit = (await c.match(key(req))) || (await c.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      if (req.mode === "navigate") { const shell = (await c.match(new URL("./", SCOPE).href)) || (await c.match(new URL("index.html", SCOPE).href)); if (shell) return shell; }
      throw err;
    }
  })());
});
