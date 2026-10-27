// 念出來（瀏覽器內建語音 speechSynthesis，不用網路、不用錢）。iPhone 內建俄文語音 Milena。
// 文字裡的重音記號（U+0301）念之前拿掉，不然有些語音會卡住。
let voices = [];
const load = () => { voices = speechSynthesis.getVoices(); };
if ('speechSynthesis' in window) { load(); speechSynthesis.addEventListener?.('voiceschanged', load); }

export const plain = s => String(s).replace(/[́']/g, '');

// 有沒有這個語言的語音；語音清單還沒載入時當作有（iOS 第一次常常是空的）
export function hasVoice(lang = 'ru-RU') {
  if (!('speechSynthesis' in window)) return false;
  if (!voices.length) load();
  return !voices.length || voices.some(v => v.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
}

// queue = true：接在正在念的後面（「全部念一遍」用）
export function say(text, { lang = 'ru-RU', slow = false, queue = false } = {}) {
  if (!('speechSynthesis' in window)) return false;
  if (!queue) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain(text));
  u.lang = lang;
  const v = voices.find(x => x.lang.replace('_', '-') === lang) || voices.find(x => x.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  u.rate = slow ? 0.55 : 0.85;
  speechSynthesis.speak(u);
  return true;
}

export const stopSay = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); };
