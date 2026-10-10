// 模擬投資：台股規則、撮合、帳務。報價經由 worker/quote-proxy.js 中繼。
// 帳戶資料存在 store 的 inv_meta / inv_orders / inv_divs / inv_snaps（登入後跟著帳號同步）。
import { QUOTE_API } from './invest-config.js';
import { store, saveDoc, newId } from './store.js';

export const START_CASH = 30000;
export const FEE_RATE = 0.001425;
export const FEE_DISCOUNT = 0.28;     // 網路下單常見 2.8 折
export const BENCH = '0050';

// ---------- 台北時間 ----------
const TW = 8 * 3600e3;
export function twNow(ms = Date.now()) {
  const d = new Date(ms + TW);
  return { ms, ymd: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}
export const twMs = (ymd, hhmm = '00:00') => Date.parse(`${ymd}T${hhmm}:00+08:00`);
const OPEN_MIN = 9 * 60, CLOSE_MIN = 13 * 60 + 30;
function addDay(ymd, n) { const d = new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400e3); return d.toISOString().slice(0, 10); }

// ---------- 交易日 ----------
let holidayMap = readCache('holidays')?.data || null; // { 'yyyy-mm-dd': { n, trade } }
export function isTradingDay(ymd) {
  const dow = new Date(ymd + 'T00:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const h = holidayMap?.[ymd];
  return !h || h.trade;
}
export const holidayName = ymd => holidayMap?.[ymd]?.n || '';
export function nextTradingDay(ymd) { let d = addDay(ymd, 1); for (let i = 0; i < 30 && !isTradingDay(d); i++) d = addDay(d, 1); return d; }
export function addTradingDays(ymd, n) { let d = ymd; for (let i = 0; i < n; i++) d = nextTradingDay(d); return d; }

// 'pre' 開盤前 | 'open' 盤中 | 'closed' 收盤後 | 'holiday' 休市
export function session(now = twNow()) {
  if (!isTradingDay(now.ymd)) return 'holiday';
  if (now.min < OPEN_MIN) return 'pre';
  if (now.min < CLOSE_MIN) return 'open';
  return 'closed';
}
// 現在下單會在哪一天的盤成交（收盤後／休市日下的是預約單，下一個交易日開盤才進場）
export function orderDay(now = twNow()) {
  const s = session(now);
  return s === 'pre' || s === 'open' ? now.ymd : nextTradingDay(now.ymd);
}

// ---------- 台股規則 ----------
export const isEtf = code => /^00/.test(code);
// 升降單位（股票／ETF 不同）
export function tickOf(p, code) {
  if (isEtf(code)) return p < 50 ? 0.01 : 0.05;
  return p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5;
}
const r2 = x => Math.round(x * 100) / 100;
export const floorTick = (x, code) => { const t = tickOf(x, code); return r2(Math.floor(r2(x / t) + 1e-9) * t); };
export const ceilTick = (x, code) => { const t = tickOf(x, code); return r2(Math.ceil(r2(x / t) - 1e-9) * t); };
export const onTick = (p, code) => Math.abs(r2(p / tickOf(p, code)) - Math.round(p / tickOf(p, code))) < 1e-6;
// 漲跌停：昨收 ±10%，再對齊升降單位
export const limitUp = (ref, code) => floorTick(ref * 1.1, code);
export const limitDown = (ref, code) => ceilTick(ref * 0.9, code);
export function stepPrice(p, code, dir) {
  const t = tickOf(dir > 0 ? p : p - 1e-9, code);
  return r2(dir > 0 ? floorTick(p, code) + t : ceilTick(p, code) - t);
}

export function calcFee(amount, odd) {
  return Math.max(odd ? 1 : 20, Math.floor(amount * FEE_RATE * FEE_DISCOUNT));
}
// 證交稅：股票 0.3%，ETF 0.1%（只有賣出收）
export const taxRate = code => (isEtf(code) ? 0.001 : 0.003);
export const calcTax = (amount, code) => Math.floor(amount * taxRate(code));
export function costs(side, price, shares, code) {
  const amount = Math.round(price * shares);
  const odd = shares % 1000 !== 0;
  const fee = calcFee(amount, odd);
  const tax = side === 'sell' ? calcTax(amount, code) : 0;
  return { amount, fee, tax, net: side === 'buy' ? amount + fee : amount - fee - tax };
}

// ---------- 帳務（全部從委託和配息算出來，不另外存現金） ----------
export function ledger(state = store.state) {
  const meta = account(state);
  const start = meta?.startCash ?? START_CASH;
  const evs = [];
  for (const o of state.inv_orders) if (o.status === 'filled') evs.push({ at: o.fill.at, o });
  for (const d of state.inv_divs) if (d.status === 'paid') evs.push({ at: twMs(d.exDate), d });
  evs.sort((a, b) => a.at - b.at);

  const pos = new Map();
  const P = (code, name, m) => {
    if (!pos.has(code)) pos.set(code, { code, name, m, shares: 0, cost: 0, realized: 0, divs: 0 });
    const p = pos.get(code);
    if (name) p.name = name;
    return p;
  };
  let cash = start, realized = 0, fees = 0, taxes = 0, divs = 0;
  for (const e of evs) {
    if (e.o) {
      const o = e.o, f = o.fill, p = P(o.code, o.name, o.m);
      fees += f.fee; taxes += f.tax;
      if (o.side === 'buy') { cash -= f.net; p.shares += o.shares; p.cost += f.net; }
      else {
        const out = p.shares ? p.cost * o.shares / p.shares : 0;
        const gain = f.net - out;
        cash += f.net; realized += gain; p.realized += gain;
        p.shares -= o.shares; p.cost -= out;
        if (p.shares <= 0) { p.shares = 0; p.cost = 0; }
      }
    } else {
      const d = e.d, p = P(d.code, d.name);
      cash += d.amount || 0; divs += d.amount || 0; p.divs += d.amount || 0;
      p.shares += d.newShares || 0;
    }
  }
  const open = state.inv_orders.filter(o => o.status === 'open');
  const reserved = open.filter(o => o.side === 'buy').reduce((n, o) => n + (o.reserve || 0), 0);
  for (const p of pos.values()) p.selling = open.filter(o => o.side === 'sell' && o.code === p.code).reduce((n, o) => n + o.shares, 0);
  return {
    start, cash, reserved, buyingPower: cash - reserved, realized, fees, taxes, divs,
    positions: [...pos.values()].filter(p => p.shares > 0),
    allPositions: pos,
  };
}
// 持股在某天開盤前有幾股（除權息用：除息日前一天收盤還持有才領得到）
export function sharesBefore(code, ymd, state = store.state) {
  let n = 0;
  for (const o of state.inv_orders) if (o.status === 'filled' && o.code === code && o.fill.day < ymd) n += o.side === 'buy' ? o.shares : -o.shares;
  for (const d of state.inv_divs) if (d.status === 'paid' && d.code === code && d.exDate < ymd) n += d.newShares || 0;
  return Math.max(0, n);
}
export const account = (state = store.state) => state.inv_meta.find(x => x.id === 'account') || null;

// ---------- 報價資料 ----------
export const inv = {
  quotes: new Map(),   // code → 即時報價（worker /rt 格式）
  list: null,          // [{ c, n, m, p }]
  byCode: new Map(),
  divList: [],
  days: new Map(),     // `${code}:${ym}` → [[date, o, h, l, c, v]]
  error: '',
  lastAt: 0,
  busy: false,
};
export const configured = () => !!QUOTE_API;

function readCache(k) { try { return JSON.parse(localStorage.getItem('studydash.inv.' + k)); } catch { return null; } }
function writeCache(k, data) { try { localStorage.setItem('studydash.inv.' + k, JSON.stringify({ at: Date.now(), data })); } catch { /* 空間不足 */ } }

async function api(path) {
  const r = await fetch(QUOTE_API.replace(/\/$/, '') + path, { cache: 'no-store' });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.data;
}
async function cached(key, maxAgeMs, path, map = x => x) {
  const c = readCache(key);
  if (c && Date.now() - c.at < maxAgeMs) return c.data;
  try {
    const data = map(await api(path));
    writeCache(key, data);
    return data;
  } catch (e) {
    if (c) return c.data; // 抓不到就先用舊的
    throw e;
  }
}

// 櫃買中心擋 Cloudflare，上櫃清單抓不到時用 App 內建的（js/otc-list.json）
let otcBuiltin = null;
async function builtinOtc() {
  if (!otcBuiltin) otcBuiltin = fetch(new URL('./otc-list.json', import.meta.url)).then(r => r.json()).then(j => j.items).catch(() => []);
  return otcBuiltin;
}

export async function loadBasics() {
  if (!configured()) return;
  // 持有或掛單中的上櫃股：配息要另外查
  const otcHeld = [...new Set(store.state.inv_orders.filter(o => o.m === 'otc' && o.status !== 'cancelled').map(o => o.code))].sort().join(',');
  const [list, hol, div] = await Promise.all([
    cached('list', 12 * 3600e3, '/list'),
    cached('holidays', 3 * 86400e3, '/holidays', rows => Object.fromEntries(rows.map(r => [r.d, { n: r.n, trade: r.trade }]))),
    cached('div.' + otcHeld, 3 * 3600e3, `/div?otc=${otcHeld}`).catch(() => []),
  ]);
  if (!list.items.some(x => x.m === 'otc')) list.items = [...list.items, ...await builtinOtc()];
  inv.list = list.items;
  inv.byCode = new Map(list.items.map(x => [x.c, x]));
  holidayMap = hol;
  inv.divList = div;
}

// 本機清單找不到時，問 mis 的名稱查詢（新上市櫃的股票也找得到）
export async function searchRemote(q) {
  const rows = await api(`/search?q=${encodeURIComponent(q)}`);
  for (const x of rows) if (!inv.byCode.has(x.c)) { const item = { ...x, p: null }; inv.byCode.set(x.c, item); inv.list.push(item); }
  return rows;
}

export const marketOf = code => inv.byCode.get(code)?.m || inv.quotes.get(code)?.m || 'tse';
export const nameOf = code => inv.byCode.get(code)?.n || inv.quotes.get(code)?.n || code;

export async function fetchQuotes(codes) {
  const uniq = [...new Set(codes)].filter(Boolean);
  if (!uniq.length || !configured()) return;
  const ch = uniq.map(c => `${marketOf(c)}_${c}`).join(',');
  const rows = await api(`/rt?ch=${ch}`);
  for (const q of rows) inv.quotes.set(q.c, q);
  inv.lastAt = Date.now();
}

// 日 K：過去的月份不會變，存在本機；這個月 10 分鐘更新一次
export async function fetchMonth(code, ym) {
  const key = `${code}:${ym}`;
  const thisYm = twNow().ymd.slice(0, 7).replace('-', '');
  const age = ym === thisYm ? 10 * 60e3 : 365 * 86400e3;
  const mem = inv.days.get(key);
  if (mem && Date.now() - mem.at < age) return mem.rows;
  const rows = await cached('day.' + key, age, `/day?code=${code}&m=${marketOf(code)}&ym=${ym}`);
  inv.days.set(key, { at: Date.now(), rows });
  return rows;
}
// 新聞：[[code, name], …] → { items: { code: [{ t, u, s, at }] }, ann: [{ c, t, body, at }], error }
export async function fetchNews(pairs) {
  const spec = pairs.map(([c, n]) => `${c}:${n.replace(/[,:]/g, ' ')}`).join(',');
  const data = await api(`/news?days=3&s=${encodeURIComponent(spec)}`);
  if (!data?.items) throw new Error('中繼站還沒有新聞功能，要把新版 worker/quote-proxy.js 重新部署到 Cloudflare');
  return data;
}

export async function fetchBars(code, months = 3) {
  const now = twNow().ymd;
  const yms = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1 - i, 1));
    yms.push(d.toISOString().slice(0, 7).replace('-', ''));
  }
  const parts = await Promise.all(yms.map(ym => fetchMonth(code, ym).catch(() => [])));
  return parts.flat();
}
async function barOn(code, ymd) {
  const rows = await fetchMonth(code, ymd.slice(0, 7).replace('-', ''));
  return rows.find(r => r[0] === ymd) || null;
}

// 參考價（昨收）：盤中用即時的 y；收盤後下一個交易日以今天收盤為準
export function refPrice(code, now = twNow()) {
  const q = inv.quotes.get(code);
  if (q) {
    const s = session(now);
    if (q.d === now.ymd && (s === 'closed')) return q.z ?? q.y;
    if (q.d !== now.ymd && q.d) return q.z ?? q.y;  // 休市日：最後一個交易日的收盤
    return q.y ?? q.z;
  }
  return inv.byCode.get(code)?.p ?? null;
}
export function priceOf(code) {
  const q = inv.quotes.get(code);
  return q?.z ?? q?.y ?? inv.byCode.get(code)?.p ?? null;
}

// ---------- 下單 ----------
// 回傳 { ok, error, order }
export function checkOrder({ code, side, kind, price, shares }, state = store.state, now = twNow()) {
  if (!account(state)) return { error: '還沒開戶' };
  if (!inv.byCode.has(code) && !inv.quotes.has(code)) return { error: '找不到這檔股票' };
  if (!(shares > 0) || !Number.isInteger(shares)) return { error: '股數要是正整數' };
  const odd = shares % 1000 !== 0;
  if (odd && shares >= 1000) return { error: '整張和零股要分開下：整張用 1000 的倍數，零股 1～999 股' };
  if (odd && kind === 'market') return { error: '零股只能下限價單（真實規則）' };
  const ref = refPrice(code, now);
  if (ref == null) return { error: '還拿不到這檔的報價，等一下再試' };
  const up = limitUp(ref, code), dn = limitDown(ref, code);
  if (kind === 'limit') {
    if (!(price > 0)) return { error: '請輸入價格' };
    if (!onTick(price, code)) return { error: `價格要對齊升降單位 ${tickOf(price, code)} 元` };
    if (price > up + 1e-9 || price < dn - 1e-9) return { error: `價格要在跌停 ${dn} ～ 漲停 ${up} 之間` };
  }
  const L = ledger(state);
  // 市價買單：券商用漲停價估算要保留多少錢
  const est = costs(side, kind === 'limit' ? price : side === 'buy' ? up : dn, shares, code);
  if (side === 'buy' && est.net > L.buyingPower + 1e-9) {
    return { error: `可用餘額不夠：需要約 ${fmtMoney(est.net)}，可用 ${fmtMoney(L.buyingPower)}${kind === 'market' ? '（市價單以漲停價估算）' : ''}` };
  }
  if (side === 'sell') {
    const p = L.allPositions.get(code);
    const free = (p?.shares || 0) - (p?.selling || 0);
    if (shares > free) return { error: `可賣股數只有 ${free} 股` };
  }
  const day = orderDay(now);
  return {
    ok: true, est, up, dn, day,
    order: {
      id: newId(), code, name: nameOf(code), m: marketOf(code), side, kind,
      price: kind === 'limit' ? price : null, shares, odd, tradeDay: day,
      preOpen: now.ms < twMs(day, '09:00'), placedAt: now.ms, status: 'open',
      reserve: side === 'buy' ? est.net : 0, createdAt: now.ms,
    },
  };
}

function filledOrder(o, price, at, day) {
  const c = costs(o.side, price, o.shares, o.code);
  return { ...o, status: 'filled', reserve: 0, fill: { price, at, day, ...c, settle: addTradingDays(day, 2) } };
}
const ended = (o, reason, at) => ({ ...o, status: 'expired', reserve: 0, endReason: reason, endedAt: at });

// 用一根日 K 判斷「那天如果一直掛著，會不會成交、用什麼價」
function fillFromBar(o, bar) {
  const [, op, hi, lo, cl] = bar;
  if (o.kind === 'market') return o.preOpen ? op : cl;
  const L = o.price;
  if (o.side === 'buy') {
    if (o.preOpen && op <= L) return op;
    return lo <= L ? L : null;
  }
  if (o.preOpen && op >= L) return op;
  return hi >= L ? L : null;
}
// 用即時報價判斷：買在賣一價、賣在買一價（比較接近真的成交價）
function fillFromQuote(o, q) {
  const ask = q.a?.[0] ?? q.z, bid = q.b?.[0] ?? q.z;
  if (o.preOpen && q.o != null) {
    if (o.kind === 'market') return q.o;
    if (o.side === 'buy' && q.o <= o.price) return q.o;
    if (o.side === 'sell' && q.o >= o.price) return q.o;
    // 開盤沒成交，但不在的這段時間有碰到價格
    if (o.side === 'buy' && q.l != null && q.l <= o.price) return o.price;
    if (o.side === 'sell' && q.h != null && q.h >= o.price) return o.price;
  }
  if (o.kind === 'market') return o.side === 'buy' ? ask : bid;
  if (o.side === 'buy' && ask != null && ask <= o.price) return ask;
  if (o.side === 'sell' && bid != null && bid >= o.price) return bid;
  return null;
}

// 把所有掛著的單、到期的除權息處理掉；回傳有沒有變動
export async function settle(now = twNow()) {
  if (!configured() || !account()) return false;
  let changed = false;
  const s = session(now);
  for (const o of store.state.inv_orders.filter(x => x.status === 'open')) {
    let next = null;
    const dayOver = o.tradeDay < now.ymd || (o.tradeDay === now.ymd && s === 'closed');
    if (dayOver) {
      if (!isTradingDay(o.tradeDay)) {
        next = ended(o, `${o.tradeDay} 休市${holidayName(o.tradeDay) ? `（${holidayName(o.tradeDay)}）` : ''}`, now.ms);
      } else {
        let bar = null;
        try { bar = await barOn(o.code, o.tradeDay); } catch { /* 下面用即時報價補 */ }
        // 日 K 還沒更新或抓不到：即時報價如果就是那一天的，用它的開高低收
        const q = inv.quotes.get(o.code);
        if (!bar && q?.d === o.tradeDay && q.o != null && q.z != null) bar = [q.d, q.o, q.h, q.l, q.z, q.v];
        if (!bar) {
          if (inv.days.get(`${o.code}:${o.tradeDay.slice(0, 7).replace('-', '')}`) == null) continue; // 抓不到資料就下次再算
          // 當天沒有成交資料：可能是颱風假或停牌；等隔天資料都齊了再判定
          if (o.tradeDay < addDay(now.ymd, -1)) next = ended(o, '當天沒有成交（停牌或休市）', now.ms);
        } else {
          const p = fillFromBar(o, bar);
          next = p != null ? filledOrder(o, p, Math.max(o.placedAt, twMs(o.tradeDay, o.preOpen ? '09:00' : '13:30')), o.tradeDay)
                           : ended(o, o.kind === 'limit' ? `當天價格沒有到 ${o.price}，收盤後失效（ROD 當日有效）` : '沒有成交', now.ms);
        }
      }
    } else if (o.tradeDay === now.ymd && s === 'open') {
      const q = inv.quotes.get(o.code);
      if (!q || q.d !== now.ymd) continue;
      const p = fillFromQuote(o, q);
      if (p != null) next = filledOrder(o, p, now.ms, now.ymd);
    }
    if (next) { saveDoc('inv_orders', next); changed = true; }
  }
  if (settleDividends(now)) changed = true;
  return changed;
}

// 除權息：先把持股相關的預告記下來（預告清單過了除息日就查不到了），到了除息日再入帳
function settleDividends(now) {
  let changed = false;
  const L = ledger();
  const held = new Set([...L.allPositions.values()].filter(p => p.shares > 0).map(p => p.code));
  for (const o of store.state.inv_orders) if (o.status === 'open' && o.side === 'buy') held.add(o.code);
  const known = new Set(store.state.inv_divs.map(d => d.id));
  for (const d of inv.divList) {
    const id = `${d.c}_${d.d}`;
    if (!held.has(d.c) || known.has(id) || d.d < account().startDate || !(d.cash > 0 || d.stock > 0)) continue;
    saveDoc('inv_divs', { id, code: d.c, name: nameOf(d.c), exDate: d.d, cash: d.cash, stock: d.stock, status: 'pending', createdAt: now.ms });
    changed = true;
  }
  for (const d of store.state.inv_divs.filter(x => x.status === 'pending' && x.exDate <= now.ymd)) {
    const shares = sharesBefore(d.code, d.exDate);
    if (!shares) { saveDoc('inv_divs', { ...d, status: 'none', shares: 0, amount: 0 }); changed = true; continue; }
    // 配股：每股配 stock 股，不足一股的部分券商折現，這裡直接捨去
    saveDoc('inv_divs', { ...d, status: 'paid', shares, amount: Math.floor(shares * (d.cash || 0)), newShares: Math.floor(shares * (d.stock || 0)), paidAt: now.ms });
    changed = true;
  }
  return changed;
}

// 每天記一筆總資產（畫走勢圖用），盤中會一直覆寫成最新的
export function snapshot(now = twNow()) {
  const meta = account();
  if (!meta) return;
  const L = ledger();
  const b = inv.quotes.get(BENCH);
  if (!b || !b.d) return;
  let value = L.cash;
  for (const p of L.positions) {
    const q = inv.quotes.get(p.code);
    if (!q?.z) return; // 報價不齊先不記
    value += p.shares * q.z;
  }
  const day = b.d; // 以報價日期為準（休市日不會多一筆）
  const prev = store.state.inv_snaps.find(x => x.id === day);
  value = Math.round(value);
  if (prev && prev.value === value && prev.bench === b.z) return;
  if (prev && now.ms - (prev.updatedAt || 0) < 5 * 60e3 && session(now) === 'open') return; // 盤中最多 5 分鐘寫一次
  saveDoc('inv_snaps', { id: day, value, bench: b.z, cash: Math.round(L.cash) });
}

export function openAccount(now = twNow()) {
  const b = inv.quotes.get(BENCH);
  saveDoc('inv_meta', {
    id: 'account', startCash: START_CASH, createdAt: now.ms, startDate: now.ymd,
    benchStart: b?.z ?? refPrice(BENCH, now), watch: ['0050', '2330', '2317', '2454', '0056'],
  });
}
export function setWatch(list) { const a = account(); if (a) saveDoc('inv_meta', { ...a, watch: list }); }
export function cancelOrder(o) { saveDoc('inv_orders', { ...o, status: 'cancelled', reserve: 0, endedAt: Date.now() }); }

// ---------- 格式 ----------
export const fmtMoney = n => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
export function fmtPrice(p) {
  if (p == null) return '—';
  return Number.isInteger(p) ? p.toLocaleString('en-US') : String(r2(p));
}
export const fmtPct = x => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%`);
export const fmtSigned = n => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n) >= 1000 || Number.isInteger(n) ? Math.round(Math.abs(n)).toLocaleString('en-US') : Math.abs(n).toFixed(2)}`;
// 台股習慣：漲紅跌綠
export const upDown = x => (x > 0 ? 'up' : x < 0 ? 'down' : '');
