// 模擬投資頁（#invest）：畫面、下單面板、背景更新報價。
import { store } from './store.js';
import { esc } from './util.js';
import * as I from './invest.js';
import { learnCard } from './invest-learn.js';

const { inv, fmtMoney, fmtPrice, fmtPct, fmtSigned, upDown } = I;

export const invUi = {
  code: null,        // 正在看哪一檔（null = 總覽）
  query: '',         // 自選股搜尋
  bars: new Map(),   // code → 日 K（畫面用）
  loading: false,
};

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData, isActive }
const isActive = () => location.hash === '#invest';

// ---------- 背景更新 ----------
let timer = null, basicsOk = false, autoTried = false;

function codesToWatch() {
  const a = I.account();
  const set = new Set([I.BENCH, ...(a?.watch || [])]);
  for (const p of I.ledger().positions) set.add(p.code);
  for (const o of store.state.inv_orders) if (o.status === 'open') set.add(o.code);
  if (invUi.code) set.add(invUi.code);
  return [...set];
}

export async function refresh(force = false) {
  if (!I.configured() || inv.busy) return;
  inv.busy = true;
  try {
    if (!basicsOk || force) { await I.loadBasics(); basicsOk = true; }
    await I.fetchQuotes(codesToWatch());
    inv.error = '';
    await I.settle();
    I.snapshot();
  } catch (e) {
    inv.error = e.message || String(e);
  } finally {
    inv.busy = false;
  }
  if (isActive()) ctx.render();
}

function schedule() {
  clearTimeout(timer);
  const open = I.session() === 'open';
  const hasOrders = store.state.inv_orders.some(o => o.status === 'open');
  // 在這頁＋盤中：5 秒；不在這頁但有掛單：1 分鐘；其他：5 分鐘
  const ms = isActive() ? (open ? 5000 : 60000) : hasOrders ? 60000 : 300000;
  timer = setTimeout(async () => {
    if (document.visibilityState === 'visible' && store.ready && I.account()) await refresh();
    schedule();
  }, ms);
}

export function initInvest(c) {
  ctx = c;
  window.addEventListener('hashchange', () => { if (isActive()) { refresh(); schedule(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.ready) { refresh(); schedule(); } });
  // 資料載入後先跑一次（處理離開期間該成交／失效的單）
  const wait = setInterval(() => {
    if (!store.ready) return;
    clearInterval(wait);
    if (I.configured()) refresh();
    schedule();
  }, 300);
  document.addEventListener('input', onInput);
  document.addEventListener('pointermove', onChartHover);
  document.addEventListener('pointerdown', onChartHover);
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (isActive()) ctx.render(); }, 200); });
}

// ---------- 畫面 ----------
function statusLine() {
  const s = I.session();
  const now = I.twNow();
  const next = I.orderDay(now);
  const nd = `${+next.slice(5, 7)}/${+next.slice(8)}（${'日一二三四五六'[new Date(next + 'T00:00:00Z').getUTCDay()]}）`;
  const t = inv.lastAt ? new Date(inv.lastAt).toLocaleTimeString('zh-TW', { hour12: false }) : '';
  if (s === 'open') return `<span class="dot live-dot"></span>盤中 · 報價 ${t}（約延遲 5 秒）`;
  if (s === 'pre') return '開盤前 · 現在下單會在 9:00 開盤時撮合';
  if (s === 'closed') return `已收盤 · 現在下單＝預約 ${nd} 開盤`;
  return `休市${I.holidayName(now.ymd) ? `（${esc(I.holidayName(now.ymd))}）` : ''} · 現在下單＝預約 ${nd} 開盤`;
}

function setupCard() {
  return `<div class="card inv-setup">
    <h2>還差一步：架報價中繼站</h2>
    <div class="sub">證交所的即時報價不讓手機網頁直接抓，需要一個免費的 Cloudflare 小中繼站幫忙轉。設定一次就好。</div>
    <ol>
      <li>到 <b>dash.cloudflare.com</b> 註冊（免費）</li>
      <li>左邊選 <b>Workers 和 Pages</b> → <b>建立</b> → <b>從 Hello World 開始</b></li>
      <li>名稱填 <b>studydash-quote</b> → 部署 → <b>編輯程式碼</b></li>
      <li>把 <code>worker/quote-proxy.js</code> 的內容整個貼上 → <b>部署</b></li>
      <li>把網址（…workers.dev）給 Claude，填進 <code>js/invest-config.js</code></li>
    </ol>
  </div>`;
}

function openAccountCard() {
  return `<div class="card inv-hero">
    <h2>開一個模擬帳戶</h2>
    <p>起始資金 <b>${fmtMoney(I.START_CASH)}</b>，用真實台股報價、照真實規則扣手續費（2.8 折）和證交稅。</p>
    <p class="sub">只有一個帳戶、不能重來，就像真的一樣。每筆買賣都可以寫下理由，之後回頭檢討。績效會跟 0050 比。</p>
    <button class="btn primary" data-action="inv-open-account" ${inv.byCode.size ? '' : 'disabled'}>${inv.byCode.size ? '開戶' : '載入報價中…'}</button>
  </div>`;
}

function summary(L, meta) {
  let mv = 0, unreal = 0, complete = true;
  for (const p of L.positions) {
    const px = I.priceOf(p.code);
    if (px == null) { complete = false; continue; }
    mv += p.shares * px;
    unreal += I.costs('sell', px, p.shares, p.code).net - p.cost;
  }
  const total = L.cash + mv;
  const ret = (total - L.start) / L.start;
  const b = I.priceOf(I.BENCH);
  const bret = meta.benchStart && b ? b / meta.benchStart - 1 : null;
  const days = Math.max(0, Math.round((Date.now() - meta.createdAt) / 86400e3));
  return `<div class="card inv-hero">
    <div class="sub">總資產（現金＋股票市值）${complete ? '' : ' · 部分報價載入中'}</div>
    <div class="inv-total">${fmtMoney(total)}</div>
    <div class="inv-rets">
      <span class="${upDown(ret)}">${fmtSigned(total - L.start)}（${fmtPct(ret)}）</span>
      <span class="sub">同期 0050 <b class="${upDown(bret)}">${fmtPct(bret)}</b></span>
    </div>
    <div class="inv-kv">
      <div><span>現金</span><b>${fmtMoney(L.cash)}</b></div>
      <div><span>可用（扣掉掛單）</span><b>${fmtMoney(L.buyingPower)}</b></div>
      <div><span>股票市值</span><b>${fmtMoney(mv)}</b></div>
      <div><span>未實現損益</span><b class="${upDown(unreal)}">${fmtSigned(unreal)}</b></div>
      <div><span>已實現損益</span><b class="${upDown(L.realized)}">${fmtSigned(L.realized)}</b></div>
      <div><span>股利</span><b>${fmtMoney(L.divs)}</b></div>
      <div><span>手續費＋稅（累計）</span><b>${fmtMoney(L.fees + L.taxes)}</b></div>
      <div><span>開戶</span><b>${days} 天</b></div>
    </div>
    <div class="sub inv-note">未實現損益已先扣掉賣出時的手續費和證交稅，跟券商 App 顯示的算法一樣。</div>
  </div>`;
}

function holdingsCard(L) {
  if (!L.positions.length) return `<div class="card"><h2>我的持股</h2><div class="empty">還沒有股票。點下面的自選股就能買。</div></div>`;
  const rows = L.positions.map(p => {
    const px = I.priceOf(p.code);
    const avg = p.cost / p.shares;
    const pnl = px != null ? I.costs('sell', px, p.shares, p.code).net - p.cost : null;
    return `<div class="inv-row" data-action="inv-stock" data-code="${p.code}">
      <div class="nm"><b>${esc(p.name)}</b><span class="sub">${p.code} · ${p.shares.toLocaleString()} 股${p.selling ? `（賣單 ${p.selling}）` : ''}</span></div>
      <div class="num"><span class="sub">均價 ${fmtPrice(Math.round(avg * 100) / 100)}</span><b>${fmtPrice(px)}</b></div>
      <div class="num pnl ${upDown(pnl)}">${pnl == null ? '—' : fmtSigned(pnl)}<span>${pnl == null ? '' : fmtPct(pnl / p.cost)}</span></div>
    </div>`;
  }).join('');
  return `<div class="card"><h2>我的持股</h2>${rows}</div>`;
}

const sideLabel = o => (o.side === 'buy' ? '買' : '賣');
const qty = o => (o.odd ? `${o.shares} 股` : `${o.shares / 1000} 張`);
const md = ymd => `${+ymd.slice(5, 7)}/${+ymd.slice(8)}`;

function openOrdersCard() {
  const open = store.state.inv_orders.filter(o => o.status === 'open').sort((a, b) => b.placedAt - a.placedAt);
  if (!open.length) return '';
  const today = I.twNow().ymd;
  return `<div class="card"><h2>委託中（${open.length}）</h2>${open.map(o => `<div class="inv-row">
      <span class="side ${o.side}">${sideLabel(o)}</span>
      <div class="nm"><b>${esc(o.name)}</b><span class="sub">${o.code} · ${qty(o)} · ${o.kind === 'limit' ? `限價 ${fmtPrice(o.price)}` : '市價'}</span></div>
      <div class="num"><span class="sub">${o.tradeDay === today ? '今天有效' : `預約 ${md(o.tradeDay)}`}</span><b>${fmtPrice(I.priceOf(o.code))}</b></div>
      <button class="btn small" data-action="inv-cancel" data-id="${o.id}">刪單</button>
    </div>`).join('')}</div>`;
}

function watchCard(meta) {
  const q = invUi.query.trim();
  let results = '';
  if (q) {
    const lq = q.toLowerCase();
    const hits = (inv.list || []).filter(x => x.c.startsWith(q) || x.n.toLowerCase().includes(lq)).slice(0, 8);
    if (hits.length < 3) remoteSearch(q);
    results = `<div class="inv-results">${hits.length ? hits.map(x => `<div class="inv-row" data-action="inv-stock" data-code="${x.c}">
        <div class="nm"><b>${esc(x.n)}</b><span class="sub">${x.c} · ${x.m === 'otc' ? '上櫃' : '上市'}${I.isEtf(x.c) ? ' · ETF' : ''}</span></div>
        <div class="num"><b>${fmtPrice(x.p)}</b><span class="sub">昨收</span></div>
        ${meta.watch.includes(x.c) ? '<span class="sub">已加入</span>' : `<button class="btn small" data-action="inv-watch-add" data-code="${x.c}">＋自選</button>`}
      </div>`).join('') : '<div class="empty">找不到</div>'}</div>`;
  }
  const rows = meta.watch.map(code => {
    const qt = inv.quotes.get(code);
    const px = qt?.z, y = qt?.y;
    const chg = px != null && y ? px - y : null;
    return `<div class="inv-row" data-action="inv-stock" data-code="${code}">
      <div class="nm"><b>${esc(I.nameOf(code))}</b><span class="sub">${code}</span></div>
      <div class="num"><b class="${upDown(chg)}">${fmtPrice(px)}</b></div>
      <div class="num pnl ${upDown(chg)}">${chg == null ? '—' : fmtSigned(Math.round(chg * 100) / 100)}<span>${chg == null ? '' : fmtPct(chg / y)}</span></div>
    </div>`;
  }).join('');
  return `<div class="card"><h2>自選股</h2>
    <form data-form="inv-search" class="inv-search" onsubmit="return false"><input type="search" name="q" value="${esc(invUi.query)}" placeholder="🔍 代號或名稱，例如 2330、台積電、0056" autocomplete="off"></form>
    ${results}${rows || '<div class="empty">還沒有自選股</div>'}</div>`;
}

let remoteTimer = null;
const remoteDone = new Set();
function remoteSearch(q) {
  if (q.length < 2 || remoteDone.has(q)) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(async () => {
    remoteDone.add(q);
    try { const rows = await I.searchRemote(q); if (rows.length && invUi.query.trim() === q) ctx.render(); } catch { /* 查不到就算了 */ }
  }, 400);
}

function historyCard() {
  const done = store.state.inv_orders.filter(o => o.status !== 'open').sort((a, b) => (b.fill?.at || b.endedAt || 0) - (a.fill?.at || a.endedAt || 0));
  const divs = store.state.inv_divs.filter(d => d.status === 'paid');
  if (!done.length && !divs.length) return '';
  const items = [
    ...done.map(o => ({ at: o.fill?.at || o.endedAt || o.placedAt, html: o.status === 'filled'
      ? `<div class="inv-row" data-action="inv-trade" data-id="${o.id}">
          <span class="side ${o.side}">${sideLabel(o)}</span>
          <div class="nm"><b>${esc(o.name)}</b><span class="sub">${md(o.fill.day)} · ${qty(o)} @ ${fmtPrice(o.fill.price)}${o.note ? ' · 📝' : ''}</span></div>
          <div class="num"><b>${o.side === 'buy' ? '-' : '+'}${fmtMoney(o.fill.net).replace('-', '')}</b><span class="sub">費 ${o.fill.fee}${o.fill.tax ? ` 稅 ${o.fill.tax}` : ''}</span></div>
        </div>`
      : `<div class="inv-row muted" data-action="inv-trade" data-id="${o.id}">
          <span class="side">${sideLabel(o)}</span>
          <div class="nm"><b>${esc(o.name)}</b><span class="sub">${qty(o)} · ${o.kind === 'limit' ? `限價 ${fmtPrice(o.price)}` : '市價'} · ${o.status === 'cancelled' ? '已刪單' : esc(o.endReason || '未成交')}</span></div>
        </div>` })),
    ...divs.map(d => ({ at: I.twMs(d.exDate), html: `<div class="inv-row">
        <span class="side div">息</span>
        <div class="nm"><b>${esc(d.name)}</b><span class="sub">${md(d.exDate)} 除權息 · ${d.shares} 股${d.cash ? ` × ${d.cash} 元` : ''}${d.newShares ? ` · 配 ${d.newShares} 股` : ''}</span></div>
        <div class="num"><b>+${fmtMoney(d.amount)}</b></div>
      </div>` })),
  ].sort((a, b) => b.at - a.at);
  return `<div class="card"><h2>交易紀錄</h2>${items.slice(0, 40).map(x => x.html).join('')}</div>`;
}

function upcomingDivs() {
  const list = store.state.inv_divs.filter(d => d.status === 'pending').sort((a, b) => a.exDate.localeCompare(b.exDate));
  if (!list.length) return '';
  return `<div class="card"><h2>即將除權息</h2>${list.map(d => `<div class="inv-row">
      <div class="nm"><b>${esc(d.name)}</b><span class="sub">${d.code} · ${md(d.exDate)} ${d.cash ? `每股配息 ${d.cash} 元` : ''}${d.stock ? ` 每股配股 ${d.stock} 股` : ''}</span></div>
    </div>`).join('')}<div class="sub inv-note">除息日前一天收盤時還持有才領得到。真實世界的股利大約一個月後才匯進戶頭，這裡在除息日直接算進現金。</div></div>`;
}

function rulesCard() {
  return `<details class="card inv-rules"><summary><h2>📘 規則小抄</h2></summary>
    <div class="md-table"><table><tbody>
      <tr><th>交易時間</th><td>週一～五 9:00～13:30。收盤後或假日下的單是「預約單」，下個交易日開盤才撮合。</td></tr>
      <tr><th>整張／零股</th><td>1 張 = 1000 股。錢不多時買「零股」（1～999 股）。零股只能下限價單。</td></tr>
      <tr><th>限價／市價</th><td>限價：最多願意用多少買（最少多少賣）。市價：有人賣就買，價格不保證；券商會先用漲停價圈住你的錢。</td></tr>
      <tr><th>當日有效（ROD）</th><td>掛單只到當天收盤，沒成交就自動失效，隔天要重新下。</td></tr>
      <tr><th>手續費</th><td>成交金額 × 0.1425% × 2.8 折，無條件捨去。整張最低 20 元、零股最低 1 元。買賣都收。</td></tr>
      <tr><th>證交稅</th><td>只有賣出收：股票 0.3%、ETF 0.1%。</td></tr>
      <tr><th>漲跌停</th><td>一天最多漲跌 10%（以昨收為準），限價單不能超過。</td></tr>
      <tr><th>升降單位</th><td>價格要對齊跳動單位：10 元以下 0.01、10～50 元 0.05、50～100 元 0.1、100～500 元 0.5、500～1000 元 1、1000 元以上 5（ETF：50 元以下 0.01、以上 0.05）。</td></tr>
      <tr><th>T+2 交割</th><td>成交後第 2 個交易日才真的扣款／入帳。真實世界要記得在那天前把錢存進交割戶，不然是違約交割。</td></tr>
      <tr><th>除權息</th><td>公司分紅：配息＝發現金，配股＝發股票。除息日當天股價會先扣掉配的錢，但你會拿到股利。</td></tr>
    </tbody></table></div>
    <div class="sub inv-note">模擬的限制：用整股市場的報價來算零股；成交只看價格，不看掛單量，冷門股真實下單可能買不到或買貴（滑價）。</div>
  </details>`;
}

// ---------- 圖表 ----------
const charts = new Map(); // id → { n, x0, x1, W, band, text: i → html }

// 圖表用實際寬度畫（SVG 不縮放，文字才不會被拉扁）
function chartWidth() {
  const v = document.getElementById('view');
  if (!v) return 600;
  const wide = matchMedia('(min-width: 900px)').matches;
  const inner = v.clientWidth - (wide ? 64 : 32);
  return Math.max(260, Math.round((wide ? (inner - 14) / 2 : inner) - 34));
}

function equityChart(meta) {
  const snaps = store.state.inv_snaps.filter(s => s.id >= meta.startDate).sort((a, b) => a.id.localeCompare(b.id));
  if (snaps.length < 2) {
    return `<div class="card"><h2>報酬走勢</h2><div class="empty">開戶第二個交易日之後就會出現走勢圖（每天記一筆）。</div></div>`;
  }
  const start = meta.startCash, b0 = meta.benchStart || snaps[0].bench;
  const mine = snaps.map(s => s.value / start - 1), bench = snaps.map(s => (s.bench && b0 ? s.bench / b0 - 1 : null));
  const all = [...mine, ...bench.filter(x => x != null), 0];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.12, 0.005);
  lo -= pad; hi += pad;
  const W = chartWidth(), H = 200, L = 6, R = 52, T = 8, B = 22;
  const x = i => L + (W - L - R) * (snaps.length === 1 ? 0.5 : i / (snaps.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const path = arr => arr.map((v, i) => (v == null ? '' : `${i && arr[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const ticks = niceTicks(lo, hi, 4);
  const id = 'eq';
  charts.set(id, {
    n: snaps.length, x0: L, x1: W - R, W,
    text: i => `${md(snaps[i].id)}　<b class="s1">我的帳戶 ${fmtPct(mine[i])}</b>（${fmtMoney(snaps[i].value)}）　<b class="s2">0050 ${fmtPct(bench[i])}</b>`,
  });
  const lastI = snaps.length - 1;
  return `<div class="card"><h2>報酬走勢</h2>
    <div class="legend"><span><i class="s1"></i>我的帳戶</span><span><i class="s2"></i>0050（同期買進持有）</span></div>
    <div class="chart" data-chart="${id}">
      <svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="我的帳戶與 0050 的累計報酬率">
        ${ticks.map(t => `<line class="grid${t === 0 ? ' zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${W - R + 6}" y="${y(t) + 4}">${(t * 100).toFixed(Math.abs(hi - lo) < 0.05 ? 1 : 0)}%</text>`).join('')}
        <text class="axis" x="${L}" y="${H - 6}">${md(snaps[0].id)}</text>
        <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${md(snaps[lastI].id)}</text>
        <path class="ln s2" d="${path(bench)}"/>
        <path class="ln s1" d="${path(mine)}"/>
        <circle class="pt s1" cx="${x(lastI)}" cy="${y(mine[lastI])}" r="4"/>
        <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      </svg>
    </div>
    <div class="readout" data-readout="${id}">${charts.get(id).text(lastI)}</div>
  </div>`;
}

function niceTicks(lo, hi, n) {
  const span = hi - lo, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function kChart(code) {
  const bars = (invUi.bars.get(code) || []).slice(-60);
  if (!bars.length) return `<div class="empty">${invUi.loading ? 'K 線載入中…' : '沒有歷史資料'}</div>`;
  const W = chartWidth(), H = 190, VH = 56, L = 4, R = 52, T = 8;
  const lo = Math.min(...bars.map(b => b[3])), hi = Math.max(...bars.map(b => b[2]));
  const pad = (hi - lo) * 0.06 || hi * 0.02;
  const ylo = lo - pad, yhi = hi + pad;
  const vmax = Math.max(...bars.map(b => b[5] || 0)) || 1;
  const step = (W - L - R) / bars.length;
  const bw = Math.max(1.5, Math.min(8, step - 2));
  const x = i => L + step * (i + 0.5);
  const y = v => T + (H - T - 6) * (1 - (v - ylo) / (yhi - ylo));
  const vy = v => H + VH - (VH - 8) * (v / vmax);
  const ticks = niceTicks(ylo, yhi, 4);
  const id = 'k' + code;
  charts.set(id, {
    n: bars.length, x0: L, x1: W - R, W, band: true,
    text: i => { const [d, o, h, l, c, v] = bars[i]; const p = i ? bars[i - 1][4] : o;
      return `${md(d)}　開 ${fmtPrice(o)}　高 ${fmtPrice(h)}　低 ${fmtPrice(l)}　收 <b class="${upDown(c - p)}">${fmtPrice(c)}</b>（${fmtPct(c / p - 1)}）　量 ${(v || 0).toLocaleString()} 張`; },
  });
  const candles = bars.map((b, i) => {
    const [, o, h, l, c, v] = b;
    const cls = c > o ? 'up' : c < o ? 'down' : 'flat';
    const top = y(Math.max(o, c)), bot = y(Math.min(o, c));
    return `<g class="cdl ${cls}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(h)}" y2="${y(l)}"/>
      <rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}"/>
      <rect class="vol" x="${x(i) - bw / 2}" y="${vy(v || 0)}" width="${bw}" height="${H + VH - vy(v || 0)}"/></g>`;
  }).join('');
  return `<div class="chart" data-chart="${id}">
      <svg viewBox="0 0 ${W} ${H + VH}" style="height:${H + VH}px" role="img" aria-label="${code} 日 K 線">
        ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${W - R + 6}" y="${y(t) + 4}">${fmtPrice(t)}</text>`).join('')}
        <line class="grid" x1="${L}" x2="${W - R}" y1="${H}" y2="${H}"/>
        <text class="axis" x="${W - R + 6}" y="${H + 14}">量</text>
        ${candles}
        <line class="xh" x1="0" x2="0" y1="${T}" y2="${H + VH}" visibility="hidden"/>
      </svg>
    </div>
    <div class="readout" data-readout="${id}">${charts.get(id).text(bars.length - 1)}</div>
    <div class="sub inv-note">紅 K＝收盤比開盤高，綠 K＝收盤比開盤低（台股習慣漲紅跌綠）。下面是每天成交量。點圖可看每一天。</div>`;
}

function onChartHover(ev) {
  const box = ev.target.closest?.('[data-chart]');
  if (!box) return;
  const c = charts.get(box.dataset.chart);
  if (!c) return;
  const r = box.getBoundingClientRect();
  const fx = (ev.clientX - r.left) / r.width * c.W;
  const t = (fx - c.x0) / (c.x1 - c.x0);
  const i = Math.max(0, Math.min(c.n - 1, c.band ? Math.floor(t * c.n) : Math.round(t * (c.n - 1))));
  const xi = c.band ? c.x0 + (c.x1 - c.x0) * (i + 0.5) / c.n : c.x0 + (c.x1 - c.x0) * (c.n === 1 ? 0.5 : i / (c.n - 1));
  const xh = box.querySelector('.xh');
  if (xh) { xh.setAttribute('x1', xi); xh.setAttribute('x2', xi); xh.setAttribute('visibility', 'visible'); }
  const ro = document.querySelector(`[data-readout="${box.dataset.chart}"]`);
  if (ro) ro.innerHTML = c.text(i);
}

// ---------- 個股頁 ----------
function stockPage(meta, L) {
  const code = invUi.code;
  const q = inv.quotes.get(code);
  const name = I.nameOf(code);
  const px = q?.z ?? I.priceOf(code);
  const y = q?.y;
  const chg = px != null && y ? px - y : null;
  const watching = meta.watch.includes(code);
  const pos = L.allPositions.get(code);
  const book = q && (q.a?.length || q.b?.length) ? `<div class="inv-book">
      <div class="hd"><span>買量</span><span>買價</span><span>賣價</span><span>賣量</span></div>
      ${[0, 1, 2, 3, 4].map(i => `<div><span>${q.g?.[i] ?? ''}</span><b class="${upDown((q.b?.[i] ?? y) - y)}">${q.b?.[i] != null ? fmtPrice(q.b[i]) : ''}</b><b class="${upDown((q.a?.[i] ?? y) - y)}">${q.a?.[i] != null ? fmtPrice(q.a[i]) : ''}</b><span>${q.f?.[i] ?? ''}</span></div>`).join('')}
    </div><div class="sub inv-note">五檔：現在掛著最好的 5 個買價和賣價（量的單位是張）。市價買會買在最低的賣價。</div>` : '';
  const trades = store.state.inv_orders.filter(o => o.code === code && o.status === 'filled').sort((a, b) => b.fill.at - a.fill.at);
  const avg = pos?.shares ? pos.cost / pos.shares : null;
  const pnl = pos?.shares && px != null ? I.costs('sell', px, pos.shares, code).net - pos.cost : null;
  return `<div class="page-head">
      <div><button class="btn ghost small" data-action="inv-back">← 返回</button>
        <h1>${esc(name)} <span class="sub">${code} · ${I.marketOf(code) === 'otc' ? '上櫃' : '上市'}${I.isEtf(code) ? ' · ETF' : ''}</span></h1></div>
      <button class="btn" data-action="${watching ? 'inv-watch-remove' : 'inv-watch-add'}" data-code="${code}">${watching ? '★ 已在自選' : '☆ 加入自選'}</button>
    </div>
    <div class="grid two">
      <div class="card">
        <div class="inv-quote"><b class="${upDown(chg)}">${fmtPrice(px)}</b>
          <span class="${upDown(chg)}">${chg == null ? '' : `${fmtSigned(Math.round(chg * 100) / 100)}（${fmtPct(chg / y)}）`}</span></div>
        <div class="sub">${q?.d ? `${md(q.d)} ${esc(q.t || '')}` : ''}</div>
        <div class="inv-kv">
          <div><span>開盤</span><b>${fmtPrice(q?.o)}</b></div><div><span>最高</span><b>${fmtPrice(q?.h)}</b></div>
          <div><span>最低</span><b>${fmtPrice(q?.l)}</b></div><div><span>昨收</span><b>${fmtPrice(y)}</b></div>
          <div><span>漲停</span><b class="up">${fmtPrice(q?.u)}</b></div><div><span>跌停</span><b class="down">${fmtPrice(q?.w)}</b></div>
          <div><span>成交量</span><b>${q?.v != null ? q.v.toLocaleString() + ' 張' : '—'}</b></div>
          <div><span>一張要</span><b>${px != null ? fmtMoney(px * 1000) : '—'}</b></div>
        </div>
        <div class="row inv-trade-btns">
          <button class="btn buy" data-action="inv-order" data-side="buy" data-code="${code}">買進</button>
          <button class="btn sell" data-action="inv-order" data-side="sell" data-code="${code}" ${pos?.shares ? '' : 'disabled'}>賣出</button>
        </div>
        ${pos?.shares ? `<div class="inv-mine">我有 <b>${pos.shares.toLocaleString()} 股</b>，均價 ${fmtPrice(Math.round(avg * 100) / 100)}，損益 <b class="${upDown(pnl)}">${pnl == null ? '—' : `${fmtSigned(pnl)}（${fmtPct(pnl / pos.cost)}）`}</b></div>` : ''}
        ${book}
      </div>
      <div class="card"><h2>日 K（近 3 個月）</h2>${kChart(code)}</div>
    </div>
    ${trades.length ? `<div class="card" style="margin-top:14px"><h2>我在這檔的交易</h2>${trades.map(o => `<div class="inv-row" data-action="inv-trade" data-id="${o.id}">
        <span class="side ${o.side}">${sideLabel(o)}</span>
        <div class="nm"><b>${md(o.fill.day)} · ${qty(o)} @ ${fmtPrice(o.fill.price)}</b><span class="sub">${o.note ? esc(o.note) : '（沒寫理由）'}</span></div>
      </div>`).join('')}</div>` : ''}`;
}

async function loadBars(code) {
  if (invUi.bars.has(code) && invUi.bars.get(code).length) return;
  invUi.loading = true;
  try { invUi.bars.set(code, await I.fetchBars(code, 3)); } catch { invUi.bars.set(code, []); }
  invUi.loading = false;
  if (isActive() && invUi.code === code) ctx.render();
}

export function renderInvest() {
  charts.clear();
  if (!I.configured()) return `<div class="page-head"><div><h1>📈 模擬投資</h1></div></div>${setupCard()}`;
  const meta = I.account();
  const head = `<div class="page-head"><div><h1>📈 模擬投資</h1><div class="sub">${statusLine()}</div></div>
    <button class="btn small" data-action="inv-refresh">⟳ 更新</button></div>
    ${inv.error ? `<div class="banner">報價抓不到：${esc(inv.error)}</div>` : ''}`;
  if (!meta) {
    if (!inv.byCode.size && !inv.busy && !autoTried) { autoTried = true; refresh(); }
    return head + openAccountCard() + `<div class="grid two" style="margin-top:14px;align-items:start">${learnCard()}${rulesCard()}</div>`;
  }
  const L = I.ledger();
  if (invUi.code) return stockPage(meta, L);
  return `${head}<div class="grid">
    <div class="grid two">${summary(L, meta)}${equityChart(meta)}</div>
    <div class="grid two"><div class="grid">${holdingsCard(L)}${openOrdersCard()}</div><div class="grid">${watchCard(meta)}</div></div>
    <div class="grid two"><div class="grid">${historyCard()}</div><div class="grid">${upcomingDivs()}${learnCard()}${rulesCard()}</div></div></div>`;
}

// ---------- 下單面板 ----------
function orderSheet(d) {
  const code = d.code;
  const L = I.ledger();
  const pos = L.allPositions.get(code);
  const free = (pos?.shares || 0) - (pos?.selling || 0);
  const ref = I.refPrice(code);
  const up = ref != null ? I.limitUp(ref, code) : null, dn = ref != null ? I.limitDown(ref, code) : null;
  const buy = d.side === 'buy';
  return `<h2>${buy ? '買進' : '賣出'} ${esc(I.nameOf(code))} <span class="sub">${code}</span></h2>
    <form data-form="inv-order">
      <div class="seg wide"><button type="button" data-action="inv-side" data-v="buy" class="${buy ? 'on buy' : ''}">買進</button><button type="button" data-action="inv-side" data-v="sell" class="${buy ? '' : 'on sell'}" ${free > 0 ? '' : 'disabled'}>賣出</button></div>
      <div class="sub inv-ref">現價 <b>${fmtPrice(I.priceOf(code))}</b> · 漲停 ${fmtPrice(up)} · 跌停 ${fmtPrice(dn)}${buy ? ` · 可用 ${fmtMoney(L.buyingPower)}` : ` · 可賣 ${free} 股`}</div>
      <div class="row">
        <div class="field" style="flex:1"><span>單位</span><div class="seg"><button type="button" data-action="inv-unit" data-v="odd" class="${d.unit === 'odd' ? 'on' : ''}">零股</button><button type="button" data-action="inv-unit" data-v="lot" class="${d.unit === 'lot' ? 'on' : ''}">整張</button></div></div>
        <label class="field" style="flex:1"><span>${d.unit === 'lot' ? '張數' : '股數（1～999）'}</span><input type="text" inputmode="numeric" name="qty" value="${esc(d.qty)}" autocomplete="off"></label>
      </div>
      <div class="row">
        <div class="field" style="flex:1"><span>價格</span><div class="seg"><button type="button" data-action="inv-kind" data-v="limit" class="${d.kind === 'limit' ? 'on' : ''}">限價</button><button type="button" data-action="inv-kind" data-v="market" class="${d.kind === 'market' ? 'on' : ''}" ${d.unit === 'odd' ? 'disabled title="零股只能限價"' : ''}>市價</button></div></div>
        <div class="field" style="flex:1"><span>${d.kind === 'limit' ? '限價（元）' : '　'}</span>${d.kind === 'limit' ? `<div class="stepper">
          <button type="button" data-action="inv-step" data-dir="-1">−</button><input type="text" inputmode="decimal" name="price" value="${esc(d.price)}" autocomplete="off"><button type="button" data-action="inv-step" data-dir="1">＋</button></div>` : '<div class="sub" style="padding-top:8px">用當下最好的價格成交</div>'}</div>
      </div>
      <div class="inv-est" id="inv-est">${estimate(d)}</div>
      <label class="field"><span>${buy ? '為什麼買？（寫下來，之後回頭看最有收穫）' : '為什麼賣？'}</span><textarea name="note" placeholder="${buy ? '例如：0056 高股息，想領股利／看好 AI 伺服器需求…' : '例如：到目標價／當初理由不成立了／停損…'}">${esc(d.note)}</textarea></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn ${buy ? 'buy' : 'sell'}">${buy ? '送出買單' : '送出賣單'}</button></div>
    </form>`;
}

function parseOrder(d) {
  const n = parseInt(String(d.qty).trim(), 10);
  const shares = d.unit === 'lot' ? n * 1000 : n;
  const price = parseFloat(String(d.price).trim());
  return { code: d.code, side: d.side, kind: d.kind, price, shares };
}

function estimate(d) {
  const p = parseOrder(d);
  const c = I.checkOrder(p);
  if (!c.ok) return `<div class="err">${esc(c.error)}</div>`;
  const e = c.est, buy = d.side === 'buy';
  const when = c.day === I.twNow().ymd && I.session() === 'open' ? '送出後馬上撮合' : `預約單：${md(c.day)} 開盤撮合`;
  return `<div class="inv-kv">
      <div><span>${d.kind === 'market' ? '估計金額' : '成交金額'}</span><b>${fmtMoney(e.amount)}</b></div>
      <div><span>手續費</span><b>${e.fee}</b></div>
      ${buy ? '' : `<div><span>證交稅 ${I.isEtf(d.code) ? '0.1%' : '0.3%'}</span><b>${e.tax}</b></div>`}
      <div><span>${buy ? '總共要付' : '實拿'}</span><b>${fmtMoney(e.net)}</b></div>
    </div>
    <div class="sub">${when} · 當日有效 · T+2（${md(I.addTradingDays(c.day, 2))}）交割${d.kind === 'market' && buy ? ' · 市價單先用漲停價圈存' : ''}</div>`;
}

function refreshSheet() {
  const d = ctx.sheetData();
  if (!d || d.kind0 !== 'inv-order') return;
  ctx.openSheet(orderSheet(d), { kind: 'inv-order', data: d });
}

function onInput(ev) {
  const el = ev.target;
  if (el.form?.dataset.form === 'inv-search') {
    invUi.query = el.value;
    ctx.render();
    return;
  }
  if (el.form?.dataset.form === 'inv-order') {
    const d = ctx.sheetData();
    if (!d) return;
    if (el.name === 'qty' || el.name === 'price' || el.name === 'note') d[el.name] = el.value;
    if (el.name !== 'note') { const box = document.getElementById('inv-est'); if (box) box.innerHTML = estimate(d); }
  }
}

function openOrder(code, side) {
  const px = I.priceOf(code);
  const odd = px != null && px * 1000 > I.ledger().buyingPower;
  const pos = I.ledger().allPositions.get(code);
  const d = {
    kind0: 'inv-order', code, side, unit: side === 'sell' ? (pos?.shares >= 1000 ? 'lot' : 'odd') : odd ? 'odd' : 'lot',
    qty: '1', kind: 'limit', price: px != null ? String(px) : '', note: '',
  };
  if (side === 'sell' && d.unit === 'odd') d.qty = String(Math.min(999, pos?.shares || 1));
  ctx.openSheet(orderSheet(d), { kind: 'inv-order', data: d });
}

export async function submitOrder(form) {
  const d = ctx.sheetData();
  if (!d) return;
  d.note = form.note?.value?.trim() || '';
  const c = I.checkOrder(parseOrder(d));
  if (!c.ok) { ctx.toast(c.error); return; }
  const o = { ...c.order, note: d.note };
  const { saveDoc } = await import('./store.js');
  saveDoc('inv_orders', o);
  ctx.closeSheet();
  ctx.toast(I.session() === 'open' && o.tradeDay === I.twNow().ymd ? '已送出，撮合中…' : `已預約 ${md(o.tradeDay)} 開盤`);
  await refresh();
  const after = store.state.inv_orders.find(x => x.id === o.id);
  if (after?.status === 'filled') ctx.toast(`成交！${o.side === 'buy' ? '買進' : '賣出'} ${qty(o)} @ ${fmtPrice(after.fill.price)}`);
}

function tradeSheet(o) {
  const f = o.fill;
  return `<h2>${o.side === 'buy' ? '買進' : '賣出'} ${esc(o.name)} <span class="sub">${o.code}</span></h2>
    <div class="inv-kv">
      ${f ? `<div><span>成交</span><b>${md(f.day)} · ${qty(o)} @ ${fmtPrice(f.price)}</b></div>
      <div><span>成交金額</span><b>${fmtMoney(f.amount)}</b></div>
      <div><span>手續費</span><b>${f.fee}</b></div>
      <div><span>證交稅</span><b>${f.tax}</b></div>
      <div><span>${o.side === 'buy' ? '付出' : '實拿'}</span><b>${fmtMoney(f.net)}</b></div>
      <div><span>交割日</span><b>${md(f.settle)}</b></div>`
      : `<div><span>狀態</span><b>${o.status === 'cancelled' ? '已刪單' : esc(o.endReason || '未成交')}</b></div>`}
      <div><span>委託</span><b>${o.kind === 'limit' ? `限價 ${fmtPrice(o.price)}` : '市價'}</b></div>
    </div>
    <form data-form="inv-note" data-id="${o.id}">
      <label class="field"><span>當時的理由</span><textarea name="note" placeholder="（沒寫）">${esc(o.note || '')}</textarea></label>
      <label class="field"><span>事後檢討（結果如何？下次會怎麼做？）</span><textarea name="review" placeholder="例如：太早賣、追高了、照計畫停損…">${esc(o.review || '')}</textarea></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">關閉</button>
        <button type="submit" class="btn primary">儲存</button></div>
    </form>`;
}

export async function submitNote(form) {
  const o = store.state.inv_orders.find(x => x.id === form.dataset.id);
  if (!o) return;
  const { saveDoc } = await import('./store.js');
  saveDoc('inv_orders', { ...o, note: form.note.value.trim(), review: form.review.value.trim() });
  ctx.closeSheet();
  ctx.toast('已儲存');
}

// ---------- 點擊 ----------
export const invActions = {
  'inv-open-account': () => {
    if (I.account()) return;
    if (!confirm(`用 ${fmtMoney(I.START_CASH)} 開戶？開了就不能重來。`)) return;
    I.openAccount();
    ctx.toast('開戶完成！先從自選股挑一檔看看');
  },
  'inv-refresh': () => { refresh(true); ctx.toast('更新中…'); },
  'inv-stock': el => {
    invUi.code = el.dataset.code;
    invUi.query = '';
    ctx.render();
    window.scrollTo(0, 0);
    refresh();
    loadBars(el.dataset.code);
  },
  'inv-back': () => { invUi.code = null; ctx.render(); },
  'inv-watch-add': el => {
    const a = I.account(); if (!a) return;
    if (!a.watch.includes(el.dataset.code)) I.setWatch([...a.watch, el.dataset.code]);
    invUi.query = '';
    refresh();
  },
  'inv-watch-remove': el => { const a = I.account(); if (a) I.setWatch(a.watch.filter(c => c !== el.dataset.code)); },
  'inv-order': el => openOrder(el.dataset.code, el.dataset.side),
  'inv-cancel': el => {
    const o = store.state.inv_orders.find(x => x.id === el.dataset.id);
    if (o?.status === 'open' && confirm(`刪掉這張${sideLabel(o)}單（${o.name} ${qty(o)}）？`)) { I.cancelOrder(o); ctx.toast('已刪單'); }
  },
  'inv-trade': el => {
    const o = store.state.inv_orders.find(x => x.id === el.dataset.id);
    if (o) ctx.openSheet(tradeSheet(o), { kind: 'inv-trade', data: o });
  },
  'inv-side': el => { const d = ctx.sheetData(); if (!d) return; d.side = el.dataset.v; if (d.side === 'sell') { const p = I.ledger().allPositions.get(d.code); if ((p?.shares || 0) < 1000) d.unit = 'odd'; } refreshSheet(); },
  'inv-unit': el => { const d = ctx.sheetData(); if (!d) return; d.unit = el.dataset.v; if (d.unit === 'odd') d.kind = 'limit'; refreshSheet(); },
  'inv-kind': el => { const d = ctx.sheetData(); if (!d) return; d.kind = el.dataset.v; refreshSheet(); },
  'inv-step': el => {
    const d = ctx.sheetData(); if (!d) return;
    const cur = parseFloat(d.price) || I.priceOf(d.code) || 0;
    d.price = String(I.stepPrice(cur, d.code, +el.dataset.dir));
    const input = document.querySelector('#sheet [name=price]');
    if (input) input.value = d.price;
    const box = document.getElementById('inv-est'); if (box) box.innerHTML = estimate(d);
  },
};
