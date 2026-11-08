// Точка входа: загрузка контента, тема, роутер, нижняя панель, офлайн-кэш.
import C, { loadAll, allWeeks } from './content.js';
import * as store from './store.js';
import * as tts from './tts.js';
import { h, icon, closeSheet, toast } from './ui.js';
import { openLesson } from './lesson.js';
import { pathScreen, weekScreen, cardsScreen, dictScreen, progressScreen, settingsScreen } from './screens.js';
import * as srs from './srs.js';

const view = document.getElementById('view');

// ---------- тема и «лёгкий» режим ----------
function applyLook() {
  const s = store.settings();
  const root = document.documentElement;
  if (s.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', s.theme);
  // стекло включено только на 3–5 элементах; «лёгкий» режим — если размытие не поддерживается
  // или его включили вручную (плотная заливка вместо blur)
  const blurOK = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  const lite = s.lite === 'on' || (s.lite === 'auto' && (!blurOK || (navigator.hardwareConcurrency || 8) <= 2));
  root.classList.toggle('lite', !!lite);
  // на сенсорных экранах без анимации смены экранов (iPhone от неё подтормаживал в Jom Cakap)
  root.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#060D0A' : '#E3EDE0');
}

// ---------- нижняя панель ----------
const TABS = [['#/', 'path', 'Путь'], ['#/cards', 'cards', 'Карточки'], ['#/dict', 'book', 'Словарь'], ['#/progress', 'chart', 'Прогресс']];
const tabbar = h('nav.tabbar.glass', { 'aria-label': 'Разделы' },
  TABS.map(([href, ic, t]) => h('a.tb', { href }, icon(ic), h('span', t), ic === 'cards' ? h('i.badge') : null)));
document.body.append(tabbar);

function updateTabs(hash) {
  tabbar.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('on', href === '#/' ? (hash === '#/' || hash.startsWith('#/week')) : hash.startsWith(href));
  });
  const n = srs.queue().list.length;
  const b = tabbar.querySelector('.badge');
  b.textContent = n > 99 ? '99+' : n || '';
  b.classList.toggle('on', n > 0);
}

// ---------- роутер ----------
function route() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/');
  closeSheet();
  tts.stop();
  const inLesson = parts[0] === 'lesson';
  document.body.classList.toggle('in-lesson', inLesson);
  updateTabs(hash);
  window.scrollTo(0, 0);
  const swap = () => {
    switch (parts[0]) {
      case '': pathScreen(view); break;
      case 'week': weekScreen(view, parts[1], parts[2]); break;
      case 'lesson':
        if (!C.lessons[parts[1]]) { location.hash = '#/'; return; }
        openLesson(view, parts[1], () => { location.hash = '#/week/' + C.lessons[parts[1]].week; });
        break;
      case 'cards': cardsScreen(view); break;
      case 'dict': dictScreen(view, parts[1] === 'root' ? parts.slice(2).join('/') : null); break;
      case 'progress': progressScreen(view); break;
      case 'settings': settingsScreen(view, applyLook); break;
      default: pathScreen(view);
    }
  };
  // плавная смена экрана (если браузер умеет и не просили меньше анимаций)
  const de = document.documentElement;
  if (document.startViewTransition && !location.search.includes('shot') && !de.classList.contains('lite') && !de.classList.contains('touch') && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
  else swap();
}

// ---------- офлайн: скачать картинки и аудио в кэш ----------
async function downloadAll(manual) {
  if (!('caches' in window)) return;
  const urls = new Set();
  const addImg = (p) => p && urls.add('content/' + p);
  for (const w of Object.values(C.weeks)) {
    addImg(w.cover);
    w.lessons.forEach(l => {
      [l.cover, l.dialogue?.img, l.text?.img, l.grammar?.img, ...(l.gallery || []),
        ...(l.pretest || []).map(p => p.img), ...(l.exercises || []).map(e => e.img),
        ...['dialogue', 'text'].flatMap(k => (l[k]?.lines || []).map(x => x.img))].forEach(addImg);
    });
    Object.values(w.lexicon).forEach(e => addImg(e.img));
  }
  try {
    const idx = await (await fetch('audio/index.json')).json();
    Object.values(idx).forEach(u => urls.add(u));
  } catch { /* аудио ещё не сгенерировано */ }
  const cache = await caches.open('bayan-media-v1');
  const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname.replace(/^.*?\/(content|audio)\//, '$1/')));
  const todo = [...urls].filter(u => !have.has(u));
  if (!todo.length) { if (manual) toast('Всё уже скачано'); return; }
  const pill = h('div.dlpill.glass', h('span', 'Скачиваю для офлайна'), h('b', '0%'));
  document.body.append(pill);
  let done = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (todo.length) {
      const u = todo.shift();
      try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch { /* сеть пропала — продолжим в следующий раз */ }
      done++;
      pill.lastChild.textContent = Math.round(done / (done + todo.length) * 100) + '%';
    }
  });
  await Promise.all(workers);
  pill.classList.add('done'); pill.firstChild.textContent = 'Готово офлайн';
  setTimeout(() => pill.remove(), 1800);
}
window.bayanDownloadAll = downloadAll;

// ---------- старт ----------
async function boot() {
  // ?shot — для скриншотов при разработке: без анимаций
  if (location.search.includes('shot')) document.head.append(h('style', '*,*::before,*::after{animation:none!important;transition:none!important}'));
  applyLook();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook);
  try {
    await loadAll();
  } catch (e) {
    view.replaceChildren(h('div.empty', h('p', 'Не удалось загрузить курс. Проверь соединение и обнови страницу.'), h('small', String(e.message))));
    return;
  }
  document.getElementById('boot')?.remove();
  window.addEventListener('hashchange', route);
  route();
  store.onChange(() => updateTabs(location.hash || '#/'));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // фоновая докачка медиа, когда страница успокоится
    setTimeout(() => (window.requestIdleCallback || setTimeout)(() => downloadAll(false)), 4000);
  }
}
boot();
