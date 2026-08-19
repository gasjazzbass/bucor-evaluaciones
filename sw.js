/* Service worker mínimo y "transparente".
   Solo existe para que el navegador ofrezca "Instalar app" (PWA autónoma).
   NO intercepta ni cachea recursos: todo (HTML/CSS/JS/imágenes/datos) se trae
   siempre de la red, igual que en el navegador. Así la app nunca se ve "sin diseño"
   por un caché viejo o roto. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Borra cualquier caché de versiones anteriores del service worker.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Handler de fetch presente (requisito para instalar) pero SIN respondWith:
// el navegador maneja cada pedido normalmente, contra la red.
self.addEventListener("fetch", () => {});

/* ---------- Notificaciones push ---------- */
const APP_URL = "https://gasjazzbass.github.io/bucor-evaluaciones/";

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Bucor · Evaluación";
  const options = {
    body: d.body || "",
    icon: "img/icon-192.png",
    badge: "img/icon-192.png",
    tag: d.tag || undefined,          // agrupa avisos del mismo alumno
    renotify: !!d.tag,
    data: { url: d.url || APP_URL },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || APP_URL;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(APP_URL) && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
