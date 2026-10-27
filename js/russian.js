// 俄文（#russian）：8 週入門計畫＋字母表，每個字、每句都能按 🔊 聽（speak.js，手機內建語音）。
// 進度存 prefs.ruDone {taskId: ts}、慢速存 prefs.ruSlow；單字可以一鍵加到字卡（卡組 preset 'ru'，lang ru-RU → 翻卡時也有 🔊）。
// 資料裡重音寫成母音後面加 '（приве'т），畫面上換成重音符號、念的時候拿掉。
import { store, newId, saveDoc, savePrefs } from './store.js';
import { esc } from './util.js';
import { say, hasVoice } from './speak.js';

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

// ---------- 8 週計畫 ----------
// 每天大約 20–30 分鐘；照自己的速度，不用剛好一週
const WEEKS = [
  {
    name: '字母①：像英文的＋假朋友', goal: '12 個長得像英文的字母會念，讀得出第一批單字',
    tip: '俄文字母只有 33 個，拼音規則很規律：會念字母就幾乎什麼都念得出來（除了重音）。',
    tasks: [
      '到「字母」分頁按「像英文」：5 個字母點一遍、跟著念',
      '按「假朋友」：7 個長得像英文、念法卻不同的字母（最容易念錯）',
      '下面 10 個單字：先自己念，再按 🔊 對答案',
      '彈舌 р：每天 2 分鐘念「т-р-р-р」（念不出來很正常，先用舌尖輕彈）',
      '按「🃏 加到字卡」，複習到全部「會了」',
    ],
    words: [
      ['кот', 'kot', '貓（公）'], ["ма'ма", 'MA-ma', '媽媽'], ["метро'", 'mye-TRO', '地鐵'], ["Москва'", 'mask-VA', '莫斯科'],
      ['сок', 'sok', '果汁'], ['нос', 'nos', '鼻子'], ['торт', 'tort', '蛋糕'], ["ка'рта", 'KAR-ta', '地圖'],
      ["раке'та", 'ra-KYE-ta', '火箭'], ["рестора'н", 'ryes-ta-RAN', '餐廳'],
    ],
  },
  {
    name: '字母②：新字母', goal: '33 個字母全部會念，看得懂路牌和招牌',
    tip: 'Ж Ш Щ Ч Ц 就是中文的 ㄖ ㄕ ㄒ ㄑ ㄘ，這是中文母語者的大優勢，歐美人學這幾個很痛苦。',
    tasks: [
      'Б Г Д Л П Ф З И Й：像希臘字母，好認',
      'Ж Ш Щ Ч Ц：用注音的感覺去念',
      'Ы Э Ю Я Ё：Ы 嘴型念「伊」、舌頭往後縮',
      'Ь Ъ：兩個不發音的符號，Ь 讓前面的子音變軟',
      '重音規則：沒重音的 о 念成「啊」— молоко́ 念 ma-la-KO',
      '字母分頁按「🎲 考我」，連續答對 20 個',
    ],
    words: [
      ["ро'бот", 'RO-bat', '機器人'], ['банк', 'bank', '銀行'], ["шко'ла", 'SHKO-la', '學校'], ['чай', 'chai', '茶'],
      ['борщ', 'borshch', '羅宋湯'], ["журна'л", 'zhur-NAL', '雜誌'], ['мы', 'my', '我們'], ['соль', "sol'", '鹽'],
      ["я'блоко", 'YA-bla-ka', '蘋果'], ["молоко'", 'ma-la-KO', '牛奶'], ['ёлка', 'YOL-ka', '樅樹、聖誕樹'], ["игра'", 'i-GRA', '遊戲'],
    ],
  },
  {
    name: '打招呼＋自我介紹', goal: '能跟俄國人打招呼、講出名字和從哪裡來',
    tip: 'Здравствуйте 第一個 в 不發音，念 ZDRAST-vuy-tye。對朋友說 Привет、對長輩老師說 Здравствуйте。',
    tasks: [
      '分清楚正式／非正式：Привет vs Здравствуйте、Пока vs До свидания',
      '每句跟讀 3 次（覺得太快就開 🐢 慢速）',
      '用手機錄一段：Здравствуйте! Меня зовут… Я из Тайваня.',
      'YouTube 看一集 Russian With Max（全俄文慢速、有字幕）',
      '加到字卡，複習到全部「會了」',
    ],
    words: [
      ["Приве'т!", 'pri-VYET', '嗨（對朋友）'], ["Здра'вствуйте!", 'ZDRAST-vuy-tye', '您好（正式）'],
      ["До'брое у'тро!", 'DOB-ra-ye OO-tra', '早安'], ["До'брый ве'чер!", 'DOB-ryi VYE-chyer', '晚上好'],
      ["Пока'!", 'pa-KA', '掰掰'], ["До свида'ния!", 'da svi-DA-ni-ya', '再見'],
      ["Спаси'бо!", 'spa-SI-ba', '謝謝'], ["Пожа'луйста", 'pa-ZHA-lus-ta', '不客氣／請'],
      ['Да. / Нет.', 'da / nyet', '是／不是'], ["Как дела'?", 'kak dye-LA', '你好嗎？'], ["Хорошо'!", 'kha-ra-SHO', '很好！'],
      ["Меня' зову'т Джо'зеф.", 'mye-NYA za-VUT JO-zef', '我叫 Joseph。'], ["Я из Тайва'ня.", 'ya iz tai-VA-nya', '我來自台灣。'],
      ["О'чень прия'тно!", 'O-chyen pri-YAT-na', '很高興認識你！'], ["Я студе'нт.", 'ya stu-DYENT', '我是學生。'],
      ["Я изуча'ю ру'сский язы'к.", 'ya i-zu-CHA-yu RUS-kiy ya-ZYK', '我在學俄文。'],
    ],
  },
  {
    name: '數字＋問價錢', goal: '0–10、20、100 會念，會問多少錢',
    tip: '數字最好的練法：手機時間、價錢、門牌，看到就在心裡用俄文念。',
    tasks: [
      '0–10 跟讀，再倒著念一次 10 → 0',
      '20、100 和「Сколько стоит?」',
      '這週看到任何數字（時鐘、價錢）都用俄文念',
      '加到字卡，複習到全部「會了」',
    ],
    words: [
      ['ноль', "nol'", '0'], ["оди'н", 'a-DIN', '1'], ['два', 'dva', '2'], ['три', 'tri', '3'], ["четы'ре", 'chye-TY-rye', '4'],
      ['пять', "pyat'", '5'], ['шесть', "shest'", '6'], ['семь', "syem'", '7'], ["во'семь", "VO-syem'", '8'],
      ["де'вять", "DYE-vyat'", '9'], ["де'сять", "DYE-syat'", '10'], ["два'дцать", "DVA-tsat'", '20'], ['сто', 'sto', '100'],
      ["Ско'лько сто'ит?", "SKOL'-ka STO-it", '這個多少錢？'], ['рубль', "rubl'", '盧布'], ["До'рого!", 'DO-ra-ga', '好貴！'],
    ],
  },
  {
    name: '名詞性別＋「我有…」', goal: '看字尾分得出陽性／陰性／中性，會說我有什麼',
    tip: '看最後一個字母就好：子音結尾＝陽性、-а／-я＝陰性、-о／-е＝中性。「我的」也要跟著變：мой／моя／моё。',
    tasks: [
      '背規則：子音＝陽、-а -я＝陰、-о -е＝中',
      'он／она／оно 代替名詞：стол → он、кошка → она、окно → оно',
      'мой／моя／моё 跟著性別變',
      '用 У меня есть… 說出 3 樣你有的東西',
      '加到字卡，複習到全部「會了」',
    ],
    words: [
      ["он · она' · оно'", 'on · a-NA · a-NO', '他 · 她 · 它'], ['стол', 'stol', '桌子（陽）'], ["ко'шка", 'KOSH-ka', '貓（陰）'],
      ["окно'", 'ak-NO', '窗戶（中）'], ["мой телефо'н", 'moy tye-lye-FON', '我的手機（陽）'], ["моя' кни'га", 'ma-YA KNI-ga', '我的書（陰）'],
      ["моё окно'", 'ma-YO ak-NO', '我的窗戶（中）'], ["Э'то мой друг.", 'E-ta moy drug', '這是我的朋友。'],
      ["У меня' есть ко'шка.", "u mye-NYA yest' KOSH-ka", '我有一隻貓。'], ["У тебя' есть брат?", "u tye-BYA yest' brat", '你有兄弟嗎？'],
    ],
  },
  {
    name: '動詞現在式＋救命句', goal: '兩種動詞變化會念，聽不懂時知道怎麼說',
    tip: '俄文動詞跟著「誰」變字尾。先記兩組：читать（-ю -ешь -ет -ем -ете -ют）和 говорить（-ю -ишь -ит -им -ите -ят）。',
    tasks: [
      'читать 6 種人稱連著念 3 次',
      'говорить 6 種人稱連著念 3 次',
      '救命句：我聽不懂／請說慢一點／請再說一次',
      '自己造 3 句：Я читаю… / Я говорю…',
      '加到字卡，複習到全部「會了」',
    ],
    words: [
      ["я чита'ю", 'ya chi-TA-yu', '我讀'], ["ты чита'ешь", 'ty chi-TA-yesh', '你讀'], ["он чита'ет", 'on chi-TA-yet', '他讀'],
      ["мы чита'ем", 'my chi-TA-yem', '我們讀'], ["вы чита'ете", 'vy chi-TA-ye-tye', '您／你們讀'], ["они' чита'ют", 'a-NI chi-TA-yut', '他們讀'],
      ["я говорю'", 'ya ga-va-RYU', '我說'], ["ты говори'шь", 'ty ga-va-RISH', '你說'], ["они' говоря'т", 'a-NI ga-va-RYAT', '他們說'],
      ["Я немно'го говорю' по-ру'сски.", 'ya nyem-NO-ga ga-va-RYU pa-RUS-ki', '我會說一點俄文。'],
      ["Вы говори'те по-англи'йски?", 'vy ga-va-RI-tye pa-an-GLIY-ski', '您會說英文嗎？'],
      ["Я не понима'ю.", 'ya nye pa-ni-MA-yu', '我聽不懂。'], ["Повтори'те, пожа'луйста.", 'paf-ta-RI-tye pa-ZHA-lus-ta', '請再說一次。'],
      ["Ме'дленнее, пожа'луйста.", 'MYED-lye-nye-ye pa-ZHA-lus-ta', '請說慢一點。'],
    ],
  },
  {
    name: '咖啡廳＋點餐', goal: '從進門點餐到買單，全程用俄文',
    tip: 'Можно…?（可以…嗎？）是萬用句：Можно меню? Можно воду? 加上 пожалуйста 就很有禮貌。',
    tasks: [
      '點餐句子跟讀',
      '認識 3 道俄羅斯食物：пельмени、блины、борщ',
      '角色扮演：自己當客人，從進門點到買單念一遍',
      '加到字卡，複習到全部「會了」',
    ],
    words: [
      ["Мо'жно меню'?", 'MOZH-na mye-NYU', '可以給我菜單嗎？'], ["Я хочу' ко'фе.", 'ya kha-CHU KO-fye', '我想要咖啡。'],
      ["Чай, пожа'луйста.", 'chai pa-ZHA-lus-ta', '請給我茶。'], ["Вку'сно!", 'FKUS-na', '好吃！'],
      ["Ско'лько с меня'?", "SKOL'-ka s mye-NYA", '我要付多少？'], ["Счёт, пожа'луйста.", 'shchyot pa-ZHA-lus-ta', '買單，謝謝。'],
      ["Где туале'т?", 'gdye tu-a-LYET', '廁所在哪裡？'], ["пельме'ни", "pyel'-MYE-ni", '俄式水餃'], ["блины'", 'bli-NY', '俄式薄餅'],
    ],
  },
  {
    name: '「在…」＋完整自我介紹', goal: '不看稿講完一段 30 秒的自我介紹',
    tip: '「在某地」用 в ＋ 字尾變 -е：Москва → в Москве、Тайвань → в Тайване。這是你學的第一個「格」。',
    tasks: [
      'в ＋ 地點：Москва → в Москве（字尾換成 -е）',
      '按「▶ 念整段」跟讀下面的自我介紹',
      '不看稿講一次，錄音跟 🔊 比較',
      '回頭把 1–7 週字卡全部複習一次',
      '🎉 入門完成！下一步：Duolingo 俄文每天 10 分鐘，目標 ТРКИ 基礎級（A2）',
    ],
    words: [
      ["в Москве'", 'v mask-VYE', '在莫斯科'], ["Я живу' в Тайва'не.", 'ya zhi-VU f tai-VA-nye', '我住在台灣。'],
      ['Где ты живёшь?', 'gdye ty zhi-VYOSH', '你住哪裡？'], ["Я учу'сь в университе'те.", "ya u-CHUS' v u-ni-vyer-si-TYE-tye", '我在大學念書。'],
      ["Я учу'сь в магистрату'ре.", "ya u-CHUS' v ma-gis-tra-TU-rye", '我在讀碩士。'],
      ["Я изуча'ю робототе'хнику.", 'ya i-zu-CHA-yu ra-ba-ta-TYEKH-ni-ku', '我研究機器人學。'],
      ["Я люблю' видеои'гры.", 'ya lyu-BLYU vi-dye-a-I-gry', '我喜歡電玩。'], ["Сейча'с", 'sye-CHAS', '現在'],
    ],
    intro: "Здра'вствуйте! Меня' зову'т Джо'зеф. Я из Тайва'ня. Я студе'нт, я учу'сь в магистрату'ре. Я изуча'ю робототе'хнику. Я люблю' игра'ть в видеои'гры. Сейча'с я изуча'ю ру'сский язы'к. О'чень прия'тно!",
    introZh: '您好！我叫 Joseph，來自台灣。我是學生，在讀碩士，研究機器人學。我喜歡打電動。現在我在學俄文。很高興認識你！',
  },
].map((w, i) => ({ ...w, n: i + 1, tasks: w.tasks.map((t, j) => ({ id: `ru${i + 1}-${j}`, text: t })) }));

const RESOURCES = [
  ['📱', 'Duolingo 俄文', '英文介面，每天 10 分鐘，跟這裡的計畫一起用'],
  ['📺', 'YouTube：Russian With Max', '全俄文慢速講生活話題，第 3 週開始看'],
  ['🔊', 'Forvo.com', '真人發音字典，內建語音念得怪的時候查'],
  ['📘', '課本《走遍俄羅斯》', '有中文解說，第 8 週之後想更系統就買第一冊'],
  ['⌨️', 'iPhone 加俄文鍵盤', '設定 → 一般 → 鍵盤 → 新增鍵盤 → 俄文'],
];

export const ruUi = { tab: 'plan', open: null, group: 'all', letter: null, quiz: null, quizShow: false, streak: 0 };

const done = () => store.prefs.ruDone || {};
const slow = () => !!store.prefs.ruSlow;
const weekDone = w => w.tasks.filter(t => done()[t.id]).length;
const curWeek = () => WEEKS.find(w => weekDone(w) < w.tasks.length) || WEEKS[WEEKS.length - 1];
const allTasks = WEEKS.flatMap(w => w.tasks);

function speak(text, queue) {
  if (!say(text, { slow: slow(), queue })) { ctx.toast('這個瀏覽器不能念出聲音'); return; }
  if (!hasVoice('ru-RU')) ctx.toast('這台裝置沒有俄文語音：iPhone 到 設定 → 輔助使用 → 朗讀內容 → 聲音 → 俄文 下載');
}

// ---------- 畫面 ----------
export function renderRussian() {
  const n = allTasks.filter(t => done()[t.id]).length;
  const cw = curWeek();
  return `<div class="page-head"><div><h1>🇷🇺 俄文</h1>
      <div class="sub">第 ${cw.n} 週：${esc(cw.name)} · 總進度 ${n}/${allTasks.length}</div></div>
      <button class="btn small ${slow() ? 'primary' : ''}" data-action="ru-slow" title="念慢一點">🐢 慢速${slow() ? '開' : '關'}</button></div>
    <div class="prog-bar" style="margin:-4px 0 12px"><div style="width:${n / allTasks.length * 100}%;background:var(--ok)"></div></div>
    <div class="seg" style="margin-bottom:12px">
      <button class="${ruUi.tab === 'plan' ? 'on' : ''}" data-action="ru-tab" data-t="plan">📅 8 週計畫</button>
      <button class="${ruUi.tab === 'abc' ? 'on' : ''}" data-action="ru-tab" data-t="abc">🔤 字母</button></div>
    ${ruUi.tab === 'abc' ? abcView() : planView()}`;
}

function planView() {
  const cur = curWeek();
  const openId = ruUi.open ?? cur.n;
  return `<section class="card">${WEEKS.map(w => weekBlock(w, cur, openId)).join('')}</section>
    <h2 class="quiz-h2">🧰 搭配用的資源</h2>
    <section class="card">${RESOURCES.map(([e, t, s]) => `<div class="ev" style="cursor:default"><span style="font-size:20px">${e}</span>
      <div class="main"><div class="title">${esc(t)}</div><div class="meta">${esc(s)}</div></div></div>`).join('')}</section>
    <div class="sub" style="margin:10px 2px">每天 20–30 分鐘就夠，照自己的速度，一週沒做完就拖到下週。點任何一句都會念給你聽。</div>`;
}

function weekBlock(w, cur, openId) {
  const n = weekDone(w);
  const open = openId === w.n;
  const state = w === cur ? 'now' : n === w.tasks.length ? 'past' : 'future';
  const tag = w === cur ? '<span class="gl-tag now">進行中</span>' : n === w.tasks.length ? '<span class="gl-tag ok">完成</span>' : '';
  return `<div class="gl-stage ${state}${open ? ' open' : ''}">
    <button type="button" class="gl-stage-head" data-action="ru-week" data-n="${w.n}">
      <span class="gl-num">W${w.n}</span>
      <span class="gl-name"><b>${esc(w.name)}</b> ${tag}<small class="sub">${esc(w.goal)}</small></span>
      <span class="sub">${n}/${w.tasks.length}</span><span class="gl-arrow">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? `<div class="gl-stage-body">
      <div class="sub gl-goal">💡 ${esc(w.tip)}</div>
      ${w.tasks.map(t => {
        const on = !!done()[t.id];
        return `<div class="gl-item ${on ? 'done' : ''}">
          <button type="button" class="check small ${on ? 'on' : ''}" data-action="ru-task" data-id="${t.id}">${on ? '✓' : ''}</button>
          <span class="text">${esc(t.text)}</span></div>`;
      }).join('')}
      ${w.intro ? `<div class="ru-intro"><div class="ru-intro-head"><b>📣 自我介紹</b>
          <button class="btn small primary" data-action="ru-say" data-say="${esc(w.intro)}">▶ 念整段</button></div>
        <div class="ru-text">${esc(acc(w.intro))}</div><div class="sub">${esc(w.introZh)}</div></div>` : ''}
      <div class="row wrap" style="margin:12px 0 6px">
        <b style="font-size:14px">單字＆句子</b><span class="spacer"></span>
        <button class="btn small" data-action="ru-say-all" data-n="${w.n}">▶ 全部念一遍</button>
        <button class="btn small" data-action="ru-cards" data-n="${w.n}">🃏 加到字卡</button></div>
      <div class="ru-words">${w.words.map(([ru, tr, zh]) => `<button type="button" class="ru-word" data-action="ru-say" data-say="${esc(ru)}">
        <span class="ru-spk">🔊</span><span class="ru-main"><span class="ru-text">${esc(acc(ru))}</span><small>${esc(tr)}</small></span>
        <span class="ru-zh">${esc(zh)}</span></button>`).join('')}</div>
    </div>` : ''}
  </div>`;
}

function abcView() {
  if (ruUi.quiz != null) return quizView();
  const list = LETTERS.filter(l => ruUi.group === 'all' || l.g === ruUi.group);
  const sel = LETTERS[ruUi.letter ?? -1];
  return `<div class="row wrap" style="margin-bottom:10px">
      <div class="seg">${Object.entries(GROUPS).map(([k, v]) => `<button class="${ruUi.group === k ? 'on' : ''}" data-action="ru-group" data-g="${k}">${v}</button>`).join('')}</div>
      <span class="spacer"></span><button class="btn small primary" data-action="ru-quiz">🎲 考我</button></div>
    ${sel ? `<section class="card ru-detail">
      <button type="button" class="ru-big" data-action="ru-say" data-say="${esc(sel.name)}">${sel.up}${sel.lo}</button>
      <div class="ru-detail-main"><div><span class="ru-tag ${sel.g}">${GROUP_TAG[sel.g]}</span> <b>${esc(sel.hint)}</b></div>
        <button type="button" class="ru-word" data-action="ru-say" data-say="${esc(sel.w)}" style="margin-top:8px">
          <span class="ru-spk">🔊</span><span class="ru-main"><span class="ru-text">${esc(acc(sel.w))}</span></span><span class="ru-zh">${esc(sel.wz)}</span></button></div>
    </section>` : `<div class="sub" style="margin:0 2px 10px">點一個字母聽它的名字、看怎麼念和例字。${ruUi.group === 'false' ? '<b>假朋友</b>：長得像英文，念法完全不同，最容易念錯！' : ''}</div>`}
    <div class="ru-grid">${list.map(l => `<button type="button" class="ru-letter ${l.g}${ruUi.letter === l.i ? ' on' : ''}" data-action="ru-letter" data-i="${l.i}">
      <span>${l.up}${l.lo}</span><small>${esc(l.hint.split('（')[0].split('，')[0])}</small></button>`).join('')}</div>`;
}

function quizView() {
  const l = LETTERS[ruUi.quiz];
  return `<section class="card ru-quiz">
    <div class="sub">這個字母怎麼念？先在心裡念，再按揭曉 · 連續答對 ${ruUi.streak}</div>
    <div class="ru-quiz-letter">${l.up}${l.lo}</div>
    ${ruUi.quizShow ? `<div><b>${esc(l.hint)}</b></div>
      <button type="button" class="ru-word" data-action="ru-say" data-say="${esc(l.w)}" style="margin:10px auto;max-width:320px">
        <span class="ru-spk">🔊</span><span class="ru-main"><span class="ru-text">${esc(acc(l.w))}</span></span><span class="ru-zh">${esc(l.wz)}</span></button>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button class="btn" data-action="ru-quiz-next" data-ok="0">😵 念錯了</button>
        <button class="btn primary" data-action="ru-quiz-next" data-ok="1">😎 念對了</button></div>`
    : `<button class="btn primary" data-action="ru-quiz-show">🔊 揭曉</button>`}
    <div style="margin-top:14px"><button class="btn ghost small" data-action="ru-quiz-end">← 回字母表</button></div>
  </section>`;
}

// ---------- 加到字卡 ----------
function addCards(n) {
  const w = WEEKS[n - 1];
  let d = store.state.decks.find(x => x.preset === 'ru');
  const t = Date.now();
  if (!d) { d = { id: newId(), name: '🇷🇺 俄文入門', color: '#e11d48', preset: 'ru', lang: 'ru-RU', createdAt: t }; saveDoc('decks', d); }
  const have = new Set(store.state.cards.filter(c => c.deckId === d.id).map(c => c.pid));
  const add = w.words.map(([ru, tr, zh], i) => ({ pid: `ru${n}-${i}`, ru, tr, zh })).filter(c => !have.has(c.pid));
  add.forEach((c, i) => saveDoc('cards', { id: newId(), deckId: d.id, pid: c.pid, front: acc(c.ru), back: `${c.zh}\n${c.tr}`, box: 0, due: '', createdAt: t + 1 + i }));
  ctx.toast(add.length ? `第 ${n} 週 ${add.length} 張加進「${d.name}」，到字卡頁複習（翻卡也能按 🔊）` : '這週的字卡已經加過了');
}

function nextQuiz() {
  let i;
  do i = Math.floor(Math.random() * LETTERS.length); while (i === ruUi.quiz);
  ruUi.quiz = i; ruUi.quizShow = false;
}

export const russianActions = {
  'ru-tab': el => { ruUi.tab = el.dataset.t; ctx.render(); },
  'ru-slow': () => savePrefs({ ruSlow: !slow() }),
  'ru-week': el => { const n = +el.dataset.n; ruUi.open = (ruUi.open ?? curWeek().n) === n ? 0 : n; ctx.render(); },
  'ru-task': el => {
    const d = { ...done() };
    if (d[el.dataset.id]) delete d[el.dataset.id]; else d[el.dataset.id] = Date.now();
    const before = curWeek().n;
    savePrefs({ ruDone: d });
    const after = curWeek().n;
    if (after !== before && after > before) { ruUi.open = null; ctx.toast(`🎉 第 ${before} 週完成！進入第 ${after} 週`); }
  },
  'ru-say': el => speak(el.dataset.say),
  'ru-say-all': el => { WEEKS[+el.dataset.n - 1].words.forEach(([ru], i) => speak(ru, i > 0)); },
  'ru-cards': el => addCards(+el.dataset.n),
  'ru-group': el => { ruUi.group = el.dataset.g; ctx.render(); },
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
