// 獎勵頁（#reward）：寵物、金幣、成就、里程碑。（兌換商店 2026-10-10 拿掉了）
import { store, savePrefs } from './store.js';
import { esc } from './util.js';
import { timer } from './timer.js';
import * as R from './reward.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initReward(c) { ctx = c; }

const petName = () => store.prefs.petName || '啾啾';
let line = null; // 寵物現在說的話（點一下換一句）

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
    <div class="sub" style="text-align:center">今天 +${s.todayCoins} · 累計賺 ${s.earned}</div>
    <div class="sub" style="margin:14px 0 4px">今日成就（每天重置）</div>
    ${R.DAILY.map(a => { const ok = s.today[a.id]; return `<div class="ach ${ok ? 'ok' : ''}">
      <span class="ach-ico">${a.icon}</span><div style="flex:1"><div>${a.name}</div><div class="sub">${a.desc}</div></div>
      <span class="${ok ? 'ach-got' : 'sub'}">${ok ? '✓ ' : ''}+${a.bonus}</span></div>`; }).join('')}
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

export function renderReward(s) {
  const sum = R.summarize();
  return `<div class="page-head"><h1>獎勵</h1><span class="sub">讀 1 分鐘 = 1 💰 + 1 經驗，補記錄也算</span></div>
    <div class="grid two">${petCard(sum)}${walletCard(sum)}</div>
    <div style="margin-top:14px">${milestoneCard(sum)}</div>`;
}

// 讀書頁上的小卡
export function rewardMini() {
  const s = R.summarize();
  return `<a href="#reward" class="quote-mini">${s.stage.crown ? '👑' : ''}${s.stage.emoji} ${esc(petName())} Lv ${s.level} · 💰 ${s.coins} · 今天 +${s.todayCoins} ›</a>`;
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
};
