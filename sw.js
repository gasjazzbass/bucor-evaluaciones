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
