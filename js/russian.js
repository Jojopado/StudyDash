// 俄文（#russian）：以通過 ТЭУ 初級（A1）為目標的教材。四個分頁：課程 16 課（ru-lessons.js）、文法 17 章（ru-grammar.js）、
// 每日單字 10 個（ru-words.js，從 prefs.ruStart 那天算第 1 天）、字母表＋記憶法。每個字、每句都能按 🔊 聽（speak.js，手機內建語音）。
// 不記進度，想看哪課就點哪課；慢速存 prefs.ruSlow。例句、單字可以一鍵加到字卡（卡組 preset 'ru'，lang ru-RU → 翻卡時也有 🔊）。
// 資料裡重音寫成母音後面加 '（приве'т），畫面上換成重音符號、念的時候拿掉。
import { store, newId, saveDoc, savePrefs } from './store.js';
import { esc, mdLite, today, parseYmd } from './util.js';
import { say, hasVoice, plain } from './speak.js';
import { LESSONS } from './ru-lessons.js';
import { GRAMMAR } from './ru-grammar.js';
import { WORDS, WORD_TOPICS, PER_DAY, DAYS } from './ru-words.js';

let ctx = null; // { openSheet, closeSheet, toast, render }
export function initRussian(c) { ctx = c; }


export const acc = s => String(s).replace(/'/g, '́');

// ---------- 字母 ----------
// g：same 長得像英文、念法也一樣 / false 假朋友（像英文但念法不同）/ new 新字母
// name = 字母名稱（給語音念）、hint = 怎麼念、w = 例字
const LETTERS = [
  ['А', 'а', 'а', 'same', '「啊」', "ма'ма", '媽媽'],
  ['Б', 'б', 'бэ', 'new', '英文 b', 'банк', '銀行'],
  ['В', 'в', 'вэ', 'false', '英文 v（長得像 B！）', "вода'", '水'],
  ['Г', 'г', 'гэ', 'new', '英文 g（go 的 g）', "газе'та", '報紙'],
  ['Д', 'д', 'дэ', 'new', '英文 d', 'дом', '家、房子'],
  ['Е', 'е', 'е', 'false', '「耶」ye（不是 e！）', "еда'", '食物'],
  ['Ё', 'ё', 'ё', 'new', '「喲」yo，有 ё 的地方一定是重音', 'ёлка', '樅樹、聖誕樹'],
  ['Ж', 'ж', 'жэ', 'new', '捲舌「ㄖ」，比中文硬', "журна'л", '雜誌'],
  ['З', 'з', 'зэ', 'new', '英文 z', "зима'", '冬天'],
  ['И', 'и', 'и', 'new', '「伊」（長得像反過來的 N）', "игра'", '遊戲'],
  ['Й', 'й', "и кра'ткое", 'new', '很短的 y，像「伊」一閃而過', 'мой', '我的'],
  ['К', 'к', 'ка', 'same', '英文 k', 'кот', '貓（公）'],
  ['Л', 'л', 'эль', 'new', '英文 l，舌頭放低一點', "ла'мпа", '燈'],
  ['М', 'м', 'эм', 'same', '英文 m', "метро'", '地鐵'],
  ['Н', 'н', 'эн', 'false', '英文 n（長得像 H！）', 'нос', '鼻子'],
  ['О', 'о', 'о', 'same', '重音時「喔」，沒重音念成「啊」', "окно'", '窗戶（念 akNO）'],
  ['П', 'п', 'пэ', 'new', '英文 p', 'парк', '公園'],
  ['Р', 'р', 'эр', 'false', '彈舌 r（長得像 P！）', "ро'бот", '機器人'],
  ['С', 'с', 'эс', 'false', '英文 s（長得像 C！）', 'сок', '果汁'],
  ['Т', 'т', 'тэ', 'same', '英文 t', "такси'", '計程車'],
  ['У', 'у', 'у', 'false', '「嗚」（長得像 y！）', "у'тро", '早上'],
  ['Ф', 'ф', 'эф', 'new', '英文 f', "фо'то", '照片'],
  ['Х', 'х', 'ха', 'false', '「喝」的 h，喉嚨磨擦（長得像 X！）', 'хлеб', '麵包'],
  ['Ц', 'ц', 'цэ', 'new', '「ㄘ」ts', 'цирк', '馬戲團'],
  ['Ч', 'ч', 'чэ', 'new', '「ㄑ／吃」ch', 'чай', '茶'],
  ['Ш', 'ш', 'ша', 'new', '「ㄕ」sh，舌頭往後', "шко'ла", '學校'],
  ['Щ', 'щ', 'ща', 'new', '長長的「ㄒ」shch', 'борщ', '羅宋湯'],
  ['Ъ', 'ъ', "твёрдый знак", 'new', '硬音符號：不發音，把前後隔開', "подъе'зд", '大樓入口'],
  ['Ы', 'ы', 'ы', 'new', '嘴型念「伊」、舌頭往後縮（最難的母音）', 'мы', '我們'],
  ['Ь', 'ь', "мя'гкий знак", 'new', '軟音符號：不發音，讓前面子音變軟', 'соль', '鹽'],
  ['Э', 'э', 'э', 'new', '「欸」e', "э'то", '這是'],
  ['Ю', 'ю', 'ю', 'new', '「優」yu', "ю'бка", '裙子'],
  ['Я', 'я', 'я', 'new', '「呀」ya（也是「我」的意思）', "я'блоко", '蘋果'],
].map(([up, lo, name, g, hint, w, wz], i) => ({ i, up, lo, name, g, hint, w, wz }));

const GROUPS = { all: '全部 33', same: '像英文', false: '假朋友', new: '新字母' };
const GROUP_TAG = { same: '像英文', false: '假朋友', new: '新' };


// 每個字母的記憶法
const MEM = {
  А: '跟英文 a 一樣，嘴巴張大「啊」。',
  Б: '大寫像數字 6 → 6 個 Banana，念 b。',
  В: '長得像 B 卻念 v → 想成 Vodka（водка）開頭的 V。',
  Г: '像一座絞刑台 Gallows → g。',
  Д: '像一間有屋頂、有地基的房子 → дом（房子）就是 д 開頭。',
  Е: '長得像 E，前面多一聲「耶」→ ye。',
  Ё: 'Е 頭上兩個點＝兩隻眼睛瞪大說「喲！」→ yo；點點最顯眼，所以一定是重音。',
  Ж: '像一隻甲蟲，俄文的甲蟲就叫 жук → 捲舌「ㄖ」。',
  З: '長得像數字 3 → 3 隻斑馬 zebra，念 z。',
  И: '英文 N 照鏡子 → 鏡子裡的人說「伊」。',
  Й: 'И 戴了一頂小帽子 → 帽子讓「伊」變得很短。',
  К: '跟英文 k 一樣，送分題。',
  Л: '像屋頂 Λ（希臘字母 lambda）→ l。',
  М: '跟英文 m 一樣（小寫 м 也是 M 的形狀，不是 m）。',
  Н: '像 H 卻念 n → нет（不）就是 Н 開頭：看到 H 就說 No。',
  О: '有重音念「喔」，沒重音偷懶念成「啊」。',
  П: '像門框，也像圓周率 π → p。',
  Р: '像 P 卻念 r → Россия（俄羅斯）就是 Р 開頭，記住要彈舌。',
  С: '像 C 卻念 s → СССР＝蘇聯 SSSR，四個 С 全念 s。',
  Т: '跟英文 t 一樣（手寫體長得像 m，看手寫時要小心）。',
  У: '像 y，尾巴往下滴 → 眼淚往下掉「嗚嗚」→ u。',
  Ф: '圓圈中間插一根棍子，像希臘字母 φ（phi）→ f。',
  Х: '像 X 卻念「喝」→ 俄國人打「哈哈」就寫 хаха。',
  Ц: '像 U 拖一條小尾巴，尾巴「ㄘ」一聲 → ts。',
  Ч: '長得像數字 4 → 「四」четы́ре 就是 Ч 開頭 → ch。',
  Ш: '長得就像中文「山」→ 山＝ㄕ，sh！',
  Щ: 'Ш 多一條小尾巴 → 「ㄕ」拉長、變軟，接近長長的「ㄒ」。',
  Ъ: '一道硬硬的牆：不發音，把前後兩個音隔開。',
  Ы: '像 ь 旁邊站了一根 I → 肚子被打一拳時的「呃伊」。',
  Ь: '像一顆小枕頭：不發音，讓前面的子音躺軟（輕輕帶一點「伊」）。',
  Э: '反過來的 E，像人疑惑時說「欸？」→ e。',
  Ю: '看起來是 I 接一個 O → I＋O＝「優」yu。',
  Я: '反過來的 R → 俄國人連 R 都反著寫，用來說「我」（я）。',
};


export const ruUi = {
  tab: 'learn', lesson: null, gram: null, shown: new Set(), picked: {},
  day: null, hide: '', topic: null,
  group: 'all', view: 'grid', letter: null, quiz: null, quizShow: false, streak: 0,
};

const TABS = [['learn', '📖 課程'], ['gram', '📐 文法'], ['daily', '📅 單字'], ['abc', '🔤 字母']];
const slow = () => !!store.prefs.ruSlow;

function speak(text, queue) {
  if (!say(text, { slow: slow(), queue })) { ctx.toast('這個瀏覽器不能念出聲音'); return; }
  if (!hasVoice('ru-RU')) ctx.toast('這台裝置沒有俄文語音：iPhone 到 設定 → 輔助使用 → 朗讀內容 → 聲音 → 俄文 下載');
}

const wordBtn = ([ru, tr, zh]) => `<button type="button" class="ru-word" data-action="ru-say" data-say="${esc(ru)}">
  <span class="ru-spk">🔊</span><span class="ru-main"><span class="ru-text">${esc(acc(ru))}</span>${tr ? `<small>${esc(tr)}</small>` : ''}</span>
  <span class="ru-zh">${esc(zh)}</span></button>`;

// ---------- 畫面 ----------
export function renderRussian() {
  const L = ruUi.tab === 'learn' && LESSONS[ruUi.lesson - 1];
  const G = ruUi.tab === 'gram' && GRAMMAR.find(g => g.id === ruUi.gram);
  const ch = L || G;
  const title = L ? `第 ${L.n} 課　${esc(L.title)}` : G ? `${G.id.toUpperCase()}　${esc(G.title)}` : '🇷🇺 俄文';
  const sub = ch ? `學會：${esc(ch.learn)}` : '目標：通過 ТЭУ 初級（A1） · 點任何一句都會念給你聽';
  const back = L ? '<button class="btn ghost small" data-action="ru-lesson" data-n="0">← 所有課程</button>'
    : G ? '<button class="btn ghost small" data-action="ru-gram" data-id="">← 所有文法</button>' : '';
  const body = ruUi.tab === 'abc' ? abcView() : ruUi.tab === 'daily' ? dailyView()
    : ruUi.tab === 'gram' ? (G ? chapterView(G, GRAMMAR, 'gram') : gramList())
    : (L ? chapterView(L, LESSONS, 'lesson') : lessonList());
  return `<div class="page-head"><div>${back}<h1>${title}</h1><div class="sub">${sub}</div></div>
      <button class="btn small ${slow() ? 'primary' : ''}" data-action="ru-slow" title="念慢一點">🐢 慢速${slow() ? '開' : '關'}</button></div>
    ${ch ? '' : `<div class="seg ru-tabs" style="margin-bottom:12px">${TABS.map(([k, v]) =>
      `<button class="${ruUi.tab === k ? 'on' : ''}" data-action="ru-tab" data-t="${k}">${v}</button>`).join('')}</div>`}
    ${body}`;
}

function lessonList() {
  const row = l => `<div class="ev" data-action="ru-lesson" data-n="${l.n}">
      <span class="ru-num">${l.n}</span>
      <div class="main"><div class="title">${esc(l.title)}</div><div class="meta">${esc(l.learn)}</div></div><span class="fold">›</span></div>`;
  return `<h2 class="quiz-h2">入門：發音和第一句話</h2><section class="card">${LESSONS.slice(0, 8).map(row).join('')}</section>
    <h2 class="quiz-h2">生活情境：初級會考的話題</h2><section class="card">${LESSONS.slice(8, 15).map(row).join('')}</section>
    <h2 class="quiz-h2">考試</h2><section class="card">${LESSONS.slice(15).map(row).join('')}</section>
    <div class="sub" style="margin:10px 2px">每課大約 20～30 分鐘：先看講解、跟著 🔊 念例句，最後做小練習。講解裡的「📐」按鈕會帶你到對應的文法章節。</div>`;
}

function gramList() {
  return `<div class="sub" style="margin:0 2px 10px">ТЭУ 初級會考的文法都在這裡。照順序讀最順：G1～G7 是名詞、形容詞、動詞，G8～G13 是六個格，G14～G17 是常用句型。每章最後有選擇題。</div>
    <section class="card">${GRAMMAR.map((g, i) => `<div class="ev" data-action="ru-gram" data-id="${g.id}">
      <span class="ru-num">${i + 1}</span>
      <div class="main"><div class="title">${esc(g.title)}</div><div class="meta">${esc(g.learn)}</div></div><span class="fold">›</span></div>`).join('')}</section>`;
}

function chapterView(ch, all, kind) {
  const i = all.indexOf(ch), prev = all[i - 1], next = all[i + 1];
  const key = kind === 'lesson' ? `L${ch.n}` : ch.id;
  const label = c => kind === 'lesson' ? `第 ${c.n} 課` : c.id.toUpperCase();
  const go = c => kind === 'lesson' ? `data-action="ru-lesson" data-n="${c.n}"` : `data-action="ru-gram" data-id="${c.id}"`;
  return `${ch.sections.map((s, j) => {
    const g = s.see && GRAMMAR.find(x => x.id === s.see);
    return `<section class="card ru-sec">
      <h2 class="ru-h">${j + 1}. ${esc(s.h)}</h2>
      ${s.md ? `<div class="md ru-md">${mdLite(acc(s.md))}</div>` : ''}
      ${s.intro ? `<div class="ru-intro"><div class="ru-intro-head"><b>範文</b>
          <button class="btn small primary" data-action="ru-say" data-say="${esc(s.intro)}">▶ 念整段</button></div>
        <div class="ru-text">${esc(acc(s.intro))}</div><div class="sub">${esc(s.introZh)}</div></div>` : ''}
      ${s.ex ? `<div class="ru-words" style="margin-top:10px">${s.ex.map(wordBtn).join('')}</div>` : ''}
      ${g ? `<button class="btn small ru-see" data-action="ru-gram" data-id="${g.id}">📐 文法 ${g.id.toUpperCase()}：${esc(g.title)} ›</button>` : ''}
    </section>`;
  }).join('')}
    <section class="card ru-sec">
      <h2 class="ru-h">✏️ 小練習</h2>
      <div class="sub" style="margin-bottom:8px">選擇題點選項就會對答案；口說題先自己念，再點卡片看答案、聽發音。</div>
      <div class="ru-words">${ch.practice.map((p, j) => practiceItem(p, `${key}-${j}`)).join('')}</div>
    </section>
    <div class="row wrap" style="margin:4px 0 14px">
      <button class="btn" data-action="ru-cards" data-kind="${kind}" data-id="${kind === 'lesson' ? ch.n : ch.id}">🃏 例句加到字卡</button><span class="spacer"></span>
      ${prev ? `<button class="btn" ${go(prev)}>‹ ${label(prev)}</button>` : ''}
      ${next ? `<button class="btn primary" ${go(next)}>${label(next)} ›</button>` : ''}</div>`;
}

function practiceItem(p, key) {
  if (p[0] === 'pick') {
    const [, q, opts, ans, zh] = p;
    // 念出來的完整句：空格填正確答案，拿掉句尾的（提示）
    const full = q.replace('___', opts[ans]).replace(/\s*（[^）]*）\s*$/, '');
    const chosen = ruUi.picked[key], done = chosen != null;
    const [before, after = ''] = q.split('___');
    const blank = done ? `<u>${esc(acc(opts[ans]))}</u>` : '<span class="ru-blank">＿＿</span>';
    return `<div class="ru-word ru-pick ${done ? (chosen === ans ? 'ok' : 'bad') : ''}">
      <span class="ru-main"><small>選出正確的字</small>
        <span class="ru-text">${esc(acc(before))}${blank}${esc(acc(after))}</span>
        ${done ? `<small class="ru-ans">${chosen === ans ? '✓ 答對了' : `✕ 正確是 ${esc(acc(opts[ans]))}`} · ${esc(zh)}</small>` : ''}
        <span class="ru-opts">${opts.map((o, k) => `<button type="button" class="btn small${done && k === ans ? ' ok' : ''}${done && k === chosen && k !== ans ? ' bad' : ''}"
          data-action="ru-pick" data-k="${key}" data-i="${k}" data-say="${esc(full)}">${esc(acc(o))}</button>`).join('')}</span></span>
      ${done ? `<button type="button" class="btn ghost small" data-action="ru-say" data-say="${esc(full)}">🔊</button>` : ''}</div>`;
  }
  const [mode, ru, tr, zh] = p;
  const on = ruUi.shown.has(key);
  return `<button type="button" class="ru-word ru-prac ${on ? 'on' : ''}" data-action="ru-prac" data-k="${key}" data-say="${esc(ru)}">
    <span class="ru-spk">${mode === 'read' ? '👀' : '🗣️'}</span>
    <span class="ru-main"><small>${mode === 'read' ? '念念看' : '用俄文怎麼說？'}</small>
      <span class="ru-text">${esc(mode === 'read' ? acc(ru) : zh)}</span>
      ${on ? `<small class="ru-ans">${mode === 'read' ? `${esc(tr)} · ${esc(zh)}` : `${esc(acc(ru))} · ${esc(tr)}`}</small>` : ''}</span>
    <span class="ru-zh">${on ? '🔊' : '點我看答案'}</span></button>`;
}

// ---------- 每日單字 ----------
// 從第一次打開單字頁那天（prefs.ruStart）開始算第 1 天，每天 10 個，走完一輪再從頭
function todayIdx() {
  const start = store.prefs.ruStart || today();
  return Math.max(0, Math.round((parseYmd(today()) - parseYmd(start)) / 864e5));
}
const dayIdx = () => ((ruUi.day ?? todayIdx()) % DAYS + DAYS) % DAYS;
const dayWords = d => WORDS.slice(d * PER_DAY, d * PER_DAY + PER_DAY);

function dailyView() {
  const d = dayIdx(), list = dayWords(d), isToday = d === todayIdx() % DAYS;
  const topics = [...new Set(list.map(w => w.topic))].join('、');
  const hide = ruUi.hide;
  return `<section class="card ru-sec">
      <div class="row">
        <button class="btn small" data-action="ru-day" data-dir="-1" aria-label="前一天">‹</button>
        <div style="flex:1;text-align:center"><b>${isToday ? '今天' : `第 ${d + 1} 天`}的 ${list.length} 個單字</b>
          <div class="sub">第 ${d + 1} / ${DAYS} 天 · ${esc(topics)}</div></div>
        <button class="btn small" data-action="ru-day" data-dir="1" aria-label="後一天">›</button></div>
      <div class="row wrap" style="margin:10px 0">
        <div class="seg">${[['', '全部顯示'], ['zh', '🙈 遮中文'], ['ru', '🙈 遮俄文']].map(([k, v]) =>
          `<button class="${hide === k ? 'on' : ''}" data-action="ru-hide" data-h="${k}">${v}</button>`).join('')}</div>
        <span class="spacer"></span>
        ${isToday ? '' : '<button class="btn small" data-action="ru-day-today">回到今天</button>'}
        <button class="btn small" data-action="ru-day-all">▶ 全部念</button>
        <button class="btn small" data-action="ru-cards" data-kind="day" data-id="${d}">🃏 加到字卡</button></div>
      <div class="ru-words">${list.map(w => {
        const open = !hide || ruUi.shown.has('w:' + w.ru);
        const ru = hide === 'ru' && !open ? '<span class="ru-blank">？？？</span>' : esc(acc(w.ru));
        const zh = hide === 'zh' && !open ? '點我看中文' : esc(w.zh);
        return `<button type="button" class="ru-word" data-action="ru-word" data-say="${esc(w.ru)}">
          <span class="ru-spk">🔊</span><span class="ru-main"><span class="ru-text">${ru}</span></span><span class="ru-zh">${zh}</span></button>`;
      }).join('')}</div>
      <div class="sub" style="margin-top:8px">🧠 背法：先「全部顯示」跟著念 3 遍 → 切「遮中文」看俄文想意思 → 切「遮俄文」看中文說俄文。最後加到字卡，之後交給間隔複習。</div>
    </section>
    <h2 class="quiz-h2">📚 全部單字（${WORDS.length} 個，依主題）</h2>
    <section class="card">${WORD_TOPICS.map(([t, ws]) => {
      const open = ruUi.topic === t;
      return `<div class="gl-stage${open ? ' open' : ''}"><button type="button" class="gl-stage-head" data-action="ru-topic" data-t="${esc(t)}">
          <span class="gl-name"><b>${esc(t)}</b></span><span class="sub">${ws.length}</span><span class="gl-arrow">${open ? '▾' : '▸'}</span></button>
        ${open ? `<div class="ru-words" style="padding-bottom:12px">${ws.map(([ru, zh]) => wordBtn([ru, '', zh])).join('')}</div>` : ''}</div>`;
    }).join('')}</section>`;
}

// ---------- 字母表 ----------
function abcView() {
  if (ruUi.quiz != null) return quizView();
  const list = LETTERS.filter(l => ruUi.group === 'all' || l.g === ruUi.group);
  const sel = LETTERS[ruUi.letter ?? -1];
  const asList = ruUi.view === 'list';
  return `<div class="row wrap" style="margin-bottom:10px">
      <div class="seg">${Object.entries(GROUPS).map(([k, v]) => `<button class="${ruUi.group === k ? 'on' : ''}" data-action="ru-group" data-g="${k}">${v}</button>`).join('')}</div>
      <span class="spacer"></span>
      <div class="seg"><button class="${asList ? '' : 'on'}" data-action="ru-view" data-v="grid">格子</button><button class="${asList ? 'on' : ''}" data-action="ru-view" data-v="list">🧠 記憶法</button></div>
      <button class="btn small primary" data-action="ru-quiz">🎲 考我</button></div>
    ${ruUi.group === 'false' ? '<div class="sub" style="margin:0 2px 10px"><b>假朋友</b>：長得像英文，念法完全不同，最容易念錯！</div>' : ''}
    ${asList ? `<section class="card">${list.map(l => `<div class="ru-row">
        <button type="button" class="ru-big small ${l.g}" data-action="ru-say" data-say="${esc(l.name)}">${l.up}${l.lo}</button>
        <div class="ru-detail-main"><div><b>${esc(l.hint)}</b></div><div class="ru-mem">🧠 ${esc(MEM[l.up])}</div>
          ${wordBtn([l.w, '', l.wz])}</div></div>`).join('')}</section>`
    : `${sel ? `<section class="card ru-detail">
      <button type="button" class="ru-big" data-action="ru-say" data-say="${esc(sel.name)}">${sel.up}${sel.lo}</button>
      <div class="ru-detail-main"><div><span class="ru-tag ${sel.g}">${GROUP_TAG[sel.g]}</span> <b>${esc(sel.hint)}</b></div>
        <div class="ru-mem">🧠 ${esc(MEM[sel.up])}</div>
        <div style="margin-top:8px">${wordBtn([sel.w, '', sel.wz])}</div></div>
    </section>` : '<div class="sub" style="margin:0 2px 10px">點一個字母：聽它的名字、看怎麼念、記憶法和例字。顏色：綠＝像英文、橘＝假朋友、藍＝新字母。</div>'}
    <div class="ru-grid">${list.map(l => `<button type="button" class="ru-letter ${l.g}${ruUi.letter === l.i ? ' on' : ''}" data-action="ru-letter" data-i="${l.i}">
      <span>${l.up}${l.lo}</span><small>${esc(l.hint.split('（')[0].split('，')[0])}</small></button>`).join('')}</div>`}`;
}

function quizView() {
  const l = LETTERS[ruUi.quiz];
  return `<section class="card ru-quiz">
    <div class="sub">這個字母怎麼念？先在心裡念，再按揭曉 · 連續答對 ${ruUi.streak}</div>
    <div class="ru-quiz-letter">${l.up}${l.lo}</div>
    ${ruUi.quizShow ? `<div><b>${esc(l.hint)}</b></div><div class="ru-mem" style="max-width:420px;margin:6px auto">🧠 ${esc(MEM[l.up])}</div>
      <div style="margin:10px auto;max-width:320px">${wordBtn([l.w, '', l.wz])}</div>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button class="btn" data-action="ru-quiz-next" data-ok="0">😵 念錯了</button>
        <button class="btn primary" data-action="ru-quiz-next" data-ok="1">😎 念對了</button></div>`
    : `<button class="btn primary" data-action="ru-quiz-show">🔊 揭曉</button>`}
    <div style="margin-top:14px"><button class="btn ghost small" data-action="ru-quiz-end">← 回字母表</button></div>
  </section>`;
}

// ---------- 加到字卡 ----------
// 全部進同一個卡組「🇷🇺 俄文入門」；pid 用俄文本身，同一句不會重複加
function addCards(items, label) {
  let d = store.state.decks.find(x => x.preset === 'ru');
  const t = Date.now();
  if (!d) { d = { id: newId(), name: '🇷🇺 俄文入門', color: '#e11d48', preset: 'ru', lang: 'ru-RU', createdAt: t }; saveDoc('decks', d); }
  const have = new Set(store.state.cards.filter(c => c.deckId === d.id).map(c => c.pid));
  const seen = new Set();
  const add = items.map(([ru, tr, zh]) => ({ pid: 'ru:' + plain(ru), ru, tr, zh }))
    .filter(c => !have.has(c.pid) && !seen.has(c.pid) && seen.add(c.pid));
  add.forEach((c, i) => saveDoc('cards', { id: newId(), deckId: d.id, pid: c.pid, front: acc(c.ru), back: c.tr ? `${c.zh}\n${c.tr}` : c.zh, box: 0, due: '', createdAt: t + 1 + i }));
  ctx.toast(add.length ? `${label} ${add.length} 張加進「${d.name}」，到字卡頁複習（翻卡也能按 🔊）` : `${label}都已經在字卡裡了`);
}

function nextQuiz() {
  let i;
  do i = Math.floor(Math.random() * LETTERS.length); while (i === ruUi.quiz);
  ruUi.quiz = i; ruUi.quizShow = false;
}

const openChapter = () => { ruUi.shown.clear(); ruUi.picked = {}; ctx.render(); window.scrollTo(0, 0); };

export const russianActions = {
  'ru-tab': el => {
    ruUi.tab = el.dataset.t;
    if (ruUi.tab === 'daily' && !store.prefs.ruStart) savePrefs({ ruStart: today() });
    ruUi.shown.clear(); ctx.render();
  },
  'ru-slow': () => savePrefs({ ruSlow: !slow() }),
  'ru-lesson': el => { ruUi.tab = 'learn'; ruUi.lesson = +el.dataset.n || null; openChapter(); },
  'ru-gram': el => { ruUi.tab = 'gram'; ruUi.gram = el.dataset.id || null; openChapter(); },
  'ru-say': el => speak(el.dataset.say),
  'ru-prac': el => {
    speak(el.dataset.say);
    if (!ruUi.shown.has(el.dataset.k)) { ruUi.shown.add(el.dataset.k); ctx.render(); }
  },
  'ru-pick': el => {
    if (ruUi.picked[el.dataset.k] != null) { speak(el.dataset.say); return; }
    ruUi.picked[el.dataset.k] = +el.dataset.i; speak(el.dataset.say); ctx.render();
  },
  'ru-cards': el => {
    const { kind, id } = el.dataset;
    if (kind === 'day') return addCards(dayWords(+id).map(w => [w.ru, '', w.zh]), `第 ${+id + 1} 天的單字`);
    const ch = kind === 'lesson' ? LESSONS[+id - 1] : GRAMMAR.find(g => g.id === id);
    addCards(ch.sections.flatMap(s => s.ex || []), kind === 'lesson' ? `第 ${id} 課的例句` : `${id.toUpperCase()} 的例句`);
  },
  'ru-day': el => { ruUi.day = dayIdx() + +el.dataset.dir; ruUi.shown.clear(); ctx.render(); },
  'ru-day-today': () => { ruUi.day = null; ruUi.shown.clear(); ctx.render(); },
  'ru-day-all': () => dayWords(dayIdx()).forEach((w, i) => speak(w.ru, i > 0)),
  'ru-hide': el => { ruUi.hide = el.dataset.h; ruUi.shown.clear(); ctx.render(); },
  'ru-word': el => {
    speak(el.dataset.say);
    const k = 'w:' + el.dataset.say;
    if (ruUi.hide && !ruUi.shown.has(k)) { ruUi.shown.add(k); ctx.render(); }
  },
  'ru-topic': el => { ruUi.topic = ruUi.topic === el.dataset.t ? null : el.dataset.t; ctx.render(); },
  'ru-group': el => { ruUi.group = el.dataset.g; ctx.render(); },
  'ru-view': el => { ruUi.view = el.dataset.v; ctx.render(); },
  'ru-letter': el => { const l = LETTERS[+el.dataset.i]; ruUi.letter = l.i; speak(l.name); ctx.render(); },
  'ru-quiz': () => { ruUi.streak = 0; nextQuiz(); ctx.render(); window.scrollTo(0, 0); },
  'ru-quiz-show': () => { const l = LETTERS[ruUi.quiz]; ruUi.quizShow = true; speak(l.name); ctx.render(); },
  'ru-quiz-next': el => {
    ruUi.streak = el.dataset.ok === '1' ? ruUi.streak + 1 : 0;
    if (ruUi.streak === 20) ctx.toast('🎉 連續答對 20 個！字母過關');
    nextQuiz(); ctx.render();
  },
  'ru-quiz-end': () => { ruUi.quiz = null; ctx.render(); },
};
