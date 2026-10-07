import {
  store, subscribe, initStore, newId, saveEvent, deleteEvent, saveTopic, deleteTopic, saveTodo, deleteTodo, savePrefs,
  saveCourse, deleteCourse, saveSession, deleteSession,
  exportData, importData, mergeData, login, signup, logout,
} from './store.js';
import { TYPES, TOPIC_COLORS, BG_PRESETS, isLight, today, addDays, ymd, esc } from './util.js';
import {
  ui, renderHome, renderCalendar, renderTodo, renderStudy, renderQuotes, renderSettings, shiftMonth, tickTimerView, subjectInfo,
} from './views.js';
import { parseSlots, fmtSlots } from './courses.js';
import * as T from './timer.js';
import { QUOTES } from './quotes.js';

const $ = sel => document.querySelector(sel);
const view = $('#view');
const fab = $('#fab');
const backdrop = $('#sheet-backdrop');
const sheet = $('#sheet');

const ROUTES = { home: renderHome, calendar: renderCalendar, todo: renderTodo, study: renderStudy, quotes: renderQuotes, settings: renderSettings };
const route = () => (location.hash.slice(1) in ROUTES ? location.hash.slice(1) : 'home');

// ---------- 畫面 ----------
function applyBg() {
  const bg = store.prefs.bg || BG_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty('--bg', bg);
  root.classList.toggle('light', isLight(bg));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
}

function render() {
  applyBg();
  const r = route();
  // 重畫時保留正在輸入的欄位（例如另一台裝置同步進來時）
  const active = document.activeElement;
  let keep = null;
  if (active && view.contains(active) && active.name) {
    const form = active.closest('form');
    keep = { form: form?.dataset.form, id: form?.dataset.id, name: active.name, value: active.value };
  }

  view.innerHTML = store.ready ? ROUTES[r](store) : '<div class="sub">載入中…</div>';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === r));
  fab.hidden = r === 'settings' || r === 'quotes';

  if (keep) {
    const sel = `form[data-form="${keep.form}"]${keep.id ? `[data-id="${keep.id}"]` : ''} [name="${keep.name}"]`;
    const el = keep.form ? view.querySelector(sel) : null;
    if (el) { el.value = keep.value; el.focus(); }
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- 底部面板 ----------
let sheetCtx = null;

function openSheet(html, ctx) {
  sheetCtx = ctx;
  sheet.innerHTML = html;
  backdrop.hidden = false;
}
function closeSheet() { backdrop.hidden = true; sheet.innerHTML = ''; sheetCtx = null; }

const lastType = () => { try { return localStorage.getItem('studydash.lastType') || 'report'; } catch { return 'report'; } };

function typeChips(cur) {
  return Object.entries(TYPES).map(([k, t]) =>
    `<button type="button" data-action="pick-type" data-type="${k}" class="${k === cur ? 'on' : ''}" style="${k === cur ? `background:${t.color};border-color:${t.color}` : ''}">${t.label}</button>`).join('');
}

// 行程／待辦屬於哪一門課（沒有課程就不顯示這欄）
function courseChips(cur) {
  const b = (id, label, color) => {
    const on = (cur || '') === id;
    return `<button type="button" data-action="pick-course" data-course="${id}" class="${on ? 'on' : ''}" style="${on && color ? `background:${color};border-color:${color}` : ''}">${esc(label)}</button>`;
  };
  return b('', '不分課程', '#94a3b8') + store.state.courses.map(c => b(c.id, c.name, c.color)).join('');
}
const courseField = cur => (store.state.courses.length
  ? `<div class="field"><span>課程</span><div class="chips" id="course-chips">${courseChips(cur)}</div></div>` : '');

function openEventSheet(ev) {
  const isNew = !ev.id;
  const e = { id: newId(), title: '', type: lastType(), date: today(), time: '', note: '', done: false, courseId: '', createdAt: Date.now(), ...ev };
  openSheet(`<h2>${isNew ? '新增行程' : '編輯行程'}</h2>
    <form data-form="event">
      <label class="field"><span>標題</span><input type="text" name="title" value="${esc(e.title)}" placeholder="例如：DSP 期中考" required autocomplete="off"></label>
      <div class="field"><span>類型</span><div class="chips" id="type-chips">${typeChips(e.type)}</div></div>
      ${courseField(e.courseId)}
      <div class="row">
        <label class="field" style="flex:1"><span>日期</span><input type="date" name="date" value="${e.date}" required></label>
        <label class="field" style="flex:1"><span>時間（可不填）</span><input type="time" name="time" value="${e.time || ''}"></label>
      </div>
      <label class="field"><span>備註</span><textarea name="note" placeholder="範圍、地點、要準備的東西…">${esc(e.note)}</textarea></label>
      <label class="row"><input type="checkbox" name="done" ${e.done ? 'checked' : ''}> 已完成</label>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="delete-event">刪除</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'event', data: e });
  if (isNew) sheet.querySelector('[name=title]').focus();
}

function stepsHtml(steps) {
  return steps.map(z => `<div class="step ${z.done ? 'done' : ''}">
    <button type="button" class="check small ${z.done ? 'on' : ''}" data-action="sheet-step-toggle" data-step="${z.id}">${z.done ? '✓' : ''}</button>
    <span>${esc(z.text)}</span><span class="spacer"></span>
    <button type="button" class="del" data-action="sheet-step-del" data-step="${z.id}" aria-label="刪除">✕</button></div>`).join('');
}

function openTodoSheet(td) {
  const isNew = !td.id;
  const x = { id: newId(), title: '', type: 'homework', due: '', note: '', done: false, courseId: '', steps: [], createdAt: Date.now(), ...td };
  x.steps = [...(x.steps || [])];
  openSheet(`<h2>${isNew ? '新增待辦' : '編輯待辦'}</h2>
    <form data-form="todo">
      <label class="field"><span>要做什麼</span><input type="text" name="title" value="${esc(x.title)}" placeholder="例如：DSP 第 3 章習題" required autocomplete="off"></label>
      <div class="field"><span>類型</span><div class="chips" id="type-chips">${typeChips(x.type)}</div></div>
      ${courseField(x.courseId)}
      <label class="field"><span>期限（可不填）</span><input type="date" name="due" value="${x.due || ''}"></label>
      <div class="field"><span>小步驟（可不填，例如：讀題 → 寫程式 → 寫報告）</span>
        <div id="steps">${stepsHtml(x.steps)}</div>
        <div class="add-goal"><input type="text" id="step-input" placeholder="新增一個步驟，按 Enter 加入" autocomplete="off">
          <button type="button" class="btn" data-action="sheet-step-add">加入</button></div>
      </div>
      <label class="field"><span>備註</span><textarea name="note" placeholder="繳交方式、頁數、連結…">${esc(x.note)}</textarea></label>
      <label class="row"><input type="checkbox" name="done" ${x.done ? 'checked' : ''}> 已完成</label>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="delete-todo">刪除</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'todo', data: x });
  if (isNew) sheet.querySelector('[name=title]').focus();
}

function addSheetStep() {
  const input = sheet.querySelector('#step-input');
  const text = input?.value.trim();
  if (!text) return;
  sheetCtx.data.steps.push({ id: newId(), text, done: false });
  sheet.querySelector('#steps').innerHTML = stepsHtml(sheetCtx.data.steps);
  input.value = '';
  input.focus();
}

function colorChips(cur) {
  return TOPIC_COLORS.map(c => `<button type="button" data-action="pick-color" data-color="${c}" class="${c === cur ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('');
}

function openTopicSheet(tp) {
  const isNew = !tp.id;
  const t = { id: newId(), name: '', color: TOPIC_COLORS[store.state.topics.length % TOPIC_COLORS.length], targetDate: '', note: '', goals: [], createdAt: Date.now(), ...tp };
  openSheet(`<h2>${isNew ? '新增自學主題' : '編輯主題'}</h2>
    <form data-form="topic">
      <label class="field"><span>主題名稱</span><input type="text" name="name" value="${esc(t.name)}" placeholder="例如：ROS2、DSP、日文" required autocomplete="off"></label>
      <div class="field"><span>顏色</span><div class="colors" id="color-chips">${colorChips(t.color)}</div></div>
      <label class="field"><span>目標完成日（可不填）</span><input type="date" name="targetDate" value="${t.targetDate || ''}"></label>
      <label class="field"><span>備註</span><textarea name="note" placeholder="為什麼學、用什麼教材…">${esc(t.note)}</textarea></label>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="delete-topic">刪除</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'topic', data: t });
  if (isNew) sheet.querySelector('[name=name]').focus();
}

function openCourseSheet(cs) {
  const isNew = !cs.id;
  const c = { id: newId(), name: '', color: TOPIC_COLORS[store.state.courses.length % TOPIC_COLORS.length], teacher: '', room: '', slots: [], start: '', end: '', createdAt: Date.now(), ...cs };
  openSheet(`<h2>${isNew ? '新增課程' : '編輯課程'}</h2>
    <form data-form="course">
      <label class="field"><span>課名</span><input type="text" name="name" value="${esc(c.name)}" placeholder="例如：機器學習" required autocomplete="off"></label>
      <div class="field"><span>顏色</span><div class="colors" id="color-chips">${colorChips(c.color)}</div></div>
      <label class="field"><span>上課時間（星期＋節次，例如：二5-6, 四2-4）</span><input type="text" name="slots" value="${esc(fmtSlots(c.slots))}" placeholder="四5-7" autocomplete="off"></label>
      <div class="row">
        <label class="field" style="flex:1"><span>教室</span><input type="text" name="room" value="${esc(c.room)}" autocomplete="off"></label>
        <label class="field" style="flex:1"><span>老師</span><input type="text" name="teacher" value="${esc(c.teacher)}" autocomplete="off"></label>
      </div>
      <div class="row">
        <label class="field" style="flex:1"><span>開學（可不填）</span><input type="date" name="start" value="${c.start || ''}"></label>
        <label class="field" style="flex:1"><span>結束（可不填）</span><input type="date" name="end" value="${c.end || ''}"></label>
      </div>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="delete-course">刪除</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'course', data: c });
  if (isNew) sheet.querySelector('[name=name]').focus();
}

function openSessionSheet() {
  const opts = [['', '自由讀書'], ...store.state.courses.map(c => [`c:${c.id}`, c.name]), ...store.state.topics.map(t => [`t:${t.id}`, t.name])];
  openSheet(`<h2>補記錄讀書時間</h2>
    <form data-form="session">
      <label class="field"><span>讀了什麼</span><select name="subject">${opts.map(([v, l]) => `<option value="${v}" ${v === T.timer.subject ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="row">
        <label class="field" style="flex:1"><span>日期</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field" style="flex:1"><span>分鐘</span><input type="text" inputmode="numeric" name="minutes" value="30" required></label>
      </div>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button></div>
    </form>`, { kind: 'session' });
}

// ---------- 番茄鐘 ----------
function recordFocus(minutes, endedAt = Date.now()) {
  if (minutes < 1) return;
  saveSession({ id: newId(), date: ymd(new Date(endedAt)), minutes, subject: T.timer.subject, createdAt: endedAt });
}

function timerTick() {
  const r = T.check();
  if (r) {
    if (r.done === 'focus') {
      recordFocus(r.minutes, r.endedAt);
      toast(`🍅 完成 ${r.minutes} 分鐘「${subjectInfo(T.timer.subject).name}」，休息一下`);
    } else {
      toast('☕ 休息結束，再來一輪？');
    }
    render();
  } else if (route() === 'study') {
    tickTimerView();
  }
}
setInterval(timerTick, 1000);

// ---------- 點擊 ----------
const findEvent = id => store.state.events.find(e => e.id === id);
const findTopic = id => store.state.topics.find(t => t.id === id);
const findTodo = id => store.state.todos.find(t => t.id === id);
const findCourse = id => store.state.courses.find(c => c.id === id);

const actions = {
  'edit-event': el => { const e = findEvent(el.dataset.id); if (e) openEventSheet(e); },
  'toggle-event': el => { const e = findEvent(el.dataset.id); if (e) saveEvent({ ...e, done: !e.done }); },
  'new-event': el => openEventSheet({ date: el.dataset.date || today() }),
  'pick-day': el => {
    if (ui.selDay === el.dataset.date) { openEventSheet({ date: el.dataset.date }); return; } // 再點一次＝新增
    ui.selDay = el.dataset.date;
    render();
  },
  'cal-mode': el => { ui.calMode = el.dataset.mode; render(); },
  'cal-nav': el => { shiftMonth(+el.dataset.dir); render(); },
  'week-nav': el => {
    ui.selDay = addDays(ui.selDay, 7 * el.dataset.dir);
    ui.month = ui.selDay.slice(0, 8) + '01';
    render();
  },
  'cal-today': () => { ui.selDay = today(); ui.month = today().slice(0, 8) + '01'; render(); },

  'edit-todo': el => { const x = findTodo(el.dataset.id); if (x) openTodoSheet(x); },
  'toggle-todo': el => { const x = findTodo(el.dataset.id); if (x) saveTodo({ ...x, done: !x.done }); },
  'toggle-step': el => {
    const x = findTodo(el.dataset.id); if (!x) return;
    const steps = (x.steps || []).map(z => z.id === el.dataset.step ? { ...z, done: !z.done } : z);
    // 步驟全部打勾就順便把待辦完成
    const all = steps.length && steps.every(z => z.done);
    saveTodo({ ...x, steps, done: all ? true : x.done });
    if (all) toast('全部步驟完成，待辦打勾了 🎉');
  },
  'new-todo': el => openTodoSheet({ due: el.dataset.date || '' }),
  'todo-filter': el => { ui.todoFilter = el.dataset.key; render(); },
  'todo-course': el => { ui.todoCourse = el.dataset.key; render(); },
  'todo-show-done': () => { ui.showDoneTodos = !ui.showDoneTodos; render(); },
  'delete-todo': () => {
    if (confirm(`刪除「${sheetCtx.data.title}」？`)) { deleteTodo(sheetCtx.data.id); closeSheet(); toast('已刪除'); }
  },
  'sheet-step-add': addSheetStep,
  'sheet-step-toggle': el => {
    sheetCtx.data.steps = sheetCtx.data.steps.map(z => z.id === el.dataset.step ? { ...z, done: !z.done } : z);
    sheet.querySelector('#steps').innerHTML = stepsHtml(sheetCtx.data.steps);
  },
  'sheet-step-del': el => {
    sheetCtx.data.steps = sheetCtx.data.steps.filter(z => z.id !== el.dataset.step);
    sheet.querySelector('#steps').innerHTML = stepsHtml(sheetCtx.data.steps);
  },
  'pick-bg': el => savePrefs({ bg: el.dataset.color }),

  'new-topic': () => openTopicSheet({}),
  'edit-topic': el => { const t = findTopic(el.dataset.id); if (t) openTopicSheet(t); },
  'topic-open': el => {
    const id = el.dataset.id;
    if (ui.openTopics.has(id)) ui.openTopics.delete(id); else ui.openTopics.add(id);
    render();
  },
  'topic-focus': el => {
    T.setSubject(`t:${el.dataset.id}`);
    if (!T.timer.running) { T.reset('focus'); T.start(); }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`開始專注：${subjectInfo(T.timer.subject).name}`);
  },
  'toggle-goal': el => {
    const t = findTopic(el.dataset.id); if (!t) return;
    saveTopic({ ...t, goals: t.goals.map(g => g.id === el.dataset.goal ? { ...g, done: !g.done } : g) });
  },
  'edit-goal': el => {
    const t = findTopic(el.dataset.id); if (!t) return;
    const g = t.goals.find(x => x.id === el.dataset.goal); if (!g) return;
    const text = prompt('修改小目標', g.text);
    if (text == null || !text.trim() || text.trim() === g.text) return;
    saveTopic({ ...t, goals: t.goals.map(x => x.id === g.id ? { ...x, text: text.trim() } : x) });
  },
  'del-goal': el => {
    const t = findTopic(el.dataset.id); if (!t) return;
    const g = t.goals.find(x => x.id === el.dataset.goal);
    if (g && confirm(`刪除「${g.text}」？`)) saveTopic({ ...t, goals: t.goals.filter(x => x.id !== g.id) });
  },

  'timer-start': () => { T.start(); render(); },
  'timer-pause': () => { T.pause(); render(); },
  'timer-reset': () => { T.reset(); render(); },
  'timer-skip': () => { T.reset('focus'); render(); },
  'timer-finish': () => {
    const m = T.focusedMinutes();
    if (m < 1) { toast('還不到 1 分鐘，先不記錄'); T.reset('focus'); render(); return; }
    recordFocus(m);
    T.reset('break');
    toast(`記錄了 ${m} 分鐘`);
    render();
  },
  'timer-len': el => { const [f, b] = el.dataset.len.split('/').map(Number); T.setLengths(f, b); render(); },
  'new-session': openSessionSheet,
  'del-session': el => { if (confirm('刪除這筆讀書紀錄？')) deleteSession(el.dataset.id); },

  'new-course': () => openCourseSheet({}),
  'edit-course': el => { const c = findCourse(el.dataset.id); if (c) openCourseSheet(c); },
  'delete-course': () => {
    if (confirm(`刪除課程「${sheetCtx.data.name}」？（標了這門課的待辦不會被刪）`)) { deleteCourse(sheetCtx.data.id); closeSheet(); toast('已刪除'); }
  },
  'pick-course': el => {
    sheetCtx.data.courseId = el.dataset.course;
    sheet.querySelector('#course-chips').innerHTML = courseChips(el.dataset.course);
  },

  'quote-next': () => {
    let i;
    do { i = Math.floor(Math.random() * QUOTES.length); } while (QUOTES.length > 1 && i === ui.quote);
    ui.quote = i;
    render();
  },
  'quote-show': el => { ui.quote = +el.dataset.i; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'quote-cat': el => { ui.quoteCat = el.dataset.key; render(); },
  'quote-fav': el => {
    const i = +el.dataset.i;
    const favs = store.prefs.favQuotes || [];
    savePrefs({ favQuotes: favs.includes(i) ? favs.filter(n => n !== i) : [...favs, i] });
  },

  'pick-type': el => {
    sheetCtx.data.type = el.dataset.type;
    sheet.querySelector('#type-chips').innerHTML = typeChips(el.dataset.type);
  },
  'pick-color': el => {
    sheetCtx.data.color = el.dataset.color;
    sheet.querySelector('#color-chips').innerHTML = colorChips(el.dataset.color);
  },
  'close-sheet': closeSheet,
  'delete-event': () => {
    if (confirm(`刪除「${sheetCtx.data.title}」？`)) { deleteEvent(sheetCtx.data.id); closeSheet(); toast('已刪除'); }
  },
  'delete-topic': () => {
    if (confirm(`刪除主題「${sheetCtx.data.name}」和裡面所有小目標？`)) { deleteTopic(sheetCtx.data.id); closeSheet(); toast('已刪除'); }
  },

  export: async () => {
    const json = JSON.stringify(exportData(), null, 2);
    const name = `學習儀表板備份_${today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    // 手機上用分享面板（可直接存到「檔案」/ iCloud），電腦上直接下載
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* 使用者取消 */ }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  logout: async () => { if (confirm('確定登出？登出後這台裝置看不到雲端資料。')) { await logout(); toast('已登出'); } },
};

document.addEventListener('click', ev => {
  if (ev.target === backdrop) { closeSheet(); return; }
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  ev.preventDefault();
  ev.stopPropagation();
  fn(el);
});

fab.addEventListener('click', () => {
  if (route() === 'study') openTopicSheet({});
  else if (route() === 'todo') openTodoSheet({ type: ui.todoFilter === 'all' ? 'homework' : ui.todoFilter, courseId: ui.todoCourse === 'all' ? '' : ui.todoCourse });
  else openEventSheet({ date: route() === 'calendar' ? ui.selDay : today() });
});

// 步驟輸入框按 Enter＝加入步驟，不要送出整個表單
sheet.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'step-input' && !ev.isComposing) { ev.preventDefault(); addSheetStep(); }
});

// ---------- 表單 ----------
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Email 或密碼錯誤',
  'auth/wrong-password': 'Email 或密碼錯誤',
  'auth/user-not-found': '找不到這個帳號，要先註冊',
  'auth/email-already-in-use': '這個 Email 已經註冊過了，直接登入',
  'auth/weak-password': '密碼至少 6 碼',
  'auth/invalid-email': 'Email 格式不對',
  'auth/network-request-failed': '網路連線失敗',
  'auth/too-many-requests': '嘗試太多次，稍後再試',
};

document.addEventListener('submit', async ev => {
  const form = ev.target;
  const kind = form.dataset.form;
  if (!kind) return;
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(form));

  if (kind === 'event') {
    const title = (f.title || '').trim();
    if (!title) return;
    const e = { ...sheetCtx.data, title, date: f.date, time: f.time || '', note: (f.note || '').trim(), done: !!f.done };
    try { localStorage.setItem('studydash.lastType', e.type); } catch { /* ignore */ }
    saveEvent(e);
    closeSheet();
    toast('已儲存');
  } else if (kind === 'todo') {
    const title = (f.title || '').trim();
    if (!title) return;
    saveTodo({ ...sheetCtx.data, title, due: f.due || '', note: (f.note || '').trim(), done: !!f.done });
    closeSheet();
    toast('已儲存');
  } else if (kind === 'add-todo') {
    const title = (f.title || '').trim();
    if (!title) return;
    saveTodo({
      id: newId(), title, type: ui.todoFilter === 'all' ? 'homework' : ui.todoFilter, courseId: ui.todoCourse === 'all' ? '' : ui.todoCourse,
      due: '', note: '', done: false, steps: [], createdAt: Date.now(),
    });
    const input = view.querySelector('form[data-form="add-todo"] [name=title]');
    if (input) { input.value = ''; input.focus(); }
  } else if (kind === 'course') {
    const name = (f.name || '').trim();
    if (!name) return;
    const slots = parseSlots(f.slots);
    if (f.slots.trim() && !slots.length) { toast('上課時間看不懂，請寫成「二5-6, 四2-4」'); return; }
    saveCourse({ ...sheetCtx.data, name, slots, room: f.room.trim(), teacher: f.teacher.trim(), start: f.start || '', end: f.end || '' });
    closeSheet();
    toast('已儲存');
  } else if (kind === 'session') {
    const minutes = parseInt(f.minutes, 10);
    if (!(minutes > 0)) { toast('分鐘數要大於 0'); return; }
    saveSession({ id: newId(), date: f.date, minutes, subject: f.subject, createdAt: Date.now() });
    closeSheet();
    toast(`記錄了 ${minutes} 分鐘`);
  } else if (kind === 'topic') {
    const name = (f.name || '').trim();
    if (!name) return;
    saveTopic({ ...sheetCtx.data, name, targetDate: f.targetDate || '', note: (f.note || '').trim() });
    closeSheet();
    toast('已儲存');
  } else if (kind === 'add-goal') {
    const text = (f.text || '').trim();
    const t = findTopic(form.dataset.id);
    if (!text || !t) return;
    saveTopic({ ...t, goals: [...(t.goals || []), { id: newId(), text, done: false }] });
    const input = view.querySelector(`form[data-id="${t.id}"] [name=text]`);
    if (input) { input.value = ''; input.focus(); }
  } else if (kind === 'login') {
    const mode = ev.submitter?.value || 'login';
    try {
      if (mode === 'signup') await signup(f.email, f.password);
      else await login(f.email, f.password);
      toast(mode === 'signup' ? '註冊成功，已開始同步' : '登入成功，已開始同步');
    } catch (e) {
      toast(AUTH_ERRORS[e.code] || `失敗：${e.message}`);
    }
  }
});

document.addEventListener('change', async ev => {
  const el = ev.target;
  if (el.dataset.action === 'custom-bg') { savePrefs({ bg: el.value }); return; }
  if (el.dataset.action === 'timer-subject') { T.setSubject(el.value); return; }
  if (!['import', 'merge'].includes(el.dataset.action) || !el.files?.[0]) return;
  try {
    const obj = JSON.parse(await el.files[0].text());
    // 不是完整備份（例如課表檔）時，按「匯入備份」也當成「加入檔案」，不會覆蓋
    const partial = !Array.isArray(obj.events) || !Array.isArray(obj.topics);
    if (el.dataset.action === 'merge' || partial) {
      const parts = [['events', '個行程'], ['todos', '個待辦'], ['courses', '門課'], ['topics', '個主題'], ['sessions', '筆讀書紀錄']]
        .filter(([k]) => obj[k]?.length).map(([k, l]) => `${obj[k].length} ${l}`);
      if (!parts.length) { toast('檔案裡沒有可以加入的資料'); return; }
      if (!confirm(`加入 ${parts.join('、')}？原本的資料不會被刪。`)) return;
      mergeData(obj);
      toast('已加入');
      return;
    }
    if (!confirm(`匯入 ${obj.events.length} 個行程、${obj.topics.length} 個主題？目前的資料會被覆蓋。`)) return;
    await importData(obj);
    toast('匯入完成');
  } catch (e) {
    toast(`匯入失敗：${e.message}`);
  } finally {
    el.value = '';
  }
});

document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !backdrop.hidden) closeSheet(); });

// ---------- 啟動 ----------
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
let wide = matchMedia('(min-width: 900px)').matches;
window.addEventListener('resize', () => {
  const w = matchMedia('(min-width: 900px)').matches;
  if (w !== wide) { wide = w; render(); }
});
// 隔天打開時「今天」要更新；切回 App 時番茄鐘可能已經到時間
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  timerTick();
  if (today() !== lastDay) { lastDay = today(); render(); }
});

subscribe(render);
render();
initStore();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 註冊失敗', e));
}
