// 隨手記（#memo）：怕忘記的事先記下來，用標籤分類。資料在 memos 集合 { text, tags[], pinned }。
// 打字時寫 #標籤 會自動變成標籤；左邊（手機在上面）列出所有標籤可以篩選。
import { store, newId, saveDoc, removeDoc, saveTodo } from './store.js';
import { esc } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initMemo(c) { ctx = c; }

// tag: 'all' | 'none'（未分類）| 'pin' | 標籤名
export const memoUi = { tag: 'all', q: '', pick: [] };

const HASH = /(^|\s)#([^\s#]+)/g;
// 「買影印卡 #學校」→ { text: '買影印卡', tags: ['學校'] }
export function parseMemo(raw) {
  const tags = [];
  const text = String(raw || '').replace(HASH, (m, sp, t) => { if (!tags.includes(t)) tags.push(t); return sp; })
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { text, tags };
}

const memos = () => store.state.memos || [];
export function allTags() {
  const n = {};
  for (const m of memos()) for (const t of m.tags || []) n[t] = (n[t] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
}
// 標籤顏色：用名字算，同一個標籤在哪裡都同色
const COLORS = ['#60a5fa', '#4ade80', '#c084fc', '#fbbf24', '#f87171', '#2dd4bf', '#f472b6', '#fb923c'];
export function tagColor(t) {
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
const sorted = list => [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  return `${d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}/` : ''}${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const tagPill = t => `<span class="memo-tag" style="--c:${tagColor(t)}">#${esc(t)}</span>`;

export function memoRow(m, { compact = false } = {}) {
  return `<div class="memo ${m.pinned ? 'pinned' : ''}" data-action="memo-edit" data-id="${m.id}">
    <div class="memo-text${compact ? ' clamp' : ''}">${esc(m.text)}</div>
    <div class="memo-meta">${(m.tags || []).map(tagPill).join('')}<span class="spacer"></span>
      <span class="sub">${when(m.createdAt)}</span>
      ${compact ? '' : `<button type="button" class="memo-pin ${m.pinned ? 'on' : ''}" data-action="memo-pin" data-id="${m.id}" aria-label="置頂">📌</button>`}
    </div></div>`;
}

// 快速輸入框：已有的標籤可以點選，或直接打 #標籤
function pickChips() {
  const tags = allTags().slice(0, 12).map(([t]) => t);
  for (const t of memoUi.pick) if (!tags.includes(t)) tags.push(t);
  if (!tags.length) return '<span class="sub">打 #標籤 就能分類，例如：繳學費 #學校</span>';
  return tags.map(t => { const on = memoUi.pick.includes(t);
    return `<button type="button" data-action="memo-pick" data-tag="${esc(t)}" class="${on ? 'on' : ''}" style="${on ? `background:${tagColor(t)};border-color:${tagColor(t)}` : ''}">#${esc(t)}</button>`; }).join('');
}

export function quickAdd(formName = 'memo-add', placeholder = '想到什麼先記下來… #標籤') {
  return `<form data-form="${formName}" class="memo-add">
    <textarea name="text" rows="2" placeholder="${placeholder}" autocomplete="off"></textarea>
    <div class="memo-add-bar"><div class="chips memo-picks">${pickChips()}</div>
      <button class="btn primary" type="submit">記下來</button></div>
  </form>`;
}

function sideTags(list) {
  const item = (key, label, n, color) => `<button type="button" data-action="memo-tag" data-tag="${esc(key)}" class="${memoUi.tag === key ? 'on' : ''}">
      ${color ? `<i style="background:${color}"></i>` : ''}<span>${label}</span><span class="n">${n}</span></button>`;
  const pins = list.filter(m => m.pinned).length;
  const none = list.filter(m => !(m.tags || []).length).length;
  return `<nav class="memo-side">
    ${item('all', '📝 全部', list.length)}
    ${pins ? item('pin', '📌 置頂', pins) : ''}
    ${none ? item('none', '未分類', none) : ''}
    ${allTags().map(([t, n]) => item(t, `#${esc(t)}`, n, tagColor(t))).join('')}
  </nav>`;
}

export function renderMemo() {
  const list = memos();
  if (memoUi.tag !== 'all' && memoUi.tag !== 'none' && memoUi.tag !== 'pin' && !allTags().some(([t]) => t === memoUi.tag)) memoUi.tag = 'all';
  const q = memoUi.q.trim().toLowerCase();
  const shown = sorted(list).filter(m =>
    (memoUi.tag === 'all' || (memoUi.tag === 'pin' ? m.pinned : memoUi.tag === 'none' ? !(m.tags || []).length : (m.tags || []).includes(memoUi.tag)))
    && (!q || m.text.toLowerCase().includes(q) || (m.tags || []).some(t => t.toLowerCase().includes(q))));
  const title = memoUi.tag === 'all' ? '' : memoUi.tag === 'pin' ? ' · 📌 置頂' : memoUi.tag === 'none' ? ' · 未分類' : ` · #${esc(memoUi.tag)}`;
  return `<div class="page-head"><h1>隨手記</h1>
      <form data-form="memo-search" class="memo-search"><input type="text" name="q" value="${esc(memoUi.q)}" placeholder="🔍 搜尋" autocomplete="off"></form></div>
    <div class="memo-layout">
      ${sideTags(list)}
      <div class="grid">
        <section class="card">${quickAdd()}</section>
        <section class="card"><h2>${shown.length} 則${title}</h2>${
          shown.length ? shown.map(m => memoRow(m)).join('')
            : `<div class="empty">${list.length ? '沒有符合的隨手記' : '還沒有隨手記。上面打字、按「記下來」就好，不用想分類。'}</div>`}</section>
      </div>
    </div>`;
}

// 首頁小卡
export function homeMemoCard() {
  const list = sorted(memos()).slice(0, 3);
  return `<section class="card memo-home"><h2>📝 隨手記 <a href="#memo" class="sub" style="font-weight:400">（${memos().length} 則）全部 ›</a></h2>
    ${quickAdd('memo-add', '怕忘記的事先記下來… #標籤')}
    ${list.map(m => memoRow(m, { compact: true })).join('')}</section>`;
}

// ---------- 編輯 ----------
function openEdit(m) {
  const raw = m.text + ((m.tags || []).length ? `\n${m.tags.map(t => `#${t}`).join(' ')}` : '');
  ctx.openSheet(`<h2>編輯隨手記</h2>
    <form data-form="memo-edit">
      <label class="field"><span>內容（#標籤 寫在哪裡都可以）</span><textarea name="text" rows="6" required>${esc(raw)}</textarea></label>
      <label class="row"><input type="checkbox" name="pinned" ${m.pinned ? 'checked' : ''}> 📌 置頂</label>
      <div class="sub" style="margin-top:6px">記於 ${when(m.createdAt)}</div>
      <div class="actions">
        <button type="button" class="btn danger" data-action="memo-del">刪除</button>
        <button type="button" class="btn" data-action="memo-todo">轉成待辦</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'memo', data: { ...m } });
}

function add(form, f) {
  const { text, tags } = parseMemo(f.text);
  for (const t of memoUi.pick) if (!tags.includes(t)) tags.push(t);
  if (!text) { ctx.toast(tags.length ? '標籤之外也寫點內容' : '先寫點什麼'); form.querySelector('[name=text]')?.focus(); return; }
  const box = form.querySelector('[name=text]');
  const stay = document.activeElement === box;
  // 先清空再存：存檔會馬上重畫，重畫時會把輸入框的字保留下來
  box.value = '';
  box.blur();
  memoUi.pick = [];
  saveDoc('memos', { id: newId(), text, tags, pinned: false, createdAt: Date.now() });
  ctx.toast('📝 記下來了');
  // 重畫後游標留在輸入框，可以一直記
  if (stay) requestAnimationFrame(() => document.querySelector(`form[data-form="${form.dataset.form}"] [name=text]`)?.focus());
}

export const memoForms = {
  'memo-add': add,
  'memo-search': (form, f) => { memoUi.q = f.q || ''; ctx.render(); },
  'memo-edit': (form, f, data) => {
    const { text, tags } = parseMemo(f.text);
    if (!text) { ctx.toast('內容不能是空的'); return; }
    saveDoc('memos', { ...data, text, tags, pinned: !!f.pinned });
    ctx.closeSheet();
    ctx.toast('已儲存');
  },
};

export const memoActions = {
  'memo-tag': el => { memoUi.tag = el.dataset.tag; ctx.render(); },
  // 點標籤只換按鈕，不重畫，才不會清掉正在打的字
  'memo-pick': el => {
    const t = el.dataset.tag;
    memoUi.pick = memoUi.pick.includes(t) ? memoUi.pick.filter(x => x !== t) : [...memoUi.pick, t];
    el.closest('.memo-picks').innerHTML = pickChips();
  },
  'memo-pin': el => {
    const m = memos().find(x => x.id === el.dataset.id);
    if (m) saveDoc('memos', { ...m, pinned: !m.pinned });
  },
  'memo-edit': el => { const m = memos().find(x => x.id === el.dataset.id); if (m) openEdit(m); },
  'memo-del': () => {
    const m = ctx.sheetData();
    if (!confirm('刪除這則隨手記？')) return;
    removeDoc('memos', m.id);
    ctx.closeSheet();
    ctx.toast('已刪除');
  },
  'memo-todo': () => {
    const m = ctx.sheetData();
    const [first, ...rest] = m.text.split('\n');
    saveTodo({ id: newId(), title: first.slice(0, 80), type: 'other', due: '', note: [first.length > 80 ? first : '', ...rest].filter(Boolean).join('\n'),
      done: false, courseId: '', steps: [], createdAt: Date.now(), updatedAt: Date.now() });
    if (confirm('已加到待辦。要把這則隨手記刪掉嗎？')) removeDoc('memos', m.id);
    ctx.closeSheet();
    ctx.toast('✅ 已轉成待辦');
  },
};

// textarea 按 Enter 直接送出（Shift+Enter 換行；中文選字時不算）
export function memoKey(ev) {
  const t = ev.target;
  if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || t.tagName !== 'TEXTAREA') return false;
  const form = t.closest('form[data-form="memo-add"]');
  if (!form) return false;
  form.requestSubmit();
  return true;
}
