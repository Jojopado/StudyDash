// 各科進度（#progress）：每科拆成單元，標「沒讀／讀過／熟了」，寫「讀到哪」和「不熟的地方」。
// 資料：units 集合 { subject: 'c:課程id' | 'g:標籤id', name, status 0|1|2, weak: [{ id, text, done, at }], note, order }
// 「讀到哪」存在 prefs.studyAt = { 科目key: { text, at } }（一科一行，手機電腦同步）
import { store, newId, saveDoc, removeDoc, savePrefs } from './store.js';
import { handle, onDrop, between } from './drag.js';
import { esc } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initProgress(c) { ctx = c; }

// subj: 目前打開哪一科（'' = 總覽）
export const progUi = { subj: '', showFixed: false };

export const STATUS = [
  { label: '沒讀', ico: '○', color: '#94a3b8' },
  { label: '讀過', ico: '◐', color: '#60a5fa' },
  { label: '熟了', ico: '●', color: '#4ade80' },
];
const WEAK = '#fbbf24';

const units = () => store.state.units || [];
const studyAt = () => store.prefs.studyAt || {};
const key = u => u.order ?? (u.createdAt || 0);
const unitsOf = s => units().filter(u => u.subject === s).sort((a, b) => key(a) - key(b));
const openWeak = u => (u.weak || []).filter(w => !w.done);

// 可以追蹤的科目：課表上的課＋讀書標籤
export function subjects() {
  return [
    ...store.state.courses.map(c => ({ key: `c:${c.id}`, name: c.name, color: c.color })),
    ...(store.prefs.studyTags || []).map(g => ({ key: `g:${g.id}`, name: g.name, color: g.color })),
  ];
}
const subjOf = k => subjects().find(s => s.key === k);

function ago(ts) {
  if (!ts) return '';
  const days = Math.round((new Date(new Date().toDateString()) - new Date(new Date(ts).toDateString())) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

onDrop('units', (id, beforeId, afterId) => {
  const u = units().find(x => x.id === id);
  if (!u) return;
  const k = x => { const y = units().find(z => z.id === x); return y ? key(y) : null; };
  saveDoc('units', { ...u, order: between(k(beforeId), k(afterId)) });
});

// 進度條：熟了（綠）＋讀過（藍），剩下灰
function bar(list) {
  const n = list.length || 1;
  const ok = list.filter(u => u.status === 2).length, read = list.filter(u => u.status === 1).length;
  return `<div class="prog-bar"><div style="width:${ok / n * 100}%;background:${STATUS[2].color}"></div><div style="width:${read / n * 100}%;background:${STATUS[1].color}"></div></div>`;
}

// ---------- 總覽 ----------
function overview() {
  const subs = subjects();
  if (!subs.length) {
    return `<section class="card"><div class="empty">還沒有科目。到「設定 → 課表」新增課程，或按下面的「＋ 其他科目」（例如 LeetCode、ROS2）。</div>
      <button class="btn" data-action="tags-manage">＋ 其他科目</button></section>`;
  }
  const allWeak = units().flatMap(u => openWeak(u).map(w => ({ u, w })));
  const card = s => {
    const list = unitsOf(s.key);
    const at = studyAt()[s.key];
    const weak = list.reduce((n, u) => n + openWeak(u).length, 0);
    const ok = list.filter(u => u.status === 2).length;
    return `<div class="prog-subj" data-action="prog-open" data-subj="${esc(s.key)}" style="--c:${esc(s.color)}">
      <div class="row"><b class="name">${esc(s.name)}</b><span class="spacer"></span>
        ${weak ? `<span class="prog-weak-n">⚠️ ${weak} 個不熟</span>` : ''}
        <span class="sub">${list.length ? `${ok}/${list.length} 熟` : '還沒拆單元'}</span></div>
      ${list.length ? bar(list) : ''}
      <div class="prog-at ${at?.text ? '' : 'sub'}">📍 ${at?.text ? `${esc(at.text)} <span class="sub">· ${ago(at.at)}</span>` : '還沒寫讀到哪'}</div>
    </div>`;
  };
  return `<div class="grid two">
    <section class="card"><h2>各科</h2>${subs.map(card).join('')}
      <button class="btn small" data-action="tags-manage" style="margin-top:10px">＋ 其他科目（不是課表上的課）</button></section>
    <section class="card"><h2>⚠️ 所有不熟的地方 <span class="sub" style="font-weight:400">${allWeak.length} 個</span></h2>
      ${allWeak.length ? allWeak.map(({ u, w }) => weakRow(u, w, true)).join('')
        : '<div class="empty">目前沒有。讀書時哪裡卡住，就到那一科的單元記下來，考前回來看這裡。</div>'}</section>
  </div>`;
}

function weakRow(u, w, showSubj = false) {
  const s = showSubj ? subjOf(u.subject) : null;
  return `<div class="goal prog-weak ${w.done ? 'done' : ''}">
    <button type="button" class="check small ${w.done ? 'on' : ''}" data-action="prog-weak-toggle" data-id="${u.id}" data-w="${w.id}" title="${w.done ? '又不熟了' : '搞懂了'}">${w.done ? '✓' : ''}</button>
    <div class="text" data-action="prog-unit" data-id="${u.id}">${esc(w.text)}
      <div class="sub">${s ? `<span style="color:${esc(s.color)}">● ${esc(s.name)}</span> · ` : ''}${esc(u.name)} · ${ago(w.at)}</div></div></div>`;
}

// ---------- 單科 ----------
function unitRow(u) {
  const st = STATUS[u.status || 0];
  const weak = openWeak(u).length;
  return `<div class="prog-unit has-handle" data-drag-id="${u.id}" data-drag-group="u">${handle()}
    <button type="button" class="prog-st" data-action="prog-st" data-id="${u.id}" style="--c:${st.color}" title="點一下換狀態">${st.ico} ${st.label}</button>
    <div class="main" data-action="prog-unit" data-id="${u.id}"><div class="title">${esc(u.name)}</div>
      ${weak || u.note ? `<div class="meta">${weak ? `<span style="color:${WEAK}">⚠️ ${weak} 個不熟</span>` : ''}${weak && u.note ? ' · ' : ''}${u.note ? `<span class="sub">${esc(u.note.split('\n')[0])}</span>` : ''}</div>` : ''}</div>
  </div>`;
}

function detail(s) {
  const list = unitsOf(s.key);
  const at = studyAt()[s.key];
  const weak = list.flatMap(u => (u.weak || []).filter(w => progUi.showFixed || !w.done).map(w => ({ u, w })));
  const fixed = list.reduce((n, u) => n + (u.weak || []).filter(w => w.done).length, 0);
  const cnt = i => list.filter(u => (u.status || 0) === i).length;
  return `<div class="grid two">
    <section class="card">
      <h2>📍 讀到哪 ${at?.at ? `<span class="sub" style="font-weight:400">上次更新：${ago(at.at)}</span>` : ''}</h2>
      <form data-form="prog-at" class="add-goal" style="margin-top:0"><input type="text" name="text" value="${esc(at?.text || '')}" maxlength="80" autocomplete="off" placeholder="例如：Ch5 讀到 5-3 FGK，p.142">
        <button class="btn primary" type="submit">更新</button></form>
      <h2 style="margin-top:16px">單元 <span class="sub" style="font-weight:400">${list.length ? `熟了 ${cnt(2)} · 讀過 ${cnt(1)} · 沒讀 ${cnt(0)}` : ''}</span></h2>
      ${list.length ? bar(list) : ''}
      <div data-drag-list="units">${list.map(unitRow).join('') || '<div class="empty">先把這科拆成單元（章節），一行一個，可以一次貼很多行。</div>'}</div>
      <form data-form="prog-add" class="prog-add"><textarea name="text" rows="2" placeholder="新增單元，例如：Ch5 統計模式（多行＝多個單元）" autocomplete="off"></textarea>
        <button class="btn" type="submit">加入</button></form>
      ${list.length ? '<div class="sub" style="margin-top:6px">點狀態換：沒讀 → 讀過 → 熟了。點單元名稱寫筆記、記不熟的地方。</div>' : ''}
    </section>
    <section class="card">
      <h2>⚠️ 不熟的地方 <span class="sub" style="font-weight:400">${weak.filter(x => !x.w.done).length} 個</span></h2>
      ${list.length ? `<form data-form="prog-weak" class="prog-weak-add">
        <input type="text" name="text" maxlength="120" autocomplete="off" placeholder="哪裡不熟？例如：NYT 什麼時候要拆">
        <div class="row"><select name="unit">${list.map(u => `<option value="${u.id}" ${u.id === progUi.lastUnit ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
          <button class="btn primary" type="submit">記下來</button></div></form>` : '<div class="empty">先新增單元，就能記不熟的地方。</div>'}
      ${weak.map(({ u, w }) => weakRow(u, w)).join('')}
      ${list.length && !weak.length ? '<div class="empty">沒有不熟的地方 👍</div>' : ''}
      ${fixed ? `<button class="btn small" data-action="prog-fixed" style="margin-top:8px">${progUi.showFixed ? '隱藏' : '顯示'}已搞懂的 ${fixed} 個</button>` : ''}
    </section>
  </div>`;
}

export function renderProgress() {
  const s = progUi.subj && subjOf(progUi.subj);
  if (progUi.subj && !s) progUi.subj = '';
  const chips = subjects().map(x => `<button type="button" data-action="prog-open" data-subj="${esc(x.key)}" class="${x.key === progUi.subj ? 'on' : ''}"
    style="${x.key === progUi.subj ? `background:${esc(x.color)};border-color:${esc(x.color)}` : ''}">${esc(x.name)}</button>`).join('');
  return `<div class="page-head"><h1>${s ? `<a href="#progress" data-action="prog-open" data-subj="" class="sub" style="font-weight:400">進度 ›</a> ${esc(s.name)}` : '各科進度'}</h1></div>
    ${subjects().length ? `<div class="chips prog-chips"><button type="button" data-action="prog-open" data-subj="" class="${s ? '' : 'on'}">總覽</button>${chips}</div>` : ''}
    ${s ? detail(s) : overview()}`;
}

// 首頁小卡：有不熟的地方才出現
export function homeProgressCard() {
  const weak = units().flatMap(u => openWeak(u).map(w => ({ u, w }))).sort((a, b) => (b.w.at || 0) - (a.w.at || 0));
  if (!weak.length) return '';
  return `<section class="card"><h2>⚠️ 不熟的地方 <a href="#progress" class="sub" style="font-weight:400">（${weak.length} 個）全部 ›</a></h2>
    ${weak.slice(0, 3).map(({ u, w }) => weakRow(u, w, true)).join('')}</section>`;
}

// ---------- 單元編輯 ----------
function weakList(u) {
  return (u.weak || []).map(w => `<div class="goal ${w.done ? 'done' : ''}">
    <button type="button" class="check small ${w.done ? 'on' : ''}" data-action="prog-sw-toggle" data-w="${w.id}">${w.done ? '✓' : ''}</button>
    <div class="text">${esc(w.text)}</div>
    <button type="button" class="del" data-action="prog-sw-del" data-w="${w.id}" aria-label="刪除">✕</button></div>`).join('')
    || '<div class="empty">沒有</div>';
}
const statusChips = cur => STATUS.map((x, i) => `<button type="button" data-action="prog-sheet-st" data-st="${i}" class="${i === cur ? 'on' : ''}"
  style="${i === cur ? `background:${x.color};border-color:${x.color}` : ''}">${x.ico} ${x.label}</button>`).join('');

function openUnit(u) {
  const d = { ...u, weak: [...(u.weak || [])] };
  ctx.openSheet(`<h2>單元</h2>
    <form data-form="prog-unit">
      <label class="field"><span>名稱</span><input type="text" name="name" value="${esc(d.name)}" required autocomplete="off"></label>
      <div class="field"><span>狀態</span><div class="chips" id="prog-st-chips">${statusChips(d.status || 0)}</div></div>
      <div class="field"><span>不熟的地方（打勾＝搞懂了）</span>
        <div id="prog-sw">${weakList(d)}</div>
        <div class="add-goal"><input type="text" id="prog-sw-input" placeholder="新增一個，按 Enter 加入" autocomplete="off">
          <button type="button" class="btn" data-action="prog-sw-add">加入</button></div></div>
      <label class="field"><span>筆記（重點、頁數、考試會考什麼…）</span><textarea name="note" rows="4">${esc(d.note || '')}</textarea></label>
      <div class="actions">
        <button type="button" class="btn danger" data-action="prog-unit-del">刪除單元</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button></div>
    </form>`, { kind: 'prog-unit', data: d });
}
const sheetEl = sel => document.querySelector(`#sheet ${sel}`);
function addSheetWeak() {
  const input = sheetEl('#prog-sw-input');
  const text = input?.value.trim();
  if (!text) return;
  const d = ctx.sheetData();
  d.weak.push({ id: newId(), text, done: false, at: Date.now() });
  sheetEl('#prog-sw').innerHTML = weakList(d);
  input.value = '';
  input.focus();
}
// 單元面板裡的輸入框按 Enter＝加入不熟的地方
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'prog-sw-input' && !ev.isComposing) { ev.preventDefault(); addSheetWeak(); }
});

// ---------- 表單 ----------
export const progressForms = {
  'prog-at': (form, f) => {
    const text = String(f.text || '').trim();
    savePrefs({ studyAt: { ...studyAt(), [progUi.subj]: { text, at: Date.now() } } });
    form.querySelector('[name=text]')?.blur();
    ctx.toast(text ? '📍 已更新讀到哪' : '已清除');
  },
  'prog-add': (form, f) => {
    const names = String(f.text || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (!names.length) return;
    const list = unitsOf(progUi.subj);
    let k = list.length ? key(list[list.length - 1]) : 0;
    form.querySelector('[name=text]').value = '';
    for (const name of names) {
      k += 1000;
      saveDoc('units', { id: newId(), subject: progUi.subj, name: name.slice(0, 80), status: 0, weak: [], note: '', order: k, createdAt: Date.now() });
    }
    ctx.toast(names.length > 1 ? `加入 ${names.length} 個單元` : `加入「${names[0]}」`);
  },
  'prog-weak': (form, f) => {
    const text = String(f.text || '').trim();
    const u = units().find(x => x.id === f.unit);
    if (!text || !u) return;
    progUi.lastUnit = u.id;
    form.querySelector('[name=text]').value = '';
    saveDoc('units', { ...u, weak: [...(u.weak || []), { id: newId(), text, done: false, at: Date.now() }] });
    ctx.toast('⚠️ 記下來了，搞懂後打勾');
  },
  'prog-unit': (form, f, d) => {
    const name = String(f.name || '').trim();
    if (!name) return;
    saveDoc('units', { ...d, name: name.slice(0, 80), note: String(f.note || '').trim() });
    ctx.closeSheet();
    ctx.toast('已儲存');
  },
};

// ---------- 點擊 ----------
const findUnit = id => units().find(x => x.id === id);
export const progressActions = {
  'prog-open': el => { progUi.subj = el.dataset.subj; progUi.showFixed = false; if (location.hash !== '#progress') location.hash = '#progress'; else ctx.render(); window.scrollTo(0, 0); },
  'prog-st': el => {
    const u = findUnit(el.dataset.id);
    if (u) saveDoc('units', { ...u, status: ((u.status || 0) + 1) % STATUS.length });
  },
  'prog-unit': el => { const u = findUnit(el.dataset.id); if (u) openUnit(u); },
  'prog-weak-toggle': el => {
    const u = findUnit(el.dataset.id);
    if (!u) return;
    let now = false;
    const weak = (u.weak || []).map(w => w.id === el.dataset.w ? (now = !w.done, { ...w, done: now }) : w);
    saveDoc('units', { ...u, weak });
    if (now) ctx.toast('👍 搞懂了');
  },
  'prog-fixed': () => { progUi.showFixed = !progUi.showFixed; ctx.render(); },
  'prog-sheet-st': el => {
    const d = ctx.sheetData();
    d.status = +el.dataset.st;
    sheetEl('#prog-st-chips').innerHTML = statusChips(d.status);
  },
  'prog-sw-add': addSheetWeak,
  'prog-sw-toggle': el => {
    const d = ctx.sheetData();
    d.weak = d.weak.map(w => w.id === el.dataset.w ? { ...w, done: !w.done } : w);
    sheetEl('#prog-sw').innerHTML = weakList(d);
  },
  'prog-sw-del': el => {
    const d = ctx.sheetData();
    d.weak = d.weak.filter(w => w.id !== el.dataset.w);
    sheetEl('#prog-sw').innerHTML = weakList(d);
  },
  'prog-unit-del': () => {
    const d = ctx.sheetData();
    if (!confirm(`刪除單元「${d.name}」？裡面記的不熟的地方也會一起刪掉。`)) return;
    removeDoc('units', d.id);
    ctx.closeSheet();
    ctx.toast('已刪除');
  },
};
