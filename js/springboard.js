// 手機主畫面（#apps）：像 iPhone 一樣，每個分頁是一個 App 圖示。
// 圖示清單從 #nav 讀（跟電腦版側邊欄同一份），所以加新分頁時只要改 index.html。
import { store } from './store.js';
import { DEADLINE_TYPES, WEEKDAYS, today, daysUntil, byDateTime, esc } from './util.js';
import { homeRemindCard } from './remind.js';
import { timer } from './timer.js';

// 每個 App 的圖示底色
const COLORS = {
  home: ['#fbbf24', '#f97316'], calendar: ['#ffffff', '#e5e7eb'], todo: ['#4ade80', '#16a34a'], goals: ['#38bdf8', '#2563eb'],
  memo: ['#fde68a', '#f59e0b'], study: ['#f87171', '#dc2626'], progress: ['#a78bfa', '#7c3aed'], cards: ['#2dd4bf', '#0d9488'],
  docs: ['#93c5fd', '#3b82f6'], quiz: ['#fb7185', '#e11d48'], money: ['#86efac', '#15803d'], remind: ['#fdba74', '#ea580c'],
  fit: ['#334155', '#0f172a'], settings: ['#9ca3af', '#4b5563'],
};
const LABEL = { home: '今天' };
const DOCK = ['home', 'todo', 'study', 'money'];

function apps() {
  const groups = [];
  for (const el of document.querySelectorAll('#nav > a:not(.nav-more), #nav > .nav-group')) {
    if (el.classList.contains('nav-group')) { groups.push({ name: el.textContent, items: [] }); continue; }
    const tab = el.dataset.tab;
    const app = { tab, ico: el.querySelector('.ico')?.textContent || '', name: LABEL[tab] || el.querySelector('span:last-child')?.textContent || tab };
    if (!groups.length) groups.push({ name: '', items: [] });
    groups[groups.length - 1].items.push(app);
  }
  return groups;
}

function badge(tab) {
  const t = today();
  if (tab === 'todo') {
    const n = store.state.todos.filter(x => !x.done && x.due && x.due <= t).length;
    return n ? `<span class="sb-badge">${n > 99 ? '99+' : n}</span>` : '';
  }
  if (tab === 'calendar') {
    const n = store.state.events.filter(e => e.date === t).length;
    return n ? `<span class="sb-badge">${n}</span>` : '';
  }
  if (tab === 'study' && timer.running) return '<span class="sb-badge live">●</span>';
  return '';
}

function icon(a) {
  const [c1, c2] = COLORS[a.tab] || ['#64748b', '#334155'];
  const d = new Date();
  // 行事曆圖示跟 iPhone 一樣顯示今天星期幾和日期
  const face = a.tab === 'calendar'
    ? `<span class="sb-cal"><small>週${WEEKDAYS[d.getDay()]}</small><b>${d.getDate()}</b></span>`
    : `<span class="sb-emoji">${esc(a.ico)}</span>`;
  return `<a class="sb-app" href="#${a.tab}" data-tab="${a.tab}">
    <span class="sb-ico" style="background:linear-gradient(160deg,${c1},${c2})">${face}${badge(a.tab)}</span>
    <span class="sb-name">${esc(a.name)}</span></a>`;
}

function widgets() {
  const d = new Date();
  const t = today();
  const todayEvs = store.state.events.filter(e => e.date === t).length;
  const todayTodos = store.state.todos.filter(x => !x.done && x.due === t).length;
  const next = store.state.events
    .filter(e => DEADLINE_TYPES.includes(e.type) && !e.done && daysUntil(e.date) >= 0)
    .sort(byDateTime)[0];
  const n = next ? daysUntil(next.date) : 0;
  return `<div class="sb-widgets">
    <a href="#home" class="sb-widget">
      <div class="sub">星期${WEEKDAYS[d.getDay()]}</div>
      <div class="sb-big">${d.getMonth() + 1}/${d.getDate()}</div>
      <div class="sub">${todayEvs ? `今天 ${todayEvs} 個行程` : '今天沒有行程'}${todayTodos ? ` · ${todayTodos} 件待辦到期` : ''}</div>
    </a>
    <a href="#calendar" class="sb-widget">
      <div class="sub">⏳ 最近的倒數</div>
      ${next ? `<div class="sb-big">${n ? `${n}<small> 天</small>` : '今天'}</div><div class="sb-ev">${esc(next.title)}</div>`
    : '<div class="sb-ev" style="margin-top:12px">沒有考試／報告／作業 🎉</div>'}
    </a>
  </div>${homeRemindCard()}`;
}

export function renderSpringboard() {
  const groups = apps();
  const all = groups.flatMap(g => g.items);
  const dock = DOCK.map(tab => all.find(a => a.tab === tab)).filter(Boolean);
  return `<div class="sb">
    ${store.ready ? widgets() : ''}
    ${groups.map(g => {
      const items = g.items.filter(a => !DOCK.includes(a.tab));
      return items.length ? `${g.name ? `<div class="sb-group">${esc(g.name)}</div>` : ''}<div class="sb-grid">${items.map(icon).join('')}</div>` : '';
    }).join('')}
  </div>
  <nav class="sb-dock">${dock.map(icon).join('')}</nav>`;
}
