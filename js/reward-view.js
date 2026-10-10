// 獎勵頁（#reward）：寵物、金幣、商店、成就、兌換後的遊戲倒數。
import { store, newId, saveDoc, removeDoc, savePrefs } from './store.js';
import { esc, fmtDate, ymd } from './util.js';
import { timer, beep, fmtClock } from './timer.js';
import * as R from './reward.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initReward(c) { ctx = c; }

const petName = () => store.prefs.petName || '啾啾';
let line = null; // 寵物現在說的話（點一下換一句）

// ---------- 兌換後倒數（這台裝置） ----------
const PLAY_KEY = 'studydash.play';
function readPlay() { try { return JSON.parse(localStorage.getItem(PLAY_KEY)); } catch { return null; } }
function writePlay(p) { try { if (p) localStorage.setItem(PLAY_KEY, JSON.stringify(p)); else localStorage.removeItem(PLAY_KEY); } catch { /* ignore */ } }

function notify(text) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker?.getRegistration().then(r => {
      if (r) r.showNotification('學習儀表板', { body: text, icon: 'icons/icon-192.png' });
      else new Notification('學習儀表板', { body: text });
    });
  } catch { /* ignore */ }
}

// 每秒呼叫一次（app.js 的 timerTick）
export function tickReward() {
  const p = readPlay();
  if (!p) return;
  const left = p.endAt - Date.now();
  if (left <= 0) {
    writePlay(null);
    beep();
    const msg = `${p.emoji} ${p.name}的時間到了！回來讀書吧～`;
    ctx.toast(msg);
    notify(msg);
    ctx.render();
    return;
  }
  const el = document.getElementById('play-clock');
  if (el) el.textContent = fmtClock(left);
}

function playCard() {
  const p = readPlay();
  if (!p) return '';
  return `<div class="play-box">
    <div class="sub">${p.emoji} ${esc(p.name)} · 剩下</div>
    <div class="play-clock" id="play-clock">${fmtClock(p.endAt - Date.now())}</div>
    <button class="btn small" data-action="rw-play-stop">提早結束</button></div>`;
}

// ---------- 畫面 ----------
function petCard(s) {
  const studying = timer.running && timer.phase === 'focus';
  const mood = R.MOODS[R.moodOf(s, studying)];
  line ??= mood.lines[Math.floor(Math.random() * mood.lines.length)];
  const lo = R.xpFor(s.level), hi = R.xpFor(s.level + 1);
  const pct = Math.round((s.xp - lo) / (hi - lo) * 100);
  return `<section class="card pet-card">
    <div class="row"><h2 style="margin:0" data-action="rw-rename" class="pet-name">${esc(petName())} ✎</h2><span class="spacer"></span>
      <span class="sub">${mood.face} ${mood.label}</span></div>
    <button class="pet ${studying ? 'studying' : ''}" data-action="rw-pet" aria-label="摸摸">
      ${s.stage.crown ? '<span class="crown">👑</span>' : ''}<span class="pet-emoji">${s.stage.emoji}</span></button>
    <div class="bubble">${esc(line)}</div>
    <div class="row" style="margin-top:12px"><b>Lv ${s.level}</b><span class="sub">${s.stage.name}</span><span class="spacer"></span>
      <span class="sub">還差 ${hi - s.xp} 分鐘升級</span></div>
    <div class="progress"><div style="width:${pct}%;background:var(--accent)"></div></div>
    <div class="row wrap" style="margin-top:12px;justify-content:center">
      <a class="btn primary" href="#study">🍅 ${studying ? '回到番茄鐘' : '帶牠去讀書'}</a></div>
  </section>`;
}

function walletCard(s) {
  return `<section class="card">
    <h2>💰 金幣</h2>
    <div class="coins">${s.coins}</div>
    <div class="sub" style="text-align:center">今天 +${s.todayCoins} · 累計賺 ${s.earned} · 已花 ${s.spent}</div>
    ${playCard()}
    <div class="sub" style="margin:14px 0 4px">今日成就（每天重置）</div>
    ${R.DAILY.map(a => { const ok = s.today[a.id]; return `<div class="ach ${ok ? 'ok' : ''}">
      <span class="ach-ico">${a.icon}</span><div style="flex:1"><div>${a.name}</div><div class="sub">${a.desc}</div></div>
      <span class="${ok ? 'ach-got' : 'sub'}">${ok ? '✓ ' : ''}+${a.bonus}</span></div>`; }).join('')}
  </section>`;
}

function shopCard(s) {
  return `<section class="card">
    <div class="row" style="margin-bottom:8px"><h2 style="margin:0">🛍️ 兌換商店</h2><span class="spacer"></span>
      <button class="btn small" data-action="rw-item-new">＋ 新增獎勵</button></div>
    <div class="shop">${R.shop().map(it => {
      const lack = it.cost - s.coins;
      return `<div class="shop-item">
        <button class="shop-edit" data-action="rw-item-edit" data-id="${esc(it.id)}" aria-label="編輯">✎</button>
        <div class="shop-emoji">${esc(it.emoji)}</div>
        <div class="shop-name">${esc(it.name)}</div>
        <button class="btn ${lack > 0 ? '' : 'primary'} small" data-action="rw-buy" data-id="${esc(it.id)}" ${lack > 0 ? 'disabled' : ''}>
          ${lack > 0 ? `還差 ${lack}` : `💰 ${it.cost}`}</button></div>`;
    }).join('') || '<div class="empty">還沒有獎勵，按「新增獎勵」</div>'}</div>
  </section>`;
}

function milestoneCard(s) {
  return `<section class="card"><h2>🏅 里程碑</h2>
    ${R.MILESTONES.map(m => { const ok = s.miles.has(m.id); const p = Math.min(100, Math.round(s.minutes / m.min * 100)); return `<div class="ach ${ok ? 'ok' : ''}">
      <span class="ach-ico">${m.icon}</span><div style="flex:1"><div>${m.name}</div>
      ${ok ? '' : `<div class="progress thin"><div style="width:${p}%;background:var(--accent)"></div></div>`}</div>
      <span class="${ok ? 'ach-got' : 'sub'}">${ok ? '✓ ' : ''}+${m.bonus}</span></div>`; }).join('')}
  </section>`;
}

function historyCard() {
  const list = [...store.state.rw_redeems].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10);
  const on = !!store.prefs.playTimer;
  return `<section class="card"><h2>🧾 兌換紀錄</h2>
    ${list.length ? list.map(r => `<div class="goal"><div class="text">${fmtDate(ymd(new Date(r.at)), false)} · ${esc(r.emoji)} ${esc(r.name)} · −${r.cost}</div>
      <button class="del" data-action="rw-refund" data-id="${r.id}" title="退回（按錯時用）">↩</button></div>`).join('')
      : '<div class="empty">還沒兌換過。讀書賺金幣，再來這裡換！</div>'}
    <label class="row" style="margin-top:12px;cursor:pointer"><input type="checkbox" data-action="rw-play-toggle" ${on ? 'checked' : ''}>
      兌換有時間的獎勵後開始倒數，時間到提醒我</label>
    <div class="sub" style="margin-top:4px">${on ? '已開啟。App 要開著才會準時響；切走再回來也會照算。' : '目前關閉，兌換只記帳。'}</div>
  </section>`;
}

export function renderReward(s) {
  const sum = R.summarize();
  return `<div class="page-head"><h1>獎勵</h1><span class="sub">讀 1 分鐘 = 1 💰 + 1 經驗，補記錄也算</span></div>
    <div class="grid two">${petCard(sum)}${walletCard(sum)}</div>
    <div class="grid two" style="margin-top:14px">${shopCard(sum)}${milestoneCard(sum)}</div>
    <div style="margin-top:14px">${historyCard()}</div>`;
}

// 讀書頁上的小卡
export function rewardMini() {
  const s = R.summarize();
  return `<a href="#reward" class="quote-mini">${s.stage.crown ? '👑' : ''}${s.stage.emoji} ${esc(petName())} Lv ${s.level} · 💰 ${s.coins} · 今天 +${s.todayCoins} ›</a>`;
}

// ---------- 商店編輯 ----------
function openItemSheet(it) {
  const isNew = !it;
  const x = it || { id: newId(), emoji: '🎁', name: '', cost: 60, minutes: 0 };
  ctx.openSheet(`<h2>${isNew ? '新增獎勵' : '編輯獎勵'}</h2>
    <form data-form="rw-item">
      <div class="row">
        <label class="field" style="width:80px"><span>圖示</span><input type="text" name="emoji" value="${esc(x.emoji)}" autocomplete="off"></label>
        <label class="field" style="flex:1"><span>名稱</span><input type="text" name="name" value="${esc(x.name)}" placeholder="例如：玩遊戲 30 分鐘" required autocomplete="off"></label>
      </div>
      <div class="row">
        <label class="field" style="flex:1"><span>價格（金幣）</span><input type="text" inputmode="numeric" name="cost" value="${x.cost}" required></label>
        <label class="field" style="flex:1"><span>倒數分鐘（0＝不倒數）</span><input type="text" inputmode="numeric" name="minutes" value="${x.minutes || 0}"></label>
      </div>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="rw-item-del">刪除</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'rw-item', data: x, isNew });
  if (isNew) document.querySelector('#sheet [name=name]').focus();
}

export function submitItem(form) {
  const f = Object.fromEntries(new FormData(form));
  const name = (f.name || '').trim();
  const cost = parseInt(f.cost, 10);
  const minutes = Math.max(0, parseInt(f.minutes, 10) || 0);
  if (!name) return;
  if (!(cost > 0)) { ctx.toast('價格要大於 0'); return; }
  const x = { ...ctx.sheetData(), emoji: (f.emoji || '🎁').trim() || '🎁', name, cost, minutes };
  const list = R.shop();
  savePrefs({ shop: list.some(i => i.id === x.id) ? list.map(i => (i.id === x.id ? x : i)) : [...list, x] });
  ctx.closeSheet();
  ctx.toast('已儲存');
}

// ---------- 動作 ----------
export const rwActions = {
  'rw-pet': () => {
    const s = R.summarize();
    const mood = R.MOODS[R.moodOf(s, timer.running && timer.phase === 'focus')];
    let next;
    do { next = mood.lines[Math.floor(Math.random() * mood.lines.length)]; } while (mood.lines.length > 1 && next === line);
    line = next;
    ctx.render();
  },
  'rw-rename': () => {
    const n = prompt('幫牠取名字', petName());
    if (n != null && n.trim()) savePrefs({ petName: n.trim().slice(0, 12) });
  },
  'rw-buy': el => {
    const it = R.shop().find(i => i.id === el.dataset.id);
    if (!it) return;
    const s = R.summarize();
    if (s.coins < it.cost) { ctx.toast(`還差 ${it.cost - s.coins} 金幣`); return; }
    if (!confirm(`花 ${it.cost} 金幣兌換「${it.name}」？`)) return;
    const r = { id: newId(), itemId: it.id, emoji: it.emoji, name: it.name, cost: it.cost, minutes: it.minutes || 0, at: Date.now() };
    // 先寫倒數和台詞，存檔觸發重畫時才看得到
    const timed = store.prefs.playTimer && r.minutes > 0;
    if (timed) writePlay({ endAt: Date.now() + r.minutes * 60000, name: r.name, emoji: r.emoji, id: r.id });
    line = '好好玩，玩完要回來喔！';
    saveDoc('rw_redeems', r);
    ctx.toast(timed ? `${r.emoji} 好好享受！${r.minutes} 分鐘後提醒你` : `${r.emoji} 兌換成功，好好享受！`);
  },
  'rw-refund': el => {
    const r = store.state.rw_redeems.find(x => x.id === el.dataset.id);
    if (!r || !confirm(`退回「${r.name}」，拿回 ${r.cost} 金幣？`)) return;
    if (readPlay()?.id === r.id) writePlay(null);
    removeDoc('rw_redeems', r.id);
    ctx.toast(`退回 ${r.cost} 金幣`);
  },
  'rw-play-stop': () => { writePlay(null); ctx.toast('提早結束，好自律！'); ctx.render(); },
  'rw-item-new': () => openItemSheet(null),
  'rw-item-edit': el => { const it = R.shop().find(i => i.id === el.dataset.id); if (it) openItemSheet(it); },
  'rw-item-del': () => {
    const x = ctx.sheetData();
    if (!confirm(`刪除「${x.name}」？（兌換紀錄不受影響）`)) return;
    savePrefs({ shop: R.shop().filter(i => i.id !== x.id) });
    ctx.closeSheet();
  },
};

// checkbox 用 change 事件
export function onRewardChange(el) {
  if (el.dataset.action !== 'rw-play-toggle') return false;
  savePrefs({ playTimer: el.checked });
  if (el.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  return true;
}
