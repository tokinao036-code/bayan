// Экраны вне урока: Путь, Неделя (+ Радио), Карточки, Словарь, Прогресс, Настройки.
import C, { allWeeks, allLessons, voiceFor, rootFamily } from './content.js';
import { h, icon, tag, star, arText, playBtns, openWord, openPhrase, img, toast, shuffle, setLessonHarakat } from './ui.js';
import { norm, stripHarakat } from './arabic.js';
import { renderCard } from './cardview.js';
import { ERR } from './check.js';
import * as srs from './srs.js';
import * as store from './store.js';
import * as tts from './tts.js';

// ---------- состояние уроков ----------
export function lessonState(id) {
  const all = allLessons();
  const i = all.findIndex(l => l.id === id);
  const st = store.get().lessons;
  if (st[id]?.done) return 'done';
  if (i === 0 || st[all[i - 1]?.id]?.done) return 'open';
  return 'locked';
}
/** Текущий урок: первый открытый и не пройденный. */
export function currentLesson() {
  return allLessons().find(l => lessonState(l.id) === 'open') || null;
}

function greeting() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 12) return 'صَباحَ الخَيْرِ';
  return 'مَساءَ الخَيْرِ';
}

const topBar = (title, extra) => h('header.top', h('div.top-t', title), extra || null,
  h('a.ib', { href: '#/settings', 'aria-label': 'Настройки' }, icon('gear')));

// =====================================================================
// ПУТЬ
// =====================================================================
export function pathScreen(root) {
  const s = store.settings();
  const cur = currentLesson();
  const curRec = cur ? store.get().lessons[cur.id] : null;
  const streak = store.streak();
  const q = srs.queue();

  const head = h('header.home-head',
    h('div',
      h('div.greet.ar', { dir: 'rtl', lang: 'ar' }, greeting()),
      h('div.sub', 'Bayan · фусха и халиджи')),
    h('div.headbtns',
      h('span.chip.streak' + (streak ? '.lit' : ''), { title: 'Серия дней' }, icon('flame'), String(streak)),
      h('a.ib', { href: '#/settings', 'aria-label': 'Настройки' }, icon('gear'))));

  const modes = h('div.modes',
    h('button.mode', { onclick: () => { store.setSetting('harakat', s.harakat === 'never' ? 'course' : 'never'); pathScreen(root); } },
      h('span.mi', h('span.ar', { dir: 'rtl' }, 'ـَـ')),
      h('span', h('small', 'Харакаты'), h('b', s.harakat === 'never' ? 'выкл' : s.harakat === 'always' ? 'всегда' : 'по курсу'))),
    h('i.sep'),
    h('button.mode', { onclick: () => { const o = ['both', 'f', 'x']; store.setSetting('variant', o[(o.indexOf(s.variant) + 1) % 3]); pathScreen(root); } },
      h('span.mi.gold', 'ф⇄х'),
      h('span', h('small', 'Диалоги'), h('b', { both: 'обе версии', f: 'только фусха', x: 'только халиджи' }[s.variant]))));

  let pill = null;
  if (cur) {
    const steps = 1; // процент по шагам сохраняется в уроке
    const pct = curRec?.step ? Math.min(95, Math.round(curRec.step / 40 * 100)) : 0;
    pill = h('a.cont.glass', { href: '#/lesson/' + cur.id },
      h('span.ring.sm', { style: { '--p': pct } }, h('b', pct + '%')),
      h('span.cont-t', h('b.ar', { dir: 'rtl', lang: 'ar' }, cur.title.ar), h('small', `Неделя ${Number(cur.week.slice(1))} · урок ${cur.n} · ${cur.title.ru}`)),
      icon('next'));
  }
  const today = h('a.todaycards', { href: '#/cards' },
    icon('cards'), h('span', h('b', `${q.list.length}`), ' карточек на сегодня'),
    q.list.length ? h('span.small.muted', `~${Math.max(1, Math.round(q.list.length * 0.25))} мин`) : h('span.small.muted', 'всё повторено'));

  const road = h('div.road');
  const nodes = [];
  for (const season of C.course.seasons) {
    road.append(h('div.season', h('div.ruqaa', { dir: 'rtl', lang: 'ar' }, season.ar), h('div.small', season.title + ' · ' + season.level)));
    season.weeks.forEach((wm, wi) => {
      const wk = C.weeks[wm.id];
      const side = wi % 2 ? 'r' : 'l';
      const firstOpen = wk && wk.lessons.some(l => lessonState(l.id) !== 'locked');
      const card = h((wk ? 'a' : 'div') + '.wk.' + side + (firstOpen ? '' : '.locked'), wk ? { href: '#/week/' + wm.id } : {},
        img(wk?.cover, wm.ru, 'wkimg'),
        h('div.wk-t',
          h('span.wk-n', 'Неделя ' + (wi + 1)),
          h('div.ruqaa', { dir: 'rtl', lang: 'ar' }, wm.ar),
          h('div.wk-ru', wm.ru)),
        !wk ? h('span.soon', 'скоро') : (!firstOpen ? h('span.lockic', icon('lock')) : null));
      road.append(card);
      nodes.push(card);
      if (wk) {
        const row = h('div.nodes');
        wk.lessons.forEach((l, li) => {
          const state = lessonState(l.id);
          const amp = Math.round(Math.sin((li + wi * 5) * 0.95) * 72);
          const n = h((state === 'locked' ? 'div' : 'a') + '.node.' + state + (cur?.id === l.id ? '.now' : ''),
            { href: state === 'locked' ? null : '#/lesson/' + l.id, style: { '--x': amp + 'px' }, 'aria-label': l.title.ru },
            star(state === 'done' ? '✓' : li + 1), h('span.nl', l.title.ru));
          row.append(n);
          nodes.push(n);
        });
        road.append(row);
        if (wk.radio) {
          const open = store.get().lessons[wk.radio.unlockAfter]?.done;
          road.append(h((open ? 'a' : 'div') + '.radiochip' + (open ? '' : '.locked'), { href: open ? '#/week/' + wm.id + '/radio' : null },
            icon('radio'), h('span', 'Радио Bayan: ' + wk.radio.title)));
        }
      }
    });
  }
  const svgWrap = h('div.ribbon');
  road.prepend(svgWrap);

  root.replaceChildren(h('div.screen.home', head, modes, pill, today, road));
  requestAnimationFrame(() => drawRibbon(road, svgWrap, nodes));
  if (cur) setTimeout(() => road.querySelector('.node.now')?.scrollIntoView({ block: 'center', behavior: 'instant' }), 60);
}

/** Светящаяся лента пути: SVG через центры карточек и уроков (сглаженная кривая). */
function drawRibbon(road, wrap, nodes) {
  const rb = road.getBoundingClientRect();
  if (!rb.width) return;
  const pts = nodes.map(n => {
    const el = n.classList.contains('node') ? n.querySelector('.star') : n;
    const b = el.getBoundingClientRect();
    return { x: b.left - rb.left + b.width / 2, y: b.top - rb.top + b.height / 2, done: n.classList.contains('done') || (!n.classList.contains('locked') && !n.classList.contains('node')) };
  });
  if (pts.length < 2) return;
  const path = (ps) => {
    let d = `M${ps[0].x},${ps[0].y}`;
    for (let i = 0; i < ps.length - 1; i++) {
      const p0 = ps[i - 1] || ps[i], p1 = ps[i], p2 = ps[i + 1], p3 = ps[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  };
  // пройденная часть — до текущего урока включительно
  const cut = Math.max(1, nodes.findIndex(n => n.classList.contains('now')) + 1 || pts.findLastIndex(p => p.done) + 1);
  const all = path(pts), done = path(pts.slice(0, Math.max(2, cut)));
  wrap.innerHTML = `<svg width="${rb.width}" height="${rb.height}" viewBox="0 0 ${rb.width} ${rb.height}" aria-hidden="true">
    <path d="${all}" class="rb-base"/>
    <path d="${done}" class="rb-glow3"/><path d="${done}" class="rb-glow2"/><path d="${done}" class="rb-glow1"/><path d="${done}" class="rb-core"/>
    <path d="${done}" class="rb-pulse"/></svg>`;
}

// =====================================================================
// НЕДЕЛЯ
// =====================================================================
export function weekScreen(root, weekId, tab = 'lessons') {
  const wk = C.weeks[weekId];
  if (!wk) { location.hash = '#/'; return; }
  const n = Number(weekId.slice(1));
  const banner = h('div.banner',
    img(wk.cover, wk.title.ru, 'bimg'),
    h('div.btxt',
      h('div.small', 'Неделя ' + n),
      h('div.ruqaa.big', { dir: 'rtl', lang: 'ar' }, wk.title.ar),
      h('div.b-ru', wk.title.ru),
      h('div.b-goal', wk.goal)));
  const tabs = h('div.tabs',
    [['lessons', 'Уроки'], ['words', 'Слова недели'], ['radio', 'Радио']].map(([k, t]) =>
    h('a.tab' + (tab === k ? '.on' : ''), { href: `#/week/${weekId}/${k}` }, t)));
  const body = h('div.wbody');
  root.replaceChildren(h('div.screen.week',
    h('header.top', h('a.ib', { href: '#/', 'aria-label': 'Назад' }, icon('back')), h('div.top-t', 'Неделя ' + n), h('span')),
    banner, tabs, body));

  if (tab === 'lessons') {
    wk.lessons.forEach((l, i) => {
      const s = lessonState(l.id);
      body.append(h((s === 'locked' ? 'div' : 'a') + '.lrow.' + s, { href: s === 'locked' ? null : '#/lesson/' + l.id },
        star(s === 'done' ? '✓' : i + 1),
        h('div.lr-t', h('b', l.title.ru), h('small', `${l.minutes} мин · ${l.words.length} слов · ${l.grammar?.title || ''}`)),
        h('span.ar.lr-ar', { dir: 'rtl', lang: 'ar' }, l.title.ar),
        s === 'locked' ? icon('lock') : null));
    });
  } else if (tab === 'words') {
    wk.lessons.forEach(l => {
      body.append(h('div.k', `Урок ${l.n}. ${l.title.ru}`));
      const list = h('div.wlist');
      l.words.forEach(w => {
        const e = C.lex[w];
        if (!e) return;
        const st = srs.wordStatus(w);
        list.append(h('button.wrow', { onclick: () => openWord(e.ar, { links: { [e.ar]: e.id } }) },
          h('i.dot.' + st), tag(e.var), h('span.ru', e.ru), h('span.ar', { dir: 'rtl', lang: 'ar' }, e.ar)));
      });
      body.append(list);
    });
  } else if (tab === 'radio') {
    radioView(body, wk);
  }
}

function radioView(body, wk) {
  const r = wk.radio;
  if (!r) { body.append(h('p.muted', 'Для этой недели эпизода нет.')); return; }
  const open = store.get().lessons[r.unlockAfter]?.done;
  if (!open) { body.append(h('div.empty', icon('lock'), h('p', 'Эпизод откроется после урока ' + C.lessons[r.unlockAfter]?.n + '.'))); return; }
  const items = [];
  const list = h('div.lines.radio');
  r.lines.forEach(line => {
    const v = line.f;
    const voice = voiceFor(line.who);
    const el = h('div.line', arText(v.ar, { links: line.links, variant: 'f', cls: 'line-ar', phrase: { ru: v.ru, voice }, sentence: v.ar }), h('div.lru', v.ru));
    el.addEventListener('dblclick', () => openPhrase(v.ar, { ru: v.ru, voice }));
    items.push({ text: v.ar, voice, el });
    list.append(el);
  });
  body.append(
    h('div.radiohead', icon('radio', 'big'), h('div', h('b', r.title), h('div.ruqaa', { dir: 'rtl' }, r.ar || ''), h('small.muted', 'Весь сюжет недели одним рассказом — только знакомые слова. Слушай в дороге.'))),
    h('div.row2.tools',
      h('button.btn.primary', { onclick: () => tts.speakSeq(items, (i) => items.forEach((x, k) => { x.el.classList.toggle('speaking', k === i); if (k === i) x.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); })) }, icon('play'), ' Слушать'),
      h('button.btn.soft', { onclick: () => tts.stop() }, icon('stop'), ' Стоп'),
      h('button.btn.soft', { onclick: () => list.classList.toggle('show-ru') }, icon('eye'), ' Перевод')),
    list);
}

// =====================================================================
// КАРТОЧКИ
// =====================================================================
export function cardsScreen(root) {
  const q = srs.queue();
  const all = Object.values(store.get().cards);
  const start = (filter, label) => {
    let list = q.list;
    if (filter) list = list.filter(filter);
    if (!list.length) { toast('Сейчас нечего повторять в этом режиме'); return; }
    session(root, list, label);
  };
  root.replaceChildren(h('div.screen.cards',
    topBar('Карточки'),
    h('div.cardsum',
      h('div.big3', String(q.list.length)),
      h('div', 'на сегодня'),
      h('div.small.muted', `${q.due.length} повторений · ${q.fresh.length} новых · ~${Math.max(1, Math.round(q.list.length * 0.25))} мин`)),
    h('button.btn.primary.wide', { disabled: !q.list.length, onclick: () => start(null, 'Повторение') }, q.list.length ? 'Начать' : 'На сегодня всё повторено'),
    h('div.modes2',
      h('button.btn.soft', { onclick: () => start(c => c.type === 'listen' || c.type === 'read', 'Только аудио и узнавание') }, icon('speaker'), ' Для дороги'),
      h('button.btn.soft', { onclick: () => start(c => c.type === 'write' || c.type === 'cloze' || c.type === 'gram', 'Письмо и грамматика') }, icon('para'), ' Письмо')),
    h('div.k', 'Всего карточек'),
    h('div.stats3',
      stat(all.length, 'всего'),
      stat(all.filter(c => c.state === 'review').length, 'на повторении'),
      stat(Object.keys(C.lex).filter(w => srs.wordStatus(w) === 'known').length, 'слов выучено')),
    h('p.small.muted', 'Слово считается выученным после трёх удачных припоминаний в разные дни. Новые типы карточек (аудио, пропуск, письмо) открываются, когда слово уверенно узнаётся.'),
    !all.length ? h('div.empty', icon('cards'), h('p', 'Карточки появятся после первого урока.')) : null));
}
const stat = (n, t) => h('div.stat', h('b', String(n)), h('small', t));

function session(root, list, label) {
  let i = 0, ok = 0;
  document.body.classList.add('in-lesson'); // как в уроке: панель вкладок прячется, внизу только кнопки ответа
  const body = h('main.pbody');
  const btn = h('button.btn.primary.wide');
  const foot = h('footer.pfoot', btn);
  const bar = h('div.pbar', h('i'));
  const cnt = h('span.pcount');
  root.replaceChildren(h('div.player',
    h('header.ptop.glass', h('button.ib', { 'aria-label': 'Закрыть', onclick: () => { tts.stop(); document.body.classList.remove('in-lesson'); cardsScreen(root); } }, icon('close')),
      h('div.pmid', bar, h('div.plabel', h('span.pstep', label), cnt))), body, foot));
  let fn = null;
  btn.onclick = () => fn && fn();
  const setButton = (l, f) => { fn = f; foot.classList.toggle('hidden', !l); btn.textContent = l || ''; };
  const show = () => {
    if (i >= list.length) {
      body.replaceChildren(h('div.finish', star('✓', 'big'), h('h2', 'Готово!'), h('p', `Карточек: ${list.length}, вспомнил(а) сразу: ${ok}.`)));
      setButton('К пути', () => { document.body.classList.remove('in-lesson'); location.hash = '#/'; });
      return;
    }
    const card = store.get().cards[list[i].id];
    bar.firstChild.style.transform = `scaleX(${(i + 1) / list.length})`;
    cnt.textContent = `${i + 1}/${list.length}`;
    body.replaceChildren(renderCard(card, {
      setButton,
      done: (g) => {
        srs.answer(card.id, g);
        if (g >= 3) ok++;
        if (g === 1) list.push(store.get().cards[card.id]); // «Снова» — ещё раз в конце сессии
        i++; tts.stop(); show();
      },
    }));
  };
  show();
}

// =====================================================================
// СЛОВАРЬ
// =====================================================================
const dictState = { q: '', v: 'all', sphere: '', all: false, tab: 'words' };
export function dictScreen(root, rootParam) {
  if (rootParam) return rootScreen(root, decodeURIComponent(rootParam));
  const studied = new Set(allLessons().filter(l => store.get().lessons[l.id]?.done).flatMap(l => l.words));
  Object.values(store.get().cards).forEach(c => c.word && studied.add(c.word));
  const input = h('input.search', { type: 'search', placeholder: 'Русский, арабский или корень (ктб, ك ت ب)', value: dictState.q });
  const list = h('div.wlist');
  const tabs = h('div.tabs', [['words', 'Слова'], ['roots', 'Корни'], ['saved', 'Предложения']].map(([k, t]) =>
    h('button.tab' + (dictState.tab === k ? '.on' : ''), { onclick: () => { dictState.tab = k; dictScreen(root); } }, t)));
  const chips = h('div.filters',
    ['all', 'f', 'x', 'fx'].map(v => h('button.chip' + (dictState.v === v ? '.on' : ''), { onclick: () => { dictState.v = v; dictScreen(root); } }, { all: 'все', f: 'ф', x: 'х', fx: 'ф+х' }[v])),
    h('select.chip', { onchange: (e) => { dictState.sphere = e.target.value; draw(); } },
      h('option', { value: '' }, 'все сферы'), Object.entries(C.course.spheres).map(([k, t]) => h('option', { value: k, selected: dictState.sphere === k }, t))),
    h('label.chip', h('input', { type: 'checkbox', checked: dictState.all, onchange: (e) => { dictState.all = e.target.checked; draw(); } }), ' весь курс'));
  root.replaceChildren(h('div.screen.dict', topBar('Словарь'), tabs,
    dictState.tab !== 'saved' ? input : null, dictState.tab === 'words' ? chips : null, list));

  // перевод «ктб» → «كتب» для поиска по корню
  const RU2AR = { к: 'ك', т: 'ت', б: 'ب', д: 'د', р: 'ر', с: 'س', л: 'ل', м: 'م', н: 'ن', ф: 'ف', х: 'خ', ш: 'ش', з: 'ز', г: 'غ', в: 'و', й: 'ي', ж: 'ج' };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    dictState.q = q;
    list.replaceChildren();
    if (dictState.tab === 'saved') {
      const saved = store.get().saved;
      if (!saved.length) list.append(h('div.empty', icon('bookmark'), h('p', 'Сохраняй предложения из диалогов — кнопка «Сохранить предложение» в карточке слова или фразы.')));
      saved.forEach(s => list.append(h('div.saved', arText(s.ar, { cls: 'mid' }), playBtns(s.ar, voiceFor('narrator')), h('div.small.muted', s.ru))));
      return;
    }
    let entries = Object.values(C.lex).filter(e => e.pos !== 'name' && (dictState.all || studied.has(e.id)));
    if (dictState.tab === 'roots') {
      const roots = new Map();
      entries.filter(e => e.root).forEach(e => { const k = e.root; (roots.get(k) || roots.set(k, []).get(k)).push(e); });
      let rs = [...roots.entries()].sort((a, b) => b[1].length - a[1].length);
      if (q) { const nq = norm(q.split('').map(c => RU2AR[c] || c).join('')).replace(/\s/g, ''); rs = rs.filter(([r]) => norm(r).replace(/\s/g, '').includes(nq)); }
      if (!rs.length) list.append(h('div.empty', icon('root'), h('p', 'Корни появятся по мере изучения слов. Включи «весь курс» на вкладке «Слова», чтобы увидеть всё.')));
      rs.forEach(([r, es]) => list.append(h('a.rootrow', { href: '#/dict/root/' + encodeURIComponent(r) },
        h('span.ar.rootbig', { dir: 'rtl' }, r.split(' ').join(' - ')), h('span.small.muted', es.length + ' сл.'),
        h('span.ar.small', { dir: 'rtl' }, es.slice(0, 4).map(e => e.ar).join('، ')))));
      return;
    }
    if (dictState.v !== 'all') entries = entries.filter(e => e.var === dictState.v);
    if (dictState.sphere) entries = entries.filter(e => (e.spheres || []).includes(dictState.sphere));
    if (q) {
      const nq = norm(q);
      const rq = norm(q.split('').map(c => RU2AR[c] || c).join('')).replace(/\s/g, '');
      entries = entries.filter(e => e.ru.toLowerCase().includes(q) || norm(e.ar).includes(nq) || (e.forms || []).some(f => norm(f).includes(nq))
        || (e.root && norm(e.root).replace(/\s/g, '') === rq));
    }
    entries.sort((a, b) => stripHarakat(a.ar).localeCompare(stripHarakat(b.ar), 'ar'));
    if (!entries.length) list.append(h('div.empty', icon('book'), h('p', studied.size ? 'Ничего не найдено.' : 'Здесь появятся слова пройденных уроков. Чтобы посмотреть весь словарь курса, отметь «весь курс».')));
    entries.slice(0, 300).forEach(e => list.append(h('button.wrow', { onclick: () => openWord(e.ar, { links: { [e.ar]: e.id } }) },
      h('i.dot.' + srs.wordStatus(e.id)), tag(e.var), h('span.ru', e.ru), h('span.ar', { dir: 'rtl', lang: 'ar' }, e.ar))));
  };
  input.addEventListener('input', draw);
  draw();
}

function rootScreen(root, r) {
  const fam = rootFamily(r);
  root.replaceChildren(h('div.screen.dict',
    h('header.top', h('a.ib', { href: '#/dict', 'aria-label': 'Назад' }, icon('back')), h('div.top-t', 'Корень'), h('span')),
    h('div.roothead', h('div.ar.rootbig', { dir: 'rtl' }, r.split(' ').join(' - ')), h('div.small.muted', 'Однокоренные слова. Бледные — ещё не изучены.')),
    h('div.tree', fam.map(e => h('button.trow' + (srs.wordStatus(e.id) === 'new' && e.week !== 'base' ? '.pale' : ''), { onclick: () => openWord(e.ar, { links: { [e.ar]: e.id } }) },
      h('span.ar', { dir: 'rtl', lang: 'ar' }, e.ar), h('span.pat.ar', { dir: 'rtl' }, e.pattern || ''), h('span.ru', e.ru))))));
}

// =====================================================================
// ПРОГРЕСС
// =====================================================================
export function progressScreen(root) {
  const st = store.get();
  const known = Object.keys(C.lex).filter(w => srs.wordStatus(w) === 'known').length;
  const learning = Object.keys(C.lex).filter(w => srs.wordStatus(w) === 'learning').length;
  const done = Object.values(st.lessons).filter(l => l.done).length;
  // календарь последних 12 недель
  const cal = h('div.cal');
  const d = new Date(); d.setDate(d.getDate() - 83);
  for (let i = 0; i < 84; i++) {
    const k = store.today(new Date(d.getTime() + 4 * 3600e3 + 12 * 3600e3));
    const x = st.days[k];
    const lvl = !x ? 0 : (x.lessons ? 3 : x.cards >= 20 ? 2 : (x.cards >= 5 || x.steps >= 3) ? 1 : 0);
    cal.append(h('i.l' + lvl, { title: k }));
    d.setDate(d.getDate() + 1);
  }
  const SK = { reading: 'Чтение', listening: 'Аудирование', writing: 'Письмо', speaking: 'Говорение', grammar: 'Грамматика' };
  const skills = h('div.skills', Object.entries(SK).map(([k, t]) => {
    const a = st.skills[k] || [];
    const p = a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) : 0;
    return h('div.skill', h('span', t), h('span.sbar', h('i', { style: { transform: `scaleX(${p / 100})` } })), h('b', a.length ? p + '%' : '—'));
  }));
  // слабые места: типы ошибок за 30 дней
  const since = Date.now() - 30 * 86400e3;
  const cnt = {};
  st.errors.filter(e => e.ts > since).forEach(e => (cnt[e.t] = (cnt[e.t] || 0) + 1));
  const weak = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const hard = Object.values(st.cards).filter(c => c.word && c.lapses).sort((a, b) => b.lapses - a.lapses).slice(0, 8);
  root.replaceChildren(h('div.screen.progress', topBar('Прогресс'),
    h('div.stats3', stat(known, 'выучено'), stat(learning, 'учу'), stat(done, 'уроков')),
    h('div.stats3', stat(store.streak(), 'серия дней'), stat(store.totalDays(), 'дней всего'), stat(Object.keys(st.saved).length, 'предложений')),
    h('div.k', 'Последние 12 недель'), cal,
    h('p.small.muted', 'Пропущенный день раз в неделю не обрывает серию.'),
    h('div.k', 'Навыки (последние ответы)'), skills,
    h('div.k', 'Слабые места'),
    weak.length ? h('div.weak', weak.map(([t, n]) => h('div.wk-row', h('span', ERR[t] || t), h('b', n)))) : h('p.small.muted', 'Пока ошибок нет — или ты ещё не начинал(а).'),
    hard.length ? h('div', h('div.k', 'Трудные слова'), h('div.wordchips', hard.map(c => h('button.chip', { dir: 'rtl', onclick: () => openWord(C.lex[c.word].ar, { links: { [C.lex[c.word].ar]: c.word } }) }, C.lex[c.word].ar)))) : null,
    weak.length || hard.length ? h('button.btn.soft.wide', { onclick: () => {
      const words = new Set([...st.errors.slice(-60).map(e => e.item?.word), ...hard.map(c => c.word)].filter(Boolean));
      const list = Object.values(st.cards).filter(c => words.has(c.word));
      if (!list.length) return toast('Нет карточек для тренировки');
      location.hash = '#/cards'; setTimeout(() => session(document.getElementById('view'), shuffle(list).slice(0, 20), 'Слабые места'), 50);
    } }, icon('refresh'), ' Потренировать слабые места') : null));
}

// =====================================================================
// НАСТРОЙКИ
// =====================================================================
export function settingsScreen(root, onApply) {
  const s = store.settings();
  const seg = (key, opts) => h('div.seg', opts.map(([v, t]) =>
    h('button' + (s[key] === v ? '.on' : ''), { onclick: () => { store.setSetting(key, v); onApply?.(); settingsScreen(root, onApply); } }, t)));
  const sw = (key, label, sub) => h('label.swrow', h('span', h('b', label), sub ? h('small', sub) : null),
    h('input.switch', { type: 'checkbox', checked: !!s[key], onchange: (e) => { store.setSetting(key, e.target.checked); onApply?.(); } }));
  const file = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' }, onchange: async (e) => {
    try { await store.importFile(e.target.files[0]); toast('Прогресс восстановлен'); location.reload(); } catch (err) { toast(err.message); }
  } });
  root.replaceChildren(h('div.screen.settings',
    h('header.top', h('a.ib', { href: '#/', 'aria-label': 'Назад' }, icon('back')), h('div.top-t', 'Настройки'), h('span')),
    h('div.k', 'Вид'),
    h('div.setrow', h('span', 'Тема'), seg('theme', [['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']])),
    h('div.setrow', h('span', h('b', 'Стекло'), h('small', 'Без размытия — быстрее на слабых устройствах')), seg('lite', [['auto', 'Авто'], ['off', 'Стекло'], ['on', 'Лёгкий']])),
    h('div.k', 'Текст'),
    h('div.setrow', h('span', 'Харакаты'), seg('harakat', [['course', 'По курсу'], ['always', 'Всегда'], ['never', 'Нет']])),
    h('div.setrow', h('span', 'Диалоги'), seg('variant', [['both', 'Обе'], ['f', 'Фусха'], ['x', 'Халиджи']])),
    sw('translit', 'Транслитерация', 'Русскими буквами под арабским текстом'),
    h('div.k', 'Озвучка'),
    h('div.setrow', h('span', 'Медленная скорость'), seg('slowRate', [[0.6, '0.6×'], [0.7, '0.7×'], [0.8, '0.8×']])),
    h('div.setrow', h('span', 'Обычная скорость'), seg('rate', [[0.9, '0.9×'], [1, '1×'], [1.1, '1.1×']])),
    h('div.k', 'Карточки'),
    h('div.setrow', h('span', 'Новых в день'), seg('newPerDay', [[10, '10'], [20, '20'], [30, '30']])),
    h('div.setrow', h('span', 'Повторений в день'), seg('reviewsPerDay', [[60, '60'], [120, '120'], [300, '300']])),
    sw('strict', 'Строгая проверка письма', 'Хамза, ة и ى считаются ошибкой'),
    h('div.k', 'Данные'),
    h('button.btn.soft.wide', { onclick: () => window.bayanDownloadAll?.(true) }, icon('refresh'), ' Скачать всё для офлайна'),
    h('button.btn.soft.wide', { onclick: () => store.exportFile() }, 'Сохранить прогресс в файл'),
    h('button.btn.soft.wide', { onclick: () => file.click() }, 'Восстановить из файла'), file,
    h('button.btn.ghost.wide.danger', { onclick: () => { if (confirm('Стереть весь прогресс? Это нельзя отменить.')) { store.resetAll(); location.hash = '#/'; location.reload(); } } }, 'Сбросить прогресс'),
    h('p.small.muted.center', 'Bayan · сезон 1 · данные хранятся только на этом устройстве')));
}
