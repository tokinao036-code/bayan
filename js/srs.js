// Интервальное повторение: FSRS-5 (параметры по умолчанию) + «лестница» карточек для каждого слова.
import * as store from './store.js';
import C from './content.js';

// Параметры FSRS-5 по умолчанию (open-spaced-repetition, 2024).
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;
const DAY = 86400e3, MIN = 60e3;
const RETENTION = 0.9;

const clampD = (d) => Math.min(10, Math.max(1, d));
const initS = (g) => Math.max(0.1, W[g - 1]);
const initD = (g) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
const R = (t, s) => Math.pow(1 + FACTOR * t / s, DECAY);
const nextD = (d, g) => {
  const d2 = d + (-W[6] * (g - 3)) * (10 - d) / 9;          // линейное затухание (FSRS-5)
  return clampD(W[7] * initD(4) + (1 - W[7]) * d2);           // возврат к среднему
};
const recallS = (d, s, r, g) => s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
  (Math.exp((1 - r) * W[10]) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
const forgetS = (d, s, r) => Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]));
const shortS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));
const interval = (s) => Math.min(36500, Math.max(1, Math.round(s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1))));

/** Пересчитать состояние карточки после ответа. g: 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко. */
export function schedule(card, g, now = Date.now()) {
  const c = { ...card };
  if (!c.reps) {
    c.s = initS(g); c.d = initD(g);
  } else {
    const t = (now - (c.last || now)) / DAY;
    if (t < 1) c.s = shortS(c.s, g);
    else { const r = R(t, c.s); c.s = g === 1 ? forgetS(c.d, c.s, r) : recallS(c.d, c.s, r, g); }
    c.d = nextD(c.d, g);
  }
  c.reps = (c.reps || 0) + 1;
  c.last = now;
  if (g === 1) {
    if (c.state === 'review') c.lapses = (c.lapses || 0) + 1;
    c.state = c.state === 'new' || c.state === 'learning' ? 'learning' : 'relearning';
    c.due = now + MIN;
  } else if (g === 2 && c.state !== 'review') {
    c.state = 'learning';
    c.due = now + 10 * MIN;
  } else {
    let days = interval(c.s);
    if (g === 2) days = Math.max(1, Math.round(days * 0.8));
    if (days > 2) days = Math.round(days * (0.95 + Math.random() * 0.1)); // небольшой разброс
    c.state = 'review';
    c.due = now + days * DAY;
  }
  if (g >= 2) {
    const day = store.today();
    c.okDays = [...new Set([...(c.okDays || []), day])];
  }
  return c;
}

/** Подпись интервала для кнопки («10 мин», «3 дн.», «2 мес.»). */
export function preview(card, g) {
  const c = schedule(card, g);
  const ms = c.due - Date.now();
  if (ms < 3600e3) return Math.max(1, Math.round(ms / MIN)) + ' мин';
  const d = ms / DAY;
  if (d < 1.5) return '1 дн.';
  if (d < 31) return Math.round(d) + ' дн.';
  if (d < 365) return Math.round(d / 30) + ' мес.';
  return (d / 365).toFixed(1) + ' г.';
}

// ---------- Карточки ----------

/** Типы карточек для слова по ступеням: сначала узнавание, потом слух и контекст, потом письмо. */
function stagesFor(e) {
  const s1 = ['read'];
  if (e.pair && C.lex[e.pair]) s1.push('pair');
  const s2 = ['listen'];
  if (e.ex) s2.push('cloze');
  const s3 = e.ex ? ['write'] : [];
  return [s1, s2, s3];
}

function newCard(id, extra) {
  return { id, state: 'new', reps: 0, lapses: 0, due: Date.now(), created: Date.now(), okDays: [], ...extra };
}

/** Добавить карточки слов урока (1-я ступень) и грамматические карточки. */
export function addLessonCards(lesson) {
  const st = store.get();
  let added = 0;
  for (const w of lesson.words || []) {
    const e = C.lex[w];
    if (!e) continue;
    for (const type of stagesFor(e)[0]) {
      const id = `${w}:${type}`;
      if (!st.cards[id]) { st.cards[id] = newCard(id, { word: w, type, stage: 1, lesson: lesson.id }); added++; }
    }
  }
  (lesson.grammar?.cards || []).forEach((g, i) => {
    const id = `${lesson.id}:g${i}`;
    if (!st.cards[id]) { st.cards[id] = newCard(id, { type: 'gram', lesson: lesson.id, gi: i }); added++; }
  });
  store.save();
  return added;
}

/** Добавить карточку сохранённого предложения. */
export function addSentenceCard(ar, ru) {
  const st = store.get();
  const id = 'sent:' + ar.slice(0, 60);
  if (!st.cards[id]) st.cards[id] = newCard(id, { type: 'sent', ar, ru });
  store.save();
}

/** Открыть следующую ступень слова, когда предыдущая уверенно вспоминается (≥2 удачных дня). */
function maybeUnlock(word) {
  const st = store.get();
  const e = C.lex[word];
  if (!e) return;
  const stages = stagesFor(e);
  for (let i = 0; i < stages.length - 1; i++) {
    const cur = stages[i].map(t => st.cards[`${word}:${t}`]).filter(Boolean);
    if (!cur.length || cur.some(c => (c.okDays || []).length < 2)) return;
    for (const type of stages[i + 1]) {
      const id = `${word}:${type}`;
      if (!st.cards[id]) st.cards[id] = newCard(id, { word, type, stage: i + 2 });
    }
  }
}

/** Ответ на карточку: пересчитать, записать статистику, открыть ступени. */
export function answer(id, g) {
  const st = store.get();
  const c = st.cards[id];
  if (!c) return;
  const wasNew = c.state === 'new';
  st.cards[id] = schedule(c, g);
  if (wasNew) st.cards[id].firstDay = store.today();
  if (c.word) maybeUnlock(c.word);
  store.logDay('cards');
  store.logSkill(c.type === 'listen' ? 'listening' : c.type === 'write' ? 'writing' : c.type === 'gram' ? 'grammar' : 'reading', g >= 3);
  store.save();
}

/** Очередь на сегодня: сначала просроченные повторения, затем новые (в пределах лимитов). */
export function queue(now = Date.now()) {
  const st = store.get();
  const s = st.settings;
  const day = store.today();
  const all = Object.values(st.cards);
  const reviewedToday = all.filter(c => c.last && store.today(new Date(c.last)) === day && c.state !== 'new').length;
  const newToday = all.filter(c => c.firstDay === day).length;
  const due = all.filter(c => c.state !== 'new' && c.due <= now).sort((a, b) => a.due - b.due)
    .slice(0, Math.max(0, s.reviewsPerDay - reviewedToday));
  const fresh = all.filter(c => c.state === 'new').sort((a, b) => a.created - b.created || (a.stage || 1) - (b.stage || 1))
    .slice(0, Math.max(0, s.newPerDay - newToday));
  return { due, fresh, list: interleave(due, fresh) };
}

/** Чередование: новые карточки вставляются между повторениями, а не идут блоком. */
function interleave(due, fresh) {
  const out = [];
  let i = 0, j = 0;
  while (i < due.length || j < fresh.length) {
    for (let k = 0; k < 3 && i < due.length; k++) out.push(due[i++]);
    if (j < fresh.length) out.push(fresh[j++]);
  }
  // соседние карточки одного слова разводим подальше
  for (let k = 1; k < out.length; k++) {
    if (out[k].word && out[k].word === out[k - 1].word) {
      const m = out.findIndex((c, idx) => idx > k && c.word !== out[k].word);
      if (m > 0) [out[k], out[m]] = [out[m], out[k]];
    }
  }
  return out;
}

/** Карточки для разминки урока: сначала слова из журнала ошибок, затем ближайшие к сроку. */
export function warmup(n, lessonId) {
  const st = store.get();
  const recentErr = [...st.errors].reverse().map(e => e.item?.word).filter(Boolean);
  const cards = Object.values(st.cards).filter(c => c.lesson !== lessonId && c.state !== 'new');
  const pick = [];
  for (const w of recentErr) {
    const c = cards.find(x => x.word === w && !pick.includes(x));
    if (c) pick.push(c);
    if (pick.length >= Math.ceil(n / 2)) break;
  }
  const rest = cards.filter(c => !pick.includes(c)).sort((a, b) => a.due - b.due);
  return [...pick, ...rest].slice(0, n);
}

/** Статус слова: new (не изучено) / learning / known (3 удачных дня в карточке узнавания). */
export function wordStatus(word) {
  const c = store.get().cards[`${word}:read`];
  if (!c) return 'new';
  return (c.okDays || []).length >= 3 ? 'known' : 'learning';
}
