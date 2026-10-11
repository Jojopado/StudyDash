// 文件（#docs）：PDF 放上來，電腦和手機都能看。
// 檔案資訊在 docs 集合 { name, size, pages, chunks, folder, courseId, lastPage, openedAt }，會即時同步；
// 檔案內容切塊存在雲端（store.js uploadChunks），打開時才下載，下載過的存在這台裝置（filecache.js），沒網路也能看。
import { store, newId, saveDoc, removeDoc, uploadChunks, downloadChunks, deleteChunks } from './store.js';
import * as FC from './filecache.js';
import { esc } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initDocs(c) { ctx = c; }

// filter: 'all' | 'recent' | 'none'（未分類）| 'c:課程id' | 'f:資料夾名'
export const docUi = { filter: 'all', q: '' };
const uploads = new Map(); // 暫時 id → { name, done, total }

const MB = 1024 * 1024;
const QUOTA = 1024 * MB;      // Firestore 免費 1GB（跟其他資料共用，留一點空間）
const WARN_SIZE = 50 * MB;
const MAX_SIZE = 200 * MB;

// ---------- pdf.js（放在 js/vendor，同網域才能開 worker，也能離線） ----------
const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168';
// 中文 PDF 沒內嵌字型時要用 cmaps；第一次用到才下載，sw.js 會留著
const PDF_OPTS = { cMapUrl: `${CDN}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${CDN}/standard_fonts/` };
let libP = null;
function pdfjs() {
  if (!libP) {
    libP = import('./vendor/pdf.min.js').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;
      return m;
    });
    libP.catch(() => { libP = null; });
  }
  return libP;
}

// ---------- 小工具 ----------
const docs = () => store.state.docs || [];
const findDoc = id => docs().find(d => d.id === id);
const fmtSize = n => (!n ? "0 MB" : n >= MB ? `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const cloudUsed = () => docs().reduce((s, d) => s + (d.chunks ? d.size || 0 : 0), 0);
const isCached = id => id in FC.index();
const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
const folders = () => [...new Set(docs().map(d => d.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
const courseOf = id => store.state.courses.find(c => c.id === id);

function matches(d) {
  const f = docUi.filter;
  if (f === 'recent' && !d.openedAt) return false;
  if (f === 'none' && (d.folder || d.courseId)) return false;
  if (f.startsWith('c:') && d.courseId !== f.slice(2)) return false;
  if (f.startsWith('f:') && d.folder !== f.slice(2)) return false;
  const q = docUi.q.trim().toLowerCase();
  return !q || d.name.toLowerCase().includes(q) || (d.folder || '').toLowerCase().includes(q);
}

// ---------- 列表 ----------
function filterChips() {
  const all = docs();
  const chip = (key, label, n, color) => {
    const on = docUi.filter === key;
    return `<button type="button" data-action="doc-filter" data-key="${esc(key)}" class="${on ? 'on' : ''}" style="${on && color ? `background:${color};border-color:${color}` : ''}">${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
  };
  const courses = store.state.courses.filter(c => all.some(d => d.courseId === c.id) || docUi.filter === `c:${c.id}`);
  const none = all.filter(d => !d.folder && !d.courseId).length;
  return chip('all', '全部', all.length)
    + (all.some(d => d.openedAt) ? chip('recent', '🕘 最近看') : '')
    + courses.map(c => chip(`c:${c.id}`, esc(c.name), all.filter(d => d.courseId === c.id).length, c.color)).join('')
    + folders().map(f => chip(`f:${f}`, `📁 ${esc(f)}`, all.filter(d => d.folder === f).length)).join('')
    + (none && none < all.length ? chip('none', '未分類', none) : '');
}

function docRow(d) {
  const c = courseOf(d.courseId);
  const bits = [
    c ? `<span class="memo-tag" style="--c:${c.color}">${esc(c.name)}</span>` : '',
    d.folder ? `<span>📁 ${esc(d.folder)}</span>` : '',
    `<span>${fmtSize(d.size || 0)}</span>`,
    d.pages ? `<span>${d.pages} 頁</span>` : '',
    d.lastPage > 1 ? `<span>看到第 ${d.lastPage} 頁</span>` : '',
    isCached(d.id) ? '<span title="已存在這台裝置，沒網路也能看">✓ 離線可看</span>' : '',
    !d.chunks ? '<span class="warn" title="加入時沒登入，只存在當初那台裝置">⚠ 沒上傳雲端</span>' : '',
  ].filter(Boolean).join('');
  return `<div class="doc-row" data-action="doc-open" data-id="${d.id}">
    <div class="doc-ico">📄</div>
    <div class="doc-main"><div class="doc-name">${esc(d.name)}</div><div class="doc-meta sub">${bits}</div></div>
    <button type="button" class="btn ghost small" data-action="doc-edit" data-id="${d.id}" aria-label="編輯">⋯</button>
  </div>`;
}

function uploadRows() {
  return [...uploads].map(([id, u]) => `<div class="doc-up" id="up-${id}">
    <div class="row"><span>⬆︎ ${esc(u.name)}</span><span class="spacer"></span><span class="sub up-pct">${u.total ? Math.round((u.done / u.total) * 100) : 0}%</span></div>
    <div class="bar"><i style="width:${u.total ? (u.done / u.total) * 100 : 0}%"></i></div></div>`).join('');
}

export function renderDocs() {
  const all = docs();
  if (docUi.filter.startsWith('c:') && !courseOf(docUi.filter.slice(2))) docUi.filter = 'all';
  if (docUi.filter.startsWith('f:') && !folders().includes(docUi.filter.slice(2))) docUi.filter = 'all';
  let shown = all.filter(matches);
  shown = docUi.filter === 'recent' ? shown.sort((a, b) => b.openedAt - a.openedAt).slice(0, 15) : shown.sort(byName);
  const local = Object.values(FC.index()).reduce((s, n) => s + n, 0);
  const used = cloudUsed();
  return `<div class="page-head"><h1>文件</h1>
      <div class="row">
        <form data-form="doc-search" class="memo-search"><input type="text" name="q" value="${esc(docUi.q)}" placeholder="🔍 搜尋" autocomplete="off"></form>
        <label class="btn primary doc-add">＋ 加入 PDF<input type="file" accept="application/pdf,.pdf" multiple data-doc-upload class="vh"></label>
      </div></div>
    ${all.length ? `<div class="chips doc-filters">${filterChips()}</div>` : ''}
    <section class="card doc-list">
      ${uploads.size ? `<div class="doc-ups">${uploadRows()}</div>` : ''}
      ${shown.length ? shown.map(docRow).join('')
        : `<div class="empty">${all.length ? '沒有符合的文件' : '還沒有文件。按右上「＋ 加入 PDF」，電腦也可以直接把 PDF 拖進這個頁面。'}</div>`}
    </section>
    <div class="sub doc-foot">
      ${store.mode === 'cloud' ? `☁️ 雲端已用 ${fmtSize(used)} / 1 GB` : '⚠ 還沒登入：PDF 只會存在這台裝置。到設定登入後再加入，手機電腦才看得到。'}
      ${local ? ` · 這台裝置存了 ${fmtSize(local)} <button type="button" class="linklike" data-action="doc-clear-cache">清除</button>` : ''}
      <span class="drop-hint"> · 電腦可以直接把 PDF 拖進來</span>
    </div>`;
}

// 上傳進度只改那一列，不整頁重畫（不然搜尋框打字會被打斷）
function paintUpload(id) {
  const u = uploads.get(id), el = document.getElementById(`up-${id}`);
  if (!u || !el) return;
  const pct = u.total ? (u.done / u.total) * 100 : 0;
  el.querySelector('i').style.width = `${pct}%`;
  el.querySelector('.up-pct').textContent = `${Math.round(pct)}%`;
}

// ---------- 加入檔案 ----------
export async function addFiles(fileList) {
  const files = [...fileList].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) { ctx.toast('只能放 PDF 檔'); return; }
  const cloud = store.mode === 'cloud';
  // 放到目前看的課程／資料夾
  const courseId = docUi.filter.startsWith('c:') ? docUi.filter.slice(2) : '';
  const folder = docUi.filter.startsWith('f:') ? docUi.filter.slice(2) : '';
  let ok = 0;
  for (const f of files) {
    if (f.size > MAX_SIZE) { ctx.toast(`「${f.name}」超過 200 MB，太大了`); continue; }
    if (cloud && cloudUsed() + f.size > QUOTA * 0.95) { ctx.toast('雲端空間快滿了（1 GB），先刪掉一些檔案'); break; }
    if (f.size > WARN_SIZE && !confirm(`「${f.name}」有 ${fmtSize(f.size)}，上傳和第一次打開會比較久，要繼續嗎？`)) continue;
    const id = newId();
    uploads.set(id, { name: f.name, done: 0, total: 0 });
    ctx.render();
    let chunks = 0;
    try {
      const u8 = new Uint8Array(await f.arrayBuffer());
      let pages = 0;
      try {
        const lib = await pdfjs();
        const pdf = await lib.getDocument({ data: u8.slice(), ...PDF_OPTS }).promise;
        pages = pdf.numPages;
        pdf.destroy();
      } catch (e) {
        if (e?.name === 'PasswordException') throw new Error('有設密碼，先解除密碼再放');
        throw new Error('打不開，可能不是正常的 PDF');
      }
      await FC.putIndexed(id, u8).catch(() => {}); // 這台不用再下載
      if (cloud) {
        chunks = await uploadChunks(id, u8, (d, n) => { const u = uploads.get(id); u.done = d; u.total = n; paintUpload(id); });
      }
      saveDoc('docs', {
        id, name: f.name.replace(/\.pdf$/i, ''), size: f.size, pages, chunks, folder, courseId,
        lastPage: 1, openedAt: 0, createdAt: Date.now(),
      });
      ok++;
    } catch (e) {
      ctx.toast(`「${f.name}」加入失敗：${e.message}`);
      FC.delIndexed(id).catch(() => {});
      if (chunks) deleteChunks(id, chunks).catch(() => {});
    } finally {
      uploads.delete(id);
      ctx.render();
    }
  }
  if (ok) ctx.toast(cloud ? `📄 已加入 ${ok} 個檔案，手機也看得到了` : `📄 已加入 ${ok} 個檔案（只存在這台）`);
}

// 加入時沒登入的檔案，登入後可以補傳
async function uploadLater(d) {
  const u8 = await FC.get(d.id);
  if (!u8) { ctx.toast('這台裝置沒有這個檔案，要在當初加入的那台補傳'); return; }
  ctx.closeSheet();
  uploads.set(d.id, { name: d.name, done: 0, total: 0 });
  ctx.render();
  try {
    const chunks = await uploadChunks(d.id, u8, (x, n) => { const u = uploads.get(d.id); u.done = x; u.total = n; paintUpload(d.id); });
    saveDoc('docs', { ...findDoc(d.id), chunks });
    ctx.toast('☁️ 已上傳，手機也看得到了');
  } catch (e) {
    ctx.toast(`上傳失敗：${e.message}`);
  } finally {
    uploads.delete(d.id);
    ctx.render();
  }
}

document.addEventListener('change', ev => {
  const el = ev.target;
  if (!el.matches?.('[data-doc-upload]') || !el.files?.length) return;
  const files = [...el.files];
  el.value = '';
  addFiles(files);
});

// 電腦：把 PDF 拖到文件頁
const onDocsPage = () => location.hash === '#docs';
const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', ev => {
  if (!onDocsPage() || !hasFiles(ev)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('doc-dropping');
});
document.addEventListener('dragleave', ev => { if (!ev.relatedTarget) document.body.classList.remove('doc-dropping'); });
document.addEventListener('drop', ev => {
  if (!onDocsPage() || !hasFiles(ev)) return;
  ev.preventDefault();
  document.body.classList.remove('doc-dropping');
  addFiles(ev.dataTransfer.files);
});

// ---------- 編輯 ----------
function openEdit(d) {
  const courses = store.state.courses;
  ctx.openSheet(`<h2>📄 文件</h2>
    <form data-form="doc-edit">
      <label class="field"><span>名稱</span><input type="text" name="name" value="${esc(d.name)}" required autocomplete="off"></label>
      ${courses.length ? `<label class="field"><span>課程</span><select name="courseId"><option value="">不分課程</option>${
        courses.map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>資料夾（可不填，打新名字就是新資料夾）</span><input type="text" name="folder" value="${esc(d.folder || '')}" list="doc-folders" autocomplete="off" placeholder="例如：論文、課本">
        <datalist id="doc-folders">${folders().map(f => `<option value="${esc(f)}">`).join('')}</datalist></label>
      <div class="sub">${fmtSize(d.size || 0)}${d.pages ? ` · ${d.pages} 頁` : ''} · ${isCached(d.id) ? '已存在這台裝置' : '還沒下載到這台'}${d.chunks ? '' : ' · 沒上傳雲端'}</div>
      <div class="actions">
        <button type="button" class="btn danger" data-action="doc-del">刪除</button>
        ${isCached(d.id) && d.chunks ? '<button type="button" class="btn" data-action="doc-uncache" title="雲端還在，下次打開會重新下載">從這台移除</button>' : ''}
        ${!d.chunks && store.mode === 'cloud' ? '<button type="button" class="btn" data-action="doc-upload-later">☁️ 上傳雲端</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">儲存</button>
      </div>
    </form>`, { kind: 'doc', data: { ...d } });
}

export const docForms = {
  'doc-search': (form, f) => { docUi.q = f.q || ''; ctx.render(); },
  'doc-edit': (form, f, data) => {
    const name = String(f.name || '').trim();
    if (!name) return;
    const cur = findDoc(data.id) || data; // 閱讀進度可能剛同步進來
    saveDoc('docs', { ...cur, name, folder: String(f.folder || '').trim().slice(0, 30), courseId: f.courseId ?? cur.courseId ?? '' });
    ctx.closeSheet();
    ctx.toast('已儲存');
  },
};

export const docActions = {
  'doc-filter': el => { docUi.filter = el.dataset.key; ctx.render(); },
  'doc-open': el => { const d = findDoc(el.dataset.id); if (d) openReader(d); },
  'doc-edit': el => { const d = findDoc(el.dataset.id); if (d) openEdit(d); },
  'doc-del': async () => {
    const d = ctx.sheetData();
    if (!confirm(`刪除「${d.name}」？手機和電腦都會刪掉。`)) return;
    ctx.closeSheet();
    removeDoc('docs', d.id);
    await FC.delIndexed(d.id).catch(() => {});
    deleteChunks(d.id, d.chunks).catch(e => console.error(e));
    ctx.toast('已刪除');
  },
  'doc-uncache': async () => {
    const d = ctx.sheetData();
    await FC.delIndexed(d.id).catch(() => {});
    ctx.closeSheet();
    ctx.render();
    ctx.toast('已從這台裝置移除（雲端還在）');
  },
  'doc-upload-later': () => uploadLater(ctx.sheetData()),
  'doc-clear-cache': async () => {
    if (!confirm('清除這台裝置存的 PDF？雲端的不會刪，下次打開會重新下載。\n（沒上傳雲端的檔案也會不見）')) return;
    await FC.clearAll().catch(() => {});
    ctx.render();
    ctx.toast('已清除');
  },
  'reader-close': () => closeReader(),
  'reader-zoom': el => zoomBy(+el.dataset.z),
  'reader-goto': () => {
    if (!R.pdf) return;
    const n = parseInt(prompt(`跳到第幾頁？（1–${R.pdf.numPages}）`, String(R.cur)), 10);
    if (n >= 1 && n <= R.pdf.numPages) goTo(n);
  },
};

// ---------- 閱讀器 ----------
// 全螢幕蓋在畫面上；頁面依序往下排，捲到附近才畫（省記憶體），離太遠的清掉。
const R = { px: 2e6, doc: null, pdf: null, el: null, body: null, inner: null, pages: [], sizes: [], fit: 1, zoom: 1, cur: 1, saveT: 0, io: null, rendered: new Map(), token: 0 };
const PX_BUDGET = 50e6;      // 所有 canvas 加起來的像素上限（iPhone 記憶體有限）
const GAP = 10;

async function openReader(d) {
  closeReader(false);
  const token = ++R.token;
  R.doc = d;
  R.cur = d.lastPage || 1;
  R.zoom = 1;
  const el = document.createElement('div');
  el.className = 'reader';
  el.innerHTML = `<div class="reader-bar">
      <button type="button" class="btn ghost" data-action="reader-close">‹ 返回</button>
      <div class="reader-title">${esc(d.name)}</div>
      <button type="button" class="btn ghost reader-page" data-action="reader-goto">… </button>
      <button type="button" class="btn ghost" data-action="reader-zoom" data-z="-1" aria-label="縮小">－</button>
      <button type="button" class="btn ghost reader-fit" data-action="reader-zoom" data-z="0">適寬</button>
      <button type="button" class="btn ghost" data-action="reader-zoom" data-z="1" aria-label="放大">＋</button>
    </div>
    <div class="reader-body"><div class="reader-inner"><div class="reader-msg">載入中…</div></div></div>`;
  document.body.appendChild(el);
  document.body.classList.add('reading');
  R.el = el;
  R.body = el.querySelector('.reader-body');
  R.inner = el.querySelector('.reader-inner');
  const msg = t => { const m = R.inner.querySelector('.reader-msg'); if (m) m.textContent = t; };

  try {
    let u8 = await FC.get(d.id).catch(() => null);
    if (!u8) {
      if (!d.chunks) throw new Error('這個檔案加入時沒登入，只存在當初那台裝置。請在那台打開 ⋯ →「☁️ 上傳雲端」。');
      if (store.mode !== 'cloud') throw new Error('要先登入才能從雲端下載');
      msg('下載中… 0%');
      u8 = await downloadChunks(d.id, d.chunks, d.size, (x, n) => msg(`下載中… ${Math.round((x / n) * 100)}%`));
      FC.putIndexed(d.id, u8).catch(() => {});
    }
    if (token !== R.token) return;
    msg('開啟中…');
    const lib = await pdfjs();
    const pdf = await lib.getDocument({ data: u8, ...PDF_OPTS }).promise;
    if (token !== R.token) { pdf.destroy(); return; }
    R.pdf = pdf;
    // 每頁大小（scale 1）；頁數很多時先用第一頁的大小，畫到時再修正
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    R.sizes = Array.from({ length: pdf.numPages }, () => [first.width, first.height]);
    if (pdf.numPages <= 400) {
      await Promise.all(R.sizes.map(async (_, i) => {
        const v = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
        R.sizes[i] = [v.width, v.height];
      }));
    }
    if (token !== R.token) return;
    R.cur = Math.min(Math.max(1, R.cur), pdf.numPages);
    computeFit();
    layout();
    goTo(R.cur);
    R.body.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    bindPinch();
    const cur = findDoc(d.id) || d;
    saveDoc('docs', { ...cur, openedAt: Date.now(), pages: pdf.numPages });
  } catch (e) {
    if (token !== R.token) return;
    console.error(e);
    msg(`打不開：${e.message || e}`);
  }
}

function closeReader(save = true) {
  if (!R.el) return;
  if (save) saveProgress(true);
  R.token++;
  R.io?.disconnect();
  for (const [, t] of R.rendered) t.task?.cancel();
  R.rendered.clear();
  R.pdf?.destroy();
  window.removeEventListener('resize', onResize);
  R.el.remove();
  document.body.classList.remove('reading');
  Object.assign(R, { doc: null, pdf: null, el: null, body: null, inner: null, pages: [], io: null });
}

// 每頁各自放到螢幕寬（直的講義、橫的投影片混在一起也都看得清楚），再乘上縮放
const scale = n => Math.min(R.fit / R.sizes[n - 1][0], 2.5) * R.zoom; // 寬螢幕不要放到太大
function computeFit() { R.fit = R.body.clientWidth - 16; }

// 依目前縮放排好每頁的空框
function layout() {
  R.io?.disconnect();
  for (const [, t] of R.rendered) t.task?.cancel();
  R.rendered.clear();
  R.inner.innerHTML = R.sizes.map(([w, h], i) => { const s = scale(i + 1); return ''
    + `<div class="reader-pg" data-n="${i + 1}" style="width:${Math.floor(w * s)}px;height:${Math.floor(h * s)}px"><span class="reader-pgno">${i + 1}</span></div>`; }).join('');
  R.pages = [...R.inner.children];
  R.io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) drawPage(+e.target.dataset.n);
  }, { root: R.body, rootMargin: '150% 0px' });
  R.pages.forEach(p => R.io.observe(p));
  R.el.querySelector('.reader-fit').classList.toggle('on', R.zoom === 1);
}

async function drawPage(n) {
  if (R.rendered.has(n) || !R.pdf) return;
  const token = R.token, s = scale(n);
  const job = { task: null };
  R.rendered.set(n, job);
  try {
    const page = await R.pdf.getPage(n);
    if (token !== R.token || R.rendered.get(n) !== job) return;
    const vp = page.getViewport({ scale: s });
    // iPhone 單一 canvas 太大會變白：限制總像素
    const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(10e6 / (vp.width * vp.height)));
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width * ratio);
    cv.height = Math.floor(vp.height * ratio);
    R.px = cv.width * cv.height;
    cv.style.width = `${Math.floor(vp.width)}px`;
    cv.style.height = `${Math.floor(vp.height)}px`;
    const box = R.pages[n - 1];
    box.style.width = cv.style.width;   // 頁面大小跟估的不一樣時修正
    box.style.height = cv.style.height;
    job.task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    await job.task.promise;
    if (R.rendered.get(n) !== job) return;
    box.querySelector('canvas')?.remove();
    box.appendChild(cv);
    trim();
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.error(e);
    if (R.rendered.get(n) === job) R.rendered.delete(n);
  }
}

// 只留目前頁附近幾頁的 canvas（iPhone 記憶體有限）
function trim() {
  const keep = Math.min(12, Math.max(3, Math.floor(PX_BUDGET / R.px)));
  if (R.rendered.size <= keep) return;
  const far = [...R.rendered.keys()].sort((a, b) => Math.abs(b - R.cur) - Math.abs(a - R.cur));
  for (const n of far.slice(0, R.rendered.size - keep)) {
    R.rendered.get(n).task?.cancel();
    R.rendered.delete(n);
    const c = R.pages[n - 1]?.querySelector('canvas');
    if (c) { c.width = 0; c.height = 0; c.remove(); }
  }
}

// 目前頁 = 畫面上方 1/3 處那一頁
function pageAt(y) {
  let lo = 0, hi = R.pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (R.pages[mid].offsetTop <= y) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}
let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!R.pdf) return;
    const n = pageAt(R.body.scrollTop + R.body.clientHeight / 3);
    if (n !== R.cur) { R.cur = n; saveProgress(); }
    paintPageNo();
    // 被清掉的頁捲回來時 IntersectionObserver 不一定會再通知，這裡補畫附近幾頁
    for (const k of [n - 1, n, n + 1]) if (k >= 1 && k <= R.pages.length) drawPage(k);
  });
}
function paintPageNo() {
  const b = R.el?.querySelector('.reader-page');
  if (b && R.pdf) b.textContent = `${R.cur} / ${R.pdf.numPages}`;
}

// 看到第幾頁：停下來 2 秒才存（另一台裝置打開會從這頁開始）
function saveProgress(now = false) {
  clearTimeout(R.saveT);
  const d = R.doc && findDoc(R.doc.id);
  if (!d || !R.pdf) return;
  const n = R.cur;
  const go = () => { const x = findDoc(d.id); if (x && x.lastPage !== n) saveDoc('docs', { ...x, lastPage: n }); };
  if (now) go(); else R.saveT = setTimeout(go, 2000);
}

function goTo(n) {
  R.cur = n;
  const p = R.pages[n - 1];
  if (p) R.body.scrollTop = p.offsetTop - GAP;
  paintPageNo();
}

// 縮放後維持畫面上同一個位置；anchor = 畫面上的點（相對 body）
function setZoom(z, anchor) {
  z = Math.min(5, Math.max(0.5, z));
  if (!R.pdf || Math.abs(z - R.zoom) < 0.01) return;
  const ax = anchor?.x ?? R.body.clientWidth / 2, ay = anchor?.y ?? R.body.clientHeight / 3;
  // 記住錨點落在哪一頁的哪個比例
  const y = R.body.scrollTop + ay;
  const n = pageAt(y), p = R.pages[n - 1];
  const fy = (y - p.offsetTop) / p.offsetHeight;
  const fx = (R.body.scrollLeft + ax) / Math.max(1, R.inner.scrollWidth);
  R.zoom = z;
  layout();
  const q = R.pages[n - 1];
  R.body.scrollTop = q.offsetTop + fy * q.offsetHeight - ay;
  R.body.scrollLeft = fx * R.inner.scrollWidth - ax;
  onScroll();
}
function zoomBy(dir) {
  if (dir === 0) setZoom(1);
  else setZoom(R.zoom * (dir > 0 ? 1.25 : 0.8));
}

let resizeT = 0;
function onResize() {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (!R.pdf) return;
    const n = R.cur;
    computeFit();
    layout();
    goTo(n);
  }, 200);
}

// 手機：兩指縮放（縮放中先用 CSS 放大，放開後再用新的大小重畫，才會清楚）
function bindPinch() {
  const body = R.body;
  let start = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  body.addEventListener('touchstart', ev => {
    if (ev.touches.length !== 2) return;
    const r = body.getBoundingClientRect();
    const mx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left;
    const my = (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top;
    start = { d: dist(ev.touches), mx, my, k: 1 };
    R.inner.style.transformOrigin = `${body.scrollLeft + mx}px ${body.scrollTop + my}px`;
  }, { passive: true });
  body.addEventListener('touchmove', ev => {
    if (!start || ev.touches.length !== 2) return;
    ev.preventDefault();
    start.k = Math.min(5 / R.zoom, Math.max(0.5 / R.zoom, dist(ev.touches) / start.d));
    R.inner.style.transform = `scale(${start.k})`;
  }, { passive: false });
  const end = () => {
    if (!start) return;
    const { k, mx, my } = start;
    start = null;
    R.inner.style.transform = '';
    setZoom(R.zoom * k, { x: mx, y: my });
  };
  body.addEventListener('touchend', ev => { if (ev.touches.length < 2) end(); });
  body.addEventListener('touchcancel', end);
}
// iOS Safari 的整頁縮放手勢，在閱讀器裡關掉
document.addEventListener('gesturestart', ev => { if (R.el) ev.preventDefault(); });

// 電腦鍵盤：← → 翻頁、+ - 縮放、Esc 關閉
document.addEventListener('keydown', ev => {
  if (!R.el || !R.pdf || ev.target.closest?.('input, textarea, select')) return;
  const k = ev.key;
  if (k === 'Escape') closeReader();
  else if (k === 'ArrowRight' || k === 'PageDown') goTo(Math.min(R.pdf.numPages, R.cur + 1));
  else if (k === 'ArrowLeft' || k === 'PageUp') goTo(Math.max(1, R.cur - 1));
  else if (k === '+' || k === '=') zoomBy(1);
  else if (k === '-') zoomBy(-1);
  else if (k === '0') zoomBy(0);
  else return;
  ev.preventDefault();
});

// 切換頁面（上一頁／點導覽）時關掉閱讀器
window.addEventListener('hashchange', () => closeReader());
