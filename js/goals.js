// 未來規劃（#goals）：主線、這週節奏、五個階段的里程碑、給自己的規則。
// 內容照 D:\Joseph整理\03_求職\未來規劃.pdf（2026/10/17）預先放好；勾選和自己加的都存在 prefs：
//   goalDone = { 里程碑id: 勾選時間 }、goalExtra = [{ id, stage, text }]、goalWeek = { 星期(0-6): 自己改的安排 }
import { store, newId, saveDoc, saveTodo, savePrefs } from './store.js';
import { esc, today, daysUntil, WEEKDAYS } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render }
export function initGoals(c) { ctx = c; }

export const goalsUi = { open: '' }; // 展開的階段（空的＝目前階段）

const GRAD = '2028-06-30';
const LINE = '會讓自走車／輪椅自己安全移動的人';
const PATH = '光達偵測 → 自主導航 → 腦波下高層指令';

const STAGES = [
  { id: 's1', name: '打底', from: '2026-09-06', to: '2027-01-10', range: '現在 → 2027/1', goal: '顧好課業，期中考後開始專題 A（光達行人偵測）', items: [
    ['g1a', 'Marathon 2 論文報告（10/21）'],
    ['g1b', '期中考（11/1–7）'],
    ['g1c', '去實驗室約 1 小時：錄光達資料包＋問清楚車子規格'],
    ['g1d', '在虛擬機裡會錄、會播放資料包'],
    ['g1e', '光達的點「分群」第一版'],
    ['g1f', '判斷哪一群是人（第一版）'],
    ['g1g', '機率基礎前半（葉丙成老師的機率課）'],
    ['g1h', '期末考（1/3–9）'],
  ] },
  { id: 's2', name: '第一個作品', from: '2027-01-11', to: '2027-02-21', range: '2027 寒假', goal: '專題 A 完成：偵測＋追蹤＋接上導航模擬', items: [
    ['g2a', '追蹤：每個人有編號，下一幀還跟得到'],
    ['g2b', '量出數字：準確率、每幀處理時間'],
    ['g2c', '接上導航模擬：看到人會繞開'],
    ['g2d', '程式碼公開＋說明文件＋展示影片'],
  ] },
  { id: 's3', name: '論文前半', from: '2027-02-22', to: '2027-08-31', range: '2027 春 → 暑假', goal: '把光達偵測搬到輪椅上，做避障和安全機制', items: [
    ['g3a', '搞懂輪椅控制器怎麼接（模擬搖桿電壓）'],
    ['g3b', '緊急停止＋看門狗（訊號斷了就自動停）'],
    ['g3c', '光達偵測搬到輪椅上'],
    ['g3d', '輪椅避障實測，拿到數據'],
    ['g3e', '線性代數：2D／3D 旋轉、座標轉換'],
  ] },
  { id: 's4', name: '論文主體', from: '2027-09-01', to: '2027-12-31', range: '2027 下半年', goal: '腦波只下高層指令（去哪裡），移動和避障交給自主導航', items: [
    ['g4a', '腦波指令 → 導航目的地'],
    ['g4b', '共享控制：腦波和自主導航一起決定怎麼走'],
    ['g4c', '完整實驗＋數據'],
    ['g4d', '開始寫論文'],
  ] },
  { id: 's5', name: '求職＋畢業', from: '2028-01-01', to: '2028-07-31', range: '2028 上半年', goal: '帶著 2 個作品＋論文去投履歷', items: [
    ['g5a', '履歷寫好（主線：光達偵測 → 輪椅 → 腦波）'],
    ['g5b', 'GitHub 首頁整理成作品集'],
    ['g5c', '刷題累積 150 題'],
    ['g5d', '投 104 上符合度高的職缺'],
    ['g5e', '論文口試'],
    ['g5f', '拿到錄取通知 🎉'],
  ] },
];

// 一週節奏：週二～四在學校很累不排事情，正事放週五～週一
const WEEK = {
  1: { t: '準備 meeting 報告＋刷題 1 題', h: 3 },
  2: { t: '休息（meeting＋上課到 18 點）', h: 0, rest: true },
  3: { t: '上午：寫作業或刷題 1 題', h: 2 },
  4: { t: '放鬆（全天課＋回台南）', h: 0, rest: true },
  5: { t: '複習這週的課、寫作業', h: 3 },
  6: { t: '專題日：自走車專題', h: 3 },
  0: { t: '專題 2 小時＋數學 1 小時＋刷題 1 題', h: 3.5 },
};
const ORDER = [1, 2, 3, 4, 5, 6, 0];

// 特別的日子：考試週專題暫停、放假專題加倍
const SPECIAL = [
  { from: '2026-11-01', to: '2026-11-07', t: '📝 期中考週：專題暫停，全部時間給考試' },
  { from: '2027-01-03', to: '2027-01-09', t: '📝 期末考週：專題暫停，全部時間給考試' },
  { from: '2027-01-11', to: '2027-02-21', t: '🏖️ 寒假：專題時間可以加倍，是做作品的主力時段' },
  { from: '2027-07-01', to: '2027-08-31', t: '🏖️ 暑假：專題時間可以加倍，是全年進度最快的時候' },
];

const RULES = [
  '想開新專案前先問：「這對自走車那條線有沒有幫助？」沒有就先記下來，等寒暑假再說。',
  'AI 最容易取代的是「只會寫一般程式」的工作；讓真實機器在真實環境穩定運作比較難取代。AI 是我的工具。',
  '作品一定要有數字（準確率、延遲、成功率），面試才答得出「你怎麼知道它有效」。',
  '累的日子休息不算偷懶，週五到週一做好就夠了。',
];

const done = () => store.prefs.goalDone || {};
const extra = () => store.prefs.goalExtra || [];
const weekText = dow => (store.prefs.goalWeek || {})[dow] ?? WEEK[dow].t;
const itemsOf = s => [...s.items.map(([id, text]) => ({ id, text })), ...extra().filter(x => x.stage === s.id).map(x => ({ ...x, mine: true }))];
const allItems = () => STAGES.flatMap(itemsOf);
const curStage = () => STAGES.find(s => today() <= s.to) || STAGES[STAGES.length - 1];
const special = (d = today()) => SPECIAL.find(x => d >= x.from && d <= x.to);
const nextItem = () => {
  const cur = curStage();
  for (const s of STAGES.slice(STAGES.indexOf(cur))) { const x = itemsOf(s).find(i => !done()[i.id]); if (x) return x; }
  return null;
};

function bar(n, total) {
  return `<div class="prog-bar"><div style="width:${total ? n / total * 100 : 0}%;background:var(--ok)"></div></div>`;
}

function itemRow(x) {
  const on = !!done()[x.id];
  return `<div class="gl-item ${on ? 'done' : ''}">
    <button type="button" class="check small ${on ? 'on' : ''}" data-action="goal-toggle" data-id="${x.id}">${on ? '✓' : ''}</button>
    <span class="text">${esc(x.text)}</span>
    ${x.mine ? `<button type="button" class="del" data-action="goal-del" data-id="${x.id}" aria-label="刪除">✕</button>` : ''}</div>`;
}

function stageBlock(s, i) {
  const cur = curStage();
  const list = itemsOf(s);
  const n = list.filter(x => done()[x.id]).length;
  const state = s.id === cur.id ? 'now' : today() > s.to ? 'past' : 'future';
  const open = (goalsUi.open || cur.id) === s.id;
  const tag = state === 'now' ? '<span class="gl-tag now">進行中</span>' : n === list.length ? '<span class="gl-tag ok">完成</span>' : '';
  return `<div class="gl-stage ${state}${open ? ' open' : ''}">
    <button type="button" class="gl-stage-head" data-action="goal-stage" data-id="${s.id}">
      <span class="gl-num">${'①②③④⑤'[i]}</span>
      <span class="gl-name"><b>${esc(s.name)}</b> ${tag}<small class="sub">${esc(s.range)}</small></span>
      <span class="sub">${n}/${list.length}</span><span class="gl-arrow">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? `<div class="gl-stage-body">
      <div class="sub gl-goal">🎯 ${esc(s.goal)}</div>
      ${bar(n, list.length)}
      ${list.map(itemRow).join('')}
      <form data-form="goal-add" data-id="${s.id}" class="add-goal"><input type="text" name="text" maxlength="60" autocomplete="off" placeholder="＋ 自己加一個里程碑"><button class="btn" type="submit">加入</button></form>
    </div>` : ''}
  </div>`;
}

function weekCard() {
  const dow = new Date().getDay();
  const sp = special();
  const total = ORDER.reduce((a, d) => a + WEEK[d].h, 0);
  return `<section class="card"><h2>📆 這週節奏 <span class="sub" style="font-weight:400">上課以外約 ${total} 小時</span></h2>
    ${sp ? `<div class="gl-special">${sp.t}</div>` : ''}
    <div class="gl-today ${WEEK[dow].rest ? 'rest' : ''}"><span class="sub">今天（週${WEEKDAYS[dow]}）</span><b>${esc(weekText(dow))}</b>${WEEK[dow].h ? `<span class="sub">${WEEK[dow].h} 小時</span>` : ''}</div>
    <div class="gl-week">${ORDER.map(d => `<button type="button" class="gl-day ${d === dow ? 'today' : ''} ${WEEK[d].rest ? 'rest' : ''}" data-action="goal-week-edit" data-dow="${d}" title="點一下修改">
      <span class="gl-dow">${WEEKDAYS[d]}</span><span class="gl-dt">${esc(weekText(d))}</span></button>`).join('')}</div>
    <div class="sub" style="margin-top:8px">點任何一天可以改內容。室友太吵的話，耳塞或降噪耳機很值得買。</div>
  </section>`;
}

export function renderGoals() {
  const items = allItems();
  const n = items.filter(x => done()[x.id]).length;
  const cur = curStage();
  const left = daysUntil(GRAD);
  const nx = nextItem();
  return `<div class="page-head"><h1>未來規劃</h1></div>
  <div class="grid">
    <section class="card gl-hero">
      <div class="sub">我的主線</div>
      <div class="gl-line">${LINE}</div>
      <div class="sub">${PATH}</div>
      <div class="gl-stats">
        <div><b>${left}</b><span>天後畢業</span></div>
        <div><b>${'①②③④⑤'[STAGES.indexOf(cur)]} ${esc(cur.name)}</b><span>目前階段</span></div>
        <div><b>${n}/${items.length}</b><span>里程碑</span></div>
      </div>
      ${bar(n, items.length)}
      ${nx ? `<div class="gl-next">👉 下一步：<b>${esc(nx.text)}</b></div>` : '<div class="gl-next">🎉 全部完成！</div>'}
    </section>
    ${weekCard()}
    <section class="card"><h2>🗺️ 路線圖 <span class="sub" style="font-weight:400">點階段可以展開</span></h2>
      ${STAGES.map(stageBlock).join('')}</section>
    <section class="card"><h2>🧭 給自己的規則</h2>
      <ol class="gl-rules">${RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
      <button type="button" class="btn" data-action="goal-idea">💡 我想開一個新專案…</button>
      <div class="sub" style="margin-top:10px">完整版（含時間軸和補數學順序）：D:\\Joseph整理\\03_求職\\未來規劃.pdf</div>
    </section>
  </div>`;
}

// 首頁一行：今天照節奏做什麼＋下一個里程碑
export function homeGoalCard() {
  const dow = new Date().getDay();
  const sp = special();
  const nx = nextItem();
  return `<a href="#goals" class="quote-mini gl-home">🧭 ${sp ? esc(sp.t.replace(/^\S+\s/, '')) : `今天：${esc(weekText(dow))}`}${nx ? ` · 下一步：${esc(nx.text)}` : ''} ›</a>`;
}

// ---------- 新專案檢查 ----------
function openIdea() {
  ctx.openSheet(`<h2>💡 想開新專案？</h2>
    <form data-form="goal-idea">
      <label class="field"><span>想做什麼</span><input type="text" name="text" maxlength="80" autocomplete="off" placeholder="例如：做一個 NDS 小遊戲" required></label>
      <div class="gl-ask">這對「<b>${LINE}</b>」這條線有沒有幫助？</div>
      <div class="actions" style="flex-wrap:wrap">
        <button type="button" class="btn" data-action="close-sheet">算了</button>
        <span class="spacer"></span>
        <button type="submit" class="btn" name="go" value="later">沒有 → 存到隨手記，寒暑假再說</button>
        <button type="submit" class="btn primary" name="go" value="todo">有 → 加進待辦</button>
      </div>
    </form>`, { kind: 'goal-idea' });
  requestAnimationFrame(() => document.querySelector('#sheet [name=text]')?.focus());
}

export const goalsForms = {
  'goal-add': (form, f) => {
    const text = String(f.text || '').trim();
    if (!text) return;
    form.querySelector('[name=text]').value = '';
    savePrefs({ goalExtra: [...extra(), { id: newId(), stage: form.dataset.id, text }] });
  },
  'goal-idea': (form, f, _data, submitter) => {
    const text = String(f.text || '').trim();
    if (!text) return;
    if (submitter?.value === 'todo') {
      saveTodo({ id: newId(), title: text, type: 'study', courseId: '', due: '', note: '主線相關（從未來規劃加入）', done: false, steps: [], createdAt: Date.now() });
      ctx.toast('✅ 加進待辦了');
    } else {
      saveDoc('memos', { id: newId(), text, tags: ['之後再說'], pinned: false, createdAt: Date.now() });
      ctx.toast('📝 存到隨手記 #之後再說，寒暑假再拿出來看');
    }
    ctx.closeSheet();
  },
};

export const goalsActions = {
  'goal-toggle': el => {
    const d = { ...done() };
    const on = !d[el.dataset.id];
    if (on) d[el.dataset.id] = Date.now(); else delete d[el.dataset.id];
    savePrefs({ goalDone: d });
    if (on) ctx.toast('👍 又前進一步了');
  },
  'goal-del': el => {
    const x = extra().find(y => y.id === el.dataset.id);
    if (!x || !confirm(`刪掉「${x.text}」？`)) return;
    const d = { ...done() };
    delete d[x.id];
    savePrefs({ goalExtra: extra().filter(y => y.id !== x.id), goalDone: d });
  },
  'goal-stage': el => {
    const cur = goalsUi.open || curStage().id;
    goalsUi.open = cur === el.dataset.id ? '-' : el.dataset.id;
    ctx.render();
  },
  'goal-week-edit': el => {
    const dow = +el.dataset.dow;
    const v = prompt(`週${WEEKDAYS[dow]}要做什麼？（清空＝恢復預設）`, weekText(dow));
    if (v == null) return;
    const w = { ...(store.prefs.goalWeek || {}) };
    if (v.trim() && v.trim() !== WEEK[dow].t) w[dow] = v.trim().slice(0, 40); else delete w[dow];
    savePrefs({ goalWeek: w });
  },
  'goal-idea': openIdea,
};
