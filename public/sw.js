/*
 * Roleplay Studio service worker.
 *
 * This worker exists only so the app can be installed as a PWA. It caches
 * NOTHING. In particular it must never intercept API calls or the login flow:
 * those must always hit the network so that auth responses and /login redirects
 * are never served from, or stored in, a cache.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only same-origin GETs are eligible. Anything else (POST/PUT/PATCH/DELETE,
  // cross-origin) is left entirely to the browser.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never touch the API or the login page. Not calling respondWith() lets the
  // browser do a normal network request with no service-worker cache involved,
  // so 401s and /login redirects are always fresh and never cached.
  if (url.pathname.startsWith("/api/") || url.pathname === "/login") return;

  // Everything else: a straight pass-through to the network, no caching.
  event.respondWith(fetch(request));
});
