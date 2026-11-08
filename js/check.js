// Проверка письма: сравнение с допустимыми ответами и подсказка, где именно ошибка.
import { norm, stripHarakat } from './arabic.js';

/** Названия типов ошибок (для журнала и «Слабых мест»). */
export const ERR = {
  hamza: 'Хамза (أ إ ء)', tamarbuta: 'Та марбута ة / ه', maqsura: 'Алиф максура ى / ي', ha: 'ح / ه', ayn: 'ع / ء',
  qaf: 'ق / ك', sad: 'ص / س', dad: 'ض / د', ta: 'ط / ت', inter: 'ذ ز ظ ث', kha: 'خ / ح / غ', letter: 'Другая буква',
  missing: 'Пропущена буква', extra: 'Лишняя буква', article: 'Артикль ال', order: 'Порядок слов', word: 'Не то слово',
  harakat: 'Харакаты', grammar: 'Грамматика', meaning: 'Значение слова', listening: 'Аудирование', pair: 'Фусха ↔ халиджи',
};

// Пары букв, которые чаще всего путают, и подсказки к ним.
const PAIRS = [
  ['حه', 'ha', 'ح — глубокое «х» из горла, ه — лёгкий выдох.'],
  ['عء', 'ayn', 'ع — гортанный звук «айн», ء — просто смычка (хамза).'],
  ['عا', 'ayn', 'ع — это согласная «айн», а не гласная «а».'],
  ['قك', 'qaf', 'ق — глубокое «к» из горла, ك — обычное «к».'],
  ['صس', 'sad', 'ص — твёрдое (эмфатическое) «с».'],
  ['ضد', 'dad', 'ض — твёрдое (эмфатическое) «д».'],
  ['طت', 'ta', 'ط — твёрдое (эмфатическое) «т».'],
  ['ظذ', 'inter', 'ظ — твёрдое межзубное, ذ — мягкое межзубное «з».'],
  ['ذز', 'inter', 'ذ — межзубное (как англ. th в this), ز — обычное «з».'],
  ['ظز', 'inter', 'ظ — межзубное эмфатическое, ز — обычное «з».'],
  ['ثس', 'inter', 'ث — межзубное (как англ. th в think), س — обычное «с».'],
  ['خح', 'kha', 'خ — «х» как в русском, ح — глубокое горловое «х».'],
  ['غخ', 'kha', 'غ — звонкое (как картавое «р»), خ — глухое «х».'],
];

function classify(a, b) { // a — ожидалось, b — написано
  for (const [p, t, hint] of PAIRS) if (p.includes(a) && p.includes(b)) return { type: t, hint };
  return { type: 'letter', hint: '' };
}

/** «Лёгкая» нормализация: без харакатов и пунктуации, но хамза, ة и ى сохраняются. */
function light(s) {
  return stripHarakat(s).replace(/[؟?!.,،؛;:«»"'()]/g, '').replace(/\s+/g, ' ').trim();
}

/** Расстояние Левенштейна с восстановлением операций по символам. */
function diff(a, b) {
  const A = [...a], B = [...b];
  const D = Array.from({ length: A.length + 1 }, (_, i) => [i, ...Array(B.length).fill(0)]);
  for (let j = 1; j <= B.length; j++) D[0][j] = j;
  for (let i = 1; i <= A.length; i++)
    for (let j = 1; j <= B.length; j++)
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
  const ops = [];
  let i = A.length, j = B.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)) {
      ops.unshift({ op: A[i - 1] === B[j - 1] ? '=' : 'sub', a: A[i - 1], b: B[j - 1] }); i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.unshift({ op: 'del', a: A[i - 1] }); i--; }
    else { ops.unshift({ op: 'ins', b: B[j - 1] }); j--; }
  }
  return { dist: D[A.length][B.length], ops };
}

/**
 * Проверить ввод.
 * @returns {{ok:boolean, near:boolean, answer:string, ops:Array, type?:string, hint?:string, notes:string[]}}
 *   ok — засчитано; near — засчитано, но с замечанием (хамза, ة/ه, ى/ي); ops — посимвольная разметка.
 */
export function check(input, accept, { strict = false } = {}) {
  const inp = norm(input);
  if (!inp) return { ok: false, near: false, answer: accept[0], ops: [], type: 'missing', hint: 'Ответ пустой.', notes: [] };
  // 1) полное совпадение после нормализации
  for (const acc of accept) {
    if (norm(acc) !== inp) continue;
    const notes = [];
    const li = light(input), la = light(acc);
    if (li !== la) {
      const { ops } = diff(la, li);
      for (const o of ops) {
        if (o.op === '=') continue;
        const pair = (o.a || '') + (o.b || '');
        if (/[ةه]/.test(pair) && /^[ةه]+$/.test(pair)) notes.push({ type: 'tamarbuta', text: 'В конце слова — та марбута ة, а не ه.' });
        else if (/^[ىي]+$/.test(pair)) notes.push({ type: 'maqsura', text: 'Здесь алиф максура ى (без точек).' });
        else if (/[أإآاءؤئ]/.test(pair)) notes.push({ type: 'hamza', text: 'Проверь хамзу: ' + la });
      }
    }
    const uniq = [...new Map(notes.map(n => [n.type, n])).values()];
    return { ok: !(strict && uniq.length), near: uniq.length > 0, answer: acc, ops: [], notes: uniq, type: uniq[0]?.type };
  }
  // 2) ищем ближайший допустимый ответ
  let best = null;
  for (const acc of accept) {
    const d = diff(norm(acc), inp);
    if (!best || d.dist < best.dist) best = { ...d, acc };
  }
  // порядок слов?
  const sortW = (s) => s.split(' ').sort().join(' ');
  if (accept.some(a => sortW(norm(a)) === sortW(inp)))
    return { ok: false, near: false, answer: best.acc, ops: best.ops, type: 'order', hint: 'Слова верные, но порядок другой.', notes: [] };
  // первая содержательная ошибка
  let type = 'word', hint = 'Сравни с правильным ответом.';
  const first = best.ops.find(o => o.op !== '=');
  if (best.dist <= Math.max(2, Math.ceil(norm(best.acc).length / 4)) && first) {
    if (first.op === 'sub') ({ type, hint } = classify(first.a, first.b));
    else if (first.op === 'del') { type = 'missing'; hint = `Пропущена буква «${first.a}».`; }
    else { type = 'extra'; hint = `Лишняя буква «${first.b}».`; }
    // артикль
    const na = norm(best.acc).split(' '), ni = inp.split(' ');
    if (na.length === ni.length && na.some((w, k) => w !== ni[k] && (('ال' + ni[k]) === w || ('ال' + w) === ni[k]))) {
      type = 'article'; hint = 'Проверь артикль ال: где он нужен, а где нет (например, в идафе у первого слова его нет).';
    }
    if (first.op === 'sub' && type !== 'article') hint = `Здесь нужна буква «${first.a}», а не «${first.b}». ` + hint;
  }
  return { ok: false, near: false, answer: best.acc, ops: best.ops, type, hint, notes: [] };
}

/** HTML-разметка ответа: правильный вариант с подсветкой отличий. */
export function diffHTML(ops) {
  return ops.map(o => {
    if (o.op === '=') return o.a;
    if (o.op === 'sub') return `<mark class="fix">${o.a}</mark>`;
    if (o.op === 'del') return `<mark class="fix">${o.a}</mark>`;
    return '';
  }).join('');
}

/** HTML-разметка ввода пользователя: что лишнее или неверное. */
export function inputHTML(ops) {
  return ops.map(o => {
    if (o.op === '=') return o.b;
    if (o.op === 'sub' || o.op === 'ins') return `<mark class="bad">${o.b}</mark>`;
    return '<mark class="gap">·</mark>';
  }).join('');
}
