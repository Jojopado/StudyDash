// 記帳（#money）：支出／收入、分類、每月統計和預算。資料在 expenses 集合。
import { store, newId, saveDoc, removeDoc, savePrefs } from './store.js';
import { esc, today, fmtDate, parseYmd } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render }
export function initMoney(c) { ctx = c; }

export const CATS = {
  out: [
    ['food', '🍱', '餐飲', '#f59e0b'], ['drink', '🥤', '飲料點心', '#fb923c'], ['traffic', '🚆', '交通', '#60a5fa'],
    ['shop', '🛍️', '購物', '#f472b6'], ['fun', '🎮', '娛樂', '#c084fc'], ['school', '📚', '學業', '#4ade80'],
    ['life', '🏠', '生活', '#2dd4bf'], ['health', '💊', '醫療', '#f87171'], ['other', '📦', '其他', '#94a3b8'],
  ],
  in: [
    ['salary', '💼', '薪水', '#22c55e'], ['scholar', '🎓', '獎學金', '#4ade80'], ['allow', '💵', '零用錢', '#2dd4bf'],
    ['other', '➕', '其他收入', '#94a3b8'],
  ],
};
export const catOf = (io, key) => (CATS[io] || CATS.out).find(c => c[0] === key) || CATS[io === 'in' ? 'in' : 'out'].at(-1);

export const moneyUi = { month: today().slice(0, 7), io: 'out', cat: 'food' };

const fmt = n => `$${Math.round(n).toLocaleString()}`;
const monthLabel = ym => `${+ym.slice(0, 4)} 年 ${+ym.slice(5)} 月`;
function shiftMonth(ym, d) {
  const x = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + d, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

const inMonth = ym => store.state.expenses.filter(x => (x.date || '').startsWith(ym));
const sum = (list, io) => list.filter(x => x.io === io).reduce((n, x) => n + (x.amount || 0), 0);

function catChips(io, cur) {
  return CATS[io].map(([k, e, label, color]) =>
    `<button type="button" data-action="money-cat" data-cat="${k}" class="${k === cur ? 'on' : ''}" style="${k === cur ? `background:${color};border-color:${color}` : ''}">${e} ${label}</button>`).join('');
}

function summaryCard(list) {
  const out = sum(list, 'out'), inc = sum(list, 'in');
  const budget = store.prefs.moneyBudget || 0;
  const thisMonth = moneyUi.month === today().slice(0, 7);
  let budgetHtml = '';
  if (budget > 0) {
    const left = budget - out;
    const pct = Math.min(100, Math.round(out / budget * 100));
    const d = parseYmd(today());
    const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
    budgetHtml = `<div class="row" style="margin-top:12px"><span class="sub">預算 ${fmt(budget)}</span><span class="spacer"></span>
        <b class="${left < 0 ? 'money-over' : ''}">${left >= 0 ? `還剩 ${fmt(left)}` : `超支 ${fmt(-left)}`}</b></div>
      <div class="progress"><div style="width:${pct}%;background:${pct >= 100 ? 'var(--danger)' : pct >= 80 ? '#f59e0b' : 'var(--ok)'}"></div></div>
      ${thisMonth && left > 0 ? `<div class="sub" style="margin-top:4px">接下來 ${daysLeft} 天，平均每天可以花 ${fmt(left / daysLeft)}</div>` : ''}`;
  }
  return `<section class="card">
    <div class="money-sum">
      <div><div class="sub">支出</div><div class="money-big">${fmt(out)}</div></div>
      <div><div class="sub">收入</div><div class="money-mid in">${fmt(inc)}</div></div>
      <div><div class="sub">結餘</div><div class="money-mid ${inc - out < 0 ? 'money-over' : ''}">${inc - out < 0 ? '−' : ''}${fmt(Math.abs(inc - out))}</div></div>
    </div>
    ${budgetHtml}
    <div class="row" style="margin-top:10px"><span class="spacer"></span>
      <button class="btn small ghost" data-action="money-budget">${budget ? '改每月預算' : '＋ 設定每月預算'}</button></div>
  </section>`;
}

function addCard() {
  const io = moneyUi.io;
  if (!CATS[io].some(c => c[0] === moneyUi.cat)) moneyUi.cat = CATS[io][0][0];
  return `<section class="card">
    <form data-form="money-add">
      <div class="row" style="margin-bottom:10px">
        <div class="seg"><button type="button" data-action="money-io" data-io="out" class="${io === 'out' ? 'on' : ''}">支出</button><button type="button" data-action="money-io" data-io="in" class="${io === 'in' ? 'on' : ''}">收入</button></div>
        <span class="spacer"></span><input type="date" name="date" value="${today()}" class="money-date">
      </div>
      <div class="money-amount"><span>$</span><input type="text" inputmode="numeric" name="amount" placeholder="0" autocomplete="off"></div>
      <div class="chips" id="money-cats" style="margin:10px 0">${catChips(io, moneyUi.cat)}</div>
      <div class="add-goal" style="margin:0"><input type="text" name="note" placeholder="備註（可不填），例如：學餐雞腿飯" autocomplete="off">
        <button class="btn primary" type="submit">記一筆</button></div>
    </form>
  </section>`;
}

function breakdownCard(list) {
  const out = list.filter(x => x.io === 'out');
  if (!out.length) return '';
  const by = {};
  for (const x of out) by[x.cat] = (by[x.cat] || 0) + (x.amount || 0);
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const max = rows[0][1];
  return `<section class="card"><h2>📊 花在哪裡</h2>
    ${rows.map(([k, v]) => { const [, e, label, color] = catOf('out', k); return `<div class="subj"><span>${e} ${label}</span>
      <div class="progress" style="flex:1"><div style="width:${Math.round(v / max * 100)}%;background:${color}"></div></div>
      <span class="sub money-pct">${fmt(v)} · ${Math.round(v / total * 100)}%</span></div>`; }).join('')}
  </section>`;
}

function listCard(list) {
  if (!list.length) return `<section class="card"><div class="empty">這個月還沒有記錄。上面輸入金額、選分類就能記一筆。</div></section>`;
  const byDay = {};
  for (const x of list) (byDay[x.date] ||= []).push(x);
  const days = Object.keys(byDay).sort().reverse();
  return `<section class="card"><h2>🧾 明細</h2>${days.map(ds => {
    const items = byDay[ds].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const dayOut = sum(items, 'out');
    return `<div class="money-day"><span>${fmtDate(ds)}${ds === today() ? ' · 今天' : ''}</span><span class="sub">${dayOut ? `支出 ${fmt(dayOut)}` : ''}</span></div>
      ${items.map(x => { const [, e, label, color] = catOf(x.io, x.cat); return `<div class="ev" data-action="money-edit" data-id="${x.id}">
        <span class="money-ico" style="background:${color}22">${e}</span>
        <div class="main"><div class="title">${esc(x.note || label)}</div>${x.note ? `<div class="meta">${label}</div>` : ''}</div>
        <b class="money-amt ${x.io}">${x.io === 'in' ? '+' : '−'}${fmt(x.amount)}</b></div>`; }).join('')}`;
  }).join('')}</section>`;
}

export function renderMoney() {
  const list = inMonth(moneyUi.month);
  return `<div class="page-head"><h1>記帳</h1>
      <div class="cal-head" style="margin:0">
        <button class="btn small" data-action="money-month" data-dir="-1">‹</button>
        <div class="label">${monthLabel(moneyUi.month)}</div>
        <button class="btn small" data-action="money-month" data-dir="1">›</button></div></div>
    <div class="grid two"><div class="grid">${summaryCard(list)}${addCard()}</div><div class="grid">${breakdownCard(list)}${listCard(list)}</div></div>`;
}

// 首頁小卡用
export function monthSpent() { return sum(inMonth(today().slice(0, 7)), 'out'); }

// ---------- 編輯 ----------
function openEdit(x) {
  ctx.openSheet(`<h2>編輯</h2>
    <form data-form="money-edit">
      <div class="seg" style="margin-bottom:10px"><button type="button" data-action="money-io" data-io="out" class="${x.io === 'out' ? 'on' : ''}">支出</button><button type="button" data-action="money-io" data-io="in" class="${x.io === 'in' ? 'on' : ''}">收入</button></div>
      <div class="row">
        <label class="field" style="flex:1"><span>金額</span><input type="text" inputmode="numeric" name="amount" value="${x.amount}" required autocomplete="off"></label>
        <label class="field" style="flex:1"><span>日期</span><input type="date" name="date" value="${x.date}" required></label>
      </div>
      <div class="field"><span>分類</span><div class="chips" id="money-cats">${catChips(x.io, x.cat)}</div></div>
      <label class="field"><span>備註</span><input type="text" name="note" value="${esc(x.note || '')}" autocomplete="off"></label>
      <div class="actions">
        <button type="button" class="btn danger" data-action="money-del">刪除</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'money', data: { ...x } });
}

const parseAmount = s => Math.round(Number(String(s || '').replace(/[,$\s]/g, '')));

export const moneyForms = {
  'money-add': (form, f) => {
    const amount = parseAmount(f.amount);
    if (!(amount > 0)) { ctx.toast('先輸入金額'); form.querySelector('[name=amount]')?.focus(); return; }
    document.activeElement?.blur(); // 重畫時才不會把剛送出的備註留在框裡
    saveDoc('expenses', { id: newId(), io: moneyUi.io, cat: moneyUi.cat, amount, date: f.date || today(), note: (f.note || '').trim(), createdAt: Date.now() });
    const [, e, label] = catOf(moneyUi.io, moneyUi.cat);
    ctx.toast(`${e} ${label} ${moneyUi.io === 'in' ? '+' : '−'}${fmt(amount)}`);
  },
  'money-edit': (form, f, data) => {
    const amount = parseAmount(f.amount);
    if (!(amount > 0)) { ctx.toast('金額要大於 0'); return; }
    saveDoc('expenses', { ...data, amount, date: f.date || data.date, note: (f.note || '').trim() });
    ctx.closeSheet();
    ctx.toast('已儲存');
  },
};

export const moneyActions = {
  'money-month': el => { moneyUi.month = shiftMonth(moneyUi.month, +el.dataset.dir); ctx.render(); },
  // 收支和分類只換按鈕，不重畫整頁，才不會清掉正在輸入的金額
  'money-io': el => {
    const io = el.dataset.io;
    const sheetData = ctx.sheetData();
    const target = sheetData && sheetData.amount !== undefined ? sheetData : moneyUi;
    target.io = io;
    target.cat = CATS[io][0][0];
    const root = el.closest('form');
    root.querySelectorAll('[data-action="money-io"]').forEach(b => b.classList.toggle('on', b.dataset.io === io));
    root.querySelector('#money-cats').innerHTML = catChips(io, target.cat);
  },
  'money-cat': el => {
    const sheetData = ctx.sheetData();
    const target = sheetData && sheetData.amount !== undefined ? sheetData : moneyUi;
    target.cat = el.dataset.cat;
    el.closest('#money-cats').innerHTML = catChips(target.io, target.cat);
  },
  'money-edit': el => { const x = store.state.expenses.find(e => e.id === el.dataset.id); if (x) openEdit(x); },
  'money-del': () => {
    const x = ctx.sheetData();
    if (!confirm(`刪除這筆 ${fmt(x.amount)}？`)) return;
    removeDoc('expenses', x.id);
    ctx.closeSheet();
    ctx.toast('已刪除');
  },
  'money-budget': () => {
    const v = prompt('每月預算（只算支出，填 0 取消）', store.prefs.moneyBudget || '');
    if (v == null) return;
    const n = parseAmount(v);
    savePrefs({ moneyBudget: n > 0 ? n : 0 });
  },
};
