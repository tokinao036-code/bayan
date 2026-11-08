// Отрисовка одной карточки повторения (используется и в разделе «Карточки», и в разминке урока).
import C, { resolve, voiceFor } from './content.js';
import { h, icon, tag, arText, playBtns, shuffle, toast } from './ui.js';
import { tokenize, stripHarakat } from './arabic.js';
import { check, diffHTML, ERR } from './check.js';
import * as srs from './srs.js';
import * as store from './store.js';
import * as tts from './tts.js';

/** Предложение-пример с выделенным (или скрытым) целевым словом. */
function sentenceWith(ex, wordId, mode /* 'mark' | 'blank' */) {
  const wrap = h('span.ar.sent', { dir: 'rtl', lang: 'ar' });
  let found = null;
  for (const t of tokenize(ex.ar)) {
    if (t.t === 'w' && !found && resolve(t.s, { prefer: [wordId] })?.id === wordId) {
      found = t.s;
      wrap.append(mode === 'blank' ? h('span.blank', ' ') : h('mark.target', t.s));
    } else wrap.append(t.s);
  }
  return { el: wrap, word: found };
}

/** Кнопки оценки FSRS с подписью интервала. */
function gradeBar(card, onGrade) {
  const names = [[1, 'Снова', 'again'], [2, 'Трудно', 'hard'], [3, 'Хорошо', 'good'], [4, 'Легко', 'easy']];
  return h('div.grades', names.map(([g, n, c]) =>
    h('button.grade.' + c, { onclick: () => onGrade(g) }, h('b', n), h('small', srs.preview(card, g)))));
}

/**
 * Показать карточку. api: { done(grade), setButton(label, fn, opts) }.
 * Возвращает элемент.
 */
export function renderCard(card, api) {
  const box = h('div.cardview');
  const e = card.word ? C.lex[card.word] : null;
  const voice = e ? voiceFor(null, e) : voiceFor('narrator');
  const reveal = (backEls, auto) => {
    box.append(h('div.back', backEls));
    if (auto != null) return;
    api.setButton(null);
    box.append(gradeBar(card, (g) => api.done(g)));
  };
  const typeName = { read: 'Узнай слово', pair: e?.var === 'x' ? 'Как это на фусхе?' : 'Как это в халиджи?', listen: 'Послушай и вспомни', cloze: 'Вставь слово', write: 'Напиши по-арабски', gram: 'Грамматика', sent: 'Сохранённое предложение' }[card.type];
  box.append(h('div.ctype', typeName));

  if (card.type === 'read' && e) {
    const ex = e.ex || { ar: e.ar, ru: '' };
    const s = sentenceWith(ex, e.id, 'mark');
    box.append(h('div.front', s.el, playBtns(ex.ar, voice)));
    api.setButton('Показать ответ', () => reveal([
      h('div.answer', tag(e.var), h('span.ar.big', { dir: 'rtl', lang: 'ar' }, e.ar), playBtns(e.ar, voice)),
      h('div.ru.big', e.ru), ex.ru ? h('div.ru.muted', ex.ru) : null]));
  } else if (card.type === 'pair' && e) {
    const p = C.lex[e.pair];
    box.append(h('div.front', tag(e.var), h('span.ar.big', { dir: 'rtl', lang: 'ar' }, e.ar), playBtns(e.ar, voice), h('div.ru.muted', e.ru)));
    api.setButton('Показать ответ', () => reveal([
      h('div.answer', tag(p.var), h('span.ar.big', { dir: 'rtl', lang: 'ar' }, p.ar), playBtns(p.ar, voiceFor(null, p))),
      p.note ? h('p.muted.small', p.note) : null]));
  } else if (card.type === 'listen' && e) {
    const say = () => tts.speakSeq([{ text: e.ar, voice }, ...(e.ex ? [{ text: e.ex.ar, voice }] : [])]);
    box.append(h('div.front.center', h('button.bigplay', { onclick: say, 'aria-label': 'Прослушать' }, icon('speaker')),
      h('button.link', { onclick: () => tts.speak(e.ar, { voice, slow: true }) }, icon('slow'), ' медленно')));
    setTimeout(say, 250);
    api.setButton('Показать ответ', () => reveal([
      h('div.answer', h('span.ar.big', { dir: 'rtl', lang: 'ar' }, e.ar)), h('div.ru.big', e.ru),
      e.ex ? h('div', arText(e.ex.ar, {}), h('div.ru.muted', e.ex.ru)) : null]));
  } else if (card.type === 'cloze' && e?.ex) {
    const s = sentenceWith(e.ex, e.id, 'blank');
    const pool = Object.values(C.lex).filter(x => x.id !== e.id && x.pos === e.pos && x.week !== 'base' && x.var !== 'x' && x.ex);
    const opts = shuffle([s.word || e.ar, ...shuffle(pool).slice(0, 3).map(x => x.ar)]);
    box.append(h('div.front', s.el, h('div.ru.muted', e.ex.ru)));
    const grid = h('div.opts.ar-opts');
    opts.forEach(o => grid.append(h('button.opt', { dir: 'rtl', lang: 'ar', onclick: (ev) => {
      const ok = o === (s.word || e.ar);
      grid.querySelectorAll('button').forEach(b => { b.disabled = true; if (b.textContent === (s.word || e.ar)) b.classList.add('ok'); });
      if (!ok) ev.currentTarget.classList.add('bad');
      if (!ok) store.logError('meaning', { word: e.id });
      tts.speak(e.ex.ar, { voice });
      api.setButton('Дальше', () => api.done(ok ? 3 : 1));
    } }, o)));
    box.append(grid);
    api.setButton(null);
  } else if (card.type === 'write' && e?.ex) {
    const s = sentenceWith(e.ex, e.id, 'blank');
    const input = h('input.arinput', { dir: 'rtl', lang: 'ar', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'اكتب هنا' });
    box.append(h('div.front', h('div.ru.big', e.ru), h('div.ru.muted', e.ex.ru), s.el), input);
    const fb = h('div.fb');
    box.append(fb);
    const go = () => {
      const target = s.word || e.ar;
      const r = check(input.value, [stripHarakat(target), stripHarakat(e.ar)], { strict: store.settings().strict });
      input.disabled = true;
      fb.className = 'fb ' + (r.ok ? (r.near ? 'near' : 'ok') : 'bad');
      fb.innerHTML = '';
      fb.append(h('div.fb-title', r.ok ? (r.near ? 'Почти идеально' : 'Верно!') : 'Не совсем'),
        h('div.ar.mid', { dir: 'rtl', html: r.ops?.length ? diffHTML(r.ops) : target }),
        ...(r.notes || []).map(n => h('div.small', n.text)),
        r.hint && !r.ok ? h('div.small', r.hint) : null);
      if (!r.ok || r.near) store.logError(r.type || 'letter', { word: e.id, input: input.value });
      tts.speak(e.ex.ar, { voice });
      api.setButton('Дальше', () => api.done(r.ok ? (r.near ? 2 : 3) : 1));
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
    api.setButton('Проверить', go);
    setTimeout(() => input.focus(), 200);
  } else if (card.type === 'gram') {
    const l = C.lessons[card.lesson];
    const g = l?.grammar?.cards?.[card.gi];
    if (!g) { api.done(3); return box; }
    box.append(h('div.front', h('div.q', g.q)));
    const grid = h('div.opts');
    g.options.forEach((o, i) => grid.append(h('button.opt' + (/[؀-ۿ]/.test(o) ? '.arabic' : ''), { dir: 'auto', onclick: (ev) => {
      const ok = i === g.answer;
      grid.querySelectorAll('button').forEach((b, k) => { b.disabled = true; if (k === g.answer) b.classList.add('ok'); });
      if (!ok) { ev.currentTarget.classList.add('bad'); store.logError('grammar', { lesson: card.lesson }); }
      api.setButton('Дальше', () => api.done(ok ? 3 : 1));
    } }, o)));
    box.append(grid, h('div.small.muted', 'Правило: ' + (l.grammar.title || '')));
    api.setButton(null);
  } else if (card.type === 'sent') {
    box.append(h('div.front', arText(card.ar, { cls: 'mid' }), playBtns(card.ar, voice)));
    api.setButton('Показать перевод', () => reveal([h('div.ru.big', card.ru || '—')]));
  } else {
    api.done(3);
  }
  return box;
}

export { ERR, toast };
