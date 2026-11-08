// Загрузка контента (course.json, словари, недели) и поиск слова в словаре по нажатию.
import { norm, candidates } from './arabic.js';

const C = {
  course: null,
  lex: {},          // id → статья (со ссылкой на неделю, где она появилась)
  index: new Map(), // нормализованная форма → [id, …]
  weeks: {},        // id недели → данные
  lessons: {},      // id урока → урок
  wordLesson: {},   // id слова → id урока, где оно изучается
};
export default C;

const BASE = 'content/';

async function getJSON(path) {
  const r = await fetch(BASE + path, { cache: 'no-cache' }).catch(() => null)
    || await caches.match(BASE + path);
  if (!r || !r.ok) throw new Error('Не удалось загрузить ' + path);
  return r.json();
}

/** Добавить статьи словаря в общий индекс. */
function addLexicon(obj, weekId) {
  for (const [id, e] of Object.entries(obj || {})) {
    if (id.startsWith('_')) continue;
    e.id = id;
    e.week = weekId;
    C.lex[id] = e;
    const keys = new Set([norm(e.ar), ...(e.forms || []).map(norm)]);
    if (e.pl) keys.add(norm(e.pl));
    if (e.pres) keys.add(norm(e.pres));
    if (e.masdar) keys.add(norm(e.masdar));
    // «جَواز سَفَر» → и отдельно первое слово
    const first = norm(e.ar).split(' ')[0];
    if (first && e.ar.includes(' ') && e.pos !== 'phrase') keys.add(first);
    for (const k of keys) {
      if (!k) continue;
      const list = C.index.get(k) || [];
      if (!list.includes(id)) list.push(id);
      C.index.set(k, list);
    }
  }
}

/** Загрузить курс, базовый словарь и все доступные недели. */
export async function loadAll() {
  C.course = await getJSON('course.json');
  const base = await getJSON(C.course.base || 'lexicon-base.json');
  addLexicon(base.lexicon, 'base');
  const files = C.course.seasons.flatMap(s => s.weeks).filter(w => w.file);
  const weeks = await Promise.all(files.map(w => getJSON(w.file).catch(() => null)));
  weeks.forEach((wk, i) => {
    if (!wk) return;
    wk.meta = files[i];
    C.weeks[wk.id] = wk;
    addLexicon(wk.lexicon, wk.id);
    wk.lessons.forEach((l, n) => {
      l.week = wk.id;
      l.n = n + 1;
      C.lessons[l.id] = l;
      for (const w of l.words || []) if (!C.wordLesson[w]) C.wordLesson[w] = l.id;
    });
  });
  return C;
}

/** Все недели курса по порядку (включая ещё не написанные). */
export function allWeeks() {
  return C.course.seasons.flatMap(s => s.weeks.map(w => ({ ...w, season: s.id, data: C.weeks[w.id] || null })));
}

/** Все уроки по порядку. */
export function allLessons() {
  return allWeeks().flatMap(w => (w.data ? w.data.lessons : []));
}

/**
 * Найти статью словаря для слова из текста.
 * @param {string} word — слово как написано (с харакатами)
 * @param {object} [opts] — { links: {surface: id}, prefer: [id] } из реплики/урока
 */
export function resolve(word, opts = {}) {
  // ручная привязка: ключ — слово как в тексте или его нормальная форма без приставок (وبعد → بعد)
  const link = opts.links && (opts.links[word] ?? candidates(word).map(c => opts.links[c]).find(Boolean));
  if (link) return C.lex[typeof link === 'string' ? link : link.id] || null;
  for (const c of candidates(word)) {
    const ids = C.index.get(c);
    if (!ids) continue;
    if (ids.length === 1) return C.lex[ids[0]];
    // несколько совпадений: сначала слова урока, потом подходящий вариант (фусха/халиджи), потом слова недель
    const pref = opts.prefer || [];
    const v = opts.variant;
    const byVar = v && ids.find(id => (v === 'x' ? C.lex[id].var === 'x' : C.lex[id].var !== 'x'));
    return C.lex[ids.find(id => pref.includes(id)) || byVar || ids.find(id => C.lex[id].week !== 'base') || ids[0]];
  }
  return null;
}

/** Достать реплику по ссылке вида "dialogue.4.f" / "text.2.x" внутри урока. */
export function lineRef(lesson, ref) {
  const [part, n, v] = ref.split('.');
  const line = lesson[part]?.lines?.[Number(n) - 1];
  if (!line) return null;
  const variant = line[v || 'f'] || line.f;
  return { line, variant, who: line.who, v: v || 'f' };
}

/** Голос для озвучки: персонаж или слово (по варианту и диалекту). */
export function voiceFor(who, entry) {
  if (who && C.course.speakers[who]) return C.course.speakers[who].voice;
  if (entry && entry.var === 'x') return (entry.dial || []).includes('sa') || !(entry.dial || []).length ? C.course.voices.word_x_sa : C.course.voices.word_x_ae;
  return C.course.voices.word_f;
}

/** Однокоренные слова из словаря (по корню). */
export function rootFamily(root) {
  const key = norm(root).replace(/\s/g, '');
  return Object.values(C.lex).filter(e => e.root && norm(e.root).replace(/\s/g, '') === key);
}
