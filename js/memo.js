// 隨手記（#memo）：怕忘記的事先記下來，用標籤分類。資料在 memos 集合 { text, tags[], pinned }。
// 打字時寫 #標籤 會自動變成標籤；左邊（手機在上面）列出所有標籤可以篩選。
import { store, newId, saveDoc, removeDoc, saveTodo, savePrefs } from './store.js';
import { handle, onDrop, between } from './drag.js';
import { esc } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initMemo(c) { ctx = c; }

// tag: 'all' | 'none'（未分類）| 'pin' | 'grp:分類id' | 標籤名
// open: 手機上目前展開哪個分類（'' = 都沒展開）
export const memoUi = { tag: 'all', q: '', pick: [], open: '' };

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
// 排序：置頂在上，其餘照拖曳的順序；沒拖過的照新到舊（排序值 = -建立時間，越新越前）
const key = m => m.order ?? -(m.createdAt || 0);
const sorted = list => [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || key(a) - key(b));

onDrop('memos', (id, beforeId, afterId) => {
  const m = memos().find(x => x.id === id);
  if (!m) return;
  const k = x => { const y = memos().find(z => z.id === x); return y ? key(y) : null; };
  saveDoc('memos', { ...m, order: between(k(beforeId), k(afterId)) });
});

// ---------- 標籤分類 ----------
// prefs.memoGroups = [{ id, name, tags: [標籤名], closed }]；沒放進分類的標籤歸在「其他標籤」
export const groups = () => store.prefs.memoGroups || [];
const saveGroups = g => savePrefs({ memoGroups: g });
function grouped() {
  const all = allTags(), cnt = Object.fromEntries(all);
  const used = new Set();
  const out = groups().map(g => {
    const tags = g.tags.filter(t => cnt[t]).map(t => { used.add(t); return [t, cnt[t]]; });
    return { ...g, tags };
  });
  const rest = all.filter(([t]) => !used.has(t));
  return { out, rest };
}
const memoInGroup = (m, g) => (m.tags || []).some(t => g.tags.includes(t));

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

export function memoRow(m, { compact = false, drag = false } = {}) {
  return `<div class="memo ${m.pinned ? 'pinned' : ''}${drag ? ' has-handle' : ''}" data-action="memo-edit" data-id="${m.id}"${drag ? ` data-drag-id="${m.id}" data-drag-group="${m.pinned ? 'pin' : 'n'}"` : ''}>
    ${drag ? handle() : ''}<div class="memo-text${compact ? ' clamp' : ''}">${esc(m.text)}</div>
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
  const item = (key, label, n, color, cls = '') => `<button type="button" data-action="memo-tag" data-tag="${esc(key)}" class="${cls}${memoUi.tag === key ? ' on' : ''}"${cls ? ' draggable="true"' : ''}>
      ${color ? `<i style="background:${color}"></i>` : ''}<span>${label}</span><span class="n">${n}</span></button>`;
  const pins = list.filter(m => m.pinned).length;
  const none = list.filter(m => !(m.tags || []).length).length;
  const { out, rest } = grouped();
  const inGrp = g => list.filter(m => (m.tags || []).some(t => g.tags.some(([x]) => x === t))).length; // 這裡的 g.tags 是 [標籤, 數量]
  const top = `${item('all', '📝 全部', list.length)}${pins ? item('pin', '📌 置頂', pins) : ''}${none ? item('none', '未分類', none) : ''}`;
  const tagItems = tags => tags.map(([t, n]) => item(t, `#${esc(t)}`, n, tagColor(t), 'sub-tag')).join('');

  // 電腦：左側樹狀，分類可以收合；標籤可以拖到別的分類
  const head = g => `<div class="memo-grp-head${memoUi.tag === `grp:${g.id}` ? ' on' : ''}">
      <button type="button" class="caret" data-action="memo-grp-fold" data-id="${esc(g.id)}" aria-label="收合">${g.closed ? '▸' : '▾'}</button>
      <button type="button" class="name" data-action="memo-tag" data-tag="grp:${esc(g.id)}"><span>📁 ${esc(g.name)}</span><span class="n">${inGrp(g)}</span></button></div>`;
  const wide = `<nav class="memo-side wide">${top}
    ${out.map(g => `<div class="memo-grp" data-grp="${esc(g.id)}">${head(g)}
      ${g.closed ? '' : tagItems(g.tags) || '<div class="memo-grp-empty">把標籤拖到這裡</div>'}</div>`).join('')}
    ${rest.length ? `<div class="memo-grp" data-grp="">${out.length ? '<div class="memo-grp-head plain">其他標籤</div>' : ''}${tagItems(rest)}</div>` : ''}
    <button type="button" class="memo-grp-edit" data-action="memo-groups">🗂️ 整理分類</button>
  </nav>`;

  // 手機：第一排 = 全部／置頂／各分類，點分類展開第二排標籤
  const cur = out.find(g => g.id === memoUi.open);
  const openTags = memoUi.open === '_rest' ? rest : cur ? cur.tags : null;
  const grpChip = g => `<button type="button" data-action="memo-grp-open" data-id="${esc(g.id)}" class="${memoUi.open === g.id || memoUi.tag === `grp:${g.id}` || g.tags.some(([t]) => t === memoUi.tag) ? 'on' : ''}">📁 ${esc(g.name)} ${memoUi.open === g.id ? '▴' : '▾'}</button>`;
  const phone = `<nav class="memo-side phone">
    <div class="memo-chiprow">${top}${out.map(grpChip).join('')}${
      rest.length ? (out.length ? `<button type="button" data-action="memo-grp-open" data-id="_rest" class="${memoUi.open === '_rest' ? 'on' : ''}">其他 ${memoUi.open === '_rest' ? '▴' : '▾'}</button>` : tagItems(rest)) : ''}
      <button type="button" data-action="memo-groups" aria-label="整理分類">🗂️</button></div>
    ${openTags ? `<div class="memo-chiprow sub">${cur ? item(`grp:${cur.id}`, `整個 ${esc(cur.name)}`, inGrp(cur)) : ''}${tagItems(openTags)}</div>` : ''}
  </nav>`;
  return wide + phone;
}

// 整理分類：新增／改名／刪除分類，每個標籤選要放哪個分類
function openGroups() {
  const g = groups();
  const opts = t => `<option value="">（其他標籤）</option>${g.map(x => `<option value="${esc(x.id)}" ${x.tags.includes(t) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
  ctx.openSheet(`<h2>🗂️ 整理標籤分類</h2>
    <div class="sub" style="margin-bottom:10px">標籤多了就放進分類（例如 學校、生活、遊戲）。電腦上也可以直接把左邊的標籤拖到分類上。</div>
    <form data-form="memo-groups">
      <h3>分類</h3>
      ${g.map(x => `<input type="text" name="g:${esc(x.id)}" value="${esc(x.name)}" placeholder="分類名稱（清空＝刪除分類）" style="margin-bottom:6px">`).join('')}
      <input type="text" name="new" placeholder="＋ 新分類名稱，例如：學校" autocomplete="off">
      ${allTags().length && g.length ? `<h3>標籤放哪個分類</h3><div class="memo-grp-map">${allTags().map(([t, n]) => `<label>
        <span class="memo-tag" style="--c:${tagColor(t)}">#${esc(t)}</span><span class="sub">${n} 則</span><span class="spacer"></span>
        <select name="t:${esc(t)}">${opts(t)}</select></label>`).join('')}</div>` : ''}
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button></div>
    </form>`, { kind: 'memo-groups' });
}

function moveTag(tag, gid) {
  saveGroups(groups().map(g => ({ ...g, tags: g.id === gid ? [...g.tags.filter(t => t !== tag), tag] : g.tags.filter(t => t !== tag) })));
}

// 電腦：把左側的標籤拖到別的分類上（HTML5 拖放，滑鼠用）
document.addEventListener('dragstart', ev => {
  const b = ev.target.closest?.('.memo-side.wide .sub-tag');
  if (!b) return;
  ev.dataTransfer.setData('text/x-memo-tag', b.dataset.tag);
  ev.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', ev => {
  const g = ev.target.closest?.('.memo-side.wide .memo-grp');
  if (!g || !ev.dataTransfer.types.includes('text/x-memo-tag')) return;
  ev.preventDefault();
  document.querySelectorAll('.memo-grp.drop').forEach(x => x !== g && x.classList.remove('drop'));
  g.classList.add('drop');
});
document.addEventListener('dragend', () => document.querySelectorAll('.memo-grp.drop').forEach(x => x.classList.remove('drop')));
document.addEventListener('drop', ev => {
  const g = ev.target.closest?.('.memo-side.wide .memo-grp');
  const tag = ev.dataTransfer?.getData('text/x-memo-tag');
  document.querySelectorAll('.memo-grp.drop').forEach(x => x.classList.remove('drop'));
  if (!g || !tag) return;
  ev.preventDefault();
  moveTag(tag, g.dataset.grp);
});

export function renderMemo() {
  const list = memos();
  const grp = memoUi.tag.startsWith('grp:') ? groups().find(g => `grp:${g.id}` === memoUi.tag) : null;
  if (memoUi.tag !== 'all' && memoUi.tag !== 'none' && memoUi.tag !== 'pin' && !grp && !allTags().some(([t]) => t === memoUi.tag)) memoUi.tag = 'all';
  const q = memoUi.q.trim().toLowerCase();
  const shown = sorted(list).filter(m =>
    (memoUi.tag === 'all' || (memoUi.tag === 'pin' ? m.pinned : memoUi.tag === 'none' ? !(m.tags || []).length
      : grp ? memoInGroup(m, grp) : (m.tags || []).includes(memoUi.tag)))
    && (!q || m.text.toLowerCase().includes(q) || (m.tags || []).some(t => t.toLowerCase().includes(q))));
  const title = memoUi.tag === 'all' ? '' : memoUi.tag === 'pin' ? ' · 📌 置頂' : memoUi.tag === 'none' ? ' · 未分類' : grp ? ` · 📁 ${esc(grp.name)}` : ` · #${esc(memoUi.tag)}`;
  return `<div class="page-head"><h1>隨手記</h1>
      <form data-form="memo-search" class="memo-search"><input type="text" name="q" value="${esc(memoUi.q)}" placeholder="🔍 搜尋" autocomplete="off"></form></div>
    <div class="memo-layout">
      ${sideTags(list)}
      <div class="grid">
        <section class="card">${quickAdd()}</section>
        <section class="card" data-drag-list="memos"><h2>${shown.length} 則${title}${shown.length > 1 ? '<span class="sub drag-hint">按住 ⋮⋮ 拖曳排序</span>' : ''}</h2>${
          shown.length ? shown.map(m => memoRow(m, { drag: true })).join('')
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
  'memo-groups': (form, f) => {
    let g = groups().map(x => ({ ...x, name: String(f[`g:${x.id}`] ?? x.name).trim() })).filter(x => x.name);
    // 每個標籤放哪個分類（選單只有既有的分類）
    const map = Object.entries(f).filter(([k]) => k.startsWith('t:')).map(([k, v]) => [k.slice(2), v]);
    if (map.length) g = g.map(x => ({ ...x, tags: [...x.tags.filter(t => !map.some(([tt]) => tt === t)), ...map.filter(([, v]) => v === x.id).map(([t]) => t)] }));
    const nn = String(f.new || '').trim();
    if (nn) g.push({ id: newId(), name: nn, tags: [], closed: false });
    saveGroups(g);
    if (nn) { openGroups(); ctx.toast(`已新增「${nn}」，現在可以把標籤放進去`); return; }
    ctx.closeSheet();
    ctx.toast('分類已儲存');
  },
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
  'memo-groups': () => openGroups(),
  'memo-grp-fold': el => saveGroups(groups().map(g => g.id === el.dataset.id ? { ...g, closed: !g.closed } : g)),
  'memo-grp-open': el => { memoUi.open = memoUi.open === el.dataset.id ? '' : el.dataset.id; ctx.render(); },
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
