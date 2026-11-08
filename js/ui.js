// Общие элементы интерфейса: иконки, метки ф/х, арабский текст с нажатием на слово, шторки, уведомления.
import C, { resolve, voiceFor } from './content.js';
import * as store from './store.js';
import * as tts from './tts.js';
import { stripHarakat, translit, tokenize, norm } from './arabic.js';
import { addSentenceCard } from './srs.js';

// append/replaceChildren пропускают null и false — удобно для условных блоков: el.append(a, cond ? b : null)
for (const m of ['append', 'replaceChildren', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...a) { return orig.apply(this, a.filter(x => x != null && x !== false)); };
}

/** Создать элемент: h('div.card.big', {onclick}, ...дети) */
export function h(sel, props, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** **жирный** → <b> в коротких текстах правил. */
export const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// ---------- иконки (линейные, 24×24) ----------
const P = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  slow: '<path d="M4 15c0-4 3.5-7 8-7s8 3 8 7"/><path d="M3 15h18"/><path d="M7 15v3M17 15v3"/><circle cx="20" cy="9" r="1.6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/><circle cx="12" cy="12" r="7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  path: '<path d="M6 20c0-5 12-4 12-9S9 7 9 3.5"/><circle cx="9" cy="3.5" r="1.2" fill="currentColor"/><circle cx="6" cy="20" r="1.2" fill="currentColor"/>',
  cards: '<rect x="4" y="6" width="12" height="15" rx="2.5"/><path d="M8 3h10a2 2 0 0 1 2 2v13"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23"/><path d="M9 7.5h7"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  radio: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v3"/>',
  para: '<path d="M10 4v16M15 4v16M17 4h-7.5a4 4 0 0 0 0 8H15"/>',
  speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  flame: '<path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.2 2.6-4.8 3.4-8.4 1.9 1.2 2.6 3 2.6 4.6 1-.6 1.7-1.9 1.8-3.1 2.3 1.8 4.2 4.1 4.2 6.9 0 3.2-2.4 5.6-6 5.6z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  root: '<path d="M12 3v8M12 11c-3 0-5 2-5 5M12 11c3 0 5 2 5 5M7 16v4M17 16v4M12 11v9"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4.5V9h-4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

/** Восьмиконечная звезда с номером (как в референсе). */
export function star(n, cls = '') {
  const el = h('span.star ' + cls);
  el.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2l5.3 5.9 7.4.4.4 7.4L39 21l-5.9 5.3-.4 7.4-7.4.4L20 40l-5.3-5.9-7.4-.4-.4-7.4L1 21l5.9-5.3.4-7.4 7.4-.4z"/></svg>';
  el.append(h('b', String(n)));
  return el;
}

/** Метка варианта: ф / х / ф+х. */
export function tag(v) {
  if (v === 'x') return h('span.tag.x', { title: 'халиджи' }, 'х');
  if (v === 'fx') return h('span.tag.fx', { title: 'общее: фусха и халиджи' }, 'ф+х');
  return h('span.tag.f', { title: 'фусха' }, 'ф');
}

// ---------- харакаты ----------
let lessonHarakat = null; // переключатель внутри урока перекрывает настройку
export function setLessonHarakat(v) { lessonHarakat = v; }
/** Показывать ли харакаты для текста с политикой недели ('full' | 'partial' | 'none'). */
export function showHarakat(policy = 'full', kind = 'text') {
  if (lessonHarakat != null) return lessonHarakat;
  const s = store.settings().harakat;
  if (s === 'always') return true;
  if (s === 'never') return false;
  if (kind !== 'text') return true;         // слова, диалоги и карточки — всегда с харакатами по умолчанию
  return policy !== 'none';
}

/**
 * Арабский текст, где каждое слово нажимается.
 * opts: { links, ctx, prefer, harakat, translit, phrase: {ru, lit, voice, other}, cls }
 */
export function arText(text, opts = {}) {
  const shown = opts.harakat === false ? stripHarakat(text) : text;
  const wrap = h('span.ar' + (opts.cls ? '.' + opts.cls : ''), { dir: 'rtl', lang: 'ar' });
  const toks = tokenize(shown);
  const origToks = tokenize(text);
  toks.forEach((t, i) => {
    if (t.t !== 'w') { wrap.append(t.s); return; }
    const orig = origToks[i]?.s || t.s;
    const b = h('span.w', { role: 'button', tabindex: '0' }, t.s);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openWord(orig, { ...opts, sentence: text }); });
    wrap.append(b);
  });
  if (opts.translit ?? store.settings().translit) {
    return h('span.arwrap', wrap, h('span.tr', translit(text)));
  }
  return wrap;
}

// ---------- шторка (bottom sheet) ----------
let sheetEl, backdrop;
function ensureSheet() {
  if (sheetEl) return;
  backdrop = h('div.backdrop', { onclick: closeSheet });
  sheetEl = h('div.sheet.glass', { role: 'dialog', 'aria-modal': 'true' });
  document.body.append(backdrop, sheetEl);
  // свайп вниз закрывает
  let y0 = null;
  sheetEl.addEventListener('touchstart', (e) => { if (sheetEl.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sheetEl.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sheetEl.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheetEl.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    sheetEl.style.transform = '';
    if (dy > 90) closeSheet();
  });
}
export function openSheet(content) {
  ensureSheet();
  sheetEl.replaceChildren(h('div.grab'), content);
  sheetEl.scrollTop = 0;
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => { backdrop.classList.add('on'); sheetEl.classList.add('on'); });
}
export function closeSheet() {
  if (!sheetEl) return;
  backdrop.classList.remove('on');
  sheetEl.classList.remove('on');
  document.body.classList.remove('sheet-open');
  tts.stop();
}

// ---------- уведомление ----------
let toastEl, toastT;
export function toast(text) {
  if (!toastEl) { toastEl = h('div.toast.glass', { role: 'status' }); document.body.append(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('on'), 2200);
}

/** Кнопки «▶» и «🐢» для фразы. */
export function playBtns(text, voice) {
  return h('span.playset',
    h('button.ib', { 'aria-label': 'Прослушать', onclick: (e) => { e.stopPropagation(); tts.speak(text, { voice }); } }, icon('play')),
    h('button.ib.slowb', { 'aria-label': 'Медленно', onclick: (e) => { e.stopPropagation(); tts.speak(text, { voice, slow: true }); } }, store.settings().slowRate + '×'));
}

// ---------- карточка слова ----------
const POS = { n: 'сущ.', v: 'глагол', adj: 'прил.', adv: 'нареч.', prep: 'предлог', pron: 'местоим.', q: 'вопрос', num: 'числ.', phrase: 'выражение', part: 'частица', conj: 'союз', name: 'имя собств.' };
const DIAL = { sa: 'Саудия', ae: 'ОАЭ', kw: 'Кувейт' };

/** Открыть шторку слова. word — как написано в тексте; opts — контекст реплики. */
export function openWord(word, opts = {}) {
  const e = resolve(word, opts);
  const ctxGloss = opts.ctx && (opts.ctx[word] ?? opts.ctx[stripHarakat(word)]);
  const body = h('div.wordsheet');
  if (!e) {
    body.append(h('div.ws-head', h('span.ar.big', { dir: 'rtl', lang: 'ar' }, word), playBtns(word, voiceFor(null, null))),
      h('p.muted', 'Этого слова пока нет в словаре.'));
    if (opts.phrase) body.append(phraseBlock(opts.sentence, opts.phrase));
    openSheet(body); return;
  }
  const v = voiceFor(null, e);
  body.append(
    h('div.ws-head',
      tag(e.var),
      h('span.ar.big', { dir: 'rtl', lang: 'ar' }, e.ar),
      playBtns(e.ar, v)),
    h('div.ws-ru', e.ru),
    ctxGloss ? h('div.ws-ctx', h('span.muted', 'здесь: '), ctxGloss) : null,
    e.lit ? h('div.ws-lit', h('span.muted', 'дословно: '), e.lit) : null,
  );
  const meta = h('div.ws-meta');
  const row = (k, ...v) => meta.append(h('div.row', h('span.k', k), h('span.v', ...v)));
  if (e.root) row('корень', h('a.rootlink', { href: '#/dict/root/' + encodeURIComponent(e.root), onclick: closeSheet }, h('span.ar', { dir: 'rtl' }, e.root.split(' ').join(' - ')), icon('next')));
  if (e.pattern) row('модель', h('span.ar', { dir: 'rtl' }, e.pattern));
  if (e.form) row('форма', e.form);
  if (e.pres) row('наст. вр.', h('span.ar', { dir: 'rtl' }, e.pres));
  if (e.masdar) row('масдар', h('span.ar', { dir: 'rtl' }, e.masdar));
  if (e.pl) row('мн. ч.', h('span.ar', { dir: 'rtl' }, e.pl));
  if (e.pos) row('часть речи', POS[e.pos] || e.pos);
  if (e.dial?.length) row('где так говорят', e.dial.map(d => DIAL[d] || d).join(', '));
  body.append(meta);
  const pair = e.pair && C.lex[e.pair];
  if (pair) {
    body.append(h('div.ws-pair',
      h('span.muted', e.var === 'x' ? 'на фусхе:' : 'в халиджи:'),
      tag(pair.var), h('span.ar', { dir: 'rtl', lang: 'ar' }, pair.ar), h('span.ru', pair.ru),
      playBtns(pair.ar, voiceFor(null, pair))));
  }
  if (e.note) body.append(h('p.ws-note', e.note));
  if (e.ex) body.append(h('div.ws-ex', arText(e.ex.ar, {}), h('div.ru', e.ex.ru), playBtns(e.ex.ar, v)));
  const cardId = `${e.id}:read`;
  const has = !!store.get().cards[cardId];
  const actions = h('div.ws-actions',
    h('button.btn.soft' + (has ? '.done' : ''), {
      disabled: has || e.week === 'base' && e.pos === 'name',
      onclick: (ev) => {
        const st = store.get();
        st.cards[cardId] = { id: cardId, word: e.id, type: 'read', stage: 1, state: 'new', reps: 0, lapses: 0, due: Date.now(), created: Date.now(), okDays: [] };
        store.save();
        ev.currentTarget.classList.add('done'); ev.currentTarget.disabled = true;
        ev.currentTarget.lastChild.textContent = 'В карточках';
        toast('Слово добавлено в карточки');
      },
    }, icon(has ? 'check' : 'plus'), h('span', has ? 'В карточках' : 'В карточки')),
  );
  if (opts.sentence && opts.phrase) actions.append(saveBtn(opts.sentence, opts.phrase.ru, opts.src));
  body.append(actions);
  if (opts.phrase) body.append(phraseBlock(opts.sentence, opts.phrase));
  openSheet(body);
  tts.speak(e.ar, { voice: v });
}

function saveBtn(ar, ru, src) {
  const has = store.get().saved.some(s => s.ar === ar);
  return h('button.btn.soft' + (has ? '.done' : ''), {
    disabled: has,
    onclick: (ev) => {
      if (store.saveSentence(ar, ru, src)) { addSentenceCard(ar, ru); toast('Предложение сохранено'); }
      ev.currentTarget.classList.add('done'); ev.currentTarget.disabled = true;
    },
  }, icon('bookmark'), h('span', has ? 'Сохранено' : 'Сохранить предложение'));
}

function phraseBlock(ar, p) {
  return h('div.ws-phrase',
    h('div.k', 'Вся фраза'),
    arText(ar, { cls: 'mid' }),
    playBtns(ar, p.voice),
    h('div.ru', p.ru),
    p.lit ? h('div.lit', h('span.muted', 'дословно: '), p.lit) : null,
    p.other ? h('div.other', tag(p.other.v), arText(p.other.ar, { cls: 'mid' }), playBtns(p.other.ar, p.voice), h('div.ru', p.other.ru)) : null);
}

/** Шторка целой фразы: дословный и литературный перевод, вторая версия, сохранить. */
export function openPhrase(ar, p, src) {
  openSheet(h('div.wordsheet',
    h('div.ws-phrase.top',
      arText(ar, { cls: 'big2', phrase: p, sentence: ar }),
      playBtns(ar, p.voice),
      h('div.ru', p.ru),
      p.lit ? h('div.lit', h('span.muted', 'дословно: '), p.lit) : null),
    p.other ? h('div.ws-phrase', h('div.k', p.other.v === 'x' ? 'На халиджи' : 'На фусхе'), arText(p.other.ar, { cls: 'mid' }), playBtns(p.other.ar, p.voice), h('div.ru', p.other.ru)) : null,
    h('div.ws-actions', saveBtn(ar, p.ru, src))));
  tts.speak(ar, { voice: p.voice });
}

/** Картинка с заглушкой, если файла ещё нет. */
export function img(src, alt = '', cls = '') {
  const el = h('div.pic' + (cls ? '.' + cls : ''));
  if (src) {
    const im = new Image();
    im.alt = alt; im.loading = 'lazy'; im.decoding = 'async';
    im.onload = () => el.classList.add('ok');
    im.onerror = () => im.remove();
    // пути в контенте относительно папки content/
    im.src = /^(https?:|\/|content\/)/.test(src) ? src : 'content/' + src;
    el.append(im);
  }
  return el;
}

/** Перемешать массив (копия). */
export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
export { norm };
