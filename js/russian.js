// 俄文（#russian）：教學式入門 8 課（講解＋例句＋小練習）＋字母表，每個字、每句都能按 🔊 聽（speak.js，手機內建語音）。
// 不記進度，想看哪課就點哪課；慢速存 prefs.ruSlow。例句可以一鍵加到字卡（卡組 preset 'ru'，lang ru-RU → 翻卡時也有 🔊）。
// 資料裡重音寫成母音後面加 '（приве'т），畫面上換成重音符號、念的時候拿掉。
import { store, newId, saveDoc, savePrefs } from './store.js';
import { esc, mdLite } from './util.js';
import { say, hasVoice, plain } from './speak.js';

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

// ---------- 課程 ----------
// sections：{ h 標題, md 講解（mdLite，可用 '標重音）, ex 例句 [俄文, 拼音, 中文] }
// practice：['read', 俄文, 拼音, 中文]＝看俄文念念看；['say', 俄文, 拼音, 中文]＝看中文說俄文
const LESSONS = [
  {
    title: '字母①：像英文的＋假朋友', learn: '12 個字母，讀得出 Москва、метро',
    sections: [
      { h: '先知道：俄文怎麼「念」', md: `俄文用**西里爾字母**，一共 33 個。
好消息：俄文**看到字就會念**，拼法跟發音幾乎一對一，不像英文同一個字母有好幾種念法。
唯一要另外記的是**重音**：每個字有一個音節念得比較重、比較長。課本會標成 ма'ма，真正的俄文書不標，所以學單字時重音要一起記。
🧠 這一課先學 12 個「長得像英文」的字母，學完就能讀出很多字了。` },
      { h: '5 個送分字母：А К М О Т', md: `長得像英文、念法也一樣：
| 字母 | 念法 |
|---|---|
| А а | a「啊」 |
| К к | k |
| М м | m |
| О о | o「喔」 |
| Т т | t |`, ex: [['кот', 'kot', '貓（公）'], ["ма'ма", 'MA-ma', '媽媽'], ['ток', 'tok', '電流']] },
      { h: '7 個假朋友：В Е Н Р С У Х', md: `長得像英文，**念法完全不同**，初學最容易念錯：
| 俄文 | 看起來像 | 其實念 | 🧠 記法 |
|---|---|---|---|
| В в | B | **v** | Vodka 的 V |
| Е е | E | **ye**「耶」 | E 前面多一聲耶 |
| Н н | H | **n** | нет（不）＝ No |
| Р р | P | **r**（彈舌） | Россия 俄羅斯 |
| С с | C | **s** | СССР 蘇聯 |
| У у | y | **u**「嗚」 | 眼淚往下滴 |
| Х х | X | **h**「喝」 | хаха 哈哈 |`, ex: [["метро'", 'mye-TRO', '地鐵'], ['нос', 'nos', '鼻子'], ['сок', 'sok', '果汁'], ['торт', 'tort', '蛋糕'], ["у'тро", 'OO-tra', '早上'], ['хор', 'khor', '合唱團'], ["Москва'", 'mask-VA', '莫斯科'], ["рестора'н", 'ryes-ta-RAN', '餐廳']] },
      { h: '彈舌 Р 怎麼練', md: `舌尖輕輕貼在**上排牙齒後面的牙齦**，用力吐氣，讓舌尖被氣流吹得抖起來。
- 先快速連念「特了、特了、特了」，越念越快，「特」的位置就是舌頭要彈的地方
- 念不出來很正常，很多俄國小孩也要練到 5、6 歲；先用舌尖輕彈一下代替也聽得懂
🧠 每天刷牙後練 1 分鐘「т-р-р-р」，兩三週就會突然彈出來。`, ex: [["ра'дио", 'RA-di-a', '收音機'], ["ка'рта", 'KAR-ta', '地圖'], ["раке'та", 'ra-KYE-ta', '火箭']] },
    ],
    practice: [['read', "Москва'", 'mask-VA', '莫斯科'], ['read', "метро'", 'mye-TRO', '地鐵'], ['read', 'торт', 'tort', '蛋糕'],
      ['read', "у'тро", 'OO-tra', '早上'], ['read', "рестора'н", 'ryes-ta-RAN', '餐廳'], ['read', "ка'рта", 'KAR-ta', '地圖']],
  },
  {
    title: '字母②：新字母', learn: '33 個字母全會，看得懂路牌和招牌',
    sections: [
      { h: '像希臘字母的：Б Г Д Л П Ф З', md: `| 字母 | 念法 | 🧠 記法 |
|---|---|---|
| Б б | b | 像 6 → 6 個 Banana |
| Г г | g | 絞刑台 Gallows |
| Д д | d | 像房子 → дом |
| Л л | l | 屋頂 Λ |
| П п | p | 圓周率 π |
| Ф ф | f | 希臘字母 φ |
| З з | z | 像 3 → 3 隻斑馬 zebra |`, ex: [['банк', 'bank', '銀行'], ['дом', 'dom', '家、房子'], ['парк', 'park', '公園'], ["фо'то", 'FO-ta', '照片'], ["зима'", 'zi-MA', '冬天'], ["газе'та", 'ga-ZYE-ta', '報紙']] },
      { h: '注音字母：Ж Ш Щ Ч Ц', md: `這 5 個就是中文的捲舌音和 ㄘ，**中文母語者的大優勢**，歐美人學這幾個很痛苦：
| 字母 | 像注音 | 🧠 記法 |
|---|---|---|
| Ж ж | ㄖ（更硬） | 像甲蟲 жук |
| Ш ш | ㄕ | 長得就是「山」 |
| Щ щ | 長的ㄒ | 山多一條尾巴 |
| Ч ч | ㄑ／ㄔ | 像 4 → четы'ре |
| Ц ц | ㄘ | U 拖小尾巴 |`, ex: [["журна'л", 'zhur-NAL', '雜誌'], ["шко'ла", 'SHKO-la', '學校'], ['борщ', 'borshch', '羅宋湯'], ['чай', 'chai', '茶'], ['цирк', 'tsirk', '馬戲團']] },
      { h: '母音：硬母音和軟母音成對', md: `俄文有 10 個母音，分成兩排，**軟母音＝硬母音前面加一個 y 音**：
| 硬 | а | э | ы | о | у |
|---|---|---|---|---|---|
| **軟** | **я** ya | **е** ye | **и** i | **ё** yo | **ю** yu |
🧠 記一排就好：а э ы о у，下面那排都是「加 y」的版本。
- **Ы**：嘴型念「伊」，舌頭往後縮，像肚子被打一拳的「呃伊」
- **Й**：И 戴帽子，很短的「伊」，只跟在母音後面（мой、чай）
- **Ё**：一定是重音，所以有 ё 的字不用另外記重音`, ex: [['мы', 'my', '我們'], ["э'то", 'E-ta', '這是'], ["ю'бка", 'YUP-ka', '裙子'], ["я'блоко", 'YA-bla-ka', '蘋果'], ['ёлка', 'YOL-ka', '樅樹、聖誕樹'], ["игра'", 'i-GRA', '遊戲'], ['мой', 'moy', '我的']] },
      { h: '兩個不發音的符號：Ь Ъ', md: `- **Ь 軟音符號**：自己不發音，讓前面的子音「變軟」，像在後面輕輕帶一點「伊」。мат（將死）和 мать（母親）就是不同的字
- **Ъ 硬音符號**：很少見，像一道牆把前後隔開，подъе'зд 念 pad-YEZD（d 和 ye 分開念）
🧠 Ь 是小枕頭（讓子音躺軟），Ъ 是一道牆（隔開）。`, ex: [['соль', "sol'", '鹽'], ['пять', "pyat'", '五'], ["подъе'зд", 'pad-YEZD', '大樓入口']] },
      { h: '重音的大秘密：沒重音的 О 念「啊」', md: `這是俄文發音最重要的規則：**О 只有在重音時念「喔」，沒重音就念「啊」**。
| 寫成 | 實際念 |
|---|---|
| молоко' | ma-la-**KO** |
| хорошо' | kha-ra-**SHO** |
| Москва' | mask-**VA** |
🧠 俄國人很懶：只有重音那個 о 認真念，其他 о 都張嘴隨便「啊」過去。（Е、Я 沒重音時也會變弱，接近「伊」）`, ex: [["молоко'", 'ma-la-KO', '牛奶'], ["хорошо'", 'kha-ra-SHO', '很好'], ["окно'", 'ak-NO', '窗戶'], ["ро'бот", 'RO-bat', '機器人']] },
    ],
    practice: [['read', "шко'ла", 'SHKO-la', '學校'], ['read', "молоко'", 'ma-la-KO', '牛奶'], ['read', "я'блоко", 'YA-bla-ka', '蘋果'],
      ['read', 'борщ', 'borshch', '羅宋湯'], ['read', "журна'л", 'zhur-NAL', '雜誌'], ['read', "хорошо'", 'kha-ra-SHO', '很好'], ['read', "ро'бот", 'RO-bat', '機器人']],
  },
  {
    title: '打招呼＋自我介紹', learn: '打招呼、說名字和從哪裡來',
    sections: [
      { h: '打招呼：分正式和不正式', md: `俄文分「你」（ты，朋友、家人）和「您」（вы，長輩、老師、陌生人），打招呼也分兩種：
| 情境 | 說法 |
|---|---|
| 朋友 | Приве'т! |
| 正式（任何人都能用） | Здра'вствуйте! |
| 早上／白天／晚上 | До'брое у'тро／До'брый день／До'брый ве'чер |
🧠 Здра'вствуйте 很長，第一個 в **不念**：ZDRAST-vuy-tye。拆成「Здра（健）＋вствуйте（康）」— 字面意思就是「祝你健康」。`, ex: [["Приве'т!", 'pri-VYET', '嗨（對朋友）'], ["Здра'вствуйте!", 'ZDRAST-vuy-tye', '您好（正式）'], ["До'брое у'тро!", 'DOB-ra-ye OO-tra', '早安'], ["До'брый день!", "DOB-ryi dyen'", '午安、日安'], ["До'брый ве'чер!", 'DOB-ryi VYE-chyer', '晚上好']] },
      { h: '說再見', md: `| 情境 | 說法 |
|---|---|
| 朋友 | Пока'! |
| 正式 | До свида'ния! |
🧠 До свида'ния＝「到（до）再見面（свидание）」，跟中文「再見」一樣的邏輯。`, ex: [["Пока'!", 'pa-KA', '掰掰'], ["До свида'ния!", 'da svi-DA-ni-ya', '再見']] },
      { h: '禮貌三寶', md: `- **Спаси'бо** 謝謝
- **Пожа'луйста** 一字三用：「請」、「不客氣」、遞東西時的「給你」
- **Извини'те** 對不起、不好意思（問路前先說這句）
🧠 Спаси'бо 的 о 沒重音，念 spa-SI-ba，不是 spa-SI-bo。`, ex: [["Спаси'бо!", 'spa-SI-ba', '謝謝'], ["Пожа'луйста", 'pa-ZHA-lus-ta', '請、不客氣'], ["Извини'те", 'iz-vi-NI-tye', '不好意思']] },
      { h: '自我介紹', md: `兩個好用的句型：
- **Меня' зову'т…** 我叫…（字面是「人們叫我…」）
- **Я из…** 我來自…
🧠 俄文**現在式不用「是」**：「我是學生」直接說 Я студе'нт（我 學生），超省力！`, ex: [["Меня' зову'т Джо'зеф.", 'mye-NYA za-VUT JO-zef', '我叫 Joseph。'], ["Как вас зову'т?", 'kak vas za-VUT', '您叫什麼名字？'], ["Я из Тайва'ня.", 'ya iz tai-VA-nya', '我來自台灣。'], ["Я студе'нт.", 'ya stu-DYENT', '我是學生。'], ["О'чень прия'тно!", 'O-chyen pri-YAT-na', '很高興認識你！']] },
      { h: '你好嗎？', md: `Как дела'? 字面是「事情怎麼樣？」，回答：
| 回答 | 意思 |
|---|---|
| Хорошо'! | 很好 |
| Норма'льно. | 還可以（俄國人最常回這個） |
| А у тебя'? | 那你呢？ |`, ex: [["Как дела'?", 'kak dye-LA', '你好嗎？'], ["Хорошо'!", 'kha-ra-SHO', '很好！'], ["Норма'льно.", "nar-MAL'-na", '還可以。'], ["А у тебя'?", 'a u tye-BYA', '那你呢？']] },
    ],
    practice: [['say', "Спаси'бо!", 'spa-SI-ba', '謝謝'], ['say', "Здра'вствуйте!", 'ZDRAST-vuy-tye', '您好（正式）'], ['say', "Меня' зову'т Джо'зеф.", 'mye-NYA za-VUT JO-zef', '我叫 Joseph。'],
      ['say', "О'чень прия'тно!", 'O-chyen pri-YAT-na', '很高興認識你！'], ['say', "Я из Тайва'ня.", 'ya iz tai-VA-nya', '我來自台灣。'], ['say', "До свида'ния!", 'da svi-DA-ni-ya', '再見（正式）'], ['say', "Как дела'?", 'kak dye-LA', '你好嗎？']],
  },
  {
    title: '數字＋問價錢', learn: '0～20、100，會問多少錢',
    sections: [
      { h: '0～10', md: `🧠 記憶小撇步：
- **три**（3）跟英文 three 很像
- **четы'ре**（4）開頭的 Ч 長得就像 4
- **пять**（5）→ 想成「五個手指頭 pyat」
- **семь**（7）跟 seven、**во'семь**（8）＝「多一點的 7」，**де'сять**（10）跟 decimal 同源`, ex: [['ноль', "nol'", '0'], ["оди'н", 'a-DIN', '1'], ['два', 'dva', '2'], ['три', 'tri', '3'], ["четы'ре", 'chye-TY-rye', '4'], ['пять', "pyat'", '5'], ['шесть', "shest'", '6'], ['семь', "syem'", '7'], ["во'семь", "VO-syem'", '8'], ["де'вять", "DYE-vyat'", '9'], ["де'сять", "DYE-syat'", '10']] },
      { h: '11～20：數字＋надцать', md: `11～19 都是「數字＋на（在…上面）＋дцать（十）」＝「在十上面的幾」：
| 數字 | 拆開 |
|---|---|
| 11 оди'ннадцать | один＋надцать |
| 12 двена'дцать | две＋надцать |
| 15 пятна'дцать | пят＋надцать |
| 20 два'дцать | два＋дцать（兩個十） |
🧠 跟英文 -teen 一樣的邏輯，看到 -надцать 就知道是 11～19。100 是 сто（想成「一百分 STOP」）。`, ex: [["оди'ннадцать", "a-DI-na-tsat'", '11'], ["двена'дцать", "dvye-NA-tsat'", '12'], ["пятна'дцать", "pyat-NA-tsat'", '15'], ["два'дцать", "DVA-tsat'", '20'], ["три'дцать", "TRI-tsat'", '30'], ['сто', 'sto', '100']] },
      { h: '問價錢＋盧布的三種樣子', md: `Ско'лько сто'ит? ＝這個多少錢？
盧布（рубль）跟著數字變樣子，這是你第一次碰到俄文的「變格」，先有印象就好：
| 數字 | 說法 |
|---|---|
| 1、21、31… | оди'н **рубль** |
| 2、3、4 | два **рубля'** |
| 5～20、0 | пять **рубле'й** |
🧠 口訣：「1 原形、2～4 加 я、5 以上加 ей」。`, ex: [["Ско'лько сто'ит?", "SKOL'-ka STO-it", '這個多少錢？'], ["оди'н рубль", "a-DIN rubl'", '一盧布'], ["два рубля'", "dva rub-LYA", '兩盧布'], ["пять рубле'й", "pyat' rub-LYEY", '五盧布'], ["До'рого!", 'DO-ra-ga', '好貴！'], ['Дёшево!', 'DYO-she-va', '好便宜！']] },
    ],
    practice: [['say', 'пять', "pyat'", '5'], ['say', "во'семь", "VO-syem'", '8'], ['say', "двена'дцать", "dvye-NA-tsat'", '12'], ['say', "два'дцать", "DVA-tsat'", '20'],
      ['say', "Ско'лько сто'ит?", "SKOL'-ka STO-it", '這個多少錢？'], ['say', "пять рубле'й", "pyat' rub-LYEY", '五盧布'], ['say', "До'рого!", 'DO-ra-ga', '好貴！']],
  },
  {
    title: '名詞性別＋「我有…」', learn: '看字尾分陽／陰／中性，說「這是我的…」「我有…」',
    sections: [
      { h: '看最後一個字母判斷性別', md: `俄文每個名詞都有性別，**看最後一個字母**就知道：
| 性別 | 結尾 | 例子 |
|---|---|---|
| 陽性 ♂ | 子音、-й | стол 桌子、чай 茶 |
| 陰性 ♀ | -а、-я | ма'ма 媽媽、ко'шка 貓 |
| 中性 ⚪ | -о、-е | окно' 窗戶、мо'ре 海 |
🧠 「**子音硬漢、а 是女生、о 是圓圓的中性**」。-ь 結尾陰陽都有，遇到再背。`, ex: [['стол', 'stol', '桌子（陽）'], ["ко'шка", 'KOSH-ka', '貓（陰）'], ["кни'га", 'KNI-ga', '書（陰）'], ["окно'", 'ak-NO', '窗戶（中）'], ["мо'ре", 'MO-rye', '海（中）']] },
      { h: '他、她、它：東西也用', md: `он／она'／оно' 不只指人，**東西也照性別用**。桌子是「他」、書是「她」：
| 問 | 答 |
|---|---|
| Где стол?（桌子在哪？） | Вот он.（在這，「他」） |
| Где кни'га?（書在哪？） | Вот она'.（在這，「她」） |`, ex: [["он · она' · оно' · они'", 'on · a-NA · a-NO · a-NI', '他 · 她 · 它 · 他們'], ['Где стол? — Вот он.', 'gdye stol — vot on', '桌子在哪？— 在這。'], ["Где кни'га? — Вот она'.", 'gdye KNI-ga — vot a-NA', '書在哪？— 在這。']] },
      { h: '「我的」跟著性別變', md: `| | 陽 | 陰 | 中 |
|---|---|---|---|
| 我的 | мой | моя' | моё |
| 你的 | твой | твоя' | твоё |
🧠 「我的」的結尾跟名詞一樣：陰性名詞 -а → моя' 也是 -я；中性 -о → моё 也是 -ё。
**Э'то**（這是）永遠不變，後面接什麼都可以。`, ex: [["мой телефо'н", 'moy tye-lye-FON', '我的手機'], ["моя' кни'га", 'ma-YA KNI-ga', '我的書'], ["моё окно'", 'ma-YO ak-NO', '我的窗戶'], ["Э'то мой друг.", 'E-ta moy drug', '這是我的朋友。'], ["Э'то моя' ма'ма.", 'E-ta ma-YA MA-ma', '這是我媽媽。']] },
      { h: '我有…：У меня есть', md: `俄文沒有「有」這個動詞，而是說「**在我這裡存在…**」：
У меня' (在我這) есть (存在) ко'шка (貓)
🧠 把 У меня' есть 當成一整塊背起來＝「我有」；把 меня' 換成 тебя' 就是「你有」。`, ex: [["У меня' есть ко'шка.", "u mye-NYA yest' KOSH-ka", '我有一隻貓。'], ["У тебя' есть брат?", "u tye-BYA yest' brat", '你有兄弟嗎？'], ["У меня' есть ро'бот.", "u mye-NYA yest' RO-bat", '我有一台機器人。']] },
    ],
    practice: [['say', "моя' кни'га", 'ma-YA KNI-ga', '我的書'], ['say', "Э'то мой телефо'н.", 'E-ta moy tye-lye-FON', '這是我的手機。'], ['say', "У меня' есть ко'шка.", "u mye-NYA yest' KOSH-ka", '我有一隻貓。'],
      ['say', "У тебя' есть брат?", "u tye-BYA yest' brat", '你有兄弟嗎？'], ['read', "мо'ре", 'MO-rye', '海（中性，結尾 -е）'], ['read', "ко'шка", 'KOSH-ka', '貓（陰性，結尾 -а）']],
  },
  {
    title: '動詞現在式＋救命句', learn: '動詞跟著「誰」變，聽不懂時會求救',
    sections: [
      { h: '為什麼動詞要變？', md: `中文「我讀、你讀、他讀」動詞都一樣，俄文的**字尾會跟著「誰在做」變**。
好消息：大部分動詞只有**兩種變法**，學會兩組就能套到幾百個動詞。` },
      { h: '第一組：читать（讀）', md: `| 誰 | 字尾 | 完整 |
|---|---|---|
| я 我 | -ю | чита'ю |
| ты 你 | -ешь | чита'ешь |
| он 他 | -ет | чита'ет |
| мы 我們 | -ем | чита'ем |
| вы 您／你們 | -ете | чита'ете |
| они' 他們 | -ют | чита'ют |
🧠 唸成一串節奏：「ю-ешь-ет-ем-ете-ют」，像繞口令念 10 次就記住了。同一組還有 понима'ть 懂、зна'ть 知道、де'лать 做。`, ex: [["я чита'ю", 'ya chi-TA-yu', '我讀'], ["ты чита'ешь", 'ty chi-TA-yesh', '你讀'], ["он чита'ет", 'on chi-TA-yet', '他讀'], ["мы чита'ем", 'my chi-TA-yem', '我們讀'], ["вы чита'ете", 'vy chi-TA-ye-tye', '您讀'], ["они' чита'ют", 'a-NI chi-TA-yut', '他們讀']] },
      { h: '第二組：говорить（說）', md: `把 е 換成 и 就是第二組：
| 誰 | 字尾 | 完整 |
|---|---|---|
| я | -ю | говорю' |
| ты | -ишь | говори'шь |
| он | -ит | говори'т |
| мы | -им | говори'м |
| вы | -ите | говори'те |
| они' | -ят | говоря'т |
🧠 第一組是 **е** 家族，第二組是 **и** 家族；動詞原形 -ить 結尾的通常是 и 家族。`, ex: [["я говорю'", 'ya ga-va-RYU', '我說'], ["ты говори'шь", 'ty ga-va-RISH', '你說'], ["они' говоря'т", 'a-NI ga-va-RYAT', '他們說']] },
      { h: '否定和問句都超簡單', md: `- **否定**：動詞前面加 не → Я **не** понима'ю.（我不懂）
- **問句**：句子完全不用改，**語調往上揚**就好 → Вы говори'те по-англи'йски?（您說英文嗎？）
🧠 跟中文一樣，把「嗎？」的語氣用聲音表現出來。` },
      { h: '救命句', md: `聽不懂的時候，這幾句可以救你一命：`, ex: [["Я не понима'ю.", 'ya nye pa-ni-MA-yu', '我聽不懂。'], ["Повтори'те, пожа'луйста.", 'paf-ta-RI-tye pa-ZHA-lus-ta', '請再說一次。'], ["Ме'дленнее, пожа'луйста.", 'MYED-lye-nye-ye pa-ZHA-lus-ta', '請說慢一點。'], ["Я немно'го говорю' по-ру'сски.", 'ya nyem-NO-ga ga-va-RYU pa-RUS-ki', '我會說一點俄文。'], ["Вы говори'те по-англи'йски?", 'vy ga-va-RI-tye pa-an-GLIY-ski', '您會說英文嗎？']] },
    ],
    practice: [['say', "я чита'ю", 'ya chi-TA-yu', '我讀'], ['say', "они' говоря'т", 'a-NI ga-va-RYAT', '他們說'], ['say', "Я не понима'ю.", 'ya nye pa-ni-MA-yu', '我聽不懂。'],
      ['say', "Ме'дленнее, пожа'луйста.", 'MYED-lye-nye-ye pa-ZHA-lus-ta', '請說慢一點。'], ['say', "Вы говори'те по-англи'йски?", 'vy ga-va-RI-tye pa-an-GLIY-ski', '您會說英文嗎？'], ['say', "ты говори'шь", 'ty ga-va-RISH', '你說']],
  },
  {
    title: '咖啡廳＋點餐', learn: '從點餐到買單，全程用俄文',
    sections: [
      { h: '萬用句：Можно…?（可以…嗎？）', md: `Мо'жно ＋ 東西 ＝「可以給我…嗎？」，再加 пожа'луйста 就很有禮貌。
要東西的時候，**陰性 -а 會變成 -у**（受詞的樣子），陽性和中性不變：
| 原形 | 要它 |
|---|---|
| вода' 水 | Мо'жно **во'ду**? |
| пи'цца 披薩 | Я хочу' **пи'ццу**. |
| ко'фе 咖啡 | ко'фе（不變） |
🧠 「女生被點名就會 **у**～ 一聲」：а → у。`, ex: [["Мо'жно меню'?", 'MOZH-na mye-NYU', '可以給我菜單嗎？'], ["Мо'жно во'ду?", 'MOZH-na VO-du', '可以給我水嗎？'], ["Я хочу' ко'фе.", 'ya kha-CHU KO-fye', '我想要咖啡。'], ["Я хочу' пи'ццу.", 'ya kha-CHU PI-tsu', '我想要披薩。'], ["Чай, пожа'луйста.", 'chai pa-ZHA-lus-ta', '請給我茶。']] },
      { h: '吃完：好吃＋買單', md: `🧠 Счёт（帳單）的 ё 一定是重音，念 shchyot。`, ex: [["Вку'сно!", 'FKUS-na', '好吃！'], ["Ско'лько с меня'?", "SKOL'-ka s mye-NYA", '我要付多少？'], ["Счёт, пожа'луйста.", 'shchyot pa-ZHA-lus-ta', '買單，謝謝。'], ["Где туале'т?", 'gdye tu-a-LYET', '廁所在哪裡？']] },
      { h: '認識俄羅斯食物', md: `| 食物 | 是什麼 |
|---|---|
| борщ | 羅宋湯（甜菜根湯，紅色的） |
| пельме'ни | 俄式水餃，配酸奶油吃 |
| блины' | 俄式薄餅，像可麗餅 |
| квас | 黑麥麵包發酵的飲料，像沒酒精的啤酒 |
🧠 台灣的「羅宋湯」就是 Russian soup 的音譯，原型就是 борщ。`, ex: [['борщ', 'borshch', '羅宋湯'], ["пельме'ни", "pyel'-MYE-ni", '俄式水餃'], ["блины'", 'bli-NY', '俄式薄餅'], ['квас', 'kvas', '格瓦斯']] },
    ],
    practice: [['say', "Мо'жно меню'?", 'MOZH-na mye-NYU', '可以給我菜單嗎？'], ['say', "Я хочу' ко'фе.", 'ya kha-CHU KO-fye', '我想要咖啡。'], ['say', "Мо'жно во'ду?", 'MOZH-na VO-du', '可以給我水嗎？'],
      ['say', "Вку'сно!", 'FKUS-na', '好吃！'], ['say', "Счёт, пожа'луйста.", 'shchyot pa-ZHA-lus-ta', '買單，謝謝。'], ['say', "Где туале'т?", 'gdye tu-a-LYET', '廁所在哪裡？']],
  },
  {
    title: '「在…」＋完整自我介紹', learn: '說住在哪、讀什麼，講完一段 30 秒自我介紹',
    sections: [
      { h: 'в ＋ 地點：字尾換成 -е', md: `「在某個地方」用 **в ＋ 地點**，地點的字尾要換成 **-е**：
| 原形 | 在那裡 |
|---|---|
| Москва' 莫斯科 | в Москве' |
| Тайва'нь 台灣 | в Тайва'не |
| университе'т 大學 | в университе'те |
| магистрату'ра 碩士班 | в магистрату'ре |
🧠 「**在**哪裡就 **е** 一聲」：-а 換 -е、-ь 換 -е、子音直接加 -е。這是你學到的第一個「格」（介系詞格）。
小細節：в 後面接 т、к、п 這種清音時念成 f：в Тайва'не 念 f tai-VA-nye。`, ex: [["в Москве'", 'v mask-VYE', '在莫斯科'], ["Я живу' в Тайва'не.", 'ya zhi-VU f tai-VA-nye', '我住在台灣。'], ['Где ты живёшь?', 'gdye ty zhi-VYOSH', '你住哪裡？'], ["Я учу'сь в университе'те.", "ya u-CHUS' v u-ni-vyer-si-TYE-tye", '我在大學念書。'], ["Я учу'сь в магистрату'ре.", "ya u-CHUS' v ma-gis-tra-TU-rye", '我在讀碩士。']] },
      { h: '說說你在做什麼', md: `🧠 изуча'ть（研究、學習）是第一組動詞：я изуча'ю。люби'ть（喜歡）是第二組：я люблю'。`, ex: [["Я изуча'ю робототе'хнику.", 'ya i-zu-CHA-yu ra-ba-ta-TYEKH-ni-ku', '我研究機器人學。'], ["Я люблю' видеои'гры.", 'ya lyu-BLYU vi-dye-a-I-gry', '我喜歡電玩。'], ["Сейча'с я изуча'ю ру'сский язы'к.", 'sye-CHAS ya i-zu-CHA-yu RUS-kiy ya-ZYK', '現在我在學俄文。']] },
      { h: '📣 完整自我介紹', md: `把 8 課學的串起來，按「▶ 念整段」跟讀，熟了以後試著不看稿講一次：`,
        intro: "Здра'вствуйте! Меня' зову'т Джо'зеф. Я из Тайва'ня. Я студе'нт, я учу'сь в магистрату'ре. Я изуча'ю робототе'хнику. Я люблю' игра'ть в видеои'гры. Сейча'с я изуча'ю ру'сский язы'к. О'чень прия'тно!",
        introZh: '您好！我叫 Joseph，來自台灣。我是學生，在讀碩士，研究機器人學。我喜歡打電動。現在我在學俄文。很高興認識你！' },
      { h: '🎉 學完了，接下來呢？', md: `- **Duolingo 俄文**（英文介面）：每天 10 分鐘維持手感
- **YouTube：Russian With Max**：全俄文慢速講生活話題，練聽力
- **Forvo.com**：真人發音字典，內建語音念得怪時查
- **課本《走遍俄羅斯》**：有中文解說，想更有系統時買第一冊
- **iPhone 加俄文鍵盤**：設定 → 一般 → 鍵盤 → 新增鍵盤 → 俄文
目標檢定：**ТРКИ 基礎級（A2）**` },
    ],
    practice: [['say', "в Москве'", 'v mask-VYE', '在莫斯科'], ['say', "Я живу' в Тайва'не.", 'ya zhi-VU f tai-VA-nye', '我住在台灣。'], ['say', "Я учу'сь в магистрату'ре.", "ya u-CHUS' v ma-gis-tra-TU-rye", '我在讀碩士。'],
      ['say', "Я изуча'ю робототе'хнику.", 'ya i-zu-CHA-yu ra-ba-ta-TYEKH-ni-ku', '我研究機器人學。'], ['say', "Я люблю' видеои'гры.", 'ya lyu-BLYU vi-dye-a-I-gry', '我喜歡電玩。']],
  },
].map((l, i) => ({ ...l, n: i + 1 }));

export const ruUi = { tab: 'learn', lesson: null, shown: new Set(), group: 'all', letter: null, quiz: null, quizShow: false, streak: 0 };

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
  return `<div class="page-head"><div>${L ? '<button class="btn ghost small" data-action="ru-lesson" data-n="0">← 所有課程</button>' : ''}
      <h1>${L ? `第 ${L.n} 課　${esc(L.title)}` : '🇷🇺 俄文'}</h1>
      <div class="sub">${L ? `學會：${esc(L.learn)}` : '從零開始的俄文入門 · 點任何一句都會念給你聽'}</div></div>
      <button class="btn small ${slow() ? 'primary' : ''}" data-action="ru-slow" title="念慢一點">🐢 慢速${slow() ? '開' : '關'}</button></div>
    ${L ? '' : `<div class="seg" style="margin-bottom:12px">
      <button class="${ruUi.tab === 'learn' ? 'on' : ''}" data-action="ru-tab" data-t="learn">📖 課程</button>
      <button class="${ruUi.tab === 'abc' ? 'on' : ''}" data-action="ru-tab" data-t="abc">🔤 字母表</button></div>`}
    ${ruUi.tab === 'abc' ? abcView() : L ? lessonView(L) : lessonList()}`;
}

function lessonList() {
  return `<section class="card">${LESSONS.map(l => `<div class="ev" data-action="ru-lesson" data-n="${l.n}">
      <span class="ru-num">${l.n}</span>
      <div class="main"><div class="title">${esc(l.title)}</div><div class="meta">${esc(l.learn)}</div></div><span class="fold">›</span></div>`).join('')}</section>
    <div class="sub" style="margin:10px 2px">每課大約 20～30 分鐘：先看講解、跟著 🔊 念例句，最後做小練習。字母還不熟可以隨時切到「字母表」看記憶法。</div>`;
}

function lessonView(L) {
  const prev = LESSONS[L.n - 2], next = LESSONS[L.n];
  return `${L.sections.map((s, i) => `<section class="card ru-sec">
      <h2 class="ru-h">${i + 1}. ${esc(s.h)}</h2>
      ${s.md ? `<div class="md ru-md">${mdLite(acc(s.md))}</div>` : ''}
      ${s.intro ? `<div class="ru-intro"><div class="ru-intro-head"><b>自我介紹</b>
          <button class="btn small primary" data-action="ru-say" data-say="${esc(s.intro)}">▶ 念整段</button></div>
        <div class="ru-text">${esc(acc(s.intro))}</div><div class="sub">${esc(s.introZh)}</div></div>` : ''}
      ${s.ex ? `<div class="ru-words" style="margin-top:10px">${s.ex.map(wordBtn).join('')}</div>` : ''}
    </section>`).join('')}
    <section class="card ru-sec">
      <h2 class="ru-h">✏️ 小練習</h2>
      <div class="sub" style="margin-bottom:8px">先自己念出來，再點卡片看答案、聽發音。</div>
      <div class="ru-words">${L.practice.map(([mode, ru, tr, zh], i) => {
        const key = `${L.n}-${i}`, on = ruUi.shown.has(key);
        return `<button type="button" class="ru-word ru-prac ${on ? 'on' : ''}" data-action="ru-prac" data-k="${key}" data-say="${esc(ru)}">
          <span class="ru-spk">${mode === 'read' ? '👀' : '🗣️'}</span>
          <span class="ru-main"><small>${mode === 'read' ? '念念看' : '用俄文怎麼說？'}</small>
            <span class="ru-text">${esc(mode === 'read' ? acc(ru) : zh)}</span>
            ${on ? `<small class="ru-ans">${mode === 'read' ? `${esc(tr)} · ${esc(zh)}` : `${esc(acc(ru))} · ${esc(tr)}`}</small>` : ''}</span>
          <span class="ru-zh">${on ? '🔊' : '點我看答案'}</span></button>`;
      }).join('')}</div>
    </section>
    <div class="row wrap" style="margin:4px 0 14px">
      <button class="btn" data-action="ru-cards" data-n="${L.n}">🃏 這課例句加到字卡</button><span class="spacer"></span>
      ${prev ? `<button class="btn" data-action="ru-lesson" data-n="${prev.n}">‹ 第 ${prev.n} 課</button>` : ''}
      ${next ? `<button class="btn primary" data-action="ru-lesson" data-n="${next.n}">第 ${next.n} 課 ›</button>` : ''}</div>`;
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
// pid 用俄文本身，同一句不會重複加
function addCards(n) {
  const L = LESSONS[n - 1];
  let d = store.state.decks.find(x => x.preset === 'ru');
  const t = Date.now();
  if (!d) { d = { id: newId(), name: '🇷🇺 俄文入門', color: '#e11d48', preset: 'ru', lang: 'ru-RU', createdAt: t }; saveDoc('decks', d); }
  const have = new Set(store.state.cards.filter(c => c.deckId === d.id).map(c => c.pid));
  const seen = new Set();
  const add = L.sections.flatMap(s => s.ex || []).map(([ru, tr, zh]) => ({ pid: 'ru:' + plain(ru), ru, tr, zh }))
    .filter(c => !have.has(c.pid) && !seen.has(c.pid) && seen.add(c.pid));
  add.forEach((c, i) => saveDoc('cards', { id: newId(), deckId: d.id, pid: c.pid, front: acc(c.ru), back: `${c.zh}\n${c.tr}`, box: 0, due: '', createdAt: t + 1 + i }));
  ctx.toast(add.length ? `第 ${n} 課 ${add.length} 張加進「${d.name}」，到字卡頁複習（翻卡也能按 🔊）` : '這課的例句已經都在字卡裡了');
}

function nextQuiz() {
  let i;
  do i = Math.floor(Math.random() * LETTERS.length); while (i === ruUi.quiz);
  ruUi.quiz = i; ruUi.quizShow = false;
}

export const russianActions = {
  'ru-tab': el => { ruUi.tab = el.dataset.t; ctx.render(); },
  'ru-slow': () => savePrefs({ ruSlow: !slow() }),
  'ru-lesson': el => { ruUi.tab = 'learn'; ruUi.lesson = +el.dataset.n || null; ruUi.shown.clear(); ctx.render(); window.scrollTo(0, 0); },
  'ru-say': el => speak(el.dataset.say),
  'ru-prac': el => {
    const k = el.dataset.k;
    if (ruUi.shown.has(k)) { speak(el.dataset.say); return; }
    ruUi.shown.add(k); speak(el.dataset.say); ctx.render();
  },
  'ru-cards': el => addCards(+el.dataset.n),
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
