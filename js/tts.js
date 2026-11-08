// Озвучка. Один интерфейс speak(text, {voice, slow}) и цепочка провайдеров:
//   1) files     — заранее сгенерированные MP3 (tools/gen_audio.py, нейроголоса edge-tts), работают офлайн;
//   2) webspeech — Web Speech API (ar-SA, иначе любой ar-*), для всего, что ещё не озвучено;
//   3) сюда можно добавить внешний TTS (ElevenLabs / Azure / Google) — см. пример externalProvider ниже.
import * as store from './store.js';

let audioIndex = null;      // "voice|text" → путь к mp3
const audio = new Audio();
audio.preload = 'auto';
let current = null;         // { stop() } текущего воспроизведения
const listeners = new Set();
export const onState = (f) => (listeners.add(f), () => listeners.delete(f));
const emit = (s) => listeners.forEach(f => f(s));

async function loadIndex() {
  if (audioIndex) return audioIndex;
  try {
    const r = await fetch('audio/index.json', { cache: 'no-cache' }).catch(() => null) || await caches.match('audio/index.json');
    audioIndex = r && r.ok ? await r.json() : {};
  } catch { audioIndex = {}; }
  return audioIndex;
}
loadIndex();

/** Ключ для поиска файла: голос + точный текст. */
export const key = (voice, text) => voice + '|' + text.trim();

// ---------- провайдер 1: файлы ----------
const filesProvider = {
  name: 'files',
  async can(text, o) { const idx = await loadIndex(); return !!idx[key(o.voice, text)]; },
  play(text, o) {
    return new Promise((resolve) => {
      audio.src = audioIndex[key(o.voice, text)];
      audio.playbackRate = o.slow ? store.settings().slowRate : store.settings().rate;
      audio.preservesPitch = true;
      audio.onended = audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
      current = { stop() { audio.pause(); resolve(); } };
    });
  },
};

// ---------- провайдер 2: Web Speech ----------
let arVoice;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  arVoice = vs.find(v => v.lang === 'ar-SA') || vs.find(v => /^ar[-_]/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

const webSpeechProvider = {
  name: 'webspeech',
  async can() { return 'speechSynthesis' in window; },
  play(text, o) {
    return new Promise((resolve) => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = arVoice?.lang || 'ar-SA';
      if (arVoice) u.voice = arVoice;
      u.rate = (o.slow ? store.settings().slowRate : store.settings().rate) * 0.95;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
      current = { stop() { speechSynthesis.cancel(); resolve(); } };
    });
  },
};

// ---------- провайдер 3 (пример, выключен): внешний TTS по HTTP ----------
// const externalProvider = {
//   name: 'external',
//   async can() { return !!store.settings().ttsKey; },
//   async play(text, o) {
//     const r = await fetch('https://…/tts', { method: 'POST', headers: { Authorization: 'Bearer ' + store.settings().ttsKey },
//       body: JSON.stringify({ text, voice: o.voice }) });
//     audio.src = URL.createObjectURL(await r.blob());
//     await audio.play(); await new Promise(res => (audio.onended = res));
//   },
// };

const providers = [filesProvider, webSpeechProvider];

/** Есть ли записанный файл для этой фразы (иначе будет синтез браузера). */
export async function hasFile(text, voice) { const idx = await loadIndex(); return !!idx[key(voice, text)]; }

let seq = 0; // номер текущей «очереди» воспроизведения; stop() его увеличивает

/** Остановить текущее воспроизведение (и диалог целиком). */
export function stop() {
  seq++;
  if (current) { const c = current; current = null; c.stop(); }
  emit(null);
}

async function playOne(text, o) {
  emit({ text });
  for (const p of providers) {
    if (await p.can(text, o)) { await p.play(text, o); break; }
  }
  emit(null);
}

/** Произнести текст. o: { voice, slow } */
export async function speak(text, o = {}) {
  if (!text) return;
  stop();
  await playOne(text, o);
}

/** Произнести несколько фраз подряд (диалог целиком). onLine(i) — подсветка текущей. */
export async function speakSeq(items, onLine) {
  stop();
  const my = seq;
  for (let i = 0; i < items.length && my === seq; i++) {
    onLine?.(i);
    await playOne(items[i].text, items[i]);
    await new Promise(r => setTimeout(r, 350));
  }
  onLine?.(-1);
}

// ---------- запись своего голоса (шэдоуинг) ----------
export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/** Записать голос; возвращает { stop(): Promise<url> }. */
export async function record() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: type });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        resolve(URL.createObjectURL(new Blob(chunks, { type })));
      };
      rec.stop();
    }),
  };
}

/** Проиграть запись пользователя. */
export function playUrl(url) {
  stop();
  return new Promise((resolve) => {
    audio.src = url; audio.playbackRate = 1;
    audio.onended = audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
    current = { stop() { audio.pause(); resolve(); } };
  });
}
