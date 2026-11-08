// Service worker: оболочка приложения кэшируется сразу, контент — «сначала сеть, потом кэш»,
// картинки, аудио и шрифты — «сначала кэш» (их докачивает downloadAll в main.js).
const VERSION = 'bayan-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/content.js', 'js/arabic.js', 'js/store.js', 'js/srs.js', 'js/tts.js', 'js/check.js',
  'js/ui.js', 'js/cardview.js', 'js/lesson.js', 'js/screens.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'content/course.json', 'content/lexicon-base.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('bayan-v') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isMedia = /\.(jpg|jpeg|png|webp|mp3|m4a)$/.test(url.pathname) || url.host.includes('fonts.g');
  if (isMedia) {
    // сначала кэш (медиа и шрифты не меняются), иначе сеть + сохранить
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(url.host.includes('fonts.g') ? 'bayan-fonts' : 'bayan-media-v1').then(c => c.put(e.request, copy)); }
      return r;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // код и контент: сначала сеть (чтобы правки доходили сразу), без сети — кэш
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
