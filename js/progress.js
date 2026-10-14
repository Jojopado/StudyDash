// 各科進度（#progress）：每科一份章節清單，每章直接點「沒讀／讀過／熟了」；
// 點章名展開：設成「📍 讀到這裡」、記「哪裡不熟」（搞懂了就打勾）。
// 資料：units 集合 { subject: 'c:課程id' | 'g:標籤id', name, status 0|1|2, weak: [{ id, text, done, at }], group, groupDate, order }
// 讀到哪：prefs.studyAt = { 科目key: { unitId, text, at } }
// 預設章節在 js/progress-preset.json，第一次打開時自動放進還沒有章節的科目（prefs.progSeeded 記已放過）。
import { store, newId, saveDoc, removeDoc, savePrefs } from './store.js';
import { esc, today, daysUntil, fmtDate } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initProgress(c) { ctx = c; }

// subj: 目前看哪一科（'weak' = 所有不熟的地方）；open: 展開的章節
export const progUi = { subj: '', open: '' };

export const STATUS = [
  { label: '沒讀', color: '#94a3b8' },
  { label: '讀過', color: '#60a5fa' },
  { label: '熟了', color: '#4ade80' },
];
const WEAK = '#fbbf24';

const units = () => store.state.units || [];
const studyAt = () => store.prefs.studyAt || {};
const key = u => u.order ?? (u.createdAt || 0);
const unitsOf = s => units().filter(u => u.subject === s).sort((a, b) => key(a) - key(b));
const openWeak = u => (u.weak || []).filter(w => !w.done);

// 所有可以追蹤的科目：課表上的課＋讀書標籤
function allSubjects() {
  return [
    ...store.state.courses.map(c => ({ key: `c:${c.id}`, name: c.name, color: c.color })),
    ...(store.prefs.studyTags || []).map(g => ({ key: `g:${g.id}`, name: g.name, color: g.color })),
  ];
}
// 有章節的科目才出現在上面那排
const subjects = () => allSubjects().filter(s => units().some(u => u.subject === s.key));
const subjOf = k => allSubjects().find(s => s.key === k);

function ago(ts) {
  if (!ts) return '';
  const days = Math.round((new Date(new Date().toDateString()) - new Date(new Date(ts).toDateString())) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------- 預設章節 ----------
let preset = null;
fetch('js/progress-preset.json').then(r => r.json()).then(p => { preset = p.subjects || []; seed(); ctx?.render(); }).catch(() => { preset = []; });

const seededNow = new Set(); // 已放過的（prefs 還沒同步回來前也算）
let seeding = false;          // 存檔會馬上重畫、又呼叫 seed()，跑的途中不要再進來
function seed() {
  // 要等雲端資料載入完（登入狀態），不然會以為沒有章節
  if (seeding || !preset || !store.ready || (store.cloudAvailable && store.mode !== 'cloud')) return;
  seeding = true;
  try { seedOnce(); } finally { seeding = false; }
}
function seedOnce() {
  const done = { ...(store.prefs.progSeeded || {}) };
  for (const id of seededNow) done[id] = true;
  let tags = [...(store.prefs.studyTags || [])];
  const at = { ...studyAt() };
  let changed = false;
  for (const p of preset) {
    if (done[p.id]) continue;
    let k = '';
    if (p.course) { const c = store.state.courses.find(x => x.name === p.course); if (c) k = `c:${c.id}`; }
    else if (p.tag) {
      let g = tags.find(x => x.name === p.tag);
      if (!g) { g = { id: `pp-${p.id}`, name: p.tag, color: p.color || '#94a3b8' }; tags = [...tags, g]; }
      k = `g:${g.id}`;
    }
    if (!k) continue;
    done[p.id] = true;
    seededNow.add(p.id);
    changed = true;
    if (units().some(u => u.subject === k)) continue; // 自己已經建了章節就不動
    let n = 0;
    for (const g of p.groups) {
      for (const [id, name, status] of g.units) {
        saveDoc('units', { id: `pp-${id}`, subject: k, name, status: status || 0, weak: [], group: g.name, groupDate: g.date || '', order: ++n * 1000, createdAt: Date.now() });
      }
    }
    // 檔案裡越前面的科目時間越新（第一次打開就先看它）
    if (p.at && !at[k]?.unitId) at[k] = { unitId: `pp-${p.at}`, text: p.atText || '', at: Date.now() - preset.indexOf(p) * 1000 };
  }
  if (changed) savePrefs({ progSeeded: done, studyTags: tags, studyAt: at });
}

// ---------- 小元件 ----------
function bar(list) {
  const n = list.length || 1;
  const ok = list.filter(u => u.status === 2).length, read = list.filter(u => u.status === 1).length;
  return `<div class="prog-bar"><div style="width:${ok / n * 100}%;background:${STATUS[2].color}"></div><div style="width:${read / n * 100}%;background:${STATUS[1].color}"></div></div>`;
}
const pct = list => (list.length ? Math.round(list.reduce((n, u) => n + (u.status || 0), 0) / (list.length * 2) * 100) : 0);

function seg(u) {
  return `<div class="pu-seg">${STATUS.map((x, i) => `<button type="button" data-action="prog-set" data-id="${u.id}" data-st="${i}"
    class="${(u.status || 0) === i ? 'on' : ''}" style="--c:${x.color}">${x.label}</button>`).join('')}</div>`;
}

function weakItem(u, w, showWhere = false) {
  const s = showWhere ? subjOf(u.subject) : null;
  return `<div class="pw ${w.done ? 'done' : ''}">
    <button type="button" class="check small ${w.done ? 'on' : ''}" data-action="prog-weak-toggle" data-id="${u.id}" data-w="${w.id}" title="${w.done ? '又不熟了' : '搞懂了'}">${w.done ? '✓' : ''}</button>
    <div class="text">${esc(w.text)}${showWhere ? `<div class="sub">${s ? `<span style="color:${esc(s.color)}">● ${esc(s.name)}</span> · ` : ''}${esc(u.name)}</div>` : ''}</div>
    ${showWhere ? '' : `<button type="button" class="del" data-action="prog-weak-del" data-id="${u.id}" data-w="${w.id}" aria-label="刪除">✕</button>`}</div>`;
}

// 一章：名稱＋三段狀態；展開後是「讀到這裡」和「哪裡不熟」
function unitRow(u, here) {
  const open = progUi.open === u.id;
  const weak = openWeak(u);
  const st = STATUS[u.status || 0];
  const at = studyAt()[u.subject];
  return `<div class="pu${open ? ' open' : ''}${here ? ' here' : ''}${weak.length ? ' has-weak' : ''}" id="pu-${u.id}" style="--st:${st.color}">
    <div class="pu-row">
      <button type="button" class="pu-name" data-action="prog-toggle" data-id="${u.id}">
        <span class="t">${here ? '<span class="pin">📍</span>' : ''}${esc(u.name)}</span>
        ${weak.length ? `<span class="pu-weak">⚠️ ${weak.length} 個不熟</span>` : ''}
      </button>
      ${seg(u)}
    </div>
    ${open ? `<div class="pu-panel">
      ${here ? `<div class="row pu-here"><span>📍 目前讀到這章</span><span class="spacer"></span><button type="button" class="btn small" data-action="prog-here" data-id="${u.id}">取消</button></div>
        <form data-form="prog-at-text" data-id="${u.id}" class="add-goal"><input type="text" name="text" value="${esc(at?.text || '')}" maxlength="60" autocomplete="off" placeholder="細到哪？例如：p.142、5-3 節（可不填）"><button class="btn" type="submit">存</button></form>`
        : `<button type="button" class="btn pu-here-btn" data-action="prog-here" data-id="${u.id}">📍 我讀到這裡</button>`}
      <div class="pu-sec">哪裡不熟？</div>
      ${(u.weak || []).map(w => weakItem(u, w)).join('')}
      <form data-form="prog-weak" data-id="${u.id}" class="add-goal"><input type="text" name="text" maxlength="120" autocomplete="off" placeholder="例如：NYT 什麼時候要拆（打完按 Enter）"><button class="btn primary" type="submit">記</button></form>
      <div class="pu-tools"><button type="button" class="linkbtn" data-action="prog-rename" data-id="${u.id}">改名</button>
        <button type="button" class="linkbtn danger" data-action="prog-del" data-id="${u.id}">刪掉這章</button></div>
    </div>` : ''}
  </div>`;
}

// ---------- 畫面 ----------
function subjectPage(s) {
  const list = unitsOf(s.key);
  const at = studyAt()[s.key];
  const hereU = at?.unitId && list.find(u => u.id === at.unitId);
  // 照 group 分段（保持章節順序）
  const groups = [];
  for (const u of list) {
    const g = u.group || '自己加的';
    let x = groups.find(y => y.name === g);
    if (!x) groups.push(x = { name: g, date: u.groupDate || '', list: [] });
    x.list.push(u);
  }
  const ok = list.filter(u => u.status === 2).length, read = list.filter(u => u.status === 1).length;
  const weakN = list.reduce((n, u) => n + openWeak(u).length, 0);
  const next = list.find(u => (u.status || 0) === 0);

  const head = `<section class="card prog-head" style="--c:${esc(s.color)}">
    <div class="prog-big"><b>${pct(list)}%</b><span class="sub">熟了 ${ok} · 讀過 ${read} · 沒讀 ${list.length - ok - read}${weakN ? ` · <span style="color:${WEAK}">⚠️ ${weakN} 個不熟</span>` : ''}</span></div>
    ${bar(list)}
    ${hereU ? `<button type="button" class="prog-here-line" data-action="prog-goto" data-id="${hereU.id}">📍 讀到 <b>${esc(hereU.name)}</b>${at.text ? `，${esc(at.text)}` : ''} <span class="sub">· ${ago(at.at)}</span><span class="spacer"></span>›</button>`
      : `<div class="sub prog-here-line">📍 點章名 →「我讀到這裡」，下次打開就知道從哪接著讀${next ? `。還沒讀的第一章：${esc(next.name)}` : ''}</div>`}
  </section>`;

  const groupHtml = g => {
    const d = g.date && g.date >= today() ? daysUntil(g.date) : null;
    const gok = g.list.filter(u => u.status === 2).length;
    return `<section class="card prog-group"><h2>${esc(g.name)}${g.date ? ` <span class="sub" style="font-weight:400">${fmtDate(g.date)}${d != null ? `・剩 ${d} 天` : ''}</span>` : ''}
      <span class="spacer"></span><span class="sub" style="font-weight:400">熟了 ${gok}/${g.list.length}</span></h2>
      ${g.list.map(u => unitRow(u, u.id === hereU?.id)).join('')}</section>`;
  };

  return `${head}${groups.map(groupHtml).join('')}
    <section class="card"><form data-form="prog-add" data-id="${esc(s.key)}" class="add-goal" style="margin-top:0">
      <input type="text" name="text" maxlength="80" autocomplete="off" placeholder="＋ 自己加一章">
      <button class="btn" type="submit">加入</button></form></section>`;
}

function weakPage() {
  const all = units().flatMap(u => openWeak(u).map(w => ({ u, w }))).sort((a, b) => (b.w.at || 0) - (a.w.at || 0));
  return `<section class="card"><h2>⚠️ 所有不熟的地方 <span class="sub" style="font-weight:400">${all.length} 個，搞懂就打勾</span></h2>
    ${all.length ? all.map(({ u, w }) => weakItem(u, w, true)).join('')
      : '<div class="empty">目前沒有 👍 讀書時哪裡卡住，點那一章的名字記下來，考前回來這裡看。</div>'}</section>`;
}

export function renderProgress() {
  seed();
  const subs = subjects();
  // 沒選（或選的科目不見了）：打開最近更新「讀到哪」的那科；不記下來，資料同步進來後會重新判斷
  let cur = progUi.subj;
  if (cur !== 'weak' && !subs.some(s => s.key === cur)) {
    const recent = subs.map(s => [s, studyAt()[s.key]?.unitId ? studyAt()[s.key].at || 1 : 0]).sort((a, b) => b[1] - a[1])[0];
    cur = recent ? recent[0].key : '';
  }
  const weakAll = units().reduce((n, u) => n + openWeak(u).length, 0);
  const chip = s => {
    const on = s.key === cur;
    return `<button type="button" data-action="prog-subj" data-subj="${esc(s.key)}" class="${on ? 'on' : ''}"
      style="${on ? `background:${esc(s.color)};border-color:${esc(s.color)}` : `border-color:${esc(s.color)}55`}">${esc(s.name)} <small>${pct(unitsOf(s.key))}%</small></button>`;
  };
  const chips = `<div class="prog-chips">${subs.map(chip).join('')}
    <button type="button" data-action="prog-subj" data-subj="weak" class="${cur === 'weak' ? 'on' : ''}" style="${cur === 'weak' ? `background:${WEAK};border-color:${WEAK}` : ''}">⚠️ 不熟 ${weakAll}</button>
    <button type="button" data-action="prog-new-subj" aria-label="新增科目">＋</button></div>`;
  const s = subjOf(cur);
  let body;
  if (!preset && !subs.length) body = '<div class="sub">載入中…</div>';
  else if (cur === 'weak') body = weakPage();
  else if (s) body = subjectPage(s);
  else body = `<section class="card"><div class="empty">還沒有科目。按上面的 ＋ 新增一科。</div></section>`;
  return `<div class="page-head"><h1>各科進度</h1></div>${chips}<div class="prog-body">${body}</div>`;
}

// 首頁小卡：有不熟的地方才出現
export function homeProgressCard() {
  const weak = units().flatMap(u => openWeak(u).map(w => ({ u, w }))).sort((a, b) => (b.w.at || 0) - (a.w.at || 0));
  if (!weak.length) return '';
  return `<section class="card"><h2>⚠️ 不熟的地方 <a href="#progress" data-action="prog-subj" data-subj="weak" class="sub" style="font-weight:400">（${weak.length} 個）全部 ›</a></h2>
    ${weak.slice(0, 3).map(({ u, w }) => weakItem(u, w, true)).join('')}</section>`;
}

// ---------- 新增科目 ----------
function openNewSubject() {
  const rest = allSubjects().filter(s => !units().some(u => u.subject === s.key));
  ctx.openSheet(`<h2>新增科目</h2>
    ${rest.length ? `<div class="field"><span>從課表／讀書標籤選</span><div class="chips">${rest.map(s =>
      `<button type="button" data-action="prog-start" data-subj="${esc(s.key)}" style="border-color:${esc(s.color)}">${esc(s.name)}</button>`).join('')}</div></div>` : ''}
    <form data-form="prog-new-subj">
      <label class="field"><span>或是新的科目名稱</span><input type="text" name="name" maxlength="20" autocomplete="off" placeholder="例如：計算機組織、多益"></label>
      <label class="field"><span>章節（一行一章，可以先空著）</span><textarea name="units" rows="5" placeholder="Ch1 …&#10;Ch2 …"></textarea></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">建立</button></div>
    </form>`, { kind: 'prog-new' });
}

function addUnits(subj, names) {
  const list = unitsOf(subj);
  let k = list.length ? key(list[list.length - 1]) : 0;
  for (const name of names) {
    k += 1000;
    saveDoc('units', { id: newId(), subject: subj, name: name.slice(0, 80), status: 0, weak: [], group: '', groupDate: '', order: k, createdAt: Date.now() });
  }
}

// ---------- 表單 ----------
const findUnit = id => units().find(x => x.id === id);
function clearInput(form) { const i = form.querySelector('[name=text]'); if (i) i.value = ''; }

export const progressForms = {
  'prog-weak': (form, f) => {
    const u = findUnit(form.dataset.id);
    const text = String(f.text || '').trim();
    if (!u || !text) return;
    clearInput(form);   // 先清空再存：存檔會重畫，重畫時會保留輸入框的字
    saveDoc('units', { ...u, weak: [...(u.weak || []), { id: newId(), text, done: false, at: Date.now() }] });
    requestAnimationFrame(() => document.querySelector(`form[data-form="prog-weak"][data-id="${u.id}"] [name=text]`)?.focus());
  },
  'prog-at-text': (form, f) => {
    const u = findUnit(form.dataset.id);
    if (!u) return;
    savePrefs({ studyAt: { ...studyAt(), [u.subject]: { unitId: u.id, text: String(f.text || '').trim(), at: Date.now() } } });
    form.querySelector('[name=text]')?.blur();
    ctx.toast('📍 已記下');
  },
  'prog-add': (form, f) => {
    const name = String(f.text || '').trim();
    const k = form.dataset.id;
    if (!name || !subjOf(k)) return;
    clearInput(form);
    addUnits(k, [name]);
  },
  'prog-new-subj': (form, f) => {
    const name = String(f.name || '').trim();
    const names = String(f.units || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (!name) { ctx.toast('寫一下科目名稱'); return; }
    const tags = store.prefs.studyTags || [];
    let g = tags.find(x => x.name === name);
    const c = store.state.courses.find(x => x.name === name);
    let k = c ? `c:${c.id}` : g ? `g:${g.id}` : '';
    if (!k) {
      const COLORS = ['#60a5fa', '#4ade80', '#c084fc', '#fbbf24', '#f87171', '#2dd4bf', '#f472b6', '#fb923c'];
      g = { id: newId(), name, color: COLORS[tags.length % COLORS.length] };
      savePrefs({ studyTags: [...tags, g] });
      k = `g:${g.id}`;
    }
    addUnits(k, names.length ? names : ['第一章']);
    progUi.subj = k;
    ctx.closeSheet();
    ctx.toast(`建立「${name}」`);
  },
};

// ---------- 點擊 ----------
export const progressActions = {
  'prog-subj': el => {
    progUi.subj = el.dataset.subj;
    progUi.open = '';
    if (location.hash !== '#progress') location.hash = '#progress'; else ctx.render();
  },
  'prog-new-subj': openNewSubject,
  'prog-start': el => {
    const s = subjOf(el.dataset.subj);
    if (!s) return;
    addUnits(s.key, ['第一章']);
    progUi.subj = s.key;
    progUi.open = '';
    ctx.closeSheet();
    ctx.toast(`開始追蹤「${s.name}」，章節可以改名或自己加`);
  },
  'prog-set': el => {
    const u = findUnit(el.dataset.id);
    const st = +el.dataset.st;
    if (!u || (u.status || 0) === st) return;
    saveDoc('units', { ...u, status: st });
    if (st === 2 && openWeak(u).length) ctx.toast(`這章還有 ${openWeak(u).length} 個不熟的地方沒打勾喔`);
  },
  'prog-toggle': el => { progUi.open = progUi.open === el.dataset.id ? '' : el.dataset.id; ctx.render(); },
  'prog-goto': el => {
    progUi.open = el.dataset.id;
    ctx.render();
    document.getElementById(`pu-${el.dataset.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  'prog-here': el => {
    const u = findUnit(el.dataset.id);
    if (!u) return;
    const cur = studyAt()[u.subject];
    const off = cur?.unitId === u.id;
    savePrefs({ studyAt: { ...studyAt(), [u.subject]: off ? { unitId: '', text: '', at: Date.now() } : { unitId: u.id, text: '', at: Date.now() } } });
    if (!off) ctx.toast('📍 記住了，下次從這裡開始');
  },
  'prog-weak-toggle': el => {
    const u = findUnit(el.dataset.id);
    if (!u) return;
    let now = false;
    const weak = (u.weak || []).map(w => w.id === el.dataset.w ? (now = !w.done, { ...w, done: now }) : w);
    saveDoc('units', { ...u, weak });
    if (now) ctx.toast('👍 搞懂了');
  },
  'prog-weak-del': el => {
    const u = findUnit(el.dataset.id);
    if (u) saveDoc('units', { ...u, weak: (u.weak || []).filter(w => w.id !== el.dataset.w) });
  },
  'prog-rename': el => {
    const u = findUnit(el.dataset.id);
    if (!u) return;
    const name = prompt('章節名稱', u.name);
    if (name?.trim()) saveDoc('units', { ...u, name: name.trim().slice(0, 80) });
  },
  'prog-del': el => {
    const u = findUnit(el.dataset.id);
    if (!u || !confirm(`刪掉「${u.name}」？`)) return;
    removeDoc('units', u.id);
    progUi.open = '';
  },
};
