// Плеер урока: претест → разминка → слова → диалог/текст → грамматика → упражнения → говорение → письмо → итог.
import C, { lineRef, voiceFor, resolve } from './content.js';
import { h, icon, tag, star, arText, playBtns, openPhrase, img, shuffle, toast, md, setLessonHarakat, showHarakat, closeSheet } from './ui.js';
import { isArabic, stripHarakat, norm } from './arabic.js';
import { check, diffHTML, inputHTML, ERR } from './check.js';
import { renderCard } from './cardview.js';
import * as srs from './srs.js';
import * as store from './store.js';
import * as tts from './tts.js';

const STEP = {
  intro: 'Начало', pretest: 'Претест', warmup: 'Разминка', words: 'Новые слова', dialogue: 'Диалог', text: 'Текст',
  grammar: 'Грамматика', exercises: 'Упражнения', speaking: 'Говорение', writing: 'Письмо', summary: 'Итог',
};

/** Голос и обе версии реплики — для шторки фразы. */
function phraseOf(line, v) {
  const other = v === 'f' ? line.x : line.f;
  return {
    ru: line[v].ru, lit: line[v].lit, voice: voiceFor(line.who),
    other: other ? { v: v === 'f' ? 'x' : 'f', ar: other.ar, ru: other.ru } : null,
  };
}

/** Собрать список экранов урока. */
function buildScreens(lesson) {
  const S = [{ step: 'intro' }];
  (lesson.pretest || []).forEach((it, i) => S.push({ step: 'pretest', i, n: lesson.pretest.length, item: it }));
  const wu = srs.warmup(lesson.warmup?.count || 6, lesson.id);
  wu.forEach((card, i) => S.push({ step: 'warmup', i, n: wu.length, card: card.id }));
  (lesson.words || []).forEach((w, i) => S.push({ step: 'words', i, n: lesson.words.length, word: w }));
  if (lesson.dialogue) S.push({ step: 'dialogue' });
  if (lesson.text) S.push({ step: 'text' });
  if (lesson.grammar) S.push({ step: 'grammar' });
  (lesson.exercises || []).forEach((ex, i) => S.push({ step: 'exercises', i, n: lesson.exercises.length, ex }));
  (lesson.speaking?.shadow || []).forEach((ref, i) => S.push({ step: 'speaking', i, n: lesson.speaking.shadow.length, ref }));
  (lesson.writing || []).forEach((w, i) => S.push({ step: 'writing', i, n: lesson.writing.length, w }));
  S.push({ step: 'summary' });
  return S;
}

/** Открыть урок. root — контейнер экрана. */
export function openLesson(root, lessonId, onExit) {
  const lesson = C.lessons[lessonId];
  const week = C.weeks[lesson.week];
  const st = store.get();
  const rec = (st.lessons[lessonId] ||= { step: 0, ok: 0, all: 0 });
  // при повторном прохождении начинаем с начала
  if (rec.done && !rec.step) { rec.ok = 0; rec.all = 0; }
  const screens = buildScreens(lesson);
  const retry = new Set(); // упражнения, которые уже повторялись после ошибки
  let idx = Math.min(rec.step || 0, screens.length - 1);
  setLessonHarakat(null);

  // ---- каркас плеера ----
  const bar = h('div.pbar', h('i'));
  const counter = h('span.pcount');
  const harBtn = h('button.chip.small', { onclick: () => { setLessonHarakat(!showHarakat(week.harakat, 'text')); render(); } });
  const varBtn = h('button.chip.small', { onclick: () => {
    const order = ['both', 'f', 'x'];
    store.setSetting('variant', order[(order.indexOf(store.settings().variant) + 1) % 3]);
    render();
  } });
  const backBtn = h('button.ib', { 'aria-label': 'Предыдущий шаг', onclick: () => prev() }, icon('back'));
  const top = h('header.ptop.glass',
    h('button.ib', { 'aria-label': 'Закрыть урок', onclick: () => { tts.stop(); onExit(); } }, icon('close')),
    backBtn,
    h('div.pmid', bar, h('div.plabel', h('span.pstep'), counter)),
    harBtn, varBtn);
  const body = h('main.pbody');
  const btn = h('button.btn.primary.wide');
  const foot = h('footer.pfoot', btn);
  root.replaceChildren(h('div.player', top, body, foot));

  let btnFn = null;
  btn.addEventListener('click', () => btnFn && btnFn());
  /** Настроить главную кнопку внизу (null — спрятать). */
  function setButton(label, fn, opts = {}) {
    btnFn = fn;
    foot.classList.toggle('hidden', !label);
    btn.textContent = label || '';
    btn.disabled = !!opts.disabled;
    btn.className = 'btn wide ' + (opts.kind || 'primary');
  }
  function next() {
    tts.stop(); closeSheet();
    idx++;
    rec.step = idx;
    store.logDay('steps');
    if (idx >= screens.length) return finish();
    render();
  }
  /** Назад на предыдущий шаг. Разминку (карточки уже оценены) пропускаем. */
  function prev() {
    tts.stop(); closeSheet();
    let j = idx - 1;
    while (j > 0 && screens[j].step === 'warmup') j--;
    if (j < 0) return;
    idx = j;
    rec.step = idx;
    store.save();
    render();
  }
  const counted = new Set(); // экраны, ответ на которых уже учтён (при возврате назад не считаем дважды)
  function result(ok, skill, errType, item) {
    if (counted.has(screens[idx])) return;
    counted.add(screens[idx]);
    rec.all++; if (ok) rec.ok++;
    store.logSkill(skill, ok);
    if (!ok && errType) store.logError(errType, { lesson: lessonId, ...item });
    store.save();
  }
  /** Блок обратной связи после ответа. */
  function feedback(ok, text, extra) {
    const f = h('div.fb ' + (ok === 'near' ? 'near' : ok ? 'ok' : 'bad'),
      h('div.fb-title', ok === 'near' ? 'Почти!' : ok ? pick(['Верно!', 'Точно!', 'Отлично!', 'Так и есть!']) : 'Не совсем'),
      text ? h('div.small', { html: md(text) }) : null, extra || null);
    body.append(f);
    requestAnimationFrame(() => f.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    return f;
  }

  function render() {
    const sc = screens[idx];
    bar.firstChild.style.transform = `scaleX(${(idx + 1) / screens.length})`;
    top.querySelector('.pstep').textContent = STEP[sc.step];
    counter.textContent = sc.n ? `${sc.i + 1}/${sc.n}` : '';
    harBtn.textContent = showHarakat(week.harakat, 'text') ? 'حَرَكات' : 'حركات';
    harBtn.title = 'Харакаты вкл/выкл';
    varBtn.textContent = { both: 'ф+х', f: 'ф', x: 'х' }[store.settings().variant];
    varBtn.title = 'Фусха / халиджи / обе';
    body.replaceChildren();
    body.scrollTop = 0;
    body.className = 'pbody step-' + sc.step;
    backBtn.disabled = idx === 0;
    backBtn.classList.toggle('hidden', idx === 0);
    const fn = R[sc.step];
    fn(sc);
  }

  // ---------- экраны ----------
  const R = {
    intro() {
      const nWords = (lesson.words || []).length;
      body.append(
        h('div.intro',
          img(lesson.cover, lesson.title.ru, 'introimg'),
          h('div.intro-t',
            h('div.small', `Неделя ${Number(lesson.week.slice(1))} · урок ${lesson.n}`),
            h('div.ruqaa.big', { dir: 'rtl', lang: 'ar' }, lesson.title.ar),
            h('h2', lesson.title.ru))),
        lesson.story ? h('div.story', icon('sparkle'), h('span', lesson.story)) : null,
        h('div.today',
          h('div.k', 'Сегодня'),
          h('div.trow2', icon('book'), h('span', `${nWords} новых слов`)),
          lesson.dialogue ? h('div.trow2', icon('para'), h('span', 'Диалог: ' + (lesson.dialogue.scene || ''))) : null,
          lesson.text ? h('div.trow2', icon('para'), h('span', 'Текст: ' + (lesson.text.title || ''))) : null,
          lesson.grammar ? h('div.trow2', icon('root'), h('span', 'Грамматика: ' + lesson.grammar.title)) : null,
          h('div.trow2', icon('mic'), h('span', 'Шэдоуинг и письмо')),
          h('div.trow2', icon('chart'), h('span', `~${lesson.minutes || 25} минут`))),
        lesson.gallery?.length ? h('div.gallery', lesson.gallery.map(g => img(g, '', 'gimg'))) : null);
      setButton(rec.step ? 'Продолжить' : 'Начать', next);
    },

    pretest(sc) {
      const it = sc.item;
      body.append(h('div.hint', icon('sparkle'), 'Попробуй угадать до объяснения — ошибаться здесь нормально, так новое запомнится лучше.'),
        h('div.qbox', it.img ? img(it.img, '', 'qimg') : null, h('span.ar.huge', { dir: 'rtl', lang: 'ar' }, it.ar), playBtns(it.ar, voiceFor(null, null)), h('div.muted', it.hint)));
      choice(it.options, it.answer, (ok) => {
        result(ok, null);
        feedback(ok, ok ? 'Догадка по корню сработала.' : 'Правильно: **' + it.options[it.answer] + '**. Запомни корень — он ещё встретится.');
        setButton('Дальше', next);
      }, { arabic: false });
      setButton(null);
    },

    warmup(sc) {
      const card = store.get().cards[sc.card];
      if (!card) return next();
      body.append(renderCard(card, {
        setButton: (l, f) => setButton(l, f),
        done: (g) => { srs.answer(card.id, g); result(g >= 3, null); next(); },
      }));
    },

    words(sc) {
      const e = C.lex[sc.word];
      if (!e) return next();
      const v = voiceFor(null, e);
      const card = h('div.wordcard',
        e.img ? img(e.img, e.ru, 'wimg') : null,
        h('div.wc-top', tag(e.var), e.dial?.length ? h('span.muted.small', e.dial.map(d => ({ sa: 'Саудия', ae: 'ОАЭ', kw: 'Кувейт' }[d])).join(' · ')) : null),
        h('div.wc-word', h('span.ar.huge', { dir: 'rtl', lang: 'ar' }, e.ar), playBtns(e.ar, v)),
        h('div.wc-meta',
          e.root ? h('span.chip.root', icon('root'), h('span.ar', { dir: 'rtl' }, e.root.split(' ').join(' - '))) : null,
          e.pattern ? h('span.chip', h('span.ar', { dir: 'rtl' }, e.pattern)) : null,
          e.form ? h('span.chip', e.form) : null));
      body.append(card);
      const back = h('div.wc-back',
        h('div.ru.big', e.ru),
        e.pl ? h('div.small', h('span.muted', 'мн. ч. '), h('span.ar', { dir: 'rtl' }, e.pl)) : null,
        e.pres ? h('div.small', h('span.muted', 'наст. вр. '), h('span.ar', { dir: 'rtl' }, e.pres)) : null,
        e.ex ? h('div.wc-ex', arText(e.ex.ar, { prefer: [e.id] }), playBtns(e.ex.ar, v), h('div.ru.muted', e.ex.ru)) : null,
        e.pair && C.lex[e.pair] ? h('div.wc-pair', h('span.muted', e.var === 'x' ? 'на фусхе: ' : 'в халиджи: '), tag(C.lex[e.pair].var), ' ',
          h('span.ar', { dir: 'rtl' }, C.lex[e.pair].ar), ' — ', C.lex[e.pair].ru, playBtns(C.lex[e.pair].ar, voiceFor(null, C.lex[e.pair]))) : null,
        e.note ? h('p.small.note', e.note) : null);
      tts.speak(e.ar, { voice: v });
      if (e.root) {
        body.append(h('div.hint', icon('sparkle'), 'Попробуй угадать значение по корню и модели, потом открой.'));
        setButton('Показать значение', () => { body.append(back); back.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); if (e.ex) tts.speak(e.ex.ar, { voice: v }); setButton('Дальше', next); });
      } else {
        body.append(back);
        setButton('Дальше', next);
      }
    },

    dialogue() { renderLines(lesson.dialogue, 'dialogue'); },
    text() { renderLines(lesson.text, 'text'); },

    grammar() {
      const g = lesson.grammar;
      if (g.img) body.append(img(g.img, g.title, 'gramimg'));
      body.append(h('h2.gtitle', g.title), h('p.gtext', { html: md(g.text) }));
      if (g.table) {
        const t = h('table.gtable');
        t.append(h('thead', h('tr', g.table.head.map(x => h('th', x)))));
        const tb = h('tbody');
        g.table.rows.forEach(r => tb.append(h('tr', r.map(c => isArabic(c) && !/[а-яё]/i.test(c)
          ? h('td.arc', { dir: 'rtl', lang: 'ar' }, h('button.cellplay', { onclick: () => tts.speak(c, { voice: voiceFor(null, null) }) }, c))
          : h('td', c)))));
        t.append(tb);
        body.append(h('div.tablewrap', t));
      }
      if (g.note) body.append(h('p.gnote', { html: md(g.note) }));
      if (g.why) {
        body.append(h('div.whyq', h('div.k', 'Объясни себе'), h('div', g.why.q)));
        choice(g.why.options, g.why.answer, (ok) => {
          result(ok, 'grammar', 'grammar');
          feedback(ok, ok ? 'Именно так.' : 'Верный ответ: ' + g.why.options[g.why.answer]);
          setButton('Дальше', next);
        }, { arabic: false, vertical: true });
        setButton(null);
      } else setButton('Дальше', next);
    },

    exercises(sc) { const f = EX[sc.ex.type]; if (f) f(sc.ex, sc); else next(); },

    speaking(sc) {
      const r = lineRef(lesson, sc.ref);
      if (!r) return next();
      const voice = voiceFor(r.who);
      const text = r.variant.ar;
      body.append(h('div.hint', icon('mic'), 'Шэдоуинг: послушай, повтори вслух сразу за диктором, запиши себя и сравни.'),
        h('div.shadow', tag(r.v), arText(text, { cls: 'big2', phrase: phraseOf(r.line, r.v), sentence: text }), h('div.ru.muted', r.variant.ru)));
      const ctr = h('div.shctl',
        h('button.btn.soft', { onclick: () => tts.speak(text, { voice }) }, icon('play'), ' Диктор'),
        h('button.btn.soft', { onclick: () => tts.speak(text, { voice, slow: true }) }, icon('slow'), ' Медленно'));
      body.append(ctr);
      if (tts.canRecord()) {
        let recr = null, myUrl = null;
        const recBtn = h('button.btn.rec', { onclick: async () => {
          if (!recr) {
            try { recr = await tts.record(); recBtn.classList.add('on'); recBtn.lastChild.textContent = ' Стоп'; }
            catch { toast('Нет доступа к микрофону'); }
          } else {
            myUrl = await recr.stop(); recr = null;
            recBtn.classList.remove('on'); recBtn.lastChild.textContent = ' Записать ещё';
            mine.disabled = false;
            await tts.playUrl(myUrl);
            await tts.speak(text, { voice });
          }
        } }, icon('mic'), h('span', ' Записать себя'));
        const mine = h('button.btn.soft', { disabled: true, onclick: () => myUrl && tts.playUrl(myUrl) }, icon('play'), ' Моя запись');
        body.append(h('div.shctl', recBtn, mine));
      } else body.append(h('p.small.muted', 'Запись голоса недоступна в этом браузере — просто повтори вслух.'));
      body.append(h('div.selfrate', h('div.k', 'Как получилось?'),
        h('div.row2',
          h('button.btn.soft', { onclick: () => { result(true, 'speaking'); next(); } }, 'Похоже'),
          h('button.btn.soft', { onclick: () => { result(false, 'speaking'); store.logError('pron', { lesson: lessonId, ref: sc.ref }); next(); } }, 'Надо ещё поработать'))));
      setButton(null);
      setTimeout(() => tts.speak(text, { voice }), 300);
    },

    writing(sc) { (W[sc.w.type] || (() => next()))(sc.w, sc); },

    summary() { finish(true); },
  };

  // ---------- диалог / текст ----------
  function renderLines(block, part) {
    const mode = store.settings().variant;
    const har = showHarakat(week.harakat, part === 'text' ? 'text' : 'dialogue');
    const items = [];
    const head = h('div.scene',
      block.img || lesson.cover ? img(block.img || lesson.cover, block.scene || '', 'sceneimg') : null,
      h('div.scene-t', h('div.small.muted', part === 'text' ? (block.title || 'Текст') : 'Сцена'), h('div', block.scene || block.title || '')));
    const playAll = h('button.btn.soft', { onclick: () => {
      const seq = items.map(x => ({ text: x.text, voice: x.voice }));
      tts.speakSeq(seq, (i) => items.forEach((x, k) => x.el.classList.toggle('speaking', k === i)));
    } }, icon('play'), ' Весь ' + (part === 'text' ? 'текст' : 'диалог'));
    const trBtn = h('button.btn.soft', { onclick: () => { list.classList.toggle('show-ru'); } }, icon('eye'), ' Перевод');
    body.append(head, h('div.row2.tools', playAll, trBtn));
    const list = h('div.lines' + (block.kind === 'chat' ? '.chat' : ''));
    block.lines.forEach((line, n) => {
      const sp = C.course.speakers[line.who] || {};
      const voice = sp.voice;
      const isMe = line.who === 'timur';
      const variants = mode === 'both' ? ['f', 'x'] : [mode];
      const bubble = h('div.line' + (isMe ? '.me' : ''), h('div.who', { style: { color: sp.color } }, sp.name || ''));
      variants.forEach(v => {
        if (v === 'x' && !line.x && mode === 'both') return; // реплика только на фусхе (лекция, письмо)
        const vv = line[v] || line.f;
        if (!vv) return;
        const realV = line[v] ? v : 'f';
        const ph = phraseOf(line, realV);
        const row = h('div.lv.v-' + realV,
          tag(realV),
          arText(vv.ar, { variant: realV, harakat: har, links: line.links, ctx: line.ctx, prefer: lesson.words, phrase: ph, src: lessonId, cls: realV === 'f' ? 'line-ar' : 'line-ar sub' }),
          h('div.lbtns',
            h('button.ib.sm', { 'aria-label': 'Прослушать', onclick: () => tts.speak(vv.ar, { voice }) }, icon('play')),
            h('button.ib.sm.slowb', { 'aria-label': 'Медленно', onclick: () => tts.speak(vv.ar, { voice, slow: true }) }, store.settings().slowRate + '×'),
            h('button.ib.sm', { 'aria-label': 'Перевод фразы', onclick: () => openPhrase(vv.ar, ph, lessonId) }, icon('para'))),
          h('div.lru', vv.ru));
        bubble.append(row);
        items.push({ text: vv.ar, voice, el: bubble });
      });
      list.append(bubble);
      if (line.img) list.append(h('figure.lineimg', img(line.img, line.cap || '', 'limg'), line.cap ? h('figcaption', line.cap) : null));
    });
    body.append(list, h('p.small.muted.center', 'Нажми на любое слово — откроется карточка. ¶ — перевод всей фразы.'));
    setButton('Дальше', next);
  }

  // ---------- вспомогательное: выбор варианта ----------
  function choice(options, answer, onDone, { arabic = null, vertical = false } = {}) {
    const grid = h('div.opts' + (vertical ? '.vert' : ''));
    const order = shuffle(options.map((o, i) => i));
    order.forEach(i => {
      const o = options[i];
      const ar = arabic ?? isArabic(o);
      grid.append(h('button.opt' + (ar ? '.arabic' : ''), { dir: ar ? 'rtl' : 'auto', lang: ar ? 'ar' : 'ru', 'data-i': i, onclick: (ev) => {
        const ok = i === answer;
        grid.querySelectorAll('button').forEach(b => { b.disabled = true; if (Number(b.dataset.i) === answer) b.classList.add('ok'); });
        if (!ok) ev.currentTarget.classList.add('bad');
        if (ar) tts.speak(options[answer], { voice: voiceFor(null, null) });
        onDone(ok);
      } }, o));
    });
    body.append(grid);
    return grid;
  }

  /** Неверно решённое упражнение повторяется в конце блока упражнений (один раз). */
  function retryLater(sc) {
    const key = sc.ex || sc.w;
    if (retry.has(key)) return;
    retry.add(key);
    let last = idx;
    while (last + 1 < screens.length && screens[last + 1].step === 'exercises') last++;
    screens.splice(last + 1, 0, { ...sc, retry: true });
  }

  // ---------- упражнения ----------
  const EX = {
    match(ex) {
      body.append(h('div.q', 'Соедини пары'));
      const left = h('div.mcol'), right = h('div.mcol');
      const pairs = ex.pairs.map(([id, ru]) => ({ id, ar: C.lex[id]?.ar || id, ru }));
      let sel = null, errors = 0, left2 = pairs.length;
      const pickBtn = (b, side, p) => {
        if (b.classList.contains('done')) return;
        if (side === 'ar') tts.speak(p.ar, { voice: voiceFor(null, C.lex[p.id]) });
        if (!sel || sel.side === side) {
          (sel?.b)?.classList.remove('sel');
          sel = { b, side, p }; b.classList.add('sel'); return;
        }
        if (sel.p === p) {
          [sel.b, b].forEach(x => { x.classList.remove('sel'); x.classList.add('done'); x.disabled = true; });
          left2--;
          if (!left2) { result(errors === 0, 'reading', errors ? 'meaning' : null); feedback(errors === 0, errors ? 'Ошибок: ' + errors : ''); setButton('Дальше', next); }
        } else {
          errors++;
          [sel.b, b].forEach(x => { x.classList.add('shake'); setTimeout(() => x.classList.remove('shake', 'sel'), 450); });
        }
        sel = null;
      };
      shuffle(pairs).forEach(p => { const b = h('button.opt.arabic', { dir: 'rtl', lang: 'ar' }, p.ar); b.onclick = () => pickBtn(b, 'ar', p); left.append(b); });
      shuffle(pairs).forEach(p => { const b = h('button.opt'); b.textContent = p.ru; b.onclick = () => pickBtn(b, 'ru', p); right.append(b); });
      body.append(h('div.match', left, right));
      setButton(null);
    },

    build(ex, sc) {
      body.append(h('div.q', 'Собери фразу'), h('div.ru.big', ex.ru));
      const ans = h('div.buildline', { dir: 'rtl', lang: 'ar' });
      const bank = h('div.bank', { dir: 'rtl' });
      const tiles = shuffle([...ex.tiles, ...(ex.extra || [])]);
      tiles.forEach(t => {
        const b = h('button.tile', { lang: 'ar' }, t);
        b.onclick = () => { (b.parentElement === bank ? ans : bank).append(b); setButton('Проверить', checkIt, { disabled: !ans.children.length }); };
        bank.append(b);
      });
      body.append(ans, bank);
      const checkIt = () => {
        const got = [...ans.children].map(b => b.textContent);
        const ok = got.join(' ') === ex.tiles.join(' ');
        [...ans.children, ...bank.children].forEach(b => (b.disabled = true));
        result(ok, 'grammar', 'order');
        const correct = ex.tiles.join(' ').replace(' ؟', '؟');
        feedback(ok, ok ? '' : 'Правильно:', ok ? null : h('div.ar.mid', { dir: 'rtl' }, correct));
        tts.speak(correct, { voice: voiceFor(null, null) });
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      };
      setButton('Проверить', checkIt, { disabled: true });
    },

    harakat(ex, sc) {
      body.append(h('div.q', 'Выбери огласовку'));
      const [a, b] = ex.ar.split('_');
      const slot = h('span.slot', '◌');
      body.append(h('div.qbox', h('span.ar.huge', { dir: 'rtl', lang: 'ar' }, a, slot, b)));
      const grid = h('div.opts.harakat');
      ex.options.forEach((o, i) => grid.append(h('button.opt.arabic', { lang: 'ar', onclick: (ev) => {
        const ok = i === ex.answer;
        grid.querySelectorAll('button').forEach((x, k) => { x.disabled = true; if (k === ex.answer) x.classList.add('ok'); });
        if (!ok) ev.currentTarget.classList.add('bad');
        slot.textContent = ''; slot.replaceWith(ex.options[ex.answer]);
        result(ok, 'grammar', 'harakat');
        feedback(ok, ex.explain || '');
        tts.speak(a + ex.options[ex.answer] + b, { voice: voiceFor(null, null) });
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      } }, '◌' + o)));
      body.append(grid);
      setButton(null);
    },

    listen(ex, sc) {
      const r = lineRef(lesson, ex.audioOf);
      const voice = voiceFor(r?.who);
      const text = r?.variant.ar;
      const play = (slow) => tts.speak(text, { voice, slow });
      if (ex.img) body.append(img(ex.img, '', 'eximg'));
      body.append(h('div.q', 'Послушай и ответь'),
        h('div.center', h('button.bigplay', { onclick: () => play(false), 'aria-label': 'Прослушать' }, icon('speaker')),
          h('button.link', { onclick: () => play(true) }, icon('slow'), ' медленно')),
        h('div.ru.big.center', ex.q));
      setTimeout(() => play(false), 300);
      choice(ex.options, ex.answer, (ok) => {
        result(ok, 'listening', 'listening');
        feedback(ok, '', h('div', arText(text, { cls: 'mid' }), h('div.small.muted', r.variant.ru)));
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      }, { arabic: false });
      setButton(null);
    },

    pair(ex, sc) {
      body.append(h('div.q', ex.q || 'Найди пару'), h('div.qbox', tag('x'), arText(ex.ar, { cls: 'big2' }), playBtns(ex.ar, C.course.voices.word_x_sa)));
      choice(ex.options, ex.answer, (ok) => {
        result(ok, 'reading', 'pair');
        feedback(ok, '');
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      });
      setButton(null);
    },

    cloze(ex, sc) {
      const [a, b] = ex.ar.split('___');
      const blank = h('span.blank', ' ');
      body.append(h('div.q', 'Вставь слово'), h('div.qbox', h('span.ar.big2', { dir: 'rtl', lang: 'ar' }, a, blank, b)), ex.ru ? h('div.ru.muted.center', ex.ru) : null);
      const i0 = ex.bank.indexOf(ex.answer);
      choice(ex.bank, i0, (ok) => {
        blank.textContent = ex.answer; blank.classList.add('filled');
        result(ok, 'reading', 'meaning');
        feedback(ok, '');
        tts.speak(a + ex.answer + b, { voice: voiceFor(null, null) });
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      });
      setButton(null);
    },

    minpair(ex) {
      const rounds = ex.rounds || 4;
      let k = 0, ok = 0;
      const voice = voiceFor(null, null);
      body.append(h('div.q', 'Минимальная пара: что звучит?'),
        h('div.mp-pair',
          h('div', h('span.ar.huge', { dir: 'rtl' }, ex.a.ar), h('div.small.muted', ex.a.ru), playBtns(ex.a.ar, voice)),
          h('div', h('span.ar.huge', { dir: 'rtl' }, ex.b.ar), h('div.small.muted', ex.b.ru), playBtns(ex.b.ar, voice))));
      const status = h('div.center.small.muted');
      const playBtn = h('button.bigplay', { 'aria-label': 'Прослушать' }, icon('speaker'));
      const grid = h('div.opts');
      const ba = h('button.opt.arabic', { dir: 'rtl' }, ex.a.ar), bb = h('button.opt.arabic', { dir: 'rtl' }, ex.b.ar);
      grid.append(ba, bb);
      body.append(h('div.center', playBtn), status, grid);
      let cur;
      const round = () => {
        cur = Math.random() < 0.5 ? ex.a : ex.b;
        [ba, bb].forEach(x => { x.disabled = false; x.classList.remove('ok', 'bad'); });
        status.textContent = `Раунд ${k + 1} из ${rounds}`;
        playBtn.onclick = () => tts.speak(cur.ar, { voice });
        setTimeout(() => tts.speak(cur.ar, { voice }), 250);
      };
      const ans = (pickd, el) => {
        const good = pickd === cur;
        if (good) ok++;
        el.classList.add(good ? 'ok' : 'bad');
        (pickd === ex.a ? bb : ba).disabled = true;
        k++;
        if (k < rounds) setTimeout(round, 700);
        else {
          result(ok >= rounds - 1, 'listening', 'ha');
          feedback(ok >= rounds - 1, `Верно ${ok} из ${rounds}.`);
          setButton('Дальше', next);
        }
      };
      ba.onclick = () => ans(ex.a, ba); bb.onclick = () => ans(ex.b, bb);
      round();
      setButton(null);
    },

    mc(ex, sc) {
      body.append(h('div.q', ex.q));
      choice(ex.options, ex.answer, (ok) => {
        result(ok, 'grammar', 'grammar');
        feedback(ok, ex.explain || '');
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      }, { vertical: true });
      setButton(null);
    },

    pattern(ex, sc) {
      body.append(h('div.q', ex.q),
        h('div.pattern', h('span.chip.root', icon('root'), h('span.ar', { dir: 'rtl' }, ex.root.split(' ').join(' - '))), h('span.plus', '+'), h('span.chip', h('span.ar', { dir: 'rtl' }, ex.pattern))));
      choice(ex.options, ex.answer, (ok) => {
        result(ok, 'grammar', 'grammar');
        feedback(ok, ex.explain || '');
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      });
      setButton(null);
    },

    translate(ex, sc) { typeTask({ title: 'Переведи на арабский', ru: ex.ru, accept: ex.accept, skill: 'writing' }, sc); },

    /** Картинки: слово → выбери картинку (pic) или картинка → выбери слово (word). */
    picture(ex, sc) {
      const target = C.lex[ex.word];
      const opts = shuffle([ex.word, ...ex.options.filter(o => o !== ex.word)]).slice(0, 4);
      if (!opts.includes(ex.word)) opts[0] = ex.word;
      const v = voiceFor(null, target);
      const done = (ok, el) => {
        grid.querySelectorAll('button').forEach(b => { b.disabled = true; if (b.dataset.id === ex.word) b.classList.add('ok'); });
        if (!ok) el.classList.add('bad');
        result(ok, 'reading', 'meaning', { word: ex.word });
        feedback(ok, `**${target.ar}** — ${target.ru}`);
        tts.speak(target.ar, { voice: v });
        if (!ok) retryLater(sc);
        setButton('Дальше', next);
      };
      let grid;
      if (ex.mode === 'word') {
        body.append(h('div.q', 'Что на картинке?'), img(target.img, '', 'eximg big'));
        grid = h('div.opts');
        shuffle(opts).forEach(id => grid.append(h('button.opt.arabic', { dir: 'rtl', lang: 'ar', 'data-id': id, onclick: (e) => done(id === ex.word, e.currentTarget) }, C.lex[id].ar)));
      } else {
        body.append(h('div.q', 'Выбери картинку'), h('div.qbox', h('span.ar.huge', { dir: 'rtl', lang: 'ar' }, target.ar), playBtns(target.ar, v)));
        grid = h('div.picgrid');
        shuffle(opts).forEach(id => grid.append(h('button.picopt', { 'data-id': id, 'aria-label': C.lex[id].ru, onclick: (e) => done(id === ex.word, e.currentTarget) }, img(C.lex[id].img, C.lex[id].ru, 'pimg'))));
        setTimeout(() => tts.speak(target.ar, { voice: v }), 250);
      }
      body.append(grid);
      setButton(null);
    },
  };

  // ---------- письмо ----------
  function typeTask({ title, ru, accept, audio, skill }, sc) {
    body.append(h('div.q', title));
    if (ru) body.append(h('div.ru.big', ru));
    if (audio) {
      const play = (slow) => tts.speak(audio.text, { voice: audio.voice, slow });
      body.append(h('div.center', h('button.bigplay', { onclick: () => play(false) }, icon('speaker')), h('button.link', { onclick: () => play(true) }, icon('slow'), ' медленно')));
      setTimeout(() => play(false), 300);
    }
    const input = h('textarea.arinput', { dir: 'rtl', lang: 'ar', rows: 2, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'اكتب هنا…' });
    body.append(input, h('p.small.muted', 'Нужна арабская клавиатура iPhone. Харакаты можно не ставить.'));
    const go = () => {
      if (!input.value.trim()) return;
      const r = check(input.value, accept, { strict: store.settings().strict });
      input.disabled = true;
      const extra = h('div');
      if (!r.ok && r.ops?.length) extra.append(h('div.small.muted', 'Ты написал(а):'), h('div.ar.mid', { dir: 'rtl', html: inputHTML(r.ops) }), h('div.small.muted', 'Правильно:'), h('div.ar.mid', { dir: 'rtl', html: diffHTML(r.ops) }));
      else extra.append(h('div.ar.mid', { dir: 'rtl' }, r.answer));
      (r.notes || []).forEach(n => extra.append(h('div.small', '• ' + n.text)));
      if (!r.ok && r.hint) extra.append(h('div.small', r.hint));
      if (!r.ok && r.type) extra.append(h('div.errtype', 'Тип ошибки: ' + (ERR[r.type] || r.type)));
      result(r.ok, skill, r.type || (r.near ? r.notes[0]?.type : null), { input: input.value });
      if (r.near) store.logError(r.notes[0].type, { lesson: lessonId, input: input.value });
      feedback(r.near ? 'near' : r.ok, '', extra);
      tts.speak(r.answer, { voice: voiceFor(null, null) });
      if (!r.ok && sc.step === 'exercises') retryLater(sc);
      setButton('Дальше', next);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    input.addEventListener('input', () => setButton('Проверить', go, { disabled: !input.value.trim() }));
    setButton('Проверить', go, { disabled: true });
    setTimeout(() => input.focus({ preventScroll: true }), 250);
  }

  const W = {
    dictation(w, sc) {
      const e = C.lex[w.audioOf];
      typeTask({ title: 'Диктант: напиши услышанное слово', accept: w.accept, audio: { text: e?.ar || w.accept[0], voice: voiceFor(null, e) }, skill: 'writing' }, sc);
    },
    sentence(w, sc) { typeTask({ title: 'Напиши предложение', ru: w.ru, accept: w.accept, skill: 'writing' }, sc); },
    translate(w, sc) { typeTask({ title: 'Переведи на арабский', ru: w.ru, accept: w.accept, skill: 'writing' }, sc); },
    free(w) {
      body.append(h('div.q', 'Свободное письмо'), h('p', w.ru),
        h('div.hints', (w.hints || []).map(x => h('span.chip', { dir: 'rtl', lang: 'ar' }, x))));
      const input = h('textarea.arinput.tall', { dir: 'rtl', lang: 'ar', rows: 6, placeholder: 'اكتب هنا…' });
      const cnt = h('div.small.muted');
      body.append(input, cnt);
      const count = () => input.value.split(/[.!؟?\n]+/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2).length;
      input.addEventListener('input', () => {
        const n = count();
        cnt.textContent = `Предложений: ${n} из ${w.minSentences || 3}`;
        setButton('Готово', done, { disabled: n < (w.minSentences || 1) });
      });
      const done = () => {
        input.disabled = true;
        const nisba = /ي(\s|$|ه)/.test(norm(input.value));
        const list = h('div.checklist', (w.checklist || []).map(c => h('label', h('input', { type: 'checkbox' }), ' ', c)));
        body.append(h('div.fb.ok', h('div.fb-title', 'Сравни с образцом'), arText(w.model, { cls: 'mid' }), playBtns(w.model, voiceFor('timur')),
          nisba ? null : h('div.small', 'Похоже, в тексте нет нисбы (ـِيّ / ـِيَّة). Её стоит использовать: روسِيّ, عَرَبِيَّة.'),
          h('div.k', 'Проверь себя:'), list));
        store.saveSentence(input.value.trim(), 'Моё сообщение (урок ' + lesson.id + ')', lessonId);
        result(true, 'writing');
        setButton('Дальше', next);
      };
      setButton('Готово', done, { disabled: true });
    },
  };

  // ---------- финал ----------
  function finish() {
    const wasDone = !!rec.done;
    rec.done = rec.done || Date.now();
    rec.step = 0;
    const added = srs.addLessonCards(lesson);
    store.logDay('lessons');
    store.save(true);
    const pct = rec.all ? Math.round(rec.ok / rec.all * 100) : 100;
    const nextL = week.lessons[lesson.n] || null;
    body.replaceChildren(
      h('div.finish',
        lesson.cover ? img(lesson.cover, '', 'finimg') : null,
        star('✓', 'big'),
        h('h2', wasDone ? 'Урок повторён' : 'Урок пройден'),
        h('div.ring', { style: { '--p': pct } }, h('b', pct + '%'), h('small', 'верных')),
        h('p', `Новых слов: ${lesson.words.length}. ` + (added ? `Карточек добавлено: ${added}.` : 'Карточки уже есть в повторении.')),
        h('div.wordchips', lesson.words.map(w => C.lex[w] ? h('span.chip', { dir: 'rtl' }, C.lex[w].ar) : null)),
        lesson.summary?.next ? h('div.story', icon('sparkle'), h('span', lesson.summary.next)) : null));
    top.querySelector('.pstep').textContent = STEP.summary;
    counter.textContent = '';
    bar.firstChild.style.transform = 'scaleX(1)';
    if (nextL) setButton('Следующий урок', () => { location.hash = '#/lesson/' + nextL.id; });
    else setButton('К пути', () => onExit());
    foot.append(h('button.btn.ghost.wide', { onclick: () => onExit() }, 'Вернуться на путь'));
  }

  render();
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
