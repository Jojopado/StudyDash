// 讀書碼表（YPT 風格）：點科目開始往上數，按停止就記一段。只存「開始時間」，App 被切到背景再回來也不會算錯。狀態存在這台裝置。
const KEY = 'studydash.timer';

// remindMin：每讀幾分鐘響一次提醒休息（0 = 不提醒）
const DEFAULTS = { running: false, startAt: 0, subject: '', note: '', remindMin: 50, reminded: 0 };

export const timer = load();

function load() {
  try {
    const t = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
    if (t.phase) { t.running = false; t.startAt = 0; delete t.phase; }   // 舊版番茄鐘狀態不接著算
    return t;
  } catch { return { ...DEFAULTS }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(timer)); } catch { /* ignore */ } }

export const elapsedMs = () => (timer.running ? Math.max(0, Date.now() - timer.startAt) : 0);

const pad = n => String(n).padStart(2, '0');
export function fmtHMS(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

let audio;
// iOS 要在使用者點擊時先建立 AudioContext，之後才能響
function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* ignore */ }
}
export function beep() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    if (!audio) return;
    [0, 0.25, 0.5].forEach(t => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.2, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.2);
    });
  } catch { /* ignore */ }
}

// 螢幕保持亮著（支援的瀏覽器才有用）
let lock = null;
async function keepAwake(on) {
  try {
    if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timer.running) keepAwake(true); });

export function start(subject) {
  unlockAudio();
  if (timer.running) return;
  timer.subject = subject;
  timer.startAt = Date.now();
  timer.reminded = 0;
  timer.running = true;
  save();
  keepAwake(true);
}

// 停止，回傳這段 { subject, note, startAt, endAt }（之後由 app 記成讀書紀錄）
export function stop() {
  if (!timer.running) return null;
  const seg = { subject: timer.subject, note: (timer.note || '').trim(), startAt: timer.startAt, endAt: Date.now() };
  timer.running = false;
  timer.startAt = 0;
  save();
  keepAwake(false);
  return seg;
}

export function setSubject(s) { timer.subject = s; save(); }
export function setNote(s) { timer.note = s; save(); }
export function setRemind(m) { timer.remindMin = m; save(); }

// 每秒檢查一次；讀滿提醒時間回傳分鐘數（響一次）
export function check() {
  if (!timer.running || !timer.remindMin) return 0;
  const n = Math.floor(elapsedMs() / (timer.remindMin * 60000));
  if (n <= timer.reminded) return 0;
  timer.reminded = n;
  save();
  beep();
  return n * timer.remindMin;
}
