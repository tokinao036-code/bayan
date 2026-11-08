// Прогресс и настройки в localStorage (ключ bayan.v1). Экспорт/импорт в файл.

const KEY = 'bayan.v1';

const DEFAULT = {
  v: 1,
  settings: {
    theme: 'auto',        // auto | light | dark
    lite: 'auto',         // auto | on | off — без размытия (на iPhone по умолчанию)
    harakat: 'course',    // course | always | never
    translit: false,      // транслитерация русскими буквами
    variant: 'both',      // f | x | both — что показывать в диалогах
    rate: 1,              // скорость озвучки (обычная)
    slowRate: 0.7,        // медленная
    newPerDay: 20,
    reviewsPerDay: 120,
    strict: false,        // строгая проверка письма (с харакатами)
  },
  lessons: {},            // id → { done: ts, step: n, score: {ok, all} }
  cards: {},              // id карточки → состояние FSRS
  errors: [],             // журнал ошибок: { t, type, item, ts }
  saved: [],              // сохранённые предложения: { ar, ru, src, ts }
  days: {},               // 'YYYY-MM-DD' → { lessons, cards, minutes }
  skills: {},             // навык → [1/0, …] последние 50 ответов
  tests: {},              // результаты контрольных
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULT), ...s, settings: { ...DEFAULT.settings, ...(s.settings || {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

let saveTimer = null;
/** Сохранить (с небольшой задержкой, чтобы не писать на каждое нажатие). */
export function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* переполнение или приватный режим */ } };
  if (now) write(); else saveTimer = setTimeout(write, 300);
  listeners.forEach(f => f(state));
}

export function get() { return state; }
export function settings() { return state.settings; }
export function setSetting(k, v) { state.settings[k] = v; save(); }
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

/** Сегодняшняя дата в местном времени (граница дня — 4 утра, как в Anki). */
export function today(d = new Date()) {
  const x = new Date(d.getTime() - 4 * 3600e3);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

/** Отметить активность за день (для серии и статистики). */
export function logDay(kind, n = 1) {
  const d = (state.days[today()] ||= { lessons: 0, cards: 0, steps: 0 });
  d[kind] = (d[kind] || 0) + n;
  save();
}

/** Записать ответ для статистики навыков. */
export function logSkill(skill, ok) {
  if (!skill) return;
  const a = (state.skills[skill] ||= []);
  a.push(ok ? 1 : 0);
  if (a.length > 60) a.splice(0, a.length - 60);
  save();
}

/** Записать ошибку в журнал. */
export function logError(type, item) {
  state.errors.push({ t: type, item, ts: Date.now() });
  if (state.errors.length > 400) state.errors.splice(0, state.errors.length - 400);
  save();
}

export function saveSentence(ar, ru, src) {
  if (state.saved.some(s => s.ar === ar)) return false;
  state.saved.unshift({ ar, ru, src, ts: Date.now() });
  save();
  return true;
}

/**
 * Серия дней без давления: один пропущенный день в неделю «замораживается»
 * и серию не обрывает.
 */
export function streak() {
  let n = 0, freezes = 0;
  // полдень «учебного» дня: дальше просто шагаем по календарю назад
  const d = new Date(Date.now() - 4 * 3600e3);
  d.setHours(12, 0, 0, 0);
  const key = () => today(new Date(d.getTime() + 4 * 3600e3));
  const active = (k) => { const x = state.days[k]; return x && (x.lessons > 0 || x.cards >= 5 || x.steps >= 3); };
  if (!active(key())) d.setDate(d.getDate() - 1); // сегодня ещё можно успеть
  for (let i = 0; i < 400; i++) {
    const k = key();
    if (active(k)) n++;
    else if (freezes < 1 && n > 0) freezes++;
    else break;
    if (i % 7 === 6) freezes = 0;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function totalDays() {
  return Object.values(state.days).filter(x => x.lessons > 0 || x.cards >= 5 || x.steps >= 3).length;
}

/** Экспорт прогресса в файл. */
export function exportFile() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bayan-progress-' + today() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Импорт прогресса из файла. */
export async function importFile(file) {
  const s = JSON.parse(await file.text());
  if (!s || s.v !== 1 || !s.settings) throw new Error('Это не файл прогресса Bayan');
  state = { ...structuredClone(DEFAULT), ...s };
  save(true);
}

export function resetAll() {
  state = structuredClone(DEFAULT);
  save(true);
}
