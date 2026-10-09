import {
  TYPES, DEADLINE_TYPES, WEEKDAYS, today, addDays, parseYmd, ymd, daysUntil,
  fmtDate, countdown, byDateTime, esc, mdLite, BG_PRESETS,
} from './util.js';
import { classesOn, classRow, courseById, fmtSlots } from './courses.js';
import { timer, leftMs, fmtClock } from './timer.js';
import { QUOTES, QUOTE_CATS, quoteOfDay } from './quotes.js';

// 畫面狀態（不存檔）
export const ui = {
  calMode: 'month',   // 'month' | 'week'
  month: today().slice(0, 8) + '01',
  selDay: today(),
  todoFilter: 'all',  // 'all' | TYPES 的 key
  todoCourse: 'all',  // 'all' | course id
  showDoneTodos: false,
  openTopics: new Set(),
  quote: null,        // 雞湯區目前顯示第幾句（null = 今日一句）
  quoteCat: 'all',
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

function topicPct(t) {
  const g = t.goals || [];
  return g.length ? Math.round(g.filter(x => x.done).length / g.length * 100) : 0;
}

function syncBanner(s) {
  if (!s.cloudAvailable || s.mode === 'cloud') return '';
  return `<div class="banner">目前資料只存在這台裝置。<a href="#settings">登入</a>就能和電腦／手機同步。</div>`;
}

// ---------- 讀書時數 ----------
export function subjectInfo(key) {
  const [k, id] = (key || '').split(':');
  if (k === 'c') { const c = courseById(S.state.courses, id); if (c) return { name: c.name, color: c.color }; }
  if (k === 't') { const t = S.state.topics.find(x => x.id === id); if (t) return { name: t.name, color: t.color }; }
  return { name: '自由讀書', color: '#94a3b8' };
}
const minutesOn = (ds, filter = () => true) =>
  S.state.sessions.filter(x => x.date === ds && filter(x)).reduce((n, x) => n + (x.minutes || 0), 0);
const weekMinutes = (filter = () => true) => {
  const from = addDays(today(), -6);
  return S.state.sessions.filter(x => x.date >= from && filter(x)).reduce((n, x) => n + (x.minutes || 0), 0);
};
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
  const topics = [...s.state.topics].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const todos = s.state.todos.filter(x => !x.done).sort(workFirst);
  const q = QUOTES[quoteOfDay(t)];

  return `${syncBanner(s)}
  <div class="page-head"><div>
    <div class="sub">${d.getFullYear()} 年</div>
    <h1>${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAYS[d.getDay()]}</h1>
  </div></div>
  <a href="#quotes" class="quote-mini">🍵 ${esc(q[1])}</a>
  <div class="grid two">
    <section class="card"><h2>☀️ 今天</h2>${classes.map(classRow).join('')}${
      todays.length || !classes.length ? list(todays, { showDate: false }, classes.length ? '' : '今天沒有安排') : ''}</section>
    <section class="card"><h2>⏳ 倒數</h2>${list(deadlines, { showCountdown: true }, '沒有待完成的考試／報告／作業 🎉')}</section>
    <section class="card"><h2>✅ 待辦 <a href="#todo" class="sub" style="font-weight:400">（${todos.length} 件）全部 ›</a></h2>${
      todos.length ? todos.slice(0, 6).map(x => todoRow(x)).join('') : '<div class="empty">沒有待辦事項</div>'}</section>
    <section class="card"><h2>🗓️ 接下來 7 天</h2>${list(week, {}, '這週沒有其他事')}</section>
    <section class="card"><h2>📖 讀書 <a href="#study" class="sub" style="font-weight:400">今天 ${fmtMin(minutesOn(t))} · 7 天 ${fmtMin(weekMinutes())} ›</a></h2>${
      topics.length ? topics.map(tp => {
        const p = topicPct(tp);
        return `<a href="#study" class="ev"><span class="bar" style="background:${esc(tp.color)}"></span>
          <div class="main"><div class="title">${esc(tp.name)}</div>
          <div class="progress" style="margin-top:6px"><div style="width:${p}%;background:${esc(tp.color)}"></div></div></div>
          <span class="badge">${p}%</span></a>`;
      }).join('') : '<div class="empty">還沒有自學主題，到「讀書」新增一個吧</div>'
    }</section>
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

function todoRow(x, { showDate = true, steps = false } = {}) {
  const ty = TYPES[x.type] || TYPES.other;
  const cd = x.due && !x.done ? countdown(x.due) : null;
  const st = x.steps || [];
  const stDone = st.filter(z => z.done).length;
  const working = !!x.workingSince && !x.done;
  const spentMin = Math.floor((x.spentMs || 0) / 60000);
  const meta = [working ? '<b class="run-tag">⏱ 執行中</b>' : '待辦', courseTag(x.courseId), ty.label, x.due && showDate ? fmtDate(x.due) : '',
    st.length ? `☑ ${stDone}/${st.length}` : '', !working && spentMin ? `⏱ ${fmtMin(spentMin)}` : '', x.note ? '📝' : ''].filter(Boolean).join(' · ');
  const stepRows = steps && !x.done ? st.map(z => `<div class="step ${z.done ? 'done' : ''}">
      <button class="check small ${z.done ? 'on' : ''}" data-action="toggle-step" data-id="${x.id}" data-step="${z.id}" aria-label="完成">${z.done ? '✓' : ''}</button>
      <span>${esc(z.text)}</span></div>`).join('') : '';
  const workBtn = x.done ? ''
    : working ? `<button class="work-btn on" data-action="todo-pause" data-id="${x.id}" aria-label="暫停">⏸</button>`
    : `<button class="work-btn" data-action="todo-start" data-id="${x.id}" aria-label="開始做" title="開始做這件（計時）">▶</button>`;
  return `<div class="ev ${x.done ? 'done' : ''} ${working ? 'working' : ''}" data-action="edit-todo" data-id="${x.id}">
    <button class="check ${x.done ? 'on' : ''}" data-action="toggle-todo" data-id="${x.id}" aria-label="完成">${x.done ? '✓' : ''}</button>
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
// 執行中的排最前面
const workFirst = (a, b) => (b.workingSince ? 1 : 0) - (a.workingSince ? 1 : 0) || byDue(a, b);

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
    <section class="card">
      <form class="add-goal" data-form="add-todo" style="margin:0 0 8px">
        <input type="text" name="title" placeholder="新增${(TYPES[addType] || TYPES.other).label}待辦，例如：DSP 第 3 章習題" autocomplete="off">
        <button class="btn" type="submit">加入</button>
      </form>
      ${open.length ? open.map(x => todoRow(x, { steps: true })).join('') : '<div class="empty">沒有未完成的待辦 🎉</div>'}
      ${done.length ? `<button class="btn small ghost" data-action="todo-show-done" style="margin-top:8px">${ui.showDoneTodos ? '隱藏' : '顯示'}已完成（${done.length}）</button>
        ${ui.showDoneTodos ? done.map(x => todoRow(x)).join('') : ''}` : ''}
    </section>`;
}

// ---------- 讀書（番茄鐘＋時數＋自學主題） ----------
function subjectOptions(cur) {
  const opt = (v, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  return opt('', '自由讀書')
    + (S.state.courses.length ? `<optgroup label="課程">${S.state.courses.map(c => opt(`c:${c.id}`, c.name)).join('')}</optgroup>` : '')
    + (S.state.topics.length ? `<optgroup label="自學主題">${S.state.topics.map(t => opt(`t:${t.id}`, t.name)).join('')}</optgroup>` : '');
}

function timerCard() {
  const focus = timer.phase === 'focus';
  const total = (focus ? timer.focusMin : timer.breakMin) * 60000;
  const pct = Math.round((1 - leftMs() / total) * 100);
  const preset = `${timer.focusMin}/${timer.breakMin}`;
  return `<section class="card timer ${focus ? '' : 'rest'}">
    <div class="row"><h2 style="margin:0">${focus ? '🍅 專注' : '☕ 休息'}</h2><span class="spacer"></span>
      <div class="seg">${['25/5', '50/10', '15/3'].map(p => `<button data-action="timer-len" data-len="${p}" class="${p === preset ? 'on' : ''}">${p}</button>`).join('')}</div></div>
    <select data-action="timer-subject" class="timer-subject" ${timer.running && focus ? 'disabled' : ''}>${subjectOptions(timer.subject)}</select>
    <div class="clock" id="timer-clock">${fmtClock(leftMs())}</div>
    <div class="progress"><div id="timer-bar" style="width:${pct}%;background:${focus ? 'var(--accent)' : 'var(--ok)'}"></div></div>
    <div class="row wrap" style="margin-top:12px;justify-content:center">
      ${timer.running
        ? '<button class="btn primary" data-action="timer-pause">⏸ 暫停</button>'
        : `<button class="btn primary" data-action="timer-start">▶ ${leftMs() < total ? '繼續' : '開始'}</button>`}
      <button class="btn" data-action="timer-reset">↺ 重來</button>
      ${focus ? '<button class="btn" data-action="timer-finish">✓ 提早結束並記錄</button>' : '<button class="btn" data-action="timer-skip">跳過休息</button>'}
    </div>
    <div class="sub" style="text-align:center;margin-top:8px">時間到會響和震動；切到別的 App 回來也會照算。</div>
  </section>`;
}

function statsCard() {
  const t = today();
  const days = [];
  for (let i = 6; i >= 0; i--) { const ds = addDays(t, -i); days.push([ds, minutesOn(ds)]); }
  const max = Math.max(60, ...days.map(d => d[1]));
  const from = addDays(t, -6);
  const bySubj = {};
  for (const x of S.state.sessions) if (x.date >= from) bySubj[x.subject || ''] = (bySubj[x.subject || ''] || 0) + (x.minutes || 0);
  const subj = Object.entries(bySubj).sort((a, b) => b[1] - a[1]);
  const smax = Math.max(1, ...subj.map(x => x[1]));
  const recent = [...S.state.sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  return `<section class="card">
    <div class="row" style="margin-bottom:8px"><h2 style="margin:0">📊 讀書時數</h2><span class="spacer"></span>
      <button class="btn small" data-action="new-session">＋ 補記錄</button></div>
    <div class="sub">今天 <b class="big">${fmtMin(minutesOn(t))}</b> · 最近 7 天 <b class="big">${fmtMin(weekMinutes())}</b></div>
    <div class="bars">${days.map(([ds, m]) => `<div class="bcol ${ds === t ? 'today' : ''}" title="${fmtDate(ds)} ${m} 分">
      <span class="bval">${m || ''}</span><div class="bfill" style="height:${Math.round(m / max * 100)}%"></div>
      <span class="blabel">${WEEKDAYS[parseYmd(ds).getDay()]}</span></div>`).join('')}</div>
    ${subj.map(([k, m]) => { const i = subjectInfo(k); return `<div class="subj"><span>${esc(i.name)}</span>
      <div class="progress" style="flex:1"><div style="width:${Math.round(m / smax * 100)}%;background:${esc(i.color)}"></div></div><span class="sub">${fmtMin(m)}</span></div>`; }).join('')}
    ${recent.length ? `<div class="sub" style="margin:10px 0 2px">最近紀錄</div>${recent.map(x => `<div class="goal">
      <div class="text">${fmtDate(x.date, false)} · ${esc(subjectInfo(x.subject).name)} · ${x.minutes} 分</div>
      <button class="del" data-action="del-session" data-id="${x.id}" aria-label="刪除">✕</button></div>`).join('')}` : ''}
  </section>`;
}

function topicCard(t) {
  const p = topicPct(t);
  const goals = t.goals || [];
  const cd = t.targetDate ? countdown(t.targetDate) : null;
  const open = ui.openTopics.has(t.id);
  const next = goals.find(g => !g.done);
  const mins = weekMinutes(x => x.subject === `t:${t.id}`);
  const goalRow = g => `<div class="goal ${g.done ? 'done' : ''}">
      <button class="check ${g.done ? 'on' : ''}" data-action="toggle-goal" data-id="${t.id}" data-goal="${g.id}" aria-label="完成">${g.done ? '✓' : ''}</button>
      <div class="text" data-action="edit-goal" data-id="${t.id}" data-goal="${g.id}" title="點一下改文字">${esc(g.text)}</div>
      ${open ? `<button class="del" data-action="del-goal" data-id="${t.id}" data-goal="${g.id}" aria-label="刪除">✕</button>` : ''}
    </div>`;
  return `<section class="card topic">
    <div class="head" data-action="topic-open" data-id="${t.id}">
      <span class="bar" style="width:6px;height:22px;border-radius:4px;background:${esc(t.color)}"></span>
      <div class="name">${esc(t.name)}</div>
      ${cd ? `<span class="badge ${cd.cls}" title="目標日 ${fmtDate(t.targetDate)}">${cd.text}</span>` : ''}
      <button class="btn small" data-action="topic-focus" data-id="${t.id}" title="用番茄鐘讀這個主題">▶ 專注</button>
      <span class="fold">${open ? '▾' : '▸'}</span>
    </div>
    <div class="row" style="margin-bottom:6px">
      <div class="progress" style="flex:1"><div style="width:${p}%;background:${esc(t.color)}"></div></div>
      <span class="sub">${goals.filter(g => g.done).length}/${goals.length} · ${p}%${mins ? ` · 7 天 ${fmtMin(mins)}` : ''}</span>
    </div>
    ${open ? `
      ${!t.note ? '' : t.note.length > 160 || t.note.includes('|')
        ? `<details class="note-box"><summary>📝 筆記</summary><div class="md">${mdLite(t.note)}</div></details>`
        : `<div class="sub" style="margin-bottom:6px">${esc(t.note)}</div>`}
      ${goals.map(goalRow).join('')}
      <form class="add-goal" data-form="add-goal" data-id="${t.id}">
        <input type="text" name="text" placeholder="新增小目標，例如：看完第 3 章" autocomplete="off">
        <button class="btn" type="submit">加入</button>
      </form>
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small ghost" data-action="edit-topic" data-id="${t.id}">編輯主題</button></div>`
    : next ? `<div class="sub" style="margin-top:4px">下一步</div>${goalRow(next)}`
    : `<div class="sub" style="margin-top:4px">${goals.length ? '全部完成 🎉' : '還沒有小目標，點標題展開來新增'}</div>`}
  </section>`;
}

export function renderStudy(s) {
  S = s;
  const topics = [...s.state.topics].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return `<div class="page-head"><h1>讀書</h1></div>
    <div class="grid two">${timerCard()}${statsCard()}</div>
    <div class="page-head" style="margin-top:22px"><h2 style="margin:0;font-size:20px">🌱 自學主題</h2>
      <button class="btn primary" data-action="new-topic">＋ 新增主題</button></div>
    <div class="grid two">${topics.map(topicCard).join('') || '<div class="card"><div class="empty">把想自學的東西拆成小目標，一個一個打勾。<br>例如：ROS2 → 裝好環境、寫第一個 node、做 TF 練習…</div></div>'}</div>`;
}

// 番茄鐘每秒更新：只改數字和進度條，不重畫整頁
export function tickTimerView() {
  const el = document.getElementById('timer-clock');
  if (!el) return;
  el.textContent = fmtClock(leftMs());
  const total = (timer.phase === 'focus' ? timer.focusMin : timer.breakMin) * 60000;
  const bar = document.getElementById('timer-bar');
  if (bar) bar.style.width = `${Math.round((1 - leftMs() / total) * 100)}%`;
}

// 待辦計時每秒更新
export function tickWorkView() {
  for (const el of document.querySelectorAll('.live[data-since]')) {
    el.textContent = fmtElapsed(+el.dataset.base + Math.max(0, Date.now() - +el.dataset.since));
  }
}

// ---------- 心靈雞湯 ----------
export function renderQuotes(s) {
  S = s;
  const favs = s.prefs.favQuotes || [];
  const i = ui.quote ?? quoteOfDay(today());
  const [cat, text] = QUOTES[i];
  const fav = favs.includes(i);
  const cats = Object.entries(QUOTE_CATS);
  const shown = QUOTES.map((q, n) => [n, q]).filter(([, q]) => ui.quoteCat === 'fav' ? false : ui.quoteCat === 'all' || q[0] === ui.quoteCat);
  return `<div class="page-head"><h1>心靈雞湯</h1><span class="sub">讀不下去的時候來這裡喘口氣</span></div>
    <section class="card quote-card">
      <div class="sub">${ui.quote == null ? '今日一句' : '隨機一句'} · ${QUOTE_CATS[cat]}</div>
      <div class="quote-text">${esc(text)}</div>
      <div class="row wrap" style="justify-content:center">
        <button class="btn primary" data-action="quote-next">🎲 換一句</button>
        <button class="btn" data-action="quote-fav" data-i="${i}">${fav ? '💛 已收藏' : '🤍 收藏'}</button>
        <a class="btn" href="#study">🍅 好，去讀 25 分鐘</a>
      </div>
    </section>
    <div class="chips" style="margin:16px 0 10px">
      <button data-action="quote-cat" data-key="all" class="${ui.quoteCat === 'all' ? 'on' : ''}">全部</button>
      ${cats.map(([k, l]) => `<button data-action="quote-cat" data-key="${k}" class="${ui.quoteCat === k ? 'on' : ''}">${l}</button>`).join('')}
      <button data-action="quote-cat" data-key="fav" class="${ui.quoteCat === 'fav' ? 'on' : ''}">💛 收藏 ${favs.length || ''}</button>
    </div>
    <section class="card">${(ui.quoteCat === 'fav' ? favs.filter(n => QUOTES[n]).map(n => [n, QUOTES[n]]) : shown)
      .map(([n, q]) => `<div class="quote-row" data-action="quote-show" data-i="${n}">${favs.includes(n) ? '💛 ' : ''}${esc(q[1])}</div>`).join('')
      || '<div class="empty">還沒有收藏，看到喜歡的按「收藏」</div>'}</section>`;
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
      ${courses.length ? courses.map(c => `<div class="ev" data-action="edit-course" data-id="${c.id}"><span class="bar" style="background:${esc(c.color)}"></span>
        <div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${fmtSlots(c.slots)}${c.room ? ` · ${esc(c.room)}` : ''}</div></div></div>`).join('')
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
    <section class="card"><h2>ℹ️ 關於</h2><div class="sub">學習儀表板 v0.5 · ${s.mode === 'cloud' ? '雲端模式' : '本機模式'} · ${s.state.events.length} 個行程、${s.state.todos.length} 個待辦、${courses.length} 門課、${s.state.topics.length} 個自學主題</div></section>
  </div>`;
}
