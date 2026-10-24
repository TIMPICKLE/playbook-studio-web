const CACHE = 'playbook-studio-v3.6.2';
const FILES = ['./viewport-layout.js', './data/madden-editable-seed.js', './data/madden-editable-batch.js', './data/madden-trace-status.js', './data/madden-editable.js', './reconcile.js', './madden.js', './madden-model.js', './madden.css', './data/huddle-catalog.json', './index.html', './styles.css', './cloud.css', './interaction.css', './glass.css', './board-layout.css', './board-layout.js', './effects.js', './vendor/tsparticles.slim-4.4.0.min.js', './app.js', './model.js', './field.js', './motion.js', './cloud.js', './sync.js', './ui.js', './icon.svg', './assets/stingers-mark.png', './assets/stingers-bolt.svg', './assets/stingers-star.svg', './manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('playbook-studio-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname.startsWith('/api/') || ['/signin-with-chatgpt','/signout-with-chatgpt','/callback'].includes(new URL(event.request.url).pathname)) return;
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
