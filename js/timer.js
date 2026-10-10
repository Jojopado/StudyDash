// 番茄鐘：用「結束時間」計時，App 被切到背景再回來也不會算錯。狀態存在這台裝置。
const KEY = 'studydash.timer';

const DEFAULTS = { phase: 'focus', running: false, endAt: 0, remaining: 25 * 60000, focusMin: 25, breakMin: 5, subject: '', startedAt: 0 };

export const timer = load();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(timer)); } catch { /* ignore */ } }

const phaseMs = () => (timer.phase === 'focus' ? timer.focusMin : timer.breakMin) * 60000;

export function leftMs() {
  return Math.max(0, timer.running ? timer.endAt - Date.now() : timer.remaining);
}

export function fmtClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
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

export function start() {
  unlockAudio();
  if (timer.running) return;
  if (timer.phase === 'focus' && timer.remaining >= phaseMs()) timer.startedAt = Date.now();
  timer.endAt = Date.now() + timer.remaining;
  timer.running = true;
  save();
}

export function pause() {
  if (!timer.running) return;
  timer.remaining = leftMs();
  timer.running = false;
  save();
}

export function reset(phase = timer.phase) {
  timer.phase = phase;
  timer.running = false;
  timer.remaining = phaseMs();
  timer.startedAt = 0;
  save();
}

export function setLengths(focusMin, breakMin) {
  timer.focusMin = focusMin;
  timer.breakMin = breakMin;
  if (!timer.running) timer.remaining = phaseMs();
  save();
}

export function setSubject(s) { timer.subject = s; save(); }

// 這次專注已經過了幾分鐘（提早結束時用）
export function focusedMinutes() {
  if (timer.phase !== 'focus') return 0;
  return Math.floor((phaseMs() - leftMs()) / 60000);
}

// 每秒檢查一次；時間到回傳 { done: 'focus' | 'break', minutes }
export function check() {
  if (!timer.running || leftMs() > 0) return null;
  const done = timer.phase;
  const minutes = timer.focusMin;
  const endedAt = timer.endAt;
  beep();
  if (done === 'focus') {
    // 專注完自動開始休息
    reset('break');
    start();
  } else {
    reset('focus');
  }
  return { done, minutes, endedAt };
}
