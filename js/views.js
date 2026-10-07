import {
  TYPES, DEADLINE_TYPES, WEEKDAYS, today, addDays, parseYmd, ymd, daysUntil,
  fmtDate, countdown, byDateTime, esc,
} from './util.js';

// 畫面狀態（不存檔）
export const ui = {
  calMode: 'month',   // 'month' | 'week'
  month: today().slice(0, 8) + '01',
  selDay: today(),
};

const isWide = () => matchMedia('(min-width: 900px)').matches;

function evRow(e, { showDate = true, showCountdown = false } = {}) {
  const ty = TYPES[e.type] || TYPES.other;
  const cd = showCountdown && !e.done ? countdown(e.date) : null;
  const meta = [ty.label, showDate ? fmtDate(e.date) : '', e.time || ''].filter(Boolean).join(' · ');
  return `<div class="ev ${e.done ? 'done' : ''}" data-action="edit-event" data-id="${e.id}">
    <button class="check ${e.done ? 'on' : ''}" data-action="toggle-event" data-id="${e.id}" aria-label="完成">${e.done ? '✓' : ''}</button>
    <span class="bar" style="background:${ty.color}"></span>
    <div class="main"><div class="title">${esc(e.title)}</div><div class="meta">${meta}</div></div>
    ${cd ? `<span class="badge ${cd.cls}">${cd.text}</span>` : ''}
  </div>`;
}

const list = (items, opts, emptyText) =>
  items.length ? items.map(e => evRow(e, opts)).join('') : `<div class="empty">${emptyText}</div>`;

function topicPct(t) {
  const g = t.goals || [];
  return g.length ? Math.round(g.filter(x => x.done).length / g.length * 100) : 0;
}

function syncBanner(s) {
  if (!s.cloudAvailable || s.mode === 'cloud') return '';
  return `<div class="banner">目前資料只存在這台裝置。<a href="#settings">登入</a>就能和電腦／手機同步。</div>`;
}

// ---------- 首頁 ----------
export function renderHome(s) {
  const t = today();
  const evs = s.state.events;
  const d = new Date();
  const todays = evs.filter(e => e.date === t).sort(byDateTime);
  const deadlines = evs
    .filter(e => DEADLINE_TYPES.includes(e.type) && !e.done && daysUntil(e.date) >= -30)
    .sort(byDateTime).slice(0, 10);
  const week = evs.filter(e => { const n = daysUntil(e.date); return n >= 1 && n <= 7; }).sort(byDateTime);
  const topics = [...s.state.topics].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  return `${syncBanner(s)}
  <div class="page-head"><div>
    <div class="sub">${d.getFullYear()} 年</div>
    <h1>${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAYS[d.getDay()]}</h1>
  </div></div>
  <div class="grid two">
    <section class="card"><h2>⏳ 倒數</h2>${list(deadlines, { showCountdown: true }, '沒有待完成的考試／報告／作業 🎉')}</section>
    <section class="card"><h2>☀️ 今天</h2>${list(todays, { showDate: false }, '今天沒有安排')}</section>
    <section class="card"><h2>🗓️ 接下來 7 天</h2>${list(week, {}, '這週沒有其他事')}</section>
    <section class="card"><h2>📚 自學進度</h2>${
      topics.length ? topics.map(tp => {
        const p = topicPct(tp);
        return `<a href="#study" class="ev"><span class="bar" style="background:${esc(tp.color)}"></span>
          <div class="main"><div class="title">${esc(tp.name)}</div>
          <div class="progress" style="margin-top:6px"><div style="width:${p}%;background:${esc(tp.color)}"></div></div></div>
          <span class="badge">${p}%</span></a>`;
      }).join('') : '<div class="empty">還沒有自學主題，到「自學」新增一個吧</div>'
    }</section>
  </div>`;
}

// ---------- 行事曆 ----------
function byDate(events) {
  const m = {};
  for (const e of events) (m[e.date] ||= []).push(e);
  for (const k in m) m[k].sort(byDateTime);
  return m;
}

export function renderCalendar(s) {
  const map = byDate(s.state.events);
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
      `<div class="chip ${e.done ? 'done' : ''}" style="background:${(TYPES[e.type] || TYPES.other).color}">${esc(e.title)}</div>`).join('');
    const more = evs.length > maxChips ? `<div class="more">+${evs.length - maxChips}</div>` : '';
    cells += `<div class="day ${other ? 'other' : ''} ${ds === t ? 'today' : ''} ${ds === ui.selDay ? 'sel' : ''}" data-action="pick-day" data-date="${ds}">
      <div class="num">${parseYmd(ds).getDate()}</div>${chips}${more}</div>`;
  }

  const sel = map[ui.selDay] || [];
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
        <button class="btn small" data-action="new-event" data-date="${ui.selDay}">＋ 新增</button></div>
      ${list(sel, { showDate: false, showCountdown: true }, '這天沒有安排')}
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
      ${evs.map(e => evRow(e, { showDate: false })).join('')}
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

// ---------- 自學 ----------
export function renderStudy(s) {
  const topics = [...s.state.topics].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const cards = topics.map(t => {
    const p = topicPct(t);
    const goals = t.goals || [];
    const cd = t.targetDate ? countdown(t.targetDate) : null;
    return `<section class="card topic">
      <div class="head">
        <span class="bar" style="width:6px;height:22px;border-radius:4px;background:${esc(t.color)}"></span>
        <div class="name">${esc(t.name)}</div>
        ${cd ? `<span class="badge ${cd.cls}" title="目標日 ${fmtDate(t.targetDate)}">${cd.text}</span>` : ''}
        <button class="btn small ghost" data-action="edit-topic" data-id="${t.id}">編輯</button>
      </div>
      <div class="row" style="margin-bottom:6px">
        <div class="progress" style="flex:1"><div style="width:${p}%;background:${esc(t.color)}"></div></div>
        <span class="sub">${goals.filter(g => g.done).length}/${goals.length} · ${p}%</span>
      </div>
      ${t.note ? `<div class="sub" style="margin-bottom:6px">${esc(t.note)}</div>` : ''}
      ${goals.map(g => `<div class="goal ${g.done ? 'done' : ''}">
        <button class="check ${g.done ? 'on' : ''}" data-action="toggle-goal" data-id="${t.id}" data-goal="${g.id}" aria-label="完成">${g.done ? '✓' : ''}</button>
        <div class="text">${esc(g.text)}</div>
        <button class="del" data-action="del-goal" data-id="${t.id}" data-goal="${g.id}" aria-label="刪除">✕</button>
      </div>`).join('')}
      <form class="add-goal" data-form="add-goal" data-id="${t.id}">
        <input type="text" name="text" placeholder="新增小目標，例如：看完第 3 章" autocomplete="off">
        <button class="btn" type="submit">加入</button>
      </form>
    </section>`;
  }).join('');

  return `<div class="page-head"><h1>自學</h1><button class="btn primary" data-action="new-topic">＋ 新增主題</button></div>
    <div class="grid two">${cards || '<div class="card"><div class="empty">把想自學的東西拆成小目標，一個一個打勾。<br>例如：ROS2 → 裝好環境、寫第一個 node、做 TF 練習…</div></div>'}</div>`;
}

// ---------- 設定 ----------
export function renderSettings(s) {
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
  return `<div class="page-head"><h1>設定</h1></div>
  <div class="grid two">
    <section class="card"><h2>☁️ 同步</h2>${sync}</section>
    <section class="card"><h2>💾 備份</h2>
      <div class="sub" style="margin-bottom:10px">匯出成 JSON 檔，可以存到 iCloud 雲碟。匯入會<b>覆蓋</b>目前所有資料。</div>
      <div class="row wrap"><button class="btn" data-action="export">匯出備份</button>
      <label class="btn">匯入備份<input type="file" accept="application/json,.json" data-action="import" hidden></label></div>
    </section>
    <section class="card"><h2>📱 裝到 iPhone</h2>
      <div class="sub">用 <b>Safari</b> 打開這個網址 → 點下方「分享」⬆️ → 「加入主畫面」。之後從主畫面打開就是全螢幕 App。</div>
    </section>
    <section class="card"><h2>ℹ️ 關於</h2><div class="sub">學習儀表板 v0.1 · ${s.mode === 'cloud' ? '雲端模式' : '本機模式'} · ${s.state.events.length} 個行程、${s.state.topics.length} 個自學主題</div></section>
  </div>`;
}
