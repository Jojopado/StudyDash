// 讀書獎勵：金幣、經驗值、寵物、成就。全部從讀書紀錄（sessions）算出來，
// 只有「兌換」另外存（rw_redeems），刪掉一筆兌換＝退回金幣。
import { store } from './store.js';
import { today, addDays } from './util.js';

// 讀 1 分鐘 = 1 金幣 + 1 經驗值
export const DEFAULT_SHOP = [
  { id: 'game30', emoji: '🎮', name: '玩遊戲 30 分鐘', cost: 60, minutes: 30 },
  { id: 'phone15', emoji: '📱', name: '滑手機 15 分鐘', cost: 25, minutes: 15 },
  { id: 'ep', emoji: '🎬', name: '看一集劇', cost: 90, minutes: 45 },
  { id: 'drink', emoji: '🥤', name: '買一杯手搖', cost: 120, minutes: 0 },
  { id: 'feast', emoji: '🍜', name: '吃一頓大餐', cost: 300, minutes: 0 },
];
export const shop = () => store.prefs.shop || DEFAULT_SHOP;

// 每天都能拿一次
export const DAILY = [
  { id: 'early', icon: '🌅', name: '早起鳥', desc: '10 點前開始讀（用計時的）', bonus: 20 },
  { id: 'deep', icon: '🧠', name: '深度專注', desc: '單次讀滿 50 分鐘', bonus: 20 },
  { id: 'triple', icon: '🍅', name: '三顆番茄', desc: '一天 3 段、每段 20 分以上', bonus: 30 },
  { id: 'h2', icon: '📚', name: '讀滿 2 小時', desc: '一天合計 120 分鐘', bonus: 40 },
  { id: 'h4', icon: '🔥', name: '讀滿 4 小時', desc: '一天合計 240 分鐘', bonus: 80 },
];
// 一輩子一次
export const MILESTONES = [
  { id: 'first', icon: '🐣', name: '第一次讀書', min: 1, bonus: 10 },
  { id: 't10', icon: '🥉', name: '累計 10 小時', min: 600, bonus: 100 },
  { id: 't30', icon: '🥈', name: '累計 30 小時', min: 1800, bonus: 200 },
  { id: 't60', icon: '🥇', name: '累計 60 小時', min: 3600, bonus: 400 },
  { id: 't100', icon: '🏆', name: '累計 100 小時', min: 6000, bonus: 800 },
];

function dailyDone(list) {
  const total = list.reduce((s, x) => s + (x.minutes || 0), 0);
  const early = list.some(x => !x.manual && x.createdAt && new Date(x.createdAt - x.minutes * 60000).getHours() < 10);
  return {
    early,
    deep: list.some(x => x.minutes >= 50),
    triple: list.filter(x => x.minutes >= 20).length >= 3,
    h2: total >= 120,
    h4: total >= 240,
  };
}

// 等級：升到 L 級總共要 30·L·(L+1) 經驗（1 級 1 小時、10 級約 55 小時）
export const xpFor = L => 30 * L * (L + 1);
export function levelOf(xp) {
  let L = 0;
  while (xp >= xpFor(L + 1)) L++;
  return L;
}

export const STAGES = [
  { from: 0, emoji: '🥚', name: '蛋' },
  { from: 1, emoji: '🐣', name: '破殼寶寶' },
  { from: 3, emoji: '🐥', name: '雛鳥' },
  { from: 6, emoji: '🐤', name: '幼鳥' },
  { from: 10, emoji: '🐦', name: '成鳥' },
  { from: 15, emoji: '🦜', name: '大鸚鵡' },
  { from: 25, emoji: '🦜', name: '鸚鵡之王', crown: true },
];
export const stageOf = L => [...STAGES].reverse().find(s => L >= s.from);

export function summarize(sessions = store.state.sessions, redeems = store.state.rw_redeems) {
  const byDay = {};
  let minutes = 0;
  for (const x of sessions) {
    if (!(x.minutes > 0)) continue;
    minutes += x.minutes;
    (byDay[x.date] ||= []).push(x);
  }
  let bonus = 0;
  const days = {};
  for (const [d, list] of Object.entries(byDay)) {
    const done = dailyDone(list);
    days[d] = done;
    for (const a of DAILY) if (done[a.id]) bonus += a.bonus;
  }
  const miles = MILESTONES.filter(m => minutes >= m.min);
  for (const m of miles) bonus += m.bonus;

  const spent = redeems.reduce((s, r) => s + (r.cost || 0), 0);
  const t = today();
  const todayMin = (byDay[t] || []).reduce((s, x) => s + x.minutes, 0);
  const todayBonus = DAILY.filter(a => days[t]?.[a.id]).reduce((s, a) => s + a.bonus, 0);
  const last = sessions.reduce((m, x) => Math.max(m, x.createdAt || 0), 0);
  const level = levelOf(minutes);
  return {
    minutes, xp: minutes, level, stage: stageOf(level), bonus, spent,
    coins: minutes + bonus - spent, earned: minutes + bonus,
    today: days[t] || {}, todayMin, todayCoins: todayMin + todayBonus,
    miles: new Set(miles.map(m => m.id)), last,
  };
}

// 新增一筆讀書紀錄之後會多什麼（給提示用）
export function gainNotice(newSession) {
  const before = summarize();
  const after = summarize([...store.state.sessions, newSession]);
  const msgs = [`+${after.earned - before.earned} 💰`];
  if (newSession.date === today()) {
    for (const a of DAILY) if (after.today[a.id] && !before.today[a.id]) msgs.push(`${a.icon}${a.name}`);
  }
  for (const m of MILESTONES) if (after.miles.has(m.id) && !before.miles.has(m.id)) msgs.push(`${m.icon}${m.name}`);
  if (after.level > before.level) msgs.push(`⬆️ 升到 ${after.level} 級`);
  if (after.stage.name !== before.stage.name) msgs.push(`${after.stage.emoji} 長成${after.stage.name}了！`);
  return msgs.join('　');
}

// 心情：只是表情和台詞，沒有懲罰
export function moodOf(s, studying) {
  if (studying) return 'study';
  if (s.todayMin >= 120) return 'great';
  if (s.todayMin > 0) return 'happy';
  if (!s.last) return 'new';
  if (Date.now() - s.last < 2 * 86400000) return 'miss';
  return 'sad';
}
export const MOODS = {
  study: { face: '✏️', label: '陪你讀書中', lines: ['我也在認真喔！', '加油加油～', '啾！（小聲）', '專心專心，我不吵你'] },
  great: { face: '😍', label: '超開心', lines: ['今天好厲害！', '你是最棒的主人！', '啾啾啾～～！！', '今天可以去玩了吧？'] },
  happy: { face: '😊', label: '開心', lines: ['今天有讀書，好棒！', '再一顆番茄好不好？', '啾～', '我又長大一點點了'] },
  miss: { face: '🥺', label: '想你了', lines: ['今天還沒讀書耶…', '陪我讀 10 分鐘就好？', '啾…（看著你）', '遊戲先等等嘛'] },
  sad: { face: '😢', label: '有點寂寞', lines: ['好久沒一起讀書了…', '我還在這裡等你喔', '先讀 10 分鐘就好', '啾……'] },
  new: { face: '🥚', label: '等你孵化', lines: ['讀 1 小時我就會破殼！', '（蛋輕輕晃了一下）', '用番茄鐘溫暖我吧'] },
};

// 最近 n 天每天賺多少（畫面用）
export function recentDays(n = 7) {
  const t = today();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(t, -i);
    out.push([d, store.state.sessions.filter(x => x.date === d).reduce((s, x) => s + (x.minutes || 0), 0)]);
  }
  return out;
}
