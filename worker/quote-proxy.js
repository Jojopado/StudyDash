// 學習儀表板・模擬投資用的報價中繼站（Cloudflare Worker）
// 證交所／櫃買中心的 API 不讓手機網頁直接抓（CORS），由這裡代抓、整理成精簡格式再回傳。
// 部署：Cloudflare 後台 → Workers → 建立 → 貼上這整個檔案 → Deploy。
//
//   /rt?ch=tse_2330,otc_6488   即時報價（約 5 秒延遲）
//   /list                       全部上市＋上櫃股票／ETF（代號、名稱、市場、昨收）
//   /day?code=2330&m=tse&ym=202610   某個月的日 K
//   /div?otc=6488,8440          即將除權息的清單（上櫃另外用 Yahoo 查持有的幾檔）
//   /search?q=環球               用名稱／代號找股票（上市＋上櫃）
// 注意：櫃買中心擋 Cloudflare 的連線，上櫃的日 K 和配息改用 Yahoo 股市的資料。
//   /holidays                   今年休市日

const ALLOW = [/^https:\/\/jojopado\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', Accept: 'application/json,text/plain,*/*' };

const num = s => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
// 民國 115/10/01、1151001 → 2026-10-01
function rocDate(s) {
  const m = /^(\d{2,3})\/?(\d{2})\/?(\d{2})$/.exec(String(s).trim());
  return m ? `${+m[1] + 1911}-${m[2]}-${m[3]}` : null;
}
const isCode = c => /^\d{4,6}[A-Z]?$/.test(c);
// 股票＝4 碼、特別股＝4 碼＋字母、ETF＝00 開頭；其他 6 碼（權證）不要
const isStock = c => /^\d{4}[A-Z]?$/.test(c) || /^00\d{2,4}[A-Z]?$/.test(c);

async function getJson(url) {
  const r = await fetch(url, { headers: UA, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`);
  return r.json();
}

// ---------- 即時 ----------
async function realtime(ch) {
  const list = ch.split(',').map(s => s.trim()).filter(s => /^(tse|otc)_\d{4,6}[A-Z]?$/.test(s)).slice(0, 60);
  if (!list.length) return [];
  const ex = list.map(s => `${s}.tw`).join('|');
  const j = await getJson(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${Date.now()}`);
  const lv = s => String(s || '').split('_').map(num).filter(x => x != null && x > 0);
  return (j.msgArray || []).map(q => ({
    c: q.c, n: q.n, m: q.ex,
    d: q.d ? `${q.d.slice(0, 4)}-${q.d.slice(4, 6)}-${q.d.slice(6, 8)}` : null,
    t: q.t || q['%'] || '',
    z: num(q.z) ?? num(q.pz),   // 成交價（這一刻沒成交時用上一筆）
    o: num(q.o), h: num(q.h), l: num(q.l),
    y: num(q.y),                // 昨收（漲跌、漲跌停的基準）
    u: num(q.u), w: num(q.w),   // 漲停、跌停
    v: num(q.v),                // 今日累積成交量（張）
    a: lv(q.a), b: lv(q.b),     // 五檔賣價、買價
    f: lv(q.f), g: lv(q.g),     // 五檔賣量、買量
  }));
}

// ---------- 清單 ----------
async function stockList() {
  const [tse, otc] = await Promise.all([
    getJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
    getJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes').catch(() => []), // 被擋時 App 用內建的上櫃清單
  ]);
  const out = [];
  for (const r of tse) if (isStock(r.Code)) out.push({ c: r.Code, n: r.Name.trim(), m: 'tse', p: num(r.ClosingPrice) });
  for (const r of otc) if (isStock(r.SecuritiesCompanyCode)) out.push({ c: r.SecuritiesCompanyCode, n: r.CompanyName.trim(), m: 'otc', p: num(r.Close) });
  return { date: rocDate(tse[0]?.Date || '') || null, items: out };
}

// ---------- 日 K ----------
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
const twYmd = sec => new Date(sec * 1000 + 8 * 3600e3).toISOString().slice(0, 10);

async function yahooChart(code, m, query) {
  const sym = `${code}.${m === 'otc' ? 'TWO' : 'TW'}`;
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&${query}`);
  const r = j.chart?.result?.[0];
  if (!r) throw new Error(j.chart?.error?.description || 'Yahoo 沒有資料');
  return r;
}

async function daily(code, m, ym) {
  if (!isCode(code) || !/^\d{6}$/.test(ym)) throw new Error('參數不對');
  if (m !== 'otc') {
    try {
      const j = await getJson(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym}01&stockNo=${code}&response=json`);
      // 證交所的成交量單位是「股」→ 換成張
      return (j.data || []).map(r => [rocDate(r[0]), num(r[3]), num(r[4]), num(r[5]), num(r[6]), Math.round((num(r[1]) || 0) / 1000)]).filter(r => r[0] && r[4] != null);
    } catch { /* 證交所暫時抓不到就改用 Yahoo */ }
  }
  const y = +ym.slice(0, 4), mo = +ym.slice(4);
  const p1 = Date.UTC(y, mo - 1, 1) / 1000 - 8 * 3600, p2 = Date.UTC(y, mo, 1) / 1000 - 8 * 3600;
  const r = await yahooChart(code, m, `period1=${p1}&period2=${p2}`);
  const q = r.indicators?.quote?.[0] || {};
  const out = [];
  (r.timestamp || []).forEach((t, i) => {
    if (q.close?.[i] == null || q.open?.[i] == null) return;
    out.push([twYmd(t), r2(q.open[i]), r2(q.high[i]), r2(q.low[i]), r2(q.close[i]), Math.round((q.volume?.[i] || 0) / 1000)]);
  });
  return out.filter(row => row[0].replace('-', '').slice(0, 6) === ym);
}

// ---------- 搜尋（mis 的名稱查詢，上市上櫃都有）----------
async function search(q) {
  q = q.trim().slice(0, 20);
  if (!q) return [];
  const j = await getJson(`https://mis.twse.com.tw/stock/api/getStockNames.jsp?n=${encodeURIComponent(q)}`);
  return (j.datas || []).map(d => ({ c: d.c, n: d.n, m: String(d.key || '').startsWith('otc_') ? 'otc' : 'tse' }))
    .filter(d => isStock(d.c)).slice(0, 20);
}

// ---------- 除權息預告 ----------
async function dividends(otcCodes) {
  const [tse, otc] = await Promise.all([
    getJson('https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL').catch(() => []),
    getJson('https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost').catch(() => []),
  ]);
  const out = [];
  for (const r of tse) {
    const d = rocDate(r.Date);
    if (d && isCode(r.Code)) out.push({ c: r.Code, d, cash: num(r.CashDividend) || 0, stock: num(r.StockDividendRatio) || 0 });
  }
  for (const r of otc) {
    const d = rocDate(r.ExRrightsExDividendDate);
    if (d && isCode(r.SecuritiesCompanyCode)) out.push({ c: r.SecuritiesCompanyCode, d, cash: num(r.CashDividend) || 0, stock: num(r.StockDividendRatio) || 0 });
  }
  // 櫃買被擋時：持有的上櫃股用 Yahoo 查最近的配息（只有現金股利）
  if (!otc.length) {
    const codes = otcCodes.split(',').filter(isCode).slice(0, 15);
    const lists = await Promise.all(codes.map(c => yahooChart(c, 'otc', 'range=6mo&events=div').then(r =>
      Object.values(r.events?.dividends || {}).map(e => ({ c, d: twYmd(e.date), cash: r2(e.amount) || 0, stock: 0 }))).catch(() => [])));
    out.push(...lists.flat());
  }
  return out;
}

// ---------- 休市日 ----------
async function holidays() {
  const j = await getJson('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule');
  // 「開始交易」「最後交易」那幾天照常交易，其他列出來的都休市
  return j.map(r => ({ d: rocDate(r.Date), n: r.Name, trade: /(開始|最後)交易/.test(r.Name) })).filter(r => r.d);
}

// ---------- 路由 ----------
const ROUTES = {
  '/rt': { ttl: 4, run: q => realtime(q.get('ch') || '') },
  '/list': { ttl: 3 * 3600, run: () => stockList() },
  '/day': {
    // 這個月的資料一直在長，快取短；以前的月份不會變
    ttl: q => (q.get('ym') === new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7).replace('-', '') ? 600 : 7 * 86400),
    run: q => daily(q.get('code') || '', q.get('m') || 'tse', q.get('ym') || ''),
  },
  '/div': { ttl: 3 * 3600, run: q => dividends(q.get('otc') || '') },
  '/search': { ttl: 3600, run: q => search(q.get('q') || '') },
  '/holidays': { ttl: 86400, run: () => holidays() },
};

function corsHeaders(origin) {
  const ok = origin && ALLOW.some(r => r.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://jojopado.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const route = ROUTES[url.pathname];
    if (!route) return new Response(JSON.stringify({ ok: true, routes: Object.keys(ROUTES) }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    const ttl = typeof route.ttl === 'function' ? route.ttl(url.searchParams) : route.ttl;
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const key = new Request(url.toString(), { method: 'GET' });
    if (cache) {
      const hit = await cache.match(key);
      if (hit) {
        const res = new Response(hit.body, hit);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      }
    }
    try {
      const data = await route.run(url.searchParams);
      const body = JSON.stringify({ ok: true, at: Date.now(), data });
      const res = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` } });
      if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
