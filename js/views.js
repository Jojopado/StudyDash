import {
  TYPES, DEADLINE_TYPES, WEEKDAYS, today, addDays, parseYmd, ymd, daysUntil,
  fmtDate, countdown, byDateTime, esc, BG_PRESETS,
} from './util.js';
import { classesOn, classRow, courseById, fmtSlotTimes, timetable } from './courses.js';
import { timer, elapsedMs, fmtHMS } from './timer.js';
import { monthSpent, currentFunds } from './money.js';
import { homeMemoCard } from './memo.js';
import { homeProgressCard } from './progress.js';
import { homeFitCard, homeHabitCard } from './fit.js';
import { homeGoalCard } from './goals.js';
import { saveTodo } from './store.js';
import { handle, onDrop, between } from './drag.js';

// 畫面狀態（不存檔）
export const ui = {
  calMode: 'month',   // 'month' | 'week'
  month: today().slice(0, 8) + '01',
  selDay: today(),
  todoFilter: 'all',  // 'all' | TYPES 的 key
  todoCourse: 'all',  // 'all' | course id
  showDoneTodos: false,
  logDay: today(),    // 讀書成果看哪一天
  statRange: 'day',   // 讀書時數：'day' | 'week' | 'month'
  focusMini: false,   // 讀書計時中把全螢幕縮小成浮動小條
};

let S; // 這次畫面用的 store（每個 render 一開始設定）
const isWide = () => matchMedia('(min-width: 900px)').matches;

function courseTag(id) {
  const c = courseById(S.state.courses, id);
  return c ? `<span class="ctag" style="color:${esc(c.color)}">● ${esc(c.name)}</span>` : '';
}

function evRow(e, { showDate = true, showCountdown = false } = {}) {
  const ty = TYPES[e.type] || TYPES.other;
  const cd = showCountdown && !e.done ? countdown(e.date) : null;
  const meta = [courseTag(e.courseId), ty.label, showDate ? fmtDate(e.date) : '', e.time || ''].filter(Boolean).join(' · ');
  return `<div class="ev ${e.done ? 'done' : ''}" data-action="edit-event" data-id="${e.id}">
    <button class="check ${e.done ? 'on' : ''}" data-action="toggle-event" data-id="${e.id}" aria-label="完成">${e.done ? '✓' : ''}</button>
    <span class="bar" style="background:${ty.color}"></span>
    <div class="main"><div class="title">${esc(e.title)}</div><div class="meta">${meta}</div></div>
    ${cd ? `<span class="badge ${cd.cls}">${cd.text}</span>` : ''}
  </div>`;
}

// 行事曆裡混有待辦（kind: 'todo'），用待辦的樣式畫
const row = (e, opts) => (e.kind === 'todo' ? todoRow(e.src, opts) : evRow(e, opts));
const list = (items, opts, emptyText) =>
  items.length ? items.map(e => row(e, opts)).join('') : `<div class="empty">${emptyText}</div>`;

function syncBanner(s) {
  if (!s.cloudAvailable || s.mode === 'cloud') return '';
  return `<div class="banner">目前資料只存在這台裝置。<a href="#settings">登入</a>就能和電腦／手機同步。</div>`;
}

// ---------- 讀書時數 ----------
// 讀了什麼：'' 自由讀書、'c:id' 課程、'g:id' 自訂標籤（prefs.studyTags）、't:id' 舊的自學主題（只剩紀錄）
export const studyTags = () => S.prefs.studyTags || [];
export function subjectInfo(key) {
  const [k, id] = (key || '').split(':');
  if (k === 'c') { const c = courseById(S.state.courses, id); if (c) return { name: c.name, color: c.color }; }
  if (k === 'g') { const g = studyTags().find(x => x.id === id); if (g) return { name: g.name, color: g.color }; }
  if (k === 't') { const t = S.state.topics.find(x => x.id === id); if (t) return { name: t.name, color: t.color }; }
  return { name: '自由讀書', color: '#94a3b8' };
}
const minutesOn = (ds, filter = () => true) =>
  S.state.sessions.filter(x => x.date === ds && filter(x)).reduce((n, x) => n + (x.minutes || 0), 0);
const weekMinutes = (filter = () => true) => {
  const from = addDays(today(), -6);
  return S.state.sessions.filter(x => x.date >= from && filter(x)).reduce((n, x) => n + (x.minutes || 0), 0);
};
// ---------- 今天讀了什麼 ----------
// 一筆紀錄的「內容」：自己寫的 note，沒寫就用待辦標題
function sessionLabel(x) {
  if (x.note) return x.note;
  const t = x.todoId && S.state.todos.find(y => y.id === x.todoId);
  return t ? t.title : '';
}
// 同一天、同科目、同內容的合成一行（例如分 4 段都讀 DSP CH8）
export function dayLog(s, ds) {
  S = s;
  const m = {};
  for (const x of s.state.sessions) {
    if (x.date !== ds) continue;
    const label = sessionLabel(x), subject = x.subject || '';
    const g = (m[`${subject}|${label}`] ||= { subject, label, minutes: 0, ids: [] });
    g.minutes += x.minutes || 0;
    g.ids.push(x.id);
  }
  return Object.values(m).sort((a, b) => b.minutes - a.minutes);
}
function logRows(groups) {
  return groups.map(g => {
    const i = subjectInfo(g.subject);
    const name = g.label || i.name;
    const tag = g.label && g.subject ? `<span class="ctag" style="color:${esc(i.color)}">● ${esc(i.name)}</span>` : '';
    return `<div class="logrow" data-action="edit-log" data-ids="${g.ids.join(',')}">
      <span class="dot" style="background:${esc(i.color)}"></span>
      <div class="main"><div class="title">${esc(name)}</div><div class="meta">${tag}${
        g.label ? '' : '<span class="sub">點一下寫上讀了什麼</span>'}${g.ids.length > 1 ? `<span class="sub">${tag ? ' · ' : ''}${g.ids.length} 段</span>` : ''}</div></div>
      <b class="mins">${fmtMin(g.minutes)}</b></div>`;
  }).join('');
}
function logCard() {
  const ds = ui.logDay, t = today();
  const groups = dayLog(S, ds);
  const total = groups.reduce((n, g) => n + g.minutes, 0);
  const d = parseYmd(ds);
  const title = ds === t ? '今天' : ds === addDays(t, -1) ? '昨天' : `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
  return `<section class="card log">
    <div class="row" style="margin-bottom:4px"><h2 style="margin:0">📒 ${title}讀了什麼</h2><span class="spacer"></span>
      <div class="seg"><button data-action="log-day" data-d="-1" aria-label="前一天">‹</button>${
        ds !== t ? '<button data-action="log-day" data-d="0">今天</button>' : ''}<button data-action="log-day" data-d="1" ${ds >= t ? 'disabled' : ''} aria-label="後一天">›</button></div></div>
    <div class="log-total">${total ? `共 <b>${fmtMin(total)}</b><span class="sub"> · ${groups.length} 項</span>` : ''}</div>
    ${groups.length ? logRows(groups) : `<div class="empty">${ds === t ? '今天還沒有讀書紀錄，點科目開始計時吧 💪' : '這天沒有讀書紀錄'}</div>`}
    ${groups.length ? '<div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small" data-action="log-copy">📋 複製成文字</button></div>' : ''}
  </section>`;
}
// 複製用的文字（貼到 LINE／筆記）
export function logText(s, ds) {
  const groups = dayLog(s, ds);
  const total = groups.reduce((n, g) => n + g.minutes, 0);
  const d = parseYmd(ds);
  return [`📒 ${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）讀書成果：共 ${fmtMin(total)}`,
    ...groups.map(g => { const n = subjectInfo(g.subject).name; return `・${g.label ? `${g.label}${g.subject ? `（${n}）` : ''}` : n} ${fmtMin(g.minutes)}`; })].join('\n');
}

const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`);

// 待辦花費時間：累計的 spentMs ＋ 正在計時的這段（workingSince 存在雲端，手機電腦看到同一個）
export const spentMs = x => (x.spentMs || 0) + (x.workingSince ? Math.max(0, Date.now() - x.workingSince) : 0);
const pad2 = n => String(n).padStart(2, '0');
export function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}
// 計時中的數字：每秒由 tickWorkView 更新
const liveClock = x => `<span class="live" data-since="${x.workingSince}" data-base="${x.spentMs || 0}">${fmtElapsed(spentMs(x))}</span>`;

// ---------- 首頁 ----------
export function renderHome(s) {
  S = s;
  const t = today();
  const evs = s.state.events;
  const d = new Date();
  const classes = classesOn(t, s.state.courses);
  const todays = evs.filter(e => e.date === t).sort(byDateTime);
  const deadlines = evs
    .filter(e => DEADLINE_TYPES.includes(e.type) && !e.done && daysUntil(e.date) >= -30)
    .sort(byDateTime).slice(0, 10);
  const week = evs.filter(e => { const n = daysUntil(e.date); return n >= 1 && n <= 7; }).sort(byDateTime);
  const todos = s.state.todos.filter(x => !x.done).sort(workFirst);
  const spent = monthSpent();
  const funds = currentFunds();

  return `${syncBanner(s)}
  <div class="page-head"><div>
    <div class="sub">${d.getFullYear()} 年</div>
    <h1>${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAYS[d.getDay()]}</h1>
  </div></div>
  <a href="#money" class="quote-mini">${funds != null ? `💳 目前資金 ${funds < 0 ? '−' : ''}$${Math.abs(funds).toLocaleString()} · ` : ''}💰 這個月花了 $${spent.toLocaleString()}${s.prefs.moneyBudget ? ` · 預算還剩 $${Math.max(0, s.prefs.moneyBudget - spent).toLocaleString()}` : ''} ›</a>
  ${homeGoalCard()}
  ${homeMemoCard()}
  <div class="grid two">
    <section class="card"><h2>☀️ 今天</h2>${classes.map(classRow).join('')}${
      todays.length || !classes.length ? list(todays, { showDate: false }, classes.length ? '' : '今天沒有安排') : ''}</section>
    <section class="card"><h2>⏳ 倒數</h2>${list(deadlines, { showCountdown: true }, '沒有待完成的考試／報告／作業 🎉')}</section>
    <section class="card"><h2>✅ 待辦 <a href="#todo" class="sub" style="font-weight:400">（${todos.length} 件）全部 ›</a></h2>${
      todos.length ? todos.slice(0, 6).map(x => todoRow(x)).join('') : '<div class="empty">沒有待辦事項</div>'}</section>
    <section class="card"><h2>🗓️ 接下來 7 天</h2>${list(week, {}, '這週沒有其他事')}</section>
    ${homeHabitCard()}
    ${homeFitCard()}
    ${homeProgressCard()}
    <section class="card log"><h2>📒 今天讀了什麼 <a href="#study" class="sub" style="font-weight:400">共 ${fmtMin(minutesOn(t))} · 7 天 ${fmtMin(weekMinutes())} ›</a></h2>${
      logRows(dayLog(s, t)) || '<div class="empty">今天還沒有讀書紀錄，到「讀書」點科目開始計時吧</div>'}</section>
  </div>`;
}

// ---------- 行事曆 ----------
function byDate(events, todos = []) {
  const m = {};
  const items = [...events, ...todos.filter(x => x.due).map(x => ({ kind: 'todo', id: x.id, title: x.title, date: x.due, time: '', done: x.done, type: x.type, src: x }))];
  for (const e of items) (m[e.date] ||= []).push(e);
  for (const k in m) m[k].sort(byDateTime);
  return m;
}

export function renderCalendar(s) {
  S = s;
  const map = byDate(s.state.events, s.state.todos);
  const head = `<div class="page-head"><h1>行事曆</h1>
    <div class="seg"><button data-action="cal-mode" data-mode="month" class="${ui.calMode === 'month' ? 'on' : ''}">月</button><button data-action="cal-mode" data-mode="week" class="${ui.calMode === 'week' ? 'on' : ''}">週</button></div></div>`;
  return head + (ui.calMode === 'month' ? monthView(map) : weekView(map));
}

function monthView(map) {
  const first = parseYmd(ui.month);
  const y = first.getFullYear(), m = first.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysIn) / 7);
  const start = addDays(ui.month, -first.getDay());
  const t = today();
  const maxChips = isWide() ? 4 : 2;

  let cells = WEEKDAYS.map(w => `<div class="dow">${w}</div>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const ds = addDays(start, i);
    const evs = map[ds] || [];
    const other = parseYmd(ds).getMonth() !== m;
    const chips = evs.slice(0, maxChips).map(e =>
      `<div class="chip ${e.done ? 'done' : ''} ${e.kind === 'todo' ? 'todo' : ''}" style="background:${(TYPES[e.type] || TYPES.other).color}">${esc(e.title)}</div>`).join('');
    const more = evs.length > maxChips ? `<div class="more">+${evs.length - maxChips}</div>` : '';
    cells += `<div class="day ${other ? 'other' : ''} ${ds === t ? 'today' : ''} ${ds === ui.selDay ? 'sel' : ''}" data-action="pick-day" data-date="${ds}">
      <div class="num">${parseYmd(ds).getDate()}</div>${chips}${more}</div>`;
  }

  const sel = map[ui.selDay] || [];
  const classes = classesOn(ui.selDay, S.state.courses);
  return `<div class="cal-head">
      <button class="btn small" data-action="cal-nav" data-dir="-1">‹</button>
      <div class="label">${y} 年 ${m + 1} 月</div>
      <button class="btn small" data-action="cal-nav" data-dir="1">›</button>
      <span class="spacer"></span>
      <button class="btn small" data-action="cal-today">今天</button>
    </div>
    <div class="month">${cells}</div>
    <section class="card" style="margin-top:14px">
      <div class="row" style="margin-bottom:6px"><h2 style="margin:0">${fmtDate(ui.selDay)}</h2><span class="spacer"></span>
        <button class="btn small" data-action="new-todo" data-date="${ui.selDay}">＋ 待辦</button>
        <button class="btn small" data-action="new-event" data-date="${ui.selDay}">＋ 行程</button></div>
      ${classes.map(classRow).join('')}
      ${sel.length || !classes.length ? list(sel, { showDate: false, showCountdown: true }, '這天沒有安排') : ''}
    </section>`;
}

function weekView(map) {
  const sel = parseYmd(ui.selDay);
  const start = addDays(ui.selDay, -sel.getDay());
  const end = addDays(start, 6);
  const t = today();
  let days = '';
  for (let i = 0; i < 7; i++) {
    const ds = addDays(start, i);
    const evs = map[ds] || [];
    days += `<div class="wday ${ds === t ? 'today' : ''}">
      <div class="whead"><span>${fmtDate(ds)}</span><button class="add" data-action="new-event" data-date="${ds}" aria-label="新增">＋</button></div>
      ${classesOn(ds, S.state.courses).map(classRow).join('')}
      ${evs.map(e => row(e, { showDate: false })).join('')}
    </div>`;
  }
  return `<div class="cal-head">
      <button class="btn small" data-action="week-nav" data-dir="-1">‹</button>
      <div class="label">${fmtDate(start, false)} – ${fmtDate(end, false)}</div>
      <button class="btn small" data-action="week-nav" data-dir="1">›</button>
      <span class="spacer"></span>
      <button class="btn small" data-action="cal-today">本週</button>
    </div>
    <div class="week">${days}</div>`;
}

export function shiftMonth(dir) {
  const d = parseYmd(ui.month);
  d.setMonth(d.getMonth() + dir);
  ui.month = ymd(d);
  // 選取日跟著換到那個月的 1 號（若是本月就選今天）
  ui.selDay = ui.month.slice(0, 7) === today().slice(0, 7) ? today() : ui.month;
}

// ---------- 待辦 ----------
// 有期限的排前面（越早越前），沒期限的照新增順序排後面
const byDue = (a, b) =>
  (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due || '').localeCompare(b.due || '') || (a.createdAt || 0) - (b.createdAt || 0);

// 分段式步驟：段落標題顯示 已完成/總數，整段做完就收起來；只有「下一步」顯示提示，其他的保持簡潔
function stepRowsHtml(x, all) {
  const nextId = all.find(z => !z.sec && !z.done)?.id;
  const out = [];
  let hide = false;
  all.forEach((z, i) => {
    if (z.sec) {
      const end = all.findIndex((y, j) => j > i && y.sec);
      const items = all.slice(i + 1, end < 0 ? all.length : end);
      const d = items.filter(y => y.done).length;
      hide = items.length > 0 && d === items.length;
      out.push(`<div class="step sec ${hide ? 'done' : ''}"><span>${hide ? '✅ ' : ''}${esc(z.text)}</span><span class="sec-n">${d}/${items.length}</span></div>`);
      return;
    }
    if (hide) return;
    const next = z.id === nextId;
    out.push(`<div class="step ${z.done ? 'done' : ''} ${next ? 'next' : ''}">
      <button class="check small ${z.done ? 'on' : ''}" data-action="toggle-step" data-id="${x.id}" data-step="${z.id}" aria-label="完成">${z.done ? '✓' : ''}</button>
      <span class="st-txt">${next ? '👉 ' : ''}${esc(z.text)}${next && z.hint ? `<small class="step-hint">${esc(z.hint)}</small>` : ''}</span></div>`);
  });
  return out.join('');
}

function todoRow(x, { showDate = true, steps = false, drag = false } = {}) {
  const ty = TYPES[x.type] || TYPES.other;
  const cd = x.due && !x.done ? countdown(x.due) : null;
  const all = x.steps || [];
  const st = all.filter(z => !z.sec);   // sec = 分段標題，不算步驟
  const stDone = st.filter(z => z.done).length;
  const working = !!x.workingSince && !x.done;
  const spentMin = Math.floor((x.spentMs || 0) / 60000);
  const meta = [working ? '<b class="run-tag">⏱ 執行中</b>' : '待辦', courseTag(x.courseId), ty.label, x.due && showDate ? fmtDate(x.due) : '',
    st.length ? `☑ ${stDone}/${st.length}` : '', !working && spentMin ? `⏱ ${fmtMin(spentMin)}` : '', !x.done && !spentMin && x.estMin ? `預計 ${fmtMin(x.estMin)}` : '', x.note ? '📝' : ''].filter(Boolean).join(' · ');
  const stepRows = steps && !x.done ? stepRowsHtml(x, all) : '';
  const workBtn = x.done ? ''
    : working ? `<button class="work-btn on" data-action="todo-pause" data-id="${x.id}" aria-label="暫停">⏸</button>`
    : `<button class="work-btn" data-action="todo-start" data-id="${x.id}" aria-label="開始做" title="開始做這件（計時）">▶</button>`;
  const dragAttr = drag && !x.done ? ` data-drag-id="${x.id}" data-drag-group="${working ? 'w' : 'n'}"` : '';
  return `<div class="ev ${x.done ? 'done' : ''} ${working ? 'working' : ''}" data-action="edit-todo" data-id="${x.id}"${dragAttr}>
    ${dragAttr ? handle() : ''}<button class="check ${x.done ? 'on' : ''}" data-action="toggle-todo" data-id="${x.id}" aria-label="完成">${x.done ? '✓' : ''}</button>
    <span class="bar" style="background:${ty.color}"></span>
    <div class="main"><div class="title">${esc(x.title)}</div><div class="meta">${meta}</div>
      ${st.length && !x.done ? `<div class="progress thin"><div style="width:${Math.round(stDone / st.length * 100)}%;background:${ty.color}"></div></div>` : ''}</div>
    ${working ? `<span class="badge run">${liveClock(x)}</span>` : cd ? `<span class="badge ${cd.cls}">${cd.text}</span>` : ''}
    ${workBtn}
  </div>${stepRows}`;
}

// 正在做的那件：大字計時＋暫停／完成
function workingCard(x) {
  const ty = TYPES[x.type] || TYPES.other;
  return `<section class="card work-card" style="border-color:${ty.color}">
    <div class="sub">⏱ 執行中 ${courseTag(x.courseId)}</div>
    <div class="work-title" data-action="edit-todo" data-id="${x.id}">${esc(x.title)}</div>
    <div class="clock">${liveClock(x)}</div>
    <div class="row wrap" style="justify-content:center">
      <button class="btn" data-action="todo-pause" data-id="${x.id}">⏸ 暫停</button>
      <button class="btn primary" data-action="toggle-todo" data-id="${x.id}">✓ 完成</button>
    </div>
  </section>`;
}
// 執行中的排最前面；再來是拖曳排過的（order 小的在上），沒拖過的照期限排在後面
const byOrder = (a, b) => (a.order == null ? 1 : 0) - (b.order == null ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0);
const workFirst = (a, b) => (b.workingSince ? 1 : 0) - (a.workingSince ? 1 : 0) || byOrder(a, b) || byDue(a, b);

// 拖曳待辦：第一次拖時把所有未完成的待辦照目前順序編號，之後放到上下兩件的中間
onDrop('todos', (id, beforeId, afterId) => {
  const open = S.state.todos.filter(x => !x.done).sort(workFirst);
  const ord = new Map(open.map(x => [x.id, x.order]));
  if (open.some(x => x.order == null)) {
    open.forEach((x, i) => { ord.set(x.id, i * 1000); if (x.id !== id) saveTodo({ ...x, order: i * 1000 }); });
  }
  const x = open.find(z => z.id === id);
  if (x) saveTodo({ ...x, order: between(ord.get(beforeId) ?? null, ord.get(afterId) ?? null) });
});

export function renderTodo(s) {
  S = s;
  const f = ui.todoFilter, fc = ui.todoCourse;
  const match = x => (f === 'all' || x.type === f) && (fc === 'all' || x.courseId === fc);
  const all = s.state.todos.filter(match);
  const open = all.filter(x => !x.done).sort(workFirst);
  const working = s.state.todos.filter(x => x.workingSince && !x.done);
  const done = all.filter(x => x.done).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const count = (k, kc) => s.state.todos.filter(x => !x.done && (k === 'all' || x.type === k) && (kc === 'all' || x.courseId === kc)).length;
  const chip = (action, key, cur, label, color, n) =>
    `<button type="button" data-action="${action}" data-key="${key}" class="${key === cur ? 'on' : ''}" style="${key === cur && color ? `background:${color};border-color:${color}` : ''}">${esc(label)}${n ? ` ${n}` : ''}</button>`;
  const addType = f === 'all' ? 'homework' : f;
  const courses = s.state.courses;

  return `<div class="page-head"><h1>待辦</h1><span class="sub">按 ▶ 開始做、會自動計時</span></div>
    ${working.map(workingCard).join('')}
    <div class="chips" style="margin-bottom:8px">${chip('todo-filter', 'all', f, '全部', '', count('all', fc))}${
      Object.entries(TYPES).map(([k, t]) => chip('todo-filter', k, f, t.label, t.color, count(k, fc))).join('')}</div>
    ${courses.length ? `<div class="chips" style="margin-bottom:12px">${chip('todo-course', 'all', fc, '所有課程', '', 0)}${
      courses.map(c => chip('todo-course', c.id, fc, c.name, c.color, count(f, c.id))).join('')}</div>` : ''}
    <section class="card" data-drag-list="todos">
      ${open.length > 1 ? `<div class="sub drag-hint" style="margin:0 0 6px">按住 ⋮⋮ 拖曳，重要的拖到上面${
        s.state.todos.some(x => x.order != null) ? ' · <button type="button" class="linkish" data-action="todo-sort-due">改回照期限排</button>' : ''}</div>` : ''}
      <form class="add-goal" data-form="add-todo" style="margin:0 0 8px">
        <input type="text" name="title" placeholder="新增${(TYPES[addType] || TYPES.other).label}待辦，例如：DSP 第 3 章習題" autocomplete="off">
        <button class="btn" type="submit">加入</button>
      </form>
      ${open.length ? open.map(x => todoRow(x, { steps: true, drag: true })).join('') : '<div class="empty">沒有未完成的待辦 🎉</div>'}
      ${done.length ? `<button class="btn small ghost" data-action="todo-show-done" style="margin-top:8px">${ui.showDoneTodos ? '隱藏' : '顯示'}已完成（${done.length}）</button>
        ${ui.showDoneTodos ? done.map(x => todoRow(x)).join('') : ''}` : ''}
    </section>`;
}

// ---------- 讀書（YPT 風格：科目清單點一下開始碼表） ----------
// 列出來的科目：自己的標籤、還沒結束的課、最後是自由讀書
export function studySubjects() {
  const t = today();
  return [...studyTags().map(g => `g:${g.id}`), ...S.state.courses.filter(c => !(c.end && t > c.end)).map(c => `c:${c.id}`), ''];
}
const dayStart = ds => parseYmd(ds).getTime();
// 正在計時的這段算進今天的部分（跨過半夜的只算今天）
const liveMs = key => (timer.running && (key === undefined || timer.subject === key) ? Math.min(elapsedMs(), Date.now() - dayStart(today())) : 0);
// 今天（某科）讀了多久，毫秒，含正在計時的
function todayMs(key) {
  const t = today();
  return S.state.sessions.filter(x => x.date === t && (key === undefined || (x.subject || '') === key)).reduce((n, x) => n + (x.minutes || 0) * 60000, 0) + liveMs(key);
}

// 一段紀錄在時間軸上的起訖；補記錄和「打勾直接算預計時間」的沒有真正時間，不畫
function sessSpan(x) {
  if (x.startAt) return [x.startAt, x.endAt || x.startAt + x.minutes * 60000];
  if (x.manual || !x.createdAt || S.state.todos.some(t => t.creditId === x.id)) return null;
  return [x.createdAt - x.minutes * 60000, x.createdAt];
}
function daySpans(ds) {
  const out = [];
  for (const x of S.state.sessions) {
    if (x.date !== ds) continue;
    const sp = sessSpan(x);
    if (sp) out.push({ subject: x.subject || '', from: sp[0], to: sp[1] });
  }
  if (timer.running && ds === today()) out.push({ subject: timer.subject, from: Math.max(timer.startAt, dayStart(ds)), to: Date.now() });
  return out.sort((a, b) => a.from - b.from);
}
const hm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hmDur = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

// 最近的考試（行事曆＋待辦），D-day 用
function nextExams() {
  const evs = S.state.events.filter(e => e.type === 'exam' && !e.done && daysUntil(e.date) >= 0).map(e => ({ title: e.title, date: e.date }));
  const tds = S.state.todos.filter(x => x.type === 'exam' && !x.done && x.due && daysUntil(x.due) >= 0).map(x => ({ title: x.title, date: x.due }));
  const seen = new Set();
  return [...evs, ...tds].sort((a, b) => a.date.localeCompare(b.date)).filter(e => !seen.has(e.title) && seen.add(e.title)).slice(0, 2);
}

function studyHero() {
  const t = today(), d = new Date();
  const spans = daySpans(t);
  const mins = S.state.sessions.filter(x => x.date === t).map(x => x.minutes || 0);
  if (timer.running) mins.push(Math.floor(liveMs() / 60000));
  const longest = Math.max(0, ...mins);
  const reminds = [[0, '不'], [25, '25'], [50, '50'], [90, '90']];
  return `<section class="card ypt">
    <div class="ypt-top"><span>${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）</span><span class="spacer"></span>${
      nextExams().map(e => `<span class="dday" title="${esc(e.title)} ${fmtDate(e.date)}">D-${daysUntil(e.date) || 'Day'} ${esc(e.title)}</span>`).join('')}</div>
    <div class="ypt-total" id="ypt-total">${fmtHMS(todayMs())}</div>
    <div class="ypt-meta">${spans.length ? `開始 ${hm(spans[0].from)} · ` : ''}最長專注 ${hmDur(longest)} · 7 天平均 ${hmDur(Math.round(weekMinutes() / 7))}</div>
    <div class="ypt-list">${studySubjects().map(k => {
      const i = subjectInfo(k), on = timer.running && timer.subject === k;
      return `<div class="ypt-row${on ? ' on' : ''}" data-action="study-go" data-subj="${k}" style="--c:${esc(i.color)}">
        <span class="ypt-play">${on ? '■' : '▶'}</span><span class="name">${esc(i.name)}</span>
        <span class="time" data-subj-time="${k}">${fmtHMS(todayMs(k))}</span></div>`;
    }).join('')}</div>
    <div class="row wrap ypt-tools">
      <button class="btn small" data-action="tags-manage">🏷️ 新增科目</button>
      <button class="btn small" data-action="new-session">＋ 補記錄</button>
      <span class="spacer"></span>
      <span class="ypt-remind"><span class="sub">提醒休息</span><div class="seg">${reminds.map(([m, l]) => `<button data-action="timer-remind" data-m="${m}" class="${m === (timer.remindMin || 0) ? 'on' : ''}">${l}</button>`).join('')}</div><span class="sub">分</span></span>
    </div>
  </section>`;
}

// 計畫表：一天 × 每 10 分鐘一格，讀書的格子塗上科目顏色（跟「讀了什麼」看同一天）
function plannerCard() {
  const ds = ui.logDay, base = dayStart(ds);
  const cells = {};   // 格子編號 → { 科目: 毫秒 }
  for (const sp of daySpans(ds)) {
    for (let c = Math.max(0, Math.floor((sp.from - base) / 600000)); c < 144 && base + c * 600000 < sp.to; c++) {
      const a = Math.max(sp.from, base + c * 600000), b = Math.min(sp.to, base + (c + 1) * 600000);
      if (b > a) { const m = (cells[c] ||= {}); m[sp.subject] = (m[sp.subject] || 0) + (b - a); }
    }
  }
  const hours = Object.keys(cells).map(c => Math.floor(c / 6));
  const h0 = Math.min(6, ...hours), h1 = Math.max(23, ...hours);
  const nowCell = ds === today() ? Math.floor((Date.now() - base) / 600000) : -1;
  const rows = [];
  for (let h = h0; h <= h1; h++) {
    rows.push(`<div class="pl-h">${h}</div>${[0, 1, 2, 3, 4, 5].map(j => {
      const c = h * 6 + j, m = cells[c];
      if (!m) return `<div class="pl-c${c === nowCell ? ' now' : ''}"></div>`;
      const [k, ms] = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      const i = subjectInfo(k);
      return `<div class="pl-c" style="background:${esc(i.color)};opacity:${Math.min(1, 0.35 + ms / 600000).toFixed(2)}" title="${h}:${j}0 ${esc(i.name)}"></div>`;
    }).join('')}`);
  }
  const untimed = S.state.sessions.filter(x => x.date === ds && !sessSpan(x)).reduce((n, x) => n + (x.minutes || 0), 0);
  return `<section class="card planner">
    <div class="row" style="margin-bottom:6px"><h2 style="margin:0">🗓️ 計畫表</h2><span class="spacer"></span><span class="sub">${fmtDate(ds)} · 每格 10 分鐘</span></div>
    <div class="pl-grid">${rows.join('')}</div>
    ${untimed ? `<div class="sub" style="margin-top:6px">另有 ${fmtMin(untimed)} 是補記錄／打勾算的，沒有時間點所以不畫。</div>` : ''}
  </section>`;
}

// 這個月每天讀多久（顏色越深越多）
function monthCal() {
  const t = today(), d = parseYmd(t);
  const first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const byDay = {};
  for (const x of S.state.sessions) if (x.date.slice(0, 7) === t.slice(0, 7)) byDay[x.date] = (byDay[x.date] || 0) + (x.minutes || 0);
  const cells = Array(first.getDay()).fill('<div></div>');
  for (let i = 1; i <= last; i++) {
    const ds = ymd(new Date(d.getFullYear(), d.getMonth(), i)), m = byDay[ds] || 0;
    const lv = !m ? 0 : m < 60 ? 1 : m < 180 ? 2 : m < 360 ? 3 : 4;
    cells.push(`<div class="mc lv${lv}${ds === t ? ' today' : ''}" title="${fmtDate(ds)} ${fmtMin(m)}"><b>${i}</b><span>${shortMin(m)}</span></div>`);
  }
  return `<div class="mcal">${WEEKDAYS.map(w => `<div class="mc-w">${w}</div>`).join('')}${cells.join('')}</div>
    <div class="sub mc-legend">顏色越深讀越久：1 小時內／1–3／3–6／6 小時以上</div>`;
}

// 讀書時數的區間：日＝最近 7 天、週＝最近 8 週（週一開始）、月＝最近 6 個月；由舊到新，最後一個是現在
const weekStart = ds => addDays(ds, -((parseYmd(ds).getDay() + 6) % 7));
function periods(range) {
  const t = today(), out = [];
  if (range === 'week') {
    const ws = weekStart(t);
    for (let i = 7; i >= 0; i--) {
      const from = addDays(ws, -7 * i), d = parseYmd(from);
      out.push({ from, to: addDays(from, 6), label: `${d.getMonth() + 1}/${d.getDate()}`, title: `${fmtDate(from)} 那週` });
    }
  } else if (range === 'month') {
    const d = parseYmd(t);
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push({ from: ymd(m), to: ymd(new Date(m.getFullYear(), m.getMonth() + 1, 0)), label: `${m.getMonth() + 1}月`, title: `${m.getFullYear()} 年 ${m.getMonth() + 1} 月` });
    }
  } else {
    for (let i = 6; i >= 0; i--) {
      const ds = addDays(t, -i);
      out.push({ from: ds, to: ds, label: WEEKDAYS[parseYmd(ds).getDay()], title: fmtDate(ds) });
    }
  }
  for (const p of out) p.m = S.state.sessions.filter(x => x.date >= p.from && x.date <= p.to).reduce((n, x) => n + (x.minutes || 0), 0);
  return out;
}
const RANGES = { day: ['日', '今天', '昨天'], week: ['週', '這週', '上週'], month: ['月', '這個月', '上個月'] };
const shortMin = m => (m >= 60 ? `${+(m / 60).toFixed(1)}h` : m ? `${m}` : '');

function statsCard() {
  const t = today();
  const range = RANGES[ui.statRange] ? ui.statRange : 'day';
  const [, curName, prevName] = RANGES[range];
  const ps = periods(range);
  const cur = ps[ps.length - 1], prev = ps[ps.length - 2];
  const max = Math.max(60, ...ps.map(p => p.m));
  // 平均每天：這週／這個月只算到今天為止的天數
  const days = Math.round((parseYmd(t) - parseYmd(cur.from)) / 86400000) + 1;
  const diff = cur.m - prev.m;
  const recent = [...S.state.sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  return `<section class="card">
    <div class="row" style="margin-bottom:8px"><h2 style="margin:0">📊 讀書時數</h2><span class="spacer"></span>
      <div class="seg">${Object.entries(RANGES).map(([k, [l]]) => `<button data-action="stat-range" data-r="${k}" class="${k === range ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
    <div class="sub">${curName} <b class="big">${fmtMin(cur.m)}</b> · ${prevName} ${fmtMin(prev.m)}${
      diff ? ` <span class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${fmtMin(Math.abs(diff))}</span>` : ''}${
      range !== 'day' ? ` · 平均每天 ${fmtMin(Math.round(cur.m / days))}` : ''}</div>
    <div class="bars">${ps.map(p => `<div class="bcol ${p === cur ? 'today' : ''}" title="${p.title} ${fmtMin(p.m)}">
      <span class="bval">${shortMin(p.m)}</span><div class="bfill" style="height:${Math.round(p.m / max * 100)}%"></div>
      <span class="blabel">${p.label}</span></div>`).join('')}</div>
    ${range === 'month' ? monthCal() : ''}
    ${cur.m ? `<div class="sub" style="margin:0 0 2px">${curName}各科</div>${subjBars(cur.from, cur.to)}` : ''}
    ${recent.length ? `<div class="sub" style="margin:10px 0 2px">最近紀錄</div>${recent.map(x => `<div class="goal">
      <div class="text">${fmtDate(x.date, false)} · ${esc(subjectInfo(x.subject).name)}${sessionLabel(x) ? ` · ${esc(sessionLabel(x))}` : ''} · ${x.minutes} 分</div>
      <button class="del" data-action="del-session" data-id="${x.id}" aria-label="刪除">✕</button></div>`).join('')}` : ''}
  </section>`;
}

// 一段日期裡每個科目／標籤讀了多久
function subjBars(from, to) {
  const bySubj = {};
  for (const x of S.state.sessions) if (x.date >= from && x.date <= to) bySubj[x.subject || ''] = (bySubj[x.subject || ''] || 0) + (x.minutes || 0);
  const subj = Object.entries(bySubj).sort((a, b) => b[1] - a[1]);
  const smax = Math.max(1, ...subj.map(x => x[1]));
  return subj.map(([k, m]) => { const i = subjectInfo(k); return `<div class="subj"><span>${esc(i.name)}</span>
      <div class="progress" style="flex:1"><div style="width:${Math.round(m / smax * 100)}%;background:${esc(i.color)}"></div></div><span class="sub">${fmtMin(m)}</span></div>`; }).join('');
}

export function renderStudy(s) {
  S = s;
  return `<div class="page-head"><h1>讀書</h1><span class="sub">點科目開始計時，停止就記一段</span></div>
    <div class="grid two">${studyHero()}${plannerCard()}${logCard()}${statsCard()}</div>`;
}

// 計時中的全螢幕（縮小後變成浮在下面的小條，可以去別頁看文件）
export function focusHtml(s) {
  S = s;
  if (!timer.running) return '';
  const i = subjectInfo(timer.subject);
  if (ui.focusMini) {
    return `<button class="focus-pill" data-action="focus-open" style="--c:${esc(i.color)}"><span class="dot"></span>${esc(i.name)}
      <b id="focus-pill-time">${fmtHMS(elapsedMs())}</b></button>`;
  }
  return `<div class="focus-screen" style="--c:${esc(i.color)}">
    <div class="row focus-head"><button class="btn small" data-action="focus-min">⌄ 縮小</button><span class="spacer"></span>
      <span class="sub">${timer.remindMin ? `每 ${timer.remindMin} 分鐘提醒休息` : ''}</span></div>
    <div class="focus-subj"><span class="dot"></span>${esc(i.name)}</div>
    <div class="focus-clock" id="focus-clock">${fmtHMS(elapsedMs())}</div>
    <div class="focus-today">今天總共 <b id="focus-today">${fmtHMS(todayMs())}</b></div>
    <form data-form="timer-note" class="timer-note"><input type="text" name="note" data-action="timer-note" maxlength="60" autocomplete="off"
      placeholder="這次讀什麼？例如：DSP 8.3 DFT（可不填）" value="${esc(timer.note || '')}"></form>
    <button class="focus-stop" data-action="study-stop" aria-label="停止">■</button>
    <div class="sub">停止就記一段。螢幕會保持亮著，切到別的 App 回來也照算。</div>
  </div>`;
}

// 每秒更新：只改數字，不重畫整頁
export function tickTimerView(s) {
  S = s;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('focus-clock', fmtHMS(elapsedMs()));
  set('focus-pill-time', fmtHMS(elapsedMs()));
  set('focus-today', fmtHMS(todayMs()));
  set('ypt-total', fmtHMS(todayMs()));
  const el = timer.running && document.querySelector(`[data-subj-time="${timer.subject}"]`);
  if (el) el.textContent = fmtHMS(todayMs(timer.subject));
}

export function tickWorkView() {
  for (const el of document.querySelectorAll('.live[data-since]')) {
    el.textContent = fmtElapsed(+el.dataset.base + Math.max(0, Date.now() - +el.dataset.since));
  }
}

// ---------- 設定 ----------
export function renderSettings(s) {
  S = s;
  let sync;
  if (!s.cloudAvailable) {
    sync = `<div class="sub">雲端同步還沒設定（需要把 Firebase 設定填進 <code>js/firebase-config.js</code>）。目前資料存在這台裝置的瀏覽器裡。</div>`;
  } else if (s.user) {
    sync = `<div class="row wrap"><div>✅ 已登入 <b>${esc(s.user.email)}</b><div class="sub">電腦和手機登入同一個帳號就會自動同步</div></div>
      <span class="spacer"></span><button class="btn" data-action="logout">登出</button></div>`;
  } else {
    sync = `<form data-form="login">
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>密碼（至少 6 碼）</span><input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
      <div class="row"><button class="btn primary" type="submit" name="mode" value="login">登入</button>
      <button class="btn" type="submit" name="mode" value="signup">第一次用：註冊</button></div>
      <div class="sub" style="margin-top:8px">登入後，這台裝置上已有的資料會自動上傳。</div>
    </form>`;
  }
  const courses = s.state.courses;
  return `<div class="page-head"><h1>設定</h1></div>
  <div class="grid two">
    <section class="card"><h2>☁️ 同步</h2>${sync}</section>
    <section class="card"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">📘 課表</h2><span class="spacer"></span>
      <button class="btn small" data-action="new-course">＋ 新增課程</button></div>
      ${timetable(courses)}
      ${courses.length ? courses.map(c => `<div class="ev" data-action="edit-course" data-id="${c.id}"><span class="bar" style="background:${esc(c.color)}"></span>
        <div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${fmtSlotTimes(c.slots) || '還沒填上課時間'}${c.room ? ` · ${esc(c.room)}` : ''}</div></div></div>`).join('')
        : '<div class="empty">還沒有課程。可以一門一門新增，或用「加入檔案」匯入課表 JSON。</div>'}
    </section>
    <section class="card"><h2>🎨 背景顏色</h2>
      <div class="colors bg-colors">${BG_PRESETS.map(c => `<button type="button" data-action="pick-bg" data-color="${c}" class="${c === (s.prefs.bg || BG_PRESETS[0]) ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        <label class="row sub">自訂顏色 <input type="color" data-action="custom-bg" value="${esc(s.prefs.bg || BG_PRESETS[0])}"></label>
        <span class="spacer"></span><button class="btn small" data-action="pick-bg" data-color="">恢復預設</button>
      </div>
      <div class="sub" style="margin-top:6px">登入後手機和電腦會用同一個背景。</div>
    </section>
    <section class="card"><h2>💾 備份</h2>
      <div class="sub" style="margin-bottom:10px">匯出成 JSON 檔，可以存到 iCloud 雲碟。「匯入備份」會<b>覆蓋</b>目前所有資料；「加入檔案」只新增，不動原本的資料。</div>
      <div class="row wrap"><button class="btn" data-action="export">匯出備份</button>
      <label class="btn">匯入備份<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      <label class="btn">加入檔案<input type="file" accept="application/json,.json" data-action="merge" hidden></label></div>
    </section>
    <section class="card"><h2>📱 裝到 iPhone</h2>
      <div class="sub">用 <b>Safari</b> 打開這個網址 → 點下方「分享」⬆️ → 「加入主畫面」。之後從主畫面打開就是全螢幕 App。</div>
    </section>
    <section class="card"><h2>ℹ️ 關於</h2><div class="sub">碩士生活 v0.12 · ${s.mode === 'cloud' ? '雲端模式' : '本機模式'} · ${s.state.events.length} 個行程、${s.state.todos.length} 個待辦、${courses.length} 門課、${s.state.cards.length} 張字卡、${s.state.expenses.length} 筆帳</div></section>
  </div>`;
}
