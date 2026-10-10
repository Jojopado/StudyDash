// 字卡（#cards）：卡組＋正反面字卡，翻卡複習（間隔重複），離線也能用（在火車上看）。
// 資料：decks {id,name,color}、cards {id,deckId,front,back,box,due}
import { store, newId, saveDoc, removeDoc } from './store.js';
import { esc, today, addDays, TOPIC_COLORS } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initCards(c) { ctx = c; }

// 答對一次升一格，下次間隔：0 天（今天再來）、1、2、4、7、15、30 天
const GAPS = [0, 1, 2, 4, 7, 15, 30];

export const cardsUi = {
  deck: null,      // 打開的卡組 id
  mode: null,      // null | 'review'（只複習到期的、要評分）| 'browse'（全部翻一遍）
  queue: [], idx: 0, flipped: false, reverse: false, done: 0,
};

const decks = () => [...store.state.decks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const cardsOf = id => store.state.cards.filter(c => c.deckId === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const isDue = c => !c.due || c.due <= today();
const findCard = id => store.state.cards.find(c => c.id === id);
const findDeck = id => store.state.decks.find(d => d.id === id);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- 畫面 ----------
export function renderCards() {
  if (cardsUi.mode) return studyView();
  if (cardsUi.deck && findDeck(cardsUi.deck)) return deckView(findDeck(cardsUi.deck));
  cardsUi.deck = null;
  const list = decks();
  const totalDue = store.state.cards.filter(isDue).length;
  return `<div class="page-head"><div><h1>字卡</h1><div class="sub">${totalDue ? `今天有 ${totalDue} 張要複習` : '今天的複習都完成了'} · 沒網路也能看</div></div>
      <button class="btn primary" data-action="card-deck-new">＋ 新卡組</button></div>
    <div class="grid two">${list.map(deckCard).join('') || `<div class="card"><div class="empty">
      做一組字卡，通勤、坐火車時拿出來翻。<br>例如：DSP 名詞、日文單字、面試問題…<br>可以一張一張加，也可以整批貼上「正面 | 背面」。</div></div>`}</div>`;
}

function deckCard(d) {
  const cs = cardsOf(d.id);
  const due = cs.filter(isDue).length;
  const learned = cs.filter(c => (c.box || 0) >= 3).length;
  return `<section class="card deck" style="border-left:5px solid ${esc(d.color)}">
    <div class="row" data-action="card-deck-open" data-id="${d.id}" style="cursor:pointer">
      <div style="flex:1;min-width:0"><div class="deck-name">${esc(d.name)}</div>
        <div class="sub">${cs.length} 張 · 熟記 ${learned} · ${due ? `<b class="deck-due">${due} 張到期</b>` : '今天沒有到期'}</div></div>
      <span class="fold">›</span></div>
    ${cs.length ? `<div class="progress thin" style="margin:8px 0 10px"><div style="width:${Math.round(learned / cs.length * 100)}%;background:${esc(d.color)}"></div></div>` : ''}
    <div class="row wrap">
      <button class="btn ${due ? 'primary' : ''} small" data-action="card-review" data-id="${d.id}" ${cs.length ? '' : 'disabled'}>▶ 複習${due ? ` ${due}` : ''}</button>
      <button class="btn small" data-action="card-browse" data-id="${d.id}" ${cs.length ? '' : 'disabled'}>🔀 全部翻一遍</button>
      <span class="spacer"></span>
      <button class="btn small ghost" data-action="card-new" data-id="${d.id}">＋ 字卡</button>
    </div>
  </section>`;
}

function deckView(d) {
  const cs = cardsOf(d.id);
  return `<div class="page-head"><div><button class="btn ghost small" data-action="card-home">← 所有卡組</button>
      <h1 style="color:${esc(d.color)}">${esc(d.name)}</h1><div class="sub">${cs.length} 張</div></div>
      <div class="row wrap"><button class="btn small" data-action="card-deck-edit" data-id="${d.id}">編輯卡組</button></div></div>
    <div class="row wrap" style="margin-bottom:14px">
      <button class="btn primary" data-action="card-review" data-id="${d.id}" ${cs.length ? '' : 'disabled'}>▶ 複習到期的</button>
      <button class="btn" data-action="card-browse" data-id="${d.id}" ${cs.length ? '' : 'disabled'}>🔀 全部翻一遍</button>
      <span class="spacer"></span>
      <button class="btn" data-action="card-new" data-id="${d.id}">＋ 一張</button>
      <button class="btn" data-action="card-bulk" data-id="${d.id}">📋 整批貼上</button>
    </div>
    <section class="card">${cs.length ? cs.map(c => `<div class="ev" data-action="card-edit" data-id="${c.id}">
        <div class="main"><div class="title">${esc(c.front)}</div><div class="meta card-back-preview">${esc(c.back)}</div></div>
        <span class="badge" title="熟練度">${'●'.repeat(Math.min(c.box || 0, 6))}${'○'.repeat(Math.max(0, 6 - (c.box || 0)))}</span></div>`).join('')
      : '<div class="empty">還沒有字卡。按「＋ 一張」或「📋 整批貼上」。</div>'}</section>`;
}

function studyView() {
  const q = cardsUi.queue;
  const d = findDeck(cardsUi.deck);
  const review = cardsUi.mode === 'review';
  const head = `<div class="page-head"><div><button class="btn ghost small" data-action="card-exit">← 結束</button>
      <h1>${esc(d?.name || '字卡')}</h1></div>
      <div class="row"><button class="btn small ${cardsUi.reverse ? 'primary' : ''}" data-action="card-reverse" title="先看背面、猜正面">⇄ 反著考</button></div></div>`;
  // 這張可能剛被刪掉
  while (cardsUi.idx < q.length && !findCard(q[cardsUi.idx])) q.splice(cardsUi.idx, 1);
  if (cardsUi.idx >= q.length) {
    return `${head}<section class="card flash-done">
      <div style="font-size:48px">🎉</div><h2>${review ? `複習完 ${cardsUi.done} 張` : '全部翻完了'}</h2>
      <div class="sub">${review ? '答錯的會在今天再出現，答對的照間隔排到之後。' : ''}</div>
      <div class="row wrap" style="justify-content:center;margin-top:14px">
        <button class="btn" data-action="card-browse" data-id="${cardsUi.deck}">🔀 再翻一次</button>
        <button class="btn primary" data-action="card-exit">回卡組</button></div></section>`;
  }
  const c = findCard(q[cardsUi.idx]);
  const [front, back] = cardsUi.reverse ? [c.back, c.front] : [c.front, c.back];
  return `${head}
    <div class="flash-progress"><div style="width:${Math.round(cardsUi.idx / q.length * 100)}%"></div></div>
    <div class="sub" style="text-align:center;margin:6px 0 10px">${cardsUi.idx + 1} / ${q.length}${review ? '' : ' · 瀏覽模式（不影響複習進度）'}</div>
    <div class="flash ${cardsUi.flipped ? 'flipped' : ''}" data-action="card-flip">
      <div class="flash-face">${esc(front)}</div>
      ${cardsUi.flipped ? `<div class="flash-line"></div><div class="flash-face back">${esc(back)}</div>` : '<div class="sub flash-hint">點一下看答案</div>'}
    </div>
    ${review
      ? (cardsUi.flipped ? `<div class="flash-grade">
          <button class="btn" data-action="card-grade" data-g="0">😵 不會<span>今天再來</span></button>
          <button class="btn" data-action="card-grade" data-g="1">🤔 模糊<span>明天</span></button>
          <button class="btn primary" data-action="card-grade" data-g="2">😎 會了<span>${GAPS[Math.min((c.box || 0) + 1, GAPS.length - 1)]} 天後</span></button></div>` : '')
      : `<div class="flash-grade">
          <button class="btn" data-action="card-step" data-dir="-1" ${cardsUi.idx ? '' : 'disabled'}>‹ 上一張</button>
          <button class="btn primary" data-action="card-step" data-dir="1">下一張 ›</button></div>`}
    <div class="sub" style="text-align:center;margin-top:10px">鍵盤：空白鍵翻面${review ? '、1 / 2 / 3 評分' : '、← → 換張'}</div>`;
}

// ---------- 編輯面板 ----------
function openDeckSheet(d) {
  const isNew = !d;
  const x = d ? { ...d } : { id: newId(), name: '', color: TOPIC_COLORS[store.state.decks.length % TOPIC_COLORS.length], createdAt: Date.now() };
  ctx.openSheet(`<h2>${isNew ? '新卡組' : '編輯卡組'}</h2>
    <form data-form="card-deck">
      <label class="field"><span>名稱</span><input type="text" name="name" value="${esc(x.name)}" placeholder="例如：DSP 名詞、日文 N3 單字" required autocomplete="off"></label>
      <div class="field"><span>顏色</span><div class="colors" id="deck-colors">${deckColors(x.color)}</div></div>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="card-deck-del">刪除卡組</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'deck', data: x });
  if (isNew) document.querySelector('#sheet [name=name]').focus();
}
const deckColors = cur => TOPIC_COLORS.map(c => `<button type="button" data-action="card-deck-color" data-color="${c}" class="${c === cur ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('');

function openCardSheet(c, deckId) {
  const isNew = !c;
  const x = c ? { ...c } : { id: newId(), deckId, front: '', back: '', box: 0, due: '', createdAt: Date.now() };
  ctx.openSheet(`<h2>${isNew ? '新增字卡' : '編輯字卡'}</h2>
    <form data-form="card">
      <label class="field"><span>正面（問題）</span><textarea name="front" rows="2" required placeholder="例如：Nyquist rate">${esc(x.front)}</textarea></label>
      <label class="field"><span>背面（答案）</span><textarea name="back" rows="4" placeholder="例如：取樣頻率至少是訊號最高頻率的 2 倍">${esc(x.back)}</textarea></label>
      ${isNew ? '<label class="row sub"><input type="checkbox" name="again" checked> 存好後繼續新增下一張</label>' : ''}
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="card-del">刪除</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">${isNew ? '完成' : '取消'}</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'card', data: x, isNew });
  document.querySelector('#sheet [name=front]').focus();
}

function openBulkSheet(deckId) {
  ctx.openSheet(`<h2>整批貼上</h2>
    <form data-form="card-bulk">
      <div class="sub" style="margin-bottom:8px">一行一張，正面和背面用 <b>|</b> 或 Tab 隔開（Excel／Google 試算表兩欄直接複製貼上就是 Tab）。</div>
      <textarea name="text" rows="10" placeholder="Nyquist rate | 取樣頻率至少是最高頻率的 2 倍&#10;FFT | 快速傅立葉轉換，O(N log N)&#10;aliasing | 取樣太慢造成高頻變成假的低頻"></textarea>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">加入</button></div>
    </form>`, { kind: 'card-bulk', data: { deckId } });
  document.querySelector('#sheet [name=text]').focus();
}

export function parseBulk(text) {
  const out = [];
  let skipped = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)\s*(?:\t|\||｜)\s*(.*)$/.exec(line);
    if (!m || !m[1].trim()) { skipped++; continue; }
    out.push({ front: m[1].trim(), back: m[2].trim().replace(/\\n/g, '\n') });
  }
  return { cards: out, skipped };
}

// ---------- 表單 ----------
export const cardForms = {
  'card-deck': (form, f, data) => {
    const name = (f.name || '').trim();
    if (!name) return;
    saveDoc('decks', { ...data, name });
    ctx.closeSheet();
    ctx.toast('已儲存');
  },
  card: (form, f, data) => {
    const front = (f.front || '').trim();
    if (!front) return;
    saveDoc('cards', { ...data, front, back: (f.back || '').trim() });
    if (f.again) {
      openCardSheet(null, data.deckId);
      ctx.toast('已加入，繼續下一張');
    } else {
      ctx.closeSheet();
      ctx.toast('已儲存');
    }
  },
  'card-bulk': (form, f, data) => {
    const { cards, skipped } = parseBulk(f.text);
    if (!cards.length) { ctx.toast('沒有看到「正面 | 背面」格式的行'); return; }
    const t = Date.now();
    cards.forEach((c, i) => saveDoc('cards', { id: newId(), deckId: data.deckId, ...c, box: 0, due: '', createdAt: t + i }));
    ctx.closeSheet();
    ctx.toast(`加入 ${cards.length} 張${skipped ? `，${skipped} 行格式不對略過` : ''}`);
  },
};

// ---------- 動作 ----------
function startStudy(deckId, mode) {
  const cs = cardsOf(deckId);
  const due = cs.filter(isDue);
  let queue;
  if (mode === 'review') {
    if (!due.length) { ctx.toast('這組今天沒有到期的卡，改成全部翻一遍'); mode = 'browse'; queue = shuffle(cs.map(c => c.id)); }
    else queue = shuffle(due.map(c => c.id));
  } else queue = shuffle(cs.map(c => c.id));
  Object.assign(cardsUi, { deck: deckId, mode, queue, idx: 0, flipped: false, done: 0 });
  ctx.render();
  window.scrollTo(0, 0);
}

function grade(g) {
  const c = findCard(cardsUi.queue[cardsUi.idx]);
  if (!c) return;
  let box = c.box || 0;
  if (g === 0) box = 0;
  else if (g === 1) box = Math.max(1, box);
  else box = Math.min(box + 1, GAPS.length - 1);
  const gap = g === 0 ? 0 : g === 1 ? 1 : GAPS[box];
  saveDoc('cards', { ...c, box, due: addDays(today(), gap), lastAt: Date.now() });
  if (g === 0) cardsUi.queue.push(c.id);   // 不會的放到最後再考一次
  cardsUi.idx++;
  cardsUi.done++;
  cardsUi.flipped = false;
  ctx.render();
}

export const cardActions = {
  'card-deck-new': () => openDeckSheet(null),
  'card-deck-edit': el => openDeckSheet(findDeck(el.dataset.id)),
  'card-deck-open': el => { cardsUi.deck = el.dataset.id; ctx.render(); window.scrollTo(0, 0); },
  'card-deck-color': el => {
    ctx.sheetData().color = el.dataset.color;
    document.querySelector('#deck-colors').innerHTML = deckColors(el.dataset.color);
  },
  'card-deck-del': () => {
    const d = ctx.sheetData();
    const n = cardsOf(d.id).length;
    if (!confirm(`刪除卡組「${d.name}」${n ? `和裡面 ${n} 張字卡` : ''}？`)) return;
    for (const c of cardsOf(d.id)) removeDoc('cards', c.id);
    removeDoc('decks', d.id);
    cardsUi.deck = null;
    ctx.closeSheet();
    ctx.toast('已刪除');
  },
  'card-home': () => { cardsUi.deck = null; ctx.render(); },
  'card-new': el => openCardSheet(null, el.dataset.id),
  'card-bulk': el => openBulkSheet(el.dataset.id),
  'card-edit': el => { const c = findCard(el.dataset.id); if (c) openCardSheet(c); },
  'card-del': () => {
    const c = ctx.sheetData();
    if (!confirm('刪除這張字卡？')) return;
    removeDoc('cards', c.id);
    ctx.closeSheet();
  },
  'card-review': el => startStudy(el.dataset.id, 'review'),
  'card-browse': el => startStudy(el.dataset.id, 'browse'),
  'card-flip': () => { cardsUi.flipped = !cardsUi.flipped; ctx.render(); },
  'card-grade': el => grade(+el.dataset.g),
  'card-step': el => {
    cardsUi.idx = Math.max(0, cardsUi.idx + +el.dataset.dir);
    cardsUi.flipped = false;
    ctx.render();
  },
  'card-reverse': () => { cardsUi.reverse = !cardsUi.reverse; cardsUi.flipped = false; ctx.render(); },
  'card-exit': () => { cardsUi.mode = null; ctx.render(); window.scrollTo(0, 0); },
};

// 翻卡時的鍵盤操作（電腦上）
export function cardsKey(ev) {
  if (location.hash !== '#cards' || !cardsUi.mode) return false;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return false;
  const review = cardsUi.mode === 'review';
  if (ev.key === ' ') { cardActions['card-flip'](); return true; }
  if (review && cardsUi.flipped && ['1', '2', '3'].includes(ev.key)) { grade(+ev.key - 1); return true; }
  if (!review && ev.key === 'ArrowRight') { cardActions['card-step']({ dataset: { dir: 1 } }); return true; }
  if (!review && ev.key === 'ArrowLeft') { cardActions['card-step']({ dataset: { dir: -1 } }); return true; }
  return false;
}
