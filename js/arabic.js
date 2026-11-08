// Работа с арабским текстом: нормализация, харакаты, разбиение на слова, транслитерация.

// Огласовки и служебные знаки: фатха…сукун, надстрочный алиф, татвиль.
const HARAKAT_RE = /[ً-ْٰـ]/g;
// Пунктуация, которую отрезаем от слова при поиске в словаре.
const PUNCT_RE = /[؟?!.,،؛;:«»"'()\[\]{}…\-–—_]/g;

/** Убрать все харакаты (для режима «без харакатов» и для поиска). */
export function stripHarakat(s) {
  return (s || '').replace(HARAKAT_RE, '');
}

/**
 * Нормализация для поиска и проверки письма:
 * без харакатов и пунктуации, все алифы с хамзой → ا, ؤ ئ → ء, ى → ي, ة → ه, چ → ك.
 */
export function norm(s) {
  return stripHarakat(s)
    .replace(PUNCT_RE, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/چ/g, 'ك')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Есть ли в строке арабские буквы. */
export function isArabic(s) {
  return /[؀-ۿ]/.test(s || '');
}

/**
 * Разбить строку на токены: слова и всё остальное (пробелы, знаки).
 * Возвращает массив { t: 'w' | 's', s: строка }.
 */
export function tokenize(s) {
  const out = [];
  const re = /([؀-ۿݐ-ݿ]+)|([^؀-ۿݐ-ݿ]+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) {
      // арабские знаки препинания (، ؟ ؛) входят в диапазон — отделяем их от слова
      const parts = m[1].split(/([،؟؛])/);
      for (const p of parts) if (p) out.push({ t: /^[،؟؛]$/.test(p) ? 's' : 'w', s: p });
    } else out.push({ t: 's', s: m[2] });
  }
  return out;
}

/**
 * Кандидаты для поиска в словаре: само слово, затем без приставок (و ف ب ل ك ال لل)
 * и без окончаний (местоимённые суффиксы, ة→ت, танвин-алиф, ات/ون/ين).
 * Порядок важен: чем меньше отрезано, тем раньше кандидат.
 */
export function candidates(word) {
  const w0 = norm(word);
  const seen = new Set();
  const out = [];
  const push = (x) => { if (x && x.length >= 1 && !seen.has(x)) { seen.add(x); out.push(x); } };

  // 1) варианты без приставок
  const pre = [w0];
  const addPre = (x) => { if (!pre.includes(x)) pre.push(x); };
  for (const x of [...pre]) if (/^[وف]/.test(x) && x.length > 2) addPre(x.slice(1));
  for (const x of [...pre]) {
    if (/^لل/.test(x) && x.length > 3) { addPre('ال' + x.slice(2)); addPre(x.slice(2)); }
    if (/^[بلك]/.test(x) && x.length > 2) addPre(x.slice(1));
  }
  for (const x of [...pre]) if (/^ال/.test(x) && x.length > 3) addPre(x.slice(2));
  // халиджи: «вِ»-приставка будущего времени у саудовцев/эмиратцев (بروح) — пробуем и без неё
  for (const x of [...pre]) if (/^ب[اتني]/.test(x) && x.length > 3) addPre(x.slice(1));
  // фусха: приставка будущего времени سـ (سَأَكْتُبُ → أَكْتُبُ)
  for (const x of [...pre]) if (/^س[اتني]/.test(x) && x.length > 3) addPre(x.slice(1));

  // 2) для каждого варианта — окончания
  const SUF = ['كما', 'هما', 'كم', 'كن', 'هم', 'هن', 'نا', 'ها', 'ني', 'ك', 'ه', 'ي'];
  for (const x of pre) {
    push(x);
    const forms = [x];
    for (const s of SUF) {
      if (x.endsWith(s) && x.length - s.length >= 2) forms.push(x.slice(0, -s.length));
    }
    for (const f of forms) {
      push(f);
      if (f.endsWith('ت')) push(f.slice(0, -1) + 'ه');          // حقيبت(ك) → حقيبه
      if (f.endsWith('ا') && f.length > 2) push(f.slice(0, -1)); // танвин-алиф: جيدا → جيد
      if (f.endsWith('ه') && f.length > 2) push(f.slice(0, -1)); // ж. р.: طويله → طويل
      if (f.endsWith('ات') && f.length > 3) { push(f.slice(0, -2) + 'ه'); push(f.slice(0, -2)); }
      if (/(ون|ين|ان)$/.test(f) && f.length > 3) push(f.slice(0, -2));
      if (f.endsWith('يه') && f.length > 3) push(f.slice(0, -1)); // نисба ж. р.: دوليه → دولي
    }
  }
  return out;
}

// ---------- Транслитерация русскими буквами (по полным харакатам) ----------

const CONS = {
  'ب': 'б', 'ت': 'т', 'ث': 'с', 'ج': 'дж', 'ح': 'х', 'خ': 'х', 'د': 'д', 'ذ': 'з', 'ر': 'р', 'ز': 'з',
  'س': 'с', 'ش': 'ш', 'ص': 'с', 'ض': 'д', 'ط': 'т', 'ظ': 'з', 'ع': 'ʿ', 'غ': 'г', 'ف': 'ф', 'ق': 'к',
  'ك': 'к', 'ل': 'л', 'م': 'м', 'ن': 'н', 'ه': 'х', 'ء': 'ʾ', 'أ': 'ʾ', 'إ': 'ʾ', 'ؤ': 'ʾ', 'ئ': 'ʾ',
  'چ': 'ч', 'گ': 'г', 'پ': 'п', 'ڤ': 'в'
};
const SUN = new Set('تثدذرزسشصضطظلن'.split(''));
const FATHA = 'َ', DAMMA = 'ُ', KASRA = 'ِ', SUKUN = 'ْ', SHADDA = 'ّ';
const TAN_F = 'ً', TAN_D = 'ٌ', TAN_K = 'ٍ', SUP_ALIF = 'ٰ';
const MAC = '̄'; // макрон над долгой гласной

/** Транслитерация одного слова с харакатами. Лучше всего работает на полностью огласованном тексте. */
function translitWord(w) {
  // разложим на «букву + её знаки»
  const L = [];
  for (const ch of w) {
    if (/[ً-ْٰ]/.test(ch) && L.length) L[L.length - 1].m += ch;
    else if (ch !== 'ـ') L.push({ c: ch, m: '' });
  }
  let out = '';
  let i = 0;
  let noDouble = -1; // буква после ассимилированного артикля: удвоение уже показано (ар-рихла)
  // артикль ال в начале слова
  if (L.length > 2 && (L[0].c === 'ا' || L[0].c === 'ٱ') && L[1].c === 'ل') {
    const next = L[2];
    if (next && SUN.has(next.c) && next.m.includes(SHADDA)) { out += 'а' + CONS[next.c] + '-'; noDouble = 2; }
    else out += 'аль-';
    i = 2;
  }
  const vowelOf = (m) => m.includes(FATHA) ? 'а' : m.includes(DAMMA) ? 'у' : m.includes(KASRA) ? 'и' : '';
  for (; i < L.length; i++) {
    const { c, m } = L[i];
    const prev = L[i - 1];
    const prevV = prev ? vowelOf(prev.m) : '';
    if (c === 'ا' || c === 'ٱ') {
      if (i === 0) { out += vowelOf(m) || 'и'; continue; }       // начало слова: краткая гласная по знаку
      if (prev?.m.includes(TAN_F)) continue;                      // танвин -ан: алиф не читается
      if (prevV === 'а') { out += MAC; continue; }                // фатха + алиф = долгое а̄
      if (!prevV && !prev?.m.includes(SUKUN) && prev?.c !== 'ا') { out += 'а' + MAC; continue; } // фатху перед алифом часто не пишут
      continue;                                                   // алиф-васла внутри слова не читается
    }
    if (c === 'آ') { out += 'ʾа' + MAC; continue; }
    if (c === 'ى') { out += (prevV === 'а' ? MAC : 'а' + MAC); continue; }
    if (c === 'ة') {
      const v = vowelOf(m);
      out += v ? 'т' + v : (m.includes(TAN_D) ? 'тун' : m.includes(TAN_K) ? 'тин' : m.includes(TAN_F) ? 'тан' : '');
      if (!v && !/[ً-ٍ]/.test(m) && !out.endsWith('а')) out += 'а';
      continue;
    }
    if (c === 'و' || c === 'ي') {
      const hasV = /[َ-ِ]/.test(m) || m.includes(SHADDA);
      const beforeAlif = L[i + 1] && (L[i + 1].c === 'ا');       // «рийа̄д»: перед алифом это согласная
      if (!hasV && !beforeAlif && !m.includes(TAN_D) && !m.includes(TAN_K) && !m.includes(TAN_F)) {
        if (c === 'و' && prevV === 'у') { out += MAC; continue; }
        if (c === 'ي' && prevV === 'и') { out += MAC; continue; }
        if (prevV === 'а' || m.includes(SUKUN)) { out += (c === 'و' ? 'в' : 'й'); continue; }
        if (!prevV && i > 0) { out += (c === 'و' ? 'ӯ' : 'ӣ'); continue; }
      }
      let cc = c === 'و' ? 'в' : 'й';
      if (m.includes(SHADDA)) cc += cc;
      out += cc + (vowelOf(m) || '') + tanween(m);
      continue;
    }
    let cc = CONS[c];
    if (cc === undefined) { out += c; continue; }
    if (m.includes(SHADDA) && i !== noDouble) cc += cc;
    out += cc + vowelOf(m) + tanween(m) + (m.includes(SUP_ALIF) ? 'а' + MAC : '');
  }
  return out.replace(/ʾ(?=[аиу])/g, (s, off) => (off === 0 ? '' : s));
}
function tanween(m) {
  return m.includes(TAN_F) ? 'ан' : m.includes(TAN_D) ? 'ун' : m.includes(TAN_K) ? 'ин' : '';
}

/** Транслитерация строки (слова через пробел). */
export function translit(s) {
  return tokenize(s || '').map(t => t.t === 'w' ? translitWord(t.s) : t.s.replace(/[،]/g, ',').replace(/[؟]/g, '?').replace(/[؛]/g, ';')).join('');
}

/** Разбить «ك ت ب» / «ктб» / «كتب» в массив букв корня. */
export function rootLetters(s) {
  return norm(s || '').replace(/[\s\-–]/g, '').split('');
}
