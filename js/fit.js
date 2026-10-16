// 🏋️ 健身（#fit）：今天要練什麼＋每組記重量次數、一週課表、動作庫（動圖＋練哪裡＋怎麼做）、InBody 身體數據。
// 資料：workouts 集合 { id: 'w-日期-課表', date, day: 'A'..'D', sets: { 動作id: [{ w, r }|null, …] }, done, doneAt }
//       body 集合 { id, date, weight, smm, pbf, fat, visceral, score, note }
//       habits 集合 { id: 'h-日期', date, items: { protein: true, … } }＝每天打勾
// 第一次打開時把 2026-08-31 的 InBody 放進 body（prefs.fitSeeded）。
import { store, saveDoc, removeDoc, savePrefs } from './store.js';
import { esc, today, addDays, parseYmd, fmtDate, WEEKDAYS } from './util.js';
import { PARTS, KITS, EX, exById, PLAN, FIRST_BODY, GOAL, CHALLENGE, HABITS, KINDS, WEEK_GOAL } from './fit-data.js';

let ctx = null; // { openSheet, closeSheet, toast, render }
export function initFit(c) { ctx = c; }

// tab: today | log | plan | lib | body；day: 今天選的課表（'' = 今天有練過的那份，沒有就顯示「選一份」；'?' = 強制選一份）
export const fitUi = { tab: 'today', day: '', part: 'all', kit: 'mine', hday: '' };

const workouts = () => store.state.workouts || [];
const habitOf = date => (store.state.habits || []).find(h => h.id === `h-${date}`);
const bodies = () => [...(store.state.body || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
const planOf = id => PLAN.find(p => p.id === id);
// 有動過（打勾任何一組或按完成）的訓練
const used = w => w.done || Object.values(w.sets || {}).some(a => a?.some(Boolean));
const wOn = date => workouts().filter(x => x.date === date && used(x));
const lastDate = id => workouts().filter(x => x.day === id && x.done).map(x => x.date).sort().pop() || '';
const daysAgo = d => Math.round((parseYmd(today()) - parseYmd(d)) / 86400000);
const agoText = d => (!d ? '還沒練過' : daysAgo(d) === 0 ? '今天練過' : daysAgo(d) === 1 ? '昨天練過' : `${daysAgo(d)} 天前練過`);
const isUpper = p => p && (p.kind === 'upper' || p.kind === 'full');

// 今天要顯示哪一份
function curPlan() {
  if (fitUi.day === '?') return null;
  if (fitUi.day) return planOf(fitUi.day);
  const w = wOn(today()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).find(x => !x.done) || wOn(today())[0];
  return w ? planOf(w.day) : null;
}

// 推薦順序：越久沒練越前面、上半身加分；同一份隔 48 小時；週二、三在學校 → 健身房那兩份優先；腿不連兩天
function recommend() {
  const t = today();
  const wd = parseYmd(t).getDay();
  const atSchool = wd === 2 || wd === 3;
  const yest = wOn(addDays(t, -1)).map(w => planOf(w.day));
  const score = p => {
    const ld = lastDate(p.id);
    const ago = ld ? daysAgo(ld) : 8;
    let s = Math.min(ago, 8);
    if (ago < 2) s -= 10;
    if (isUpper(p)) s += 2;
    if ((p.kind === 'gym') !== atSchool) s -= 20;
    if (p.kind === 'lower' && yest.some(y => y?.kind === 'lower' || y?.kind === 'full')) s -= 6;
    return s;
  };
  return [...PLAN].sort((a, b) => score(b) - score(a));
}
const wid = (date, day) => `w-${date}-${day}`;
const partOf = id => PARTS.find(p => p.id === id);
const UNIT = { kg: '下', bw: '下', sec: '秒', min: '分' };

// ---------- 第一次的 InBody ----------
let seeding = false;
function seed() {
  if (seeding || !store.ready || (store.cloudAvailable && store.mode !== 'cloud') || store.prefs.fitSeeded) return;
  seeding = true;
  try {
    if (!(store.state.body || []).some(b => b.id === FIRST_BODY.id)) saveDoc('body', { ...FIRST_BODY, createdAt: Date.now() });
    savePrefs({ fitSeeded: true });
  } finally { seeding = false; }
}

// ---------- 小元件 ----------
// 兩張圖交替＝動圖
function anim(e, cls = '') {
  const src = i => `img/ex/${e.img}-${i}.jpg`;
  return `<div class="fx-anim ${cls}"><img src="${src(0)}" alt="${esc(e.name)}" loading="lazy"><img class="b" src="${src(1)}" alt="" loading="lazy"></div>`;
}
const muscleChips = e => `${e.prim.map(m => `<span class="fx-m prim">${esc(m)}</span>`).join('')}${e.sec.map(m => `<span class="fx-m">${esc(m)}</span>`).join('')}`;
const kitTag = e => `<span class="fx-tag kit-${e.kit}">${KITS.find(k => k.id === e.kit)?.label || ''}${e.kit === 'gym' ? '（以後再說）' : ''}</span>`;
const imgNote = e => (e.imgNote ? `<div class="sub fx-imgnote">📷 ${esc(e.imgNote)}</div>` : '');
// 脊椎側彎標記
const SPINE = { avoid: '⛔ 側彎不建議', care: '⚠️ 側彎要小心', good: '🦴 對側彎好' };
const spineTag = e => (e.spine ? `<span class="fx-tag spine-${e.spine}">${SPINE[e.spine]}</span>` : '');
const spineLine = e => (e.spine && e.spine !== 'good' ? `<div class="fx-spine spine-${e.spine}">${SPINE[e.spine]}：${esc(e.spineNote)}</div>` : '');
const range = it => {
  const u = exById(it.ex).unit;
  const r = it.lo === it.hi ? `${it.lo}` : `${it.lo}–${it.hi}`;
  return u === 'min' ? `${r} 分鐘` : `${it.sets} 組 × ${r} ${u === 'sec' ? '秒' : '下'}${it.each ? '（每邊）' : ''}`;
};
const restText = s => (s >= 120 ? `${s / 60} 分` : s >= 60 ? `${s / 60 === 1 ? '1 分' : `${s} 秒`}` : `${s} 秒`);

// 這週（週一開始）練完的
function weekStart(d = today()) { const n = (parseYmd(d).getDay() + 6) % 7; return addDays(d, -n); }
function weekDone() {
  const from = weekStart(), to = addDays(from, 6);
  return workouts().filter(w => w.done && w.date >= from && w.date <= to);
}

// 上一次（今天以前）做這個動作的紀錄
function lastSets(exId, before) {
  const w = workouts().filter(x => x.date < before && x.sets?.[exId]?.some(Boolean)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return w ? { date: w.date, sets: w.sets[exId] } : null;
}

// 加重的方法（依器材）
const ADD = { db: '每顆啞鈴加 1 片（約 +2.5～3 kg）；已經 9 kg 了就放慢 3 秒、多停 1 秒', bb: '槓鈴兩邊各加一片', kb: '壺鈴只有 8 kg：下去放慢到 3 秒、底下停 1 秒，或改用比較重的啞鈴', mb: '換重 1～2 kg 的球，或每組多 3 下' };
function suggest(it, last) {
  const e = exById(it.ex);
  if (!last) return e.unit === 'kg' ? `第一次：${it.start ? `建議 <b>${it.start}</b>，` : ''}選「做完還能再做 1–2 下」的重量` : '';
  const done = last.sets.filter(Boolean);
  const reps = done.map(s => s.r).join('/');
  const head = `上次 ${fmtDate(last.date, false)}：${e.unit === 'kg' && done[0]?.w ? `${done[0].w} kg × ` : ''}${reps} ${UNIT[e.unit]}`;
  const allTop = done.length >= it.sets && done.every(s => +s.r >= it.hi);
  if (e.unit === 'kg') return `${head}　👉 ${allTop ? `<b>每組都到 ${it.hi} 下了，這次加重</b>（${ADD[e.kit] || '+1～2 kg'}）` : '同重量，試著多做 1 下'}`;
  return `${head}　👉 ${allTop ? '<b>到上限了，下次加難度或加時間</b>' : '試著多 1 下／多 5 秒'}`;
}

// ---------- 每天打勾 ----------
const dayNo = d => Math.round((parseYmd(d) - parseYmd(CHALLENGE.start)) / 86400000) + 1;
const habitScore = date => { const h = habitOf(date); return HABITS.filter(x => h?.items?.[x.id]).length; };

function habitCard(compact = false) {
  const t = today();
  const d = !compact && fitUi.hday && fitUi.hday <= t ? fitUi.hday : t;
  const h = habitOf(d);
  const n = habitScore(d);
  const no = dayNo(d);
  const dn = wOn(d).filter(w => w.done);
  const rows = HABITS.map(x => {
    const on = !!h?.items?.[x.id];
    return `<button type="button" class="hb${on ? ' on' : ''}" data-action="fit-habit" data-date="${d}" data-h="${x.id}">
      <span class="box">${on ? '✓' : ''}</span><span class="ic">${x.icon}</span><span class="t">${esc(x.label)}${!compact && x.hint ? `<small>${esc(x.hint)}</small>` : ''}</span></button>`;
  }).join('');
  const train = `<div class="hb-train">${dn.length ? `✅ 練了 ${dn.map(w => `${w.day} ${esc(planOf(w.day)?.name || '')}`).join('、')}` : '🏋️ 還沒練：想練就在下面選一份，休息日走路就好'}</div>`;
  return `<section class="card fit-habits">
    <h2>✅ ${d === t ? '今天' : fmtDate(d)}打勾 <span class="sub" style="font-weight:400">${no >= 1 && no <= CHALLENGE.days ? `30 天挑戰第 ${no} 天 · ` : ''}${n}/${HABITS.length}</span>${
      compact ? ' <a href="#fit" data-action="fit-go" class="sub" style="font-weight:400">健身 ›</a>' : ''}</h2>
    <div class="prog-bar"><div style="width:${n / HABITS.length * 100}%;background:var(--ok)"></div></div>
    <div class="hb-list${compact ? ' compact' : ''}">${rows}</div>
    ${compact ? '' : train}
    ${d !== t ? '<div style="margin-top:8px"><button type="button" class="btn small" data-action="fit-hday" data-date="">回到今天</button></div>' : ''}
  </section>`;
}

function challengeCard() {
  const t = today();
  const days = Array.from({ length: CHALLENGE.days }, (_, i) => addDays(CHALLENGE.start, i));
  const cells = days.map((d, i) => {
    const n = habitScore(d);
    const trained = workouts().some(x => x.date === d && x.done);
    const future = d > t;
    const lv = future ? 'f' : n === 0 ? 0 : n >= HABITS.length ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : 1;
    const sel = d === (fitUi.hday || t);
    return `<button type="button" class="cg lv${lv}${d === t ? ' today' : ''}${sel ? ' sel' : ''}" ${future ? 'disabled' : `data-action="fit-hday" data-date="${d}"`} title="${fmtDate(d)} ${n}/${HABITS.length}"><span>${i + 1}</span>${trained ? '<i>💪</i>' : ''}</button>`;
  }).join('');
  const full = days.filter(d => d <= t && habitScore(d) >= HABITS.length).length;
  const end = days[days.length - 1];
  return `<section class="card"><h2>📅 30 天挑戰 <span class="sub" style="font-weight:400">${fmtDate(CHALLENGE.start, false)}～${fmtDate(end, false)} · 全勾 ${full} 天</span></h2>
    <div class="cg-grid">${cells}</div>
    <div class="sub" style="margin-top:8px">顏色越深＝勾越多，💪＝那天有練完。點格子可以補勾之前的日子。${t >= end ? '<b>挑戰結束了！去量一次 InBody，填在「身體」。</b>' : `最後一天（${fmtDate(end, false)}）再量一次 InBody 對照。`}</div></section>`;
}

// ---------- 今天 ----------
const draft = {}; // 還沒按 ✓ 的輸入（重畫時不要不見）

function setRow(day, date, it, i, cur, last) {
  const e = exById(it.ex);
  const k = `${it.ex}:${i}`;
  const s = cur?.[i];
  const prev = last?.sets?.[i] || last?.sets?.filter(Boolean).slice(-1)[0];
  const d = draft[`${date}:${k}`] || {};
  const w = s?.w ?? d.w ?? prev?.w ?? '';
  const r = s?.r ?? d.r ?? prev?.r ?? it.lo;
  const id = `${date}|${day}|${k}`;
  return `<form class="fx-set${s ? ' ok' : ''}" data-form="fit-set" data-id="${esc(id)}">
    <span class="n">${it.sets > 1 ? `第 ${i + 1} 組` : '完成'}</span>
    ${e.unit === 'kg' ? `<input type="number" name="w" inputmode="decimal" step="0.5" min="0" value="${esc(String(w))}" placeholder="重量" data-fit-draft="${esc(`${date}:${k}`)}" ${s ? 'disabled' : ''}><span class="u">kg ×</span>` : ''}
    <input type="number" name="r" inputmode="numeric" min="0" value="${esc(String(r))}" data-fit-draft="${esc(`${date}:${k}`)}" ${s ? 'disabled' : ''}><span class="u">${UNIT[e.unit]}</span>
    <span class="spacer"></span>
    ${s ? `<button type="button" class="check on" data-action="fit-unset" data-id="${esc(id)}" title="取消這組">✓</button>`
      : '<button type="submit" class="check" title="做完這組">✓</button>'}
  </form>`;
}

function exBlock(p, date, it, n) {
  const e = exById(it.ex);
  const w = workouts().find(x => x.id === wid(date, p.id));
  const cur = w?.sets?.[it.ex];
  const last = lastSets(it.ex, date);
  const doneN = (cur || []).filter(Boolean).length;
  const sets = it.ex === 'walk' ? 1 : it.sets;
  const finished = doneN >= sets;
  return `<section class="card fx${finished ? ' finished' : ''}">
    <div class="fx-top">
      <button type="button" class="fx-pic" data-action="fit-ex" data-ex="${e.id}">${anim(e)}<span class="fx-zoom">怎麼做 ›</span></button>
      <div class="fx-info">
        <div class="fx-name"><span class="fx-no">${n}</span>${esc(e.name)}${finished ? ' <span class="ok">✓</span>' : ''}</div>
        <div class="fx-muscles">${muscleChips(e)}</div>
        <div class="fx-goal"><b>${range(it)}</b>${it.rest ? ` · 休息 ${restText(it.rest)}` : ''}${it.note ? ` · ${esc(it.note)}` : ''}</div>
        ${imgNote(e)}
      </div>
    </div>
    ${spineLine(e)}
    ${suggest(it, last) ? `<div class="fx-last">${suggest(it, last)}</div>` : ''}
    <div class="fx-sets">${Array.from({ length: sets }, (_, i) => setRow(p.id, date, it, i, cur, last)).join('')}</div>
  </section>`;
}

function weekStrip() {
  const t = today();
  const from = weekStart();
  const dn = weekDone();
  const up = dn.filter(w => isUpper(planOf(w.day))).length;
  const cells = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(from, i);
    const ws = workouts().filter(w => w.date === d && w.done);
    const p = ws[0] && planOf(ws[0].day);
    return `<div class="fw${d === t ? ' today' : ''}${p ? ' ok' : ' rest'}" style="${p ? `--c:${p.color}` : ''}">
      <span class="wd">${WEEKDAYS[parseYmd(d).getDay()]}</span><span class="dot">${ws.length ? ws.map(w => w.day).join('') : d < t ? '·' : ''}</span><span class="nm">${p ? KINDS[p.kind] : d === t ? '今天' : ''}</span></div>`;
  }).join('');
  return `<div class="fit-week">${cells}</div>
    <div class="fit-goal sub">這週練了 <b>${dn.length}</b>/${WEEK_GOAL.total} 次 · 上半身 <b>${up}</b>/${WEEK_GOAL.upper} 次${dn.length >= WEEK_GOAL.total && up >= WEEK_GOAL.upper ? ' 🎉 達標' : ''}</div>`;
}

function pickCard() {
  const rec = recommend();
  return `<section class="card"><h2>🏋️ 今天想練哪一份？</h2>
    <div class="sub">沒有固定星期，想練什麼就選什麼。⭐ 是照「多久沒練」幫你挑的，上半身會優先。</div>
    <div class="fit-pick">${rec.map((p, i) => `<button type="button" class="fit-pk" data-action="fit-day" data-day="${p.id}" style="--c:${p.color}">
      <span class="fit-badge">${p.id}</span><span class="t"><b>${i === 0 ? '⭐ ' : ''}${esc(p.name)}</b>
      <span class="sub">${esc(p.where)} · ${p.mins} 分 · ${agoText(lastDate(p.id))}</span></span><span class="r">›</span></button>`).join('')}</div>
    <div class="sub" style="margin-top:8px">同一份最好隔一天；上半身「推」和「拉」練不同肌肉，可以連兩天。想休息就走路＋做脊椎伸展。</div></section>`;
}

function todayTab() {
  const t = today();
  const p = curPlan();
  const head = `${weekStrip()}${habitCard()}`;
  if (!p) return `${head}${pickCard()}${challengeCard()}`;
  const w = workouts().find(x => x.id === wid(t, p.id));
  const total = p.list.length;
  const fin = p.list.filter(it => ((w?.sets?.[it.ex]) || []).filter(Boolean).length >= (it.ex === 'walk' ? 1 : it.sets)).length;
  return `${head}
    <section class="card fit-dayhead" style="--c:${p.color}">
      <div class="row"><span class="fit-badge">${p.id}</span><div style="flex:1"><b>${esc(p.name)}</b>
        <div class="sub">${esc(p.where)} · 約 ${p.mins} 分鐘 · ${agoText(lastDate(p.id))}</div></div>
        <div class="fit-count"><b>${fin}</b>/${total}</div></div>
      <div class="prog-bar" style="margin-top:8px"><div style="width:${fin / total * 100}%;background:${p.color}"></div></div>
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button type="button" class="btn small" data-action="fit-day" data-day="?">↺ 換一份</button></div>
      <div class="fit-warm">🔥 先熱身：開合跳／原地踏步 3 分鐘 → 貓牛式 10 下、手臂繞圈 → 第一個動作先用輕重量做 1–2 組</div>
      <div class="fit-warm" style="margin-top:6px">🦴 脊椎側彎：動作慢、背打直、左右做一樣多。<b>刺痛、麻、背痛變嚴重就停</b>，酸是正常的。</div>
    </section>
    <div id="fit-rest" class="fit-rest" hidden></div>
    ${p.list.map((it, i) => exBlock(p, t, it, i + 1)).join('')}
    ${noteCard(t, p.id, w)}
    <section class="card"><div class="row">
      ${w?.done ? `<span>✅ 練完了！${w.doneAt ? `<span class="sub">（${new Date(w.doneAt).toTimeString().slice(0, 5)}）</span>` : ''}</span><span class="spacer"></span><button type="button" class="btn small" data-action="fit-finish" data-day="${p.id}">取消完成</button>`
        : `<span class="sub">做完後記得補充蛋白質（乳清、雞胸、豆漿、茶葉蛋）</span><span class="spacer"></span><button type="button" class="btn primary" data-action="fit-finish" data-day="${p.id}">完成這次訓練</button>`}
    </div></section>
    ${challengeCard()}`;
}

// ---------- 心得 ----------
export const FEELS = [
  { id: 'tired', label: '😫 很累' },
  { id: 'ok', label: '😐 普通' },
  { id: 'good', label: '🙂 不錯' },
  { id: 'great', label: '💪 超有力' },
];
const feelOf = id => FEELS.find(f => f.id === id);

function noteForm(date, day, w, inSheet = false) {
  const id = `${date}|${day}`;
  return `<div class="chips fit-feels">${FEELS.map(f => `<button type="button" data-action="fit-feel" data-id="${esc(id)}" data-feel="${f.id}" class="${w?.feel === f.id ? 'on' : ''}">${f.label}</button>`).join('')}</div>
    <form data-form="fit-note" data-id="${esc(id)}"${inSheet ? ' data-sheet="1"' : ''}>
      <textarea name="note" rows="4" maxlength="2000" placeholder="例如：臥推 40 kg 第三組很吃力、深蹲膝蓋有點怪、今天精神很好多做一組、練完吃了雞胸便當…">${esc(w?.note || '')}</textarea>
      <div class="actions"><span class="sub">${w?.noteAt ? `上次存：${new Date(w.noteAt).toTimeString().slice(0, 5)}` : ''}</span><span class="spacer"></span>
        ${inSheet ? '<button type="button" class="btn" data-action="close-sheet">取消</button>' : ''}<button type="submit" class="btn primary">存心得</button></div>
    </form>`;
}
function noteCard(date, day, w) {
  return `<section class="card fit-note"><h2>📝 今天的心得 <span class="sub" style="font-weight:400">感覺怎麼樣？</span></h2>${noteForm(date, day, w)}</section>`;
}

// 一次訓練的摘要：每個動作 重量 × 次數
function setsSummary(w) {
  const p = planOf(w.day);
  const order = p ? p.list.map(it => it.ex) : [];
  const keys = Object.keys(w.sets || {}).filter(k => w.sets[k]?.some(Boolean)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return keys.map(k => {
    const e = exById(k);
    const ss = w.sets[k].filter(Boolean);
    const ws = [...new Set(ss.map(x => x.w).filter(Boolean))];
    return `<div class="fit-ls"><span>${esc(e?.name || k)}</span><span class="sub">${ws.length ? `${ws.join('/')} kg × ` : ''}${ss.map(x => x.r).join('/')} ${UNIT[e?.unit] || '下'}</span></div>`;
  }).join('');
}

function logTab() {
  const list = workouts().filter(w => w.done || w.note || w.feel || Object.values(w.sets || {}).some(a => a?.some(Boolean)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const month = today().slice(0, 7);
  const nMonth = list.filter(w => w.done && w.date.startsWith(month)).length;
  const head = `<section class="card"><div class="fit-stats">
    <div><b>${list.filter(w => w.done).length}</b><span class="sub">總共練完</span></div>
    <div><b>${nMonth}</b><span class="sub">這個月</span></div>
    <div><b>${weekDone().length}</b><span class="sub">這週</span></div></div></section>`;
  if (!list.length) return `${head}<section class="card"><div class="empty">還沒有紀錄。練完在「今天」最下面寫心得，就會出現在這裡。</div></section>`;
  return head + list.map(w => {
    const p = planOf(w.day);
    const f = feelOf(w.feel);
    return `<section class="card fit-log" style="--c:${p?.color || '#94a3b8'}">
      <div class="row"><span class="fit-badge">${esc(w.day)}</span><div style="flex:1;min-width:0"><b>${fmtDate(w.date)}</b> ${p ? esc(p.name) : ''}
        <div class="sub">${w.done ? '✅ 練完' : '⏳ 沒按完成'}${f ? ` · ${f.label}` : ''}</div></div>
        <button type="button" class="btn small" data-action="fit-note-edit" data-id="${esc(`${w.date}|${w.day}`)}">${w.note ? '編輯' : '寫心得'}</button></div>
      ${w.note ? `<div class="fit-note-text">${esc(w.note)}</div>` : ''}
      ${setsSummary(w) ? `<details class="fit-det"><summary class="sub">做了哪些（${Object.values(w.sets || {}).filter(a => a?.some(Boolean)).length} 個動作）</summary>${setsSummary(w)}</details>` : ''}
    </section>`;
  }).join('');
}

// ---------- 課表 ----------
function planTab() {
  const day = p => `<section class="card fit-plan" style="--c:${p.color}">
    <h2><span class="fit-badge">${p.id}</span> ${esc(p.name)} <span class="sub" style="font-weight:400">${esc(p.where)} · ${p.mins} 分</span></h2>
    ${p.list.map(it => { const e = exById(it.ex); return `<button type="button" class="fit-pl" data-action="fit-ex" data-ex="${e.id}">
      ${anim(e, 'mini')}<span class="t"><b>${esc(e.name)}</b><span class="sub">${e.prim.join('、')}</span></span><span class="r">${range(it)}</span></button>`; }).join('')}
  </section>`;
  const eg = [['一', 'A'], ['二', 'B'], ['三', 'C'], ['四', 'F'], ['五', 'D'], ['六', 'E'], ['日', '']].map(([wd, id]) => {
    const p = planOf(id);
    return `<tr><td>週${wd}</td><td>${p ? `<b style="color:${p.color}">${p.id}</b> ${esc(p.name)}` : '<span class="sub">休息（走路 8000 步）</span>'}</td><td>${p ? esc(p.where) : '—'}</td></tr>`;
  }).join('');
  return `<section class="card"><h2>🗓️ 自由排，規則只有這幾條</h2>
      <ul class="fit-ul"><li>每週目標 <b>${WEEK_GOAL.total} 次以上</b>，其中<b>上半身（A 推、F 拉、E 全身）${WEEK_GOAL.upper} 次</b></li>
        <li><b>同一份隔一天</b>（肌肉需要 48 小時恢復）；A 推和 F 拉練不同肌肉，<b>可以連兩天</b></li>
        <li><b>腿（D）不要連兩天</b></li>
        <li>週二、三在學校就做 B／C（健身房）；不想去就回家練 A、F</li>
        <li>「今天」頁會照多久沒練幫你排 ⭐，點一下就開始</li></ul></section>
    <section class="card"><h2>📅 排法參考 <span class="sub" style="font-weight:400">不用照著做</span></h2>
      <table class="fit-table"><tr><th>星期</th><th>內容</th><th>地點</th></tr>${eg}</table>
      <div class="sub" style="margin-top:8px">這樣一週上半身 3 次（A、F、E）。想再多練上半身，休息日加一次 A 或 F 也可以，只要跟上一次同一份隔一天。</div></section>
    <div class="grid two">${PLAN.map(day).join('')}</div>
    <section class="card"><h2>🫣 不敢用健身房的機器？</h2>
      <ul class="fit-ul"><li><b>完全沒關係。</b>肌肉不知道你用的是機器還是自己家的啞鈴，重量夠、次數夠就會長。這份課表的肌肉訓練都在家做。</li>
        <li>在健身房就做你習慣的：<b>跑步機、健身車、藥球</b>。藥球區和墊子區通常人比較少。</li>
        <li>大家都在看自己的手機和鏡子，其實沒人在看你。戴耳機會比較自在。</li>
        <li>想挑戰的話，人少的時段（平日下午 2–5 點）可以先試<b>滑輪下拉</b>：坐著、插銷調重量，是最好上手的機器。不想試也完全 OK。</li></ul></section>
    <section class="card"><h2>📈 重量怎麼選、怎麼進步</h2>
      <table class="fit-table">
        <tr><td>選重量</td><td>做完一組時<b>還能再做 1–2 下</b>就是對的重量</td></tr>
        <tr><td>進步</td><td>例如 8–12 下：每組都做到 12 下 → 下次加重，從 8 下重新往上做（這頁會自動提醒你）。壺鈴和藥球重量固定，就加次數，或換重一點的</td></tr>
        <tr><td>頭兩週</td><td>每個動作只做 <b>2 組</b>，先把動作學好，避免痠到不想動</td></tr>
        <tr><td>休息</td><td>主項 2 分鐘、其他 60–90 秒（按 ✓ 會自動倒數）</td></tr>
        <tr><td>熱身</td><td>動態伸展 5 分鐘＋輕重量暖身 1–2 組</td></tr>
      </table></section>
    <section class="card"><h2>🦴 脊椎側彎注意事項</h2>
      <ul class="fit-ul"><li><b>先給復健科或物理治療師看一次</b>，問自己的側彎角度、哪些動作要避免。角度超過 20 度或常常背痛，一定要先問。</li>
        <li><b>不要讓重量直接往下壓脊椎</b>：槓鈴不扛背上深蹲、過頭推用輕重量。課表已經換成高腳杯深蹲（重量在胸前）。</li>
        <li><b>不要負重轉身</b>：俄羅斯轉體已經拿掉。</li>
        <li><b>彎腰的動作要有支撐</b>：划船改成一手撐床的單手划船。</li>
        <li><b>左右做一樣多</b>；有一邊明顯比較弱，弱的那邊多做一組。</li>
        <li><b>多練核心</b>：側棒式、死蟲式、棒式、臀橋都不壓脊椎，對側彎很好。</li>
        <li>每天做 <b>5 分鐘脊椎伸展</b>（打勾清單裡有）：貓牛式、嬰兒式。</li>
        <li><b>酸是正常的；刺痛、麻、背痛變嚴重就停</b>，去看醫生。</li>
        <li>動作庫裡每個動作都有標：⛔ 不建議、⚠️ 要小心、🦴 對側彎好。</li></ul></section>
    <section class="card"><h2>⚠️ 在家練的安全</h2>
      <ul class="fit-ul"><li>槓鈴<b>不要扛上肩深蹲</b>（沒有架子很危險），練腿用壺鈴高腳杯深蹲和啞鈴分腿蹲。</li>
        <li>沒有健身椅：胸做<b>地板臥推</b>，划船和三頭伸展用<b>床沿</b>撐或坐。</li>
        <li>啞鈴片插上槓之後，兩邊的螺帽一定要<b>鎖緊</b>，每組做之前檢查一下。</li>
        <li>壺鈴擺盪前，確認前後<b>沒有東西和人</b>。</li>
        <li>划船、硬舉時<b>背一拱起來就停</b>，代表太重了。</li></ul></section>
    <section class="card"><h2>🍱 搭配飲食</h2>
      <table class="fit-table">
        <tr><td>熱量</td><td>每天約 <b>1700–1800 kcal</b>（基礎代謝 1469，不要吃更少）</td></tr>
        <tr><td>蛋白質</td><td>每天 <b>110–120 g</b>：雞胸 100 g≈23 g、蛋 1 顆≈7 g、無糖豆漿 400 ml≈14 g、乳清 1 匙≈20–25 g、板豆腐半盒≈17 g</td></tr>
        <tr><td>練完</td><td>2 小時內吃一餐有蛋白質的（便當＋茶葉蛋、乳清＋香蕉）</td></tr>
        <tr><td>先戒</td><td>含糖飲料、宵夜、炸物（內臟脂肪最怕這三個）</td></tr>
        <tr><td>睡眠</td><td>7 小時以上</td></tr>
      </table></section>`;
}

// ---------- 動作庫 ----------
function libTab() {
  const okKit = e => fitUi.kit === 'all' || (fitUi.kit === 'mine' ? e.kit !== 'gym' : e.kit === fitUi.kit);
  const list = EX.filter(e => (fitUi.part === 'all' || e.part === fitUi.part) && okKit(e));
  const chip = (id, label, color) => {
    const on = fitUi.part === id;
    return `<button type="button" data-action="fit-part" data-part="${id}" class="${on ? 'on' : ''}" style="${on && color ? `background:${color};border-color:${color}` : color ? `border-color:${color}66` : ''}">${label}</button>`;
  };
  const card = e => {
    const pt = partOf(e.part);
    return `<button type="button" class="fx-card" data-action="fit-ex" data-ex="${e.id}">
      ${anim(e)}
      <div class="fx-card-b"><div class="fx-name"><span class="fx-pdot" style="background:${pt.color}"></span>${esc(e.name)}</div>
        <div class="sub">${esc(e.en)} · ${esc(e.equip)}</div>
        <div class="fx-muscles">${muscleChips(e)}</div>
        <div class="fx-tags">${kitTag(e)}${spineTag(e)}</div></div></button>`;
  };
  return `<div class="chips fit-parts">${chip('all', '全部')}${PARTS.map(p => chip(p.id, p.label, p.color)).join('')}</div>
    <div class="chips fit-kits">${[{ id: 'mine', label: '✅ 我有的器材' }, ...KITS, { id: 'all', label: '全部' }].map(k =>
      `<button type="button" data-action="fit-kit" data-kit="${k.id}" class="${fitUi.kit === k.id ? 'on' : ''}">${k.label}</button>`).join('')}</div>
    <div class="sub" style="margin:8px 0">共 ${list.length} 個動作。紅字是主要練到的肌肉，點卡片看怎麼做。</div>
    <div class="fx-grid">${list.map(card).join('')}</div>
    <div class="sub" style="margin-top:12px">圖片來源：free-exercise-db（公眾領域）</div>`;
}

// ---------- 身體數據 ----------
function bodyTab() {
  const list = bodies();
  const first = list[0], last = list[list.length - 1];
  if (!last) return '<section class="card"><div class="empty">還沒有紀錄，下面新增一筆。</div></section>' + bodyForm();
  const meter = (label, key, unit, goal, lowerBetter = true) => {
    const v = last[key], s = first[key];
    if (v == null) return '';
    const total = Math.abs(s - goal) || 1;
    const got = lowerBetter ? s - v : v - s;
    const pct = Math.max(0, Math.min(100, got / total * 100));
    const diff = +(v - s).toFixed(1);
    return `<div class="fit-meter"><div class="row"><b>${label}</b><span class="spacer"></span>
      <span>${v}${unit}</span><span class="sub">　目標 ${goal}${unit}</span></div>
      <div class="prog-bar"><div style="width:${pct}%;background:var(--ok)"></div></div>
      <div class="sub">${list.length > 1 ? `比第一次 ${diff > 0 ? '+' : ''}${diff}${unit}` : `還差 ${Math.abs(+(v - goal).toFixed(1))}${unit}`}</div></div>`;
  };
  const nextDate = addDays(last.date, 42);
  const row = (b, i) => {
    const p = list[i - 1];
    const d = (k, better) => {
      if (!p || b[k] == null || p[k] == null) return '';
      const x = +(b[k] - p[k]).toFixed(1);
      if (!x) return '';
      const good = better === 'down' ? x < 0 : x > 0;
      return ` <small style="color:${good ? 'var(--ok)' : 'var(--danger)'}">${x > 0 ? '▲' : '▼'}${Math.abs(x)}</small>`;
    };
    return `<tr><td>${b.date.slice(5).replace('-', '/')}<br><small class="sub">${b.date.slice(0, 4)}</small></td>
      <td>${b.weight ?? '—'}${d('weight', 'down')}</td><td>${b.smm ?? '—'}${d('smm', 'up')}</td><td>${b.pbf ?? '—'}${d('pbf', 'down')}</td>
      <td>${b.visceral ?? '—'}${d('visceral', 'down')}</td><td>${b.score ?? '—'}</td>
      <td><button type="button" class="del" data-action="fit-body-del" data-id="${esc(b.id)}" aria-label="刪除">✕</button></td></tr>`;
  };
  return `<section class="card"><h2>🎯 離目標還有多遠 <span class="sub" style="font-weight:400">最新：${fmtDate(last.date)}</span></h2>
      ${meter('體重', 'weight', ' kg', GOAL.weight)}
      ${meter('體脂率', 'pbf', '%', GOAL.pbf)}
      ${meter('骨骼肌', 'smm', ' kg', GOAL.smm, false)}
      ${meter('內臟脂肪等級', 'visceral', '', GOAL.visceral)}
      <div class="sub" style="margin-top:6px">重點不是體重，是<b>骨骼肌往上、體脂往下</b>。下次建議 ${fmtDate(nextDate)} 左右再量（${nextDate <= today() ? '<b>已經可以量了！</b>' : `還有 ${Math.round((parseYmd(nextDate) - parseYmd(today())) / 86400000)} 天`}），同一台機器、同一時段、空腹、運動前。</div></section>
    <section class="card"><h2>📋 每次的紀錄</h2>
      <div class="fit-scroll"><table class="fit-table fit-hist"><tr><th>日期</th><th>體重</th><th>骨骼肌</th><th>體脂%</th><th>內臟</th><th>分數</th><th></th></tr>
      ${list.map(row).reverse().join('')}</table></div>
      ${first.note ? `<div class="sub" style="margin-top:6px">${esc(first.note)}</div>` : ''}</section>
    ${bodyForm()}
    <section class="card"><h2>🩺 第一次報告（2026-08-31）重點</h2>
      <ul class="fit-ul"><li>體脂率 <b>30.8%</b>（男性標準 10–20%），體脂肪 22.6 kg，超出標準約 7–13 kg</li>
        <li>骨骼肌 28.2 kg，在正常範圍的最低邊；<b>手臂只有標準的 78–79%</b>，軀幹 86%，腿 93%</li>
        <li>內臟脂肪 <b>9</b>（標準 1–9，已經到上限）；軀幹脂肪是標準的 271%</li>
        <li>BMI 24.6，依台灣國健署標準剛好跨過「過重」的 24</li>
        <li>所以課表的上半身動作比較多，目標是<b>減脂 12.7 kg、增肌 5.1 kg</b></li>
        <li>建議順便抽血：空腹血糖、HbA1c、血脂、肝功能</li></ul></section>`;
}

function bodyForm() {
  const f = (name, label, step = '0.1') => `<label class="field"><span>${label}</span><input type="number" name="${name}" inputmode="decimal" step="${step}" min="0"></label>`;
  return `<section class="card"><h2>＋ 新增一次量測</h2>
    <form data-form="fit-body" class="fit-body-form">
      <label class="field"><span>日期</span><input type="date" name="date" value="${today()}" required></label>
      ${f('weight', '體重 kg')}${f('smm', '骨骼肌 kg')}${f('pbf', '體脂率 %')}${f('fat', '體脂肪 kg')}${f('visceral', '內臟脂肪等級', '1')}${f('score', 'InBody 分數', '1')}
      <div class="actions" style="grid-column:1/-1"><span class="spacer"></span><button type="submit" class="btn primary">存</button></div>
    </form></section>`;
}

// ---------- 主畫面 ----------
export function renderFit() {
  seed();
  const tabs = [['today', '今天'], ['log', '紀錄'], ['plan', '課表'], ['lib', '動作'], ['body', '身體']];
  const body = { today: todayTab, log: logTab, plan: planTab, lib: libTab, body: bodyTab }[fitUi.tab]();
  return `<div class="page-head"><h1>健身</h1><div class="seg">${tabs.map(([k, l]) =>
    `<button type="button" data-action="fit-tab" data-tab="${k}" class="${fitUi.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    ${body}`;
}

// 首頁：每天打勾（每天都出現）
export const homeHabitCard = () => habitCard(true);

// 首頁：今天有在練就顯示進度，沒有就顯示推薦
export function homeFitCard() {
  const t = today();
  const ws = wOn(t);
  const w = ws.find(x => !x.done) || ws[0];
  const n = weekDone().length;
  if (!w) {
    const p = recommend()[0];
    return `<section class="card"><h2>🏋️ 今天練什麼？ <a href="#fit" data-action="fit-go" class="sub" style="font-weight:400">這週 ${n}/${WEEK_GOAL.total} 次 ›</a></h2>
      <button type="button" class="fit-pk" data-action="fit-day" data-day="${p.id}" style="--c:${p.color}"><span class="fit-badge">${p.id}</span><span class="t"><b>⭐ ${esc(p.name)}</b><span class="sub">${esc(p.where)} · ${p.mins} 分 · ${agoText(lastDate(p.id))}</span></span><span class="r">開始 ›</span></button>
      <div class="sub" style="margin-top:6px"><a href="#fit" data-action="fit-day" data-day="?">選別的 ›</a></div></section>`;
  }
  const p = planOf(w.day);
  const fin = p.list.filter(it => ((w.sets?.[it.ex]) || []).filter(Boolean).length >= (it.ex === 'walk' ? 1 : it.sets)).length;
  return `<section class="card"><h2>🏋️ 今天練 ${p.id}｜${esc(p.name)} <a href="#fit" data-action="fit-go" class="sub" style="font-weight:400">${esc(p.where)} ›</a></h2>
    ${w.done ? `<div>✅ 練完了，記得吃蛋白質${w.note ? '' : ' · <a href="#fit" data-action="fit-go">📝 寫一下心得 ›</a>'}</div>` : `<div class="prog-bar"><div style="width:${fin / p.list.length * 100}%;background:${p.color}"></div></div>
    <div class="sub" style="margin-top:6px">${fin}/${p.list.length} 個動作 · ${p.list.slice(0, 4).map(it => esc(exById(it.ex).name)).join('、')}…</div>`}</section>`;
}

// ---------- 動作說明 ----------
function openEx(id) {
  const e = exById(id);
  if (!e) return;
  const pt = partOf(e.part);
  const inPlan = PLAN.filter(p => p.list.some(it => it.ex === id)).map(p => { const it = p.list.find(x => x.ex === id); return `<b style="color:${p.color}">${p.id}</b> ${esc(p.name)}：${range(it)}`; });
  ctx.openSheet(`<h2>${esc(e.name)} <span class="sub" style="font-weight:400">${esc(e.en)}</span></h2>
    ${anim(e, 'big')}${imgNote(e)}
    <div class="fx-detail">
      <div class="row" style="flex-wrap:wrap;gap:6px"><span class="fx-tag" style="background:${pt.color}33;color:${pt.color}">${pt.label}</span>${kitTag(e)}<span class="fx-tag">🧰 ${esc(e.equip)}</span></div>
      ${e.spine ? `<div class="pu-sec">脊椎側彎</div><div class="fx-spine spine-${e.spine}">${SPINE[e.spine]}：${esc(e.spineNote)}</div>` : ''}
      <div class="pu-sec">練到哪裡</div><div class="fx-muscles">${muscleChips(e)}</div><div class="sub">紅色＝主要、灰色＝次要</div>
      <div class="pu-sec">怎麼做</div><ol class="fit-ol">${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="pu-sec">注意</div><ul class="fit-ul">${e.tips.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      ${inPlan.length ? `<div class="pu-sec">在你的課表</div><div>${inPlan.join('<br>')}</div>` : ''}
    </div>
    <div class="actions"><span class="spacer"></span><button type="button" class="btn" data-action="close-sheet">關閉</button></div>`, { kind: 'fit-ex' });
}

// ---------- 休息倒數 ----------
let restEnd = 0, restName = '';
setInterval(() => {
  const el = document.getElementById('fit-rest');
  if (!el) return;
  if (!restEnd) { el.hidden = true; return; }
  const left = Math.ceil((restEnd - Date.now()) / 1000);
  el.hidden = false;
  if (left > 0) {
    el.innerHTML = `⏱️ 休息 <b>${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b> <span class="sub">下一組：${esc(restName)}</span><span class="spacer"></span><button type="button" class="btn small" data-action="fit-rest-skip">跳過</button>`;
  } else {
    el.innerHTML = `💪 休息結束，開始下一組！<span class="spacer"></span><button type="button" class="btn small" data-action="fit-rest-skip">好</button>`;
    if (left === 0) try { navigator.vibrate?.([200, 100, 200]); } catch { /* 不支援 */ }
    if (left < -20) restEnd = 0;
  }
}, 500);

// 沒按 ✓ 的數字先記著
document.addEventListener('input', ev => {
  const k = ev.target.dataset?.fitDraft;
  if (k) draft[k] = { ...(draft[k] || {}), [ev.target.name]: ev.target.value };
});

function getW(date, day) {
  return workouts().find(x => x.id === wid(date, day)) || { id: wid(date, day), date, day, sets: {}, done: false, createdAt: Date.now() };
}

export const fitForms = {
  'fit-note': (form, f) => {
    const [date, day] = form.dataset.id.split('|');
    const doc = getW(date, day);
    saveDoc('workouts', { ...doc, note: String(f.note || '').trim(), noteAt: Date.now() });
    if (form.dataset.sheet) ctx.closeSheet();
    else form.querySelector('textarea')?.blur();
    ctx.toast('📝 心得存好了');
  },
  'fit-set': (form, f) => {
    const [date, day, k] = form.dataset.id.split('|');
    const [ex, i] = k.split(':');
    const e = exById(ex);
    const r = +f.r, w = f.w === undefined ? null : +f.w;
    if (e.unit === 'kg' && !(f.w > 0)) { ctx.toast('填一下重量（kg）'); form.querySelector('[name=w]')?.focus(); return; }
    if (!(r > 0)) { ctx.toast(`填一下${UNIT[e.unit] === '下' ? '次數' : UNIT[e.unit] === '秒' ? '秒數' : '分鐘'}`); return; }
    const doc = getW(date, day);
    const arr = [...(doc.sets[ex] || [])];
    arr[+i] = e.unit === 'kg' ? { w, r } : { r };
    for (let j = 0; j < arr.length; j++) if (arr[j] === undefined) arr[j] = null;
    delete draft[`${date}:${k}`];
    // 下一組先帶入同樣的數字
    const nk = `${date}:${ex}:${+i + 1}`;
    if (!draft[nk]) draft[nk] = e.unit === 'kg' ? { w, r } : { r };
    document.activeElement?.blur();
    saveDoc('workouts', { ...doc, sets: { ...doc.sets, [ex]: arr } });
    const p = planOf(day);
    const it = p?.list.find(x => x.ex === ex);
    const lastSet = +i + 1 >= (ex === 'walk' ? 1 : it?.sets || 1);
    const nextIt = lastSet ? p?.list[p.list.indexOf(it) + 1] : it;
    if (it?.rest && nextIt) { restEnd = Date.now() + it.rest * 1000; restName = exById(nextIt.ex).name; }
    if (lastSet && p && p.list.every(x => (x.ex === ex ? arr : (doc.sets[x.ex] || [])).filter(Boolean).length >= (x.ex === 'walk' ? 1 : x.sets))) ctx.toast('🎉 全部動作都做完了！按下面「完成今天的訓練」');
  },
  'fit-body': (form, f) => {
    const num = k => (f[k] === '' || f[k] == null ? null : +f[k]);
    if (!f.date || num('weight') == null) { ctx.toast('至少填日期和體重'); return; }
    const id = `ib-${f.date.replaceAll('-', '')}`;
    saveDoc('body', { id, date: f.date, weight: num('weight'), smm: num('smm'), pbf: num('pbf'), fat: num('fat'), visceral: num('visceral'), score: num('score'), createdAt: Date.now() });
    form.reset();
    ctx.toast('已記錄 📈');
  },
};

export const fitActions = {
  'fit-go': () => { fitUi.tab = 'today'; fitUi.day = ''; if (location.hash !== '#fit') location.hash = '#fit'; else ctx.render(); },
  'fit-tab': el => { fitUi.tab = el.dataset.tab; ctx.render(); window.scrollTo(0, 0); },
  'fit-day': el => {
    fitUi.tab = 'today';
    fitUi.day = el.dataset.day;
    if (location.hash !== '#fit') location.hash = '#fit'; else ctx.render();
    window.scrollTo(0, 0);
  },
  'fit-part': el => { fitUi.part = el.dataset.part; ctx.render(); },
  'fit-kit': el => { fitUi.kit = el.dataset.kit; ctx.render(); },
  'fit-ex': el => openEx(el.dataset.ex),
  'fit-habit': el => {
    const { date, h: k } = el.dataset;
    const h = habitOf(date) || { id: `h-${date}`, date, items: {}, createdAt: Date.now() };
    const items = { ...h.items, [k]: !h.items?.[k] };
    saveDoc('habits', { ...h, items });
    if (items[k] && HABITS.every(x => items[x.id])) ctx.toast('🎉 全部打勾了！');
  },
  'fit-hday': el => {
    fitUi.hday = el.dataset.date === today() ? '' : el.dataset.date;
    fitUi.tab = 'today';
    ctx.render();
    if (el.dataset.date) document.querySelector('.fit-habits')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'fit-rest-skip': () => { restEnd = 0; const el = document.getElementById('fit-rest'); if (el) el.hidden = true; },
  'fit-unset': el => {
    const [date, day, k] = el.dataset.id.split('|');
    const [ex, i] = k.split(':');
    const doc = workouts().find(x => x.id === wid(date, day));
    if (!doc) return;
    const arr = [...(doc.sets[ex] || [])];
    if (arr[+i]) draft[`${date}:${k}`] = { ...arr[+i] };
    arr[+i] = null;
    saveDoc('workouts', { ...doc, sets: { ...doc.sets, [ex]: arr } });
  },
  'fit-finish': el => {
    const doc = getW(today(), el.dataset.day);
    const done = !doc.done;
    saveDoc('workouts', { ...doc, done, doneAt: done ? Date.now() : null });
    restEnd = 0;
    if (done) ctx.toast('💪 辛苦了！這週又完成一次');
  },
  'fit-feel': el => {
    const [date, day] = el.dataset.id.split('|');
    const doc = getW(date, day);
    const feel = doc.feel === el.dataset.feel ? '' : el.dataset.feel;
    // 心得框裡還沒存的字一起存，不然重畫會不見
    const ta = el.closest('.card, .sheet')?.querySelector('form[data-form="fit-note"] textarea');
    const note = ta ? ta.value.trim() : doc.note;
    saveDoc('workouts', { ...doc, feel, note: note || '' });
    if (el.closest('.sheet')) el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.feel === feel));
  },
  'fit-note-edit': el => {
    const [date, day] = el.dataset.id.split('|');
    const w = workouts().find(x => x.id === wid(date, day));
    const p = planOf(day);
    ctx.openSheet(`<h2>📝 ${fmtDate(date)} ${esc(day)}${p ? ` ${esc(p.name)}` : ''} 的心得</h2>${noteForm(date, day, w, true)}`, { kind: 'fit-note' });
    ctx.sheetEl()?.querySelector('textarea')?.focus();
  },
  'fit-body-del': el => {
    const b = (store.state.body || []).find(x => x.id === el.dataset.id);
    if (b && confirm(`刪掉 ${b.date} 的紀錄？`)) removeDoc('body', b.id);
  },
};
