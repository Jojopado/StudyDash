// 提醒自己（#remind）：寫給自己看的幾句話。首頁每天輪一句，記帳頁的輸入框上面也會出現「吃得完嗎」那句。
// 清單存在 prefs.reminds = [{ id, emoji, text, sub }]；還沒改過就用 DEFAULTS
import { store, newId, savePrefs } from './store.js';
import { esc, today } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render }
export function initRemind(c) { ctx = c; }

const DEFAULTS = [
  { id: 'r-food', emoji: '🍱', text: '買飯之前想清楚：吃得完嗎？', sub: '不要浪費老爸給的生活費。吃不完就買小份，或分兩餐吃。' },
  { id: 'r-diet', emoji: '🥟', text: '沒有「不能吃」的食物，份量控制就好', sub: '水餃一餐 8–10 顆，配青菜或蛋。吃不完就放冷凍，不要丟。' },
];

const list = () => store.prefs.reminds || DEFAULTS;
const save = arr => savePrefs({ reminds: arr });

// 首頁：每天輪一句
export function homeRemindCard() {
  const arr = list();
  if (!arr.length) return '';
  const day = Math.floor(new Date(today()).getTime() / 864e5);
  const r = arr[day % arr.length];
  return `<a href="#remind" class="quote-mini rm-home">📌 ${esc(r.emoji)} ${esc(r.text)} ›</a>`;
}

// 記帳頁：買吃的時候最需要看到
export function foodRemindLine() {
  const r = list().find(x => x.id === 'r-food');
  return r ? `<div class="rm-inline">${esc(r.emoji)} ${esc(r.text)}<small>${esc(r.sub || '')}</small></div>` : '';
}

export function renderRemind() {
  const arr = list();
  return `<div class="page-head"><h1>提醒自己</h1></div>
  <div class="grid">
    <section class="card">
      ${arr.length ? arr.map(r => `<div class="rm-item">
        <span class="rm-emoji">${esc(r.emoji)}</span>
        <div class="rm-main" data-action="rm-edit" data-id="${r.id}"><b>${esc(r.text)}</b>${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ''}</div>
        <button type="button" class="del" data-action="rm-del" data-id="${r.id}" aria-label="刪除">✕</button>
      </div>`).join('') : '<div class="empty">還沒有提醒，下面加一句給自己</div>'}
      <form data-form="rm-add" class="add-goal" style="margin-top:12px"><input type="text" name="text" maxlength="60" autocomplete="off" placeholder="＋ 再加一句提醒自己的話"><button class="btn" type="submit">加入</button></form>
      <div class="sub" style="margin-top:10px">點一句可以修改。首頁每天會輪流出現一句，記帳頁會提醒「吃得完嗎」。</div>
    </section>
  </div>`;
}

export const remindForms = {
  'rm-add': (form, f) => {
    const text = String(f.text || '').trim();
    if (!text) return;
    form.querySelector('[name=text]').value = '';
    save([...list(), { id: newId(), emoji: '📌', text, sub: '' }]);
  },
};

export const remindActions = {
  'rm-edit': el => {
    const r = list().find(x => x.id === el.dataset.id);
    if (!r) return;
    const text = prompt('提醒的話', r.text);
    if (text == null || !text.trim()) return;
    const sub = prompt('補充說明（可以留空）', r.sub || '');
    save(list().map(x => x.id === r.id ? { ...x, text: text.trim().slice(0, 60), sub: (sub ?? x.sub ?? '').trim().slice(0, 100) } : x));
  },
  'rm-del': el => {
    const r = list().find(x => x.id === el.dataset.id);
    if (!r || !confirm(`刪掉「${r.text}」？`)) return;
    save(list().filter(x => x.id !== r.id));
  },
};
