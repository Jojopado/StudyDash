// 測驗（#quiz）：證照考古題選擇題（IoT 755 題、RFID／EPC 177 題）。題庫是靜態 JSON（js/quiz-*.json），離線也能做。
// 作答紀錄存在 prefs.quiz[bankId][questionId] = [答對次數, 答錯次數, 最後一次是否答對(1/0)]，跟著帳號同步。
import { store, savePrefs } from './store.js';
import { esc } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render }
export function initQuiz(c) { ctx = c; }

const BANKS = [
  { id: 'iot', file: 'js/quiz-iot.json', short: 'IoT 物聯網', exam: 50, mins: 60 },
  { id: 'rfid', file: 'js/quiz-rfid.json', short: 'RFID／EPC', exam: 40, mins: 60 },   // GS1 認證考試 40 題、60 分鐘
  { id: 'dc', file: 'js/quiz-dc.json', short: '資料壓縮', exam: 30, mins: 45 },   // 期中 11/5 練習題（Ch1＋Ch5）
];
const BANK_KEY = 'studydash.quiz.bank';
const bankCfg = () => BANKS.find(b => b.id === quizUi.bank) || BANKS[0];
const L = 'ABCD';

const banks = {};       // id -> 題庫資料（載入後）
let loading = null;

export const quizUi = {
  bank: (() => { try { return localStorage.getItem(BANK_KEY) || 'iot'; } catch { return 'iot'; } })(),
  mode: null,           // null | 'practice' | 'exam' | 'result'
  title: '',
  queue: [], idx: 0,
  picked: null,         // 練習模式：這題選了哪個
  answers: [],          // 模擬考：每題選了哪個
  startAt: 0, endAt: 0,
  right: 0, wrong: 0,
};

function load() {
  if (loading) return loading;
  loading = Promise.all(BANKS.map(b => fetch(b.file).then(r => r.json()).then(d => { banks[b.id] = d; })))
    .then(() => ctx.render())
    .catch(e => { loading = null; ctx.toast(`題庫載入失敗：${e.message}`); });
  return loading;
}

const bank = () => banks[quizUi.bank];
const qById = id => bank()?.questions.find(q => q.id === id);
const groupOf = id => bank()?.groups.find(g => g.id === id);
const rec = () => (store.prefs.quiz || {})[quizUi.bank] || {};
const isWrong = r => r && r[2] === 0;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function record(results) { // results: [{id, ok}]
  const all = { ...(store.prefs.quiz || {}) };
  const r = { ...(all[quizUi.bank] || {}) };
  for (const { id, ok } of results) {
    const [c, w] = r[id] || [0, 0, 0];
    r[id] = ok ? [c + 1, w, 1] : [c, w + 1, 0];
  }
  all[quizUi.bank] = r;
  savePrefs({ quiz: all });
}

// ---------- 畫面 ----------
export function renderQuiz() {
  if (!bank()) { load(); return '<div class="page-head"><div><h1>測驗</h1><div class="sub">題庫載入中…</div></div></div>'; }
  if (quizUi.mode === 'practice' || quizUi.mode === 'exam') return questionView();
  if (quizUi.mode === 'result') return resultView();
  return homeView();
}

function stats(ids) {
  const r = rec();
  let done = 0, ok = 0, wrong = 0;
  for (const id of ids) {
    const x = r[id];
    if (!x) continue;
    done++;
    if (x[2]) ok++; else wrong++;
  }
  return { done, ok, wrong, total: ids.length };
}

function homeView() {
  const b = bank();
  const ids = b.questions.map(q => q.id);
  const s = stats(ids);
  const pct = s.done ? Math.round(s.ok / s.done * 100) : 0;
  const r = rec();
  const groups = b.groups.map(g => {
    const gq = b.questions.filter(q => q.g === g.id);
    const gs = stats(gq.map(q => q.id));
    const resume = gs.done && gs.done < gs.total ? gq.findIndex(q => !r[q.id]) : -1;
    return `<div class="ev quiz-group">
      <div class="main"><div class="title">${esc(g.name)}${g.ref ? ' <span class="badge" title="原卷沒有附答案，答案是講義推定的參考答案">參考答案</span>' : ''}</div>
        <div class="meta">${g.count} 題 · 做過 ${gs.done}${gs.wrong ? ` · <b class="quiz-bad">錯 ${gs.wrong}</b>` : ''}</div>
        <div class="progress thin"><div style="width:${Math.round(gs.done / gs.total * 100)}%"></div></div></div>
      <div class="row quiz-group-btns">
        <button class="btn small ghost" data-action="quiz-pickq" data-id="${g.id}" title="選從第幾題開始">＃ 選題</button>
        ${resume >= 0 ? `<button class="btn small primary" data-action="quiz-group" data-id="${g.id}" data-start="${resume}" title="跳到第一題還沒做的">▶ 繼續第 ${gq[resume].n} 題</button>`
          : `<button class="btn small" data-action="quiz-group" data-id="${g.id}">▶ 依序做</button>`}</div></div>`;
  }).join('');
  const EXAM_SIZE = bankCfg().exam;
  const tabs = BANKS.map(x => `<button type="button" class="${x.id === quizUi.bank ? 'on' : ''}" style="${x.id === quizUi.bank ? 'background:var(--accent);border-color:var(--accent)' : ''}" data-action="quiz-bank" data-id="${x.id}">${esc(x.short)}${banks[x.id] ? ` · ${banks[x.id].questions.length}` : ''}</button>`).join('');
  return `<div class="page-head"><div><h1>測驗</h1><div class="sub">${esc(b.name)} ${esc(b.label || '考古題')} · ${s.total} 題 · 沒網路也能做</div></div></div>
    <div class="chips" style="margin-bottom:12px">${tabs}</div>
    <section class="card">
      <div class="quiz-stats">
        <div><b>${s.done}</b><span>做過 / ${s.total}</span></div>
        <div><b>${pct}%</b><span>最近一次答對率</span></div>
        <div><b class="${s.wrong ? 'quiz-bad' : ''}">${s.wrong}</b><span>錯題本</span></div>
      </div>
      <div class="progress" style="margin:10px 0 14px"><div style="width:${Math.round(s.done / s.total * 100)}%"></div></div>
      <div class="row wrap">
        <button class="btn primary" data-action="quiz-random">🔀 隨機練習</button>
        <button class="btn" data-action="quiz-new" ${s.done < s.total ? '' : 'disabled'}>🆕 只做沒做過的</button>
        <span class="quiz-split"><button class="btn" data-action="quiz-wrong" ${s.wrong ? '' : 'disabled'}>🔁 錯題本${s.wrong ? ` ${s.wrong}` : ''}</button><button class="btn" data-action="quiz-wrong-pick" title="選從第幾題開始" ${s.wrong ? '' : 'disabled'}>＃</button></span>
        <button class="btn" data-action="quiz-exam">📝 模擬考 ${EXAM_SIZE} 題</button>
      </div>
      <div class="sub" style="margin-top:10px">練習：選完馬上看對錯和解析。模擬考：${EXAM_SIZE} 題、${bankCfg().mins} 分鐘，交卷後才看答案。答錯的題目會進錯題本，之後答對就會移出。</div>
    </section>
    <h2 class="quiz-h2">題組</h2>
    <section class="card">${groups}</section>
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      <button class="btn small ghost" data-action="quiz-reset" ${s.done ? '' : 'disabled'}>清除作答紀錄</button></div>`;
}

function questionView() {
  const exam = quizUi.mode === 'exam';
  const q = qById(quizUi.queue[quizUi.idx]);
  const g = groupOf(q.g);
  const n = quizUi.queue.length;
  const picked = exam ? quizUi.answers[quizUi.idx] : quizUi.picked;
  const shown = !exam && picked != null;
  const opts = q.o.map((o, i) => {
    if (!o) return '';
    let cls = '';
    if (shown) cls = i === q.a ? 'ok' : i === picked ? 'bad' : 'dim';
    else if (exam && picked === i) cls = 'on';
    return `<button class="quiz-opt ${cls}" data-action="quiz-pick" data-i="${i}" ${shown ? 'disabled' : ''}>
      <span class="quiz-l">${L[i]}</span><span class="quiz-t">${esc(o)}</span>${shown && i === q.a ? '<span class="quiz-mark">✓</span>' : shown && i === picked ? '<span class="quiz-mark">✕</span>' : ''}</button>`;
  }).join('');
  const answered = exam ? quizUi.answers.filter(x => x != null).length : 0;
  const head = `<div class="page-head"><div><button class="btn ghost small" data-action="quiz-exit">← ${exam ? '放棄考試' : '結束'}</button>
      <h1>${esc(quizUi.title)}</h1></div>
      ${exam ? `<div class="row"><span class="sub" id="quiz-clock">${clock()}</span><button class="btn small primary" data-action="quiz-submit">交卷</button></div>`
        : `<div class="sub">✓ ${quizUi.right} · ✕ ${quizUi.wrong}</div>`}</div>`;
  return `${head}
    <div class="flash-progress"><div style="width:${Math.round((quizUi.idx + (shown ? 1 : 0)) / n * 100)}%"></div></div>
    <div class="sub quiz-pos"><button class="quiz-jump" data-action="quiz-jump" title="跳到別題">${quizUi.idx + 1} / ${n} ▾</button>${exam ? ` · 已作答 ${answered}` : ''} · ${esc(g?.name || '')} 第 ${q.n} 題</div>
    <section class="card quiz-card">
      <div class="quiz-q">${esc(q.q)}</div>
      <div class="quiz-opts">${opts}</div>
      ${shown ? `<div class="quiz-ex ${picked === q.a ? 'good' : 'bad'}"><b>${picked === q.a ? '答對了！' : `答錯了，${g?.ref ? '參考' : '正確'}答案是 ${L[q.a]}`}</b><div>${esc(q.e)}</div></div>` : ''}
    </section>
    <div class="flash-grade">
      ${exam ? `<button class="btn" data-action="quiz-step" data-dir="-1" ${quizUi.idx ? '' : 'disabled'}>‹ 上一題</button>
        <button class="btn primary" data-action="quiz-step" data-dir="1" ${quizUi.idx < n - 1 ? '' : 'disabled'}>下一題 ›</button>`
        : shown ? `<button class="btn primary" data-action="quiz-next">${quizUi.idx < n - 1 ? '下一題 ›' : '看結果'}</button>` : ''}
    </div>
    <div class="sub" style="text-align:center;margin-top:10px">鍵盤：1–4 或 A–D 作答${exam ? '、← → 換題' : '、Enter 下一題'}</div>`;
}

function clock() {
  const ms = Math.max(0, quizUi.endAt - Date.now());
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
  return `⏱ ${m}:${String(s).padStart(2, '0')}`;
}

function resultView() {
  const qs = quizUi.queue.map(qById);
  const exam = quizUi.answers.length > 0;
  const total = qs.length;
  const right = exam ? qs.filter((q, i) => quizUi.answers[i] === q.a).length : quizUi.right;
  const done = exam ? total : quizUi.right + quizUi.wrong;
  const score = done ? Math.round(right / done * 100) : 0;
  const all = exam ? qs.map((q, i) => ({ q, p: quizUi.answers[i] })) : [];
  const wrongList = all.filter(x => x.p !== x.q.a);
  const rightList = all.filter(x => x.p === x.q.a);
  const reviewCard = ({ q, p }) => `<section class="card quiz-card">
      <div class="sub">${esc(groupOf(q.g)?.name || '')} 第 ${q.n} 題</div>
      <div class="quiz-q">${esc(q.q)}</div>
      <div class="quiz-opts">${q.o.map((o, i) => (o ? `<div class="quiz-opt ${i === q.a ? 'ok' : i === p ? 'bad' : 'dim'}"><span class="quiz-l">${L[i]}</span><span class="quiz-t">${esc(o)}</span></div>` : '')).join('')}</div>
      <div class="quiz-ex ${p === q.a ? 'good' : 'bad'}"><b>${p === q.a ? `答對了！答案 ${L[q.a]}` : `${p == null ? '沒作答' : `你選 ${L[p]}`}，答案 ${L[q.a]}`}</b><div>${esc(q.e)}</div></div></section>`;
  const mins = Math.round((quizUi.endAt && exam ? Math.min(Date.now(), quizUi.endAt) : Date.now()) - quizUi.startAt) / 60000;
  return `<div class="page-head"><div><button class="btn ghost small" data-action="quiz-exit">← 回測驗</button><h1>${esc(quizUi.title)}</h1></div></div>
    <section class="card flash-done">
      <div style="font-size:44px">${score >= 70 ? '🎉' : '💪'}</div>
      <h2>${right} / ${done} 題答對（${score} 分）</h2>
      <div class="sub">${exam ? `用了 ${Math.max(1, Math.round(mins))} 分鐘` : ''}${score >= 70 ? ' · 及格線一般是 70 分' : ' · 一般及格線是 70 分，再加油'}</div>
      <div class="row wrap" style="justify-content:center;margin-top:14px">
        ${stats(bank().questions.map(q => q.id)).wrong ? '<button class="btn" data-action="quiz-wrong">🔁 練錯題本</button>' : ''}
        <button class="btn primary" data-action="quiz-exit">回測驗</button></div>
    </section>
    ${wrongList.length ? `<h2 class="quiz-h2">答錯的 ${wrongList.length} 題</h2>${wrongList.map(reviewCard).join('')}` : ''}
    ${rightList.length ? `<h2 class="quiz-h2">答對的 ${rightList.length} 題（也看一下解析）</h2>${rightList.map(reviewCard).join('')}` : ''}`;
}

// 題號格子：綠＝最近答對、紅＝最近答錯、空心＝沒做過；cur＝目前這題
function numGrid(ids, action, cur = -1, seq = false) {
  const r = rec();
  const exam = quizUi.mode === 'exam' && action === 'quiz-goto';
  return `<div class="quiz-grid">${ids.map((id, i) => {
    const q = qById(id), x = r[id];
    const cls = exam ? (quizUi.answers[i] != null ? 'on' : '') : x ? (x[2] ? 'ok' : 'bad') : '';
    return `<button class="${cls}${i === cur ? ' cur' : ''}" data-action="${action}" data-i="${i}" title="${esc(groupOf(q.g)?.name || '')} 第 ${q.n} 題">${exam || seq ? i + 1 : q.n}</button>`;
  }).join('')}</div>`;
}
const gridLegend = exam => exam
  ? '<div class="sub quiz-legend"><i class="on"></i>已作答 <i></i>沒作答</div>'
  : '<div class="sub quiz-legend"><i class="ok"></i>答對 <i class="bad"></i>答錯 <i></i>沒做過</div>';

let picking = null; // { ids, title }：選題格子按下去要開始的那一組
function openPicker(gid) {
  const g = groupOf(gid);
  const ids = bank().questions.filter(q => q.g === g.id).map(q => q.id);
  picking = { ids, title: g.name };
  const r = rec();
  const first = ids.findIndex(id => !r[id]);
  ctx.openSheet(`<h2>${esc(g.name)} · 從第幾題開始？</h2>
    ${gridLegend(false)}
    ${numGrid(ids, 'quiz-from', first)}
    <div class="actions">
      ${first > 0 ? `<button class="btn primary" data-action="quiz-from" data-i="${first}">▶ 從第一題沒做過的（第 ${qById(ids[first]).n} 題）</button>` : ''}
      <button class="btn ghost" data-action="close-sheet">取消</button></div>`);
}

// 錯題本照題庫順序排，編號 1…k（答對就會移出，所以每次剩下的都是還沒訂正的）
function openWrongPicker() {
  const r = rec();
  const ids = bank().questions.filter(q => isWrong(r[q.id])).map(q => q.id);
  if (!ids.length) return;
  picking = { ids, title: '錯題本' };
  ctx.openSheet(`<h2>錯題本 · 從第幾題開始？</h2>
    <div class="sub" style="margin-bottom:10px">共 ${ids.length} 題，照題庫順序排；答對的會移出錯題本。</div>
    ${numGrid(ids, 'quiz-from', -1, true)}
    <div class="actions"><button class="btn ghost" data-action="close-sheet">取消</button></div>`);
}

function openJump() {
  const exam = quizUi.mode === 'exam';
  ctx.openSheet(`<h2>跳到第幾題？</h2>
    ${gridLegend(exam)}
    ${numGrid(quizUi.queue, 'quiz-goto', quizUi.idx)}
    <div class="actions"><button class="btn ghost" data-action="close-sheet">取消</button></div>`);
}

// ---------- 動作 ----------
function start(ids, title, mode = 'practice', idx = 0) {
  if (!ids.length) { ctx.toast('沒有題目'); return; }
  Object.assign(quizUi, {
    mode, title, queue: ids, idx: Math.min(Math.max(0, idx), ids.length - 1), picked: null, right: 0, wrong: 0,
    answers: mode === 'exam' ? ids.map(() => null) : [],
    startAt: Date.now(), endAt: mode === 'exam' ? Date.now() + bankCfg().mins * 60000 : 0,
  });
  ctx.render();
  window.scrollTo(0, 0);
}

function pick(i) {
  const q = qById(quizUi.queue[quizUi.idx]);
  if (!q || !q.o[i]) return;
  if (quizUi.mode === 'exam') { quizUi.answers[quizUi.idx] = i; ctx.render(); return; }
  if (quizUi.picked != null) return;
  quizUi.picked = i;
  const ok = i === q.a;
  if (ok) quizUi.right++; else quizUi.wrong++;
  record([{ id: q.id, ok }]);   // savePrefs 會觸發重畫
}

function next() {
  if (quizUi.mode !== 'practice' || quizUi.picked == null) return;
  if (quizUi.idx >= quizUi.queue.length - 1) { quizUi.mode = 'result'; ctx.render(); window.scrollTo(0, 0); return; }
  quizUi.idx++;
  quizUi.picked = null;
  ctx.render();
  window.scrollTo(0, 0);
}

function submitExam(auto) {
  const blank = quizUi.answers.filter(x => x == null).length;
  if (!auto && blank && !confirm(`還有 ${blank} 題沒作答，確定交卷？`)) return;
  record(quizUi.queue.map((id, i) => ({ id, ok: quizUi.answers[i] === qById(id).a })).filter((x, i) => quizUi.answers[i] != null || auto));
  quizUi.mode = 'result';
  ctx.render();
  window.scrollTo(0, 0);
  if (auto) ctx.toast('時間到，自動交卷');
}

export const quizActions = {
  'quiz-random': () => start(shuffle(bank().questions.map(q => q.id)), '隨機練習'),
  'quiz-new': () => { const r = rec(); start(shuffle(bank().questions.filter(q => !r[q.id]).map(q => q.id)), '沒做過的題目'); },
  'quiz-wrong': () => { const r = rec(); start(shuffle(bank().questions.filter(q => isWrong(r[q.id])).map(q => q.id)), '錯題本'); },
  'quiz-exam': () => start(shuffle(bank().questions.map(q => q.id)).slice(0, bankCfg().exam), '模擬考', 'exam'),
  'quiz-bank': el => {
    quizUi.bank = el.dataset.id;
    try { localStorage.setItem(BANK_KEY, quizUi.bank); } catch {}
    ctx.render();
  },
  'quiz-group': el => { const g = groupOf(el.dataset.id); start(bank().questions.filter(q => q.g === g.id).map(q => q.id), g.name, 'practice', +el.dataset.start || 0); },
  'quiz-pickq': el => openPicker(el.dataset.id),
  'quiz-from': el => {
    ctx.closeSheet();
    if (picking) start(picking.ids, picking.title, 'practice', +el.dataset.i);
  },
  'quiz-wrong-pick': openWrongPicker,
  'quiz-jump': openJump,
  'quiz-goto': el => {
    ctx.closeSheet();
    quizUi.idx = +el.dataset.i;
    if (quizUi.mode === 'practice') quizUi.picked = null;
    ctx.render();
    window.scrollTo(0, 0);
  },
  'quiz-pick': el => pick(+el.dataset.i),
  'quiz-next': next,
  'quiz-step': el => {
    quizUi.idx = Math.min(quizUi.queue.length - 1, Math.max(0, quizUi.idx + +el.dataset.dir));
    ctx.render();
  },
  'quiz-submit': () => submitExam(false),
  'quiz-exit': () => {
    if (quizUi.mode === 'exam' && !confirm('放棄這次模擬考？作答不會記錄。')) return;
    if (quizUi.mode === 'practice' && (quizUi.right + quizUi.wrong) > 0) { quizUi.mode = 'result'; quizUi.answers = []; ctx.render(); return; }
    quizUi.mode = null;
    ctx.render();
    window.scrollTo(0, 0);
  },
  'quiz-reset': () => {
    if (!confirm('清除這個題庫的所有作答紀錄（含錯題本）？')) return;
    const all = { ...(store.prefs.quiz || {}) };
    delete all[quizUi.bank];
    savePrefs({ quiz: all });
    ctx.toast('已清除');
  },
};

// 模擬考倒數（app.js 每秒呼叫）
export function quizTick() {
  if (location.hash !== '#quiz' || quizUi.mode !== 'exam') return;
  if (Date.now() >= quizUi.endAt) { submitExam(true); return; }
  const el = document.getElementById('quiz-clock');
  if (el) el.textContent = clock();
}

export function quizKey(ev) {
  if (location.hash !== '#quiz' || !(quizUi.mode === 'practice' || quizUi.mode === 'exam')) return false;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return false;
  const k = ev.key.toUpperCase();
  const i = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : L.indexOf(k);
  if (k.length === 1 && i >= 0) { pick(i); return true; }
  if (quizUi.mode === 'practice' && (ev.key === 'Enter' || ev.key === 'ArrowRight' || ev.key === ' ')) { next(); return true; }
  if (quizUi.mode === 'exam' && ev.key === 'ArrowRight') { quizActions['quiz-step']({ dataset: { dir: 1 } }); return true; }
  if (quizUi.mode === 'exam' && ev.key === 'ArrowLeft') { quizActions['quiz-step']({ dataset: { dir: -1 } }); return true; }
  return false;
}
