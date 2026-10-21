/* SOL Signal service worker. Bump VERSION to roll out a new cache. */
const VERSION = "v2";
const CACHE = `sol-signal-${VERSION}`;
const PRECACHE = ["/offline", "/icon.svg", "/icons/192", "/icons/512"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(PRECACHE);
      // Also cache the build assets the offline page needs, so it renders styled without a network.
      const html = await (await c.match("/offline")).text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) || [])];
      await c.addAll(assets).catch(() => {});
    }),
  );
  // No skipWaiting here: the page shows "Update available" and the user opts in (see SKIP_WAITING).
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sol-signal-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always network (market data must never be served stale as live); offline page as fallback.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }
  // Hashed build assets are immutable: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
  // Everything else (APIs included) goes straight to the network.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { notification: { title: "SOL Signal", body: event.data ? event.data.text() : "" } };
  }
  // Payloads use the Declarative Web Push shape: { web_push: 8030, notification: {...} }.
  const n = data.notification || data;
  event.waitUntil(
    self.registration.showNotification(n.title || "SOL Signal", {
      body: n.body || "",
      icon: "/icons/192",
      badge: "/icons/192",
      tag: n.tag,
      lang: n.lang,
      dir: n.dir,
      data: { url: n.navigate || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const same = wins.find((w) => new URL(w.url).origin === target.origin);
      if (same) return same.focus().then((w) => (w && "navigate" in w ? w.navigate(target.href) : undefined));
      return self.clients.openWindow(target.href);
    }),
  );
});

// Some browsers rotate subscriptions; re-subscribe and tell the server to replace the old one.
self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  event.waitUntil(
    (event.newSubscription
      ? Promise.resolve(event.newSubscription)
      : self.registration.pushManager.subscribe(old ? old.options : { userVisibleOnly: true })
    ).then((sub) =>
      fetch("/api/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: old ? old.endpoint : undefined }),
      }),
    ),
  );
});
