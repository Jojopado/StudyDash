// 文件（#docs）：PDF／Word／PPT 放上來，電腦和手機都能看，可以用資料夾（可多層）分類。
// 檔案資訊在 docs 集合 { name, ext, size, pages, chunks, folderId, courseId, lastPage, openedAt }，
// 資料夾在 doc_folders 集合 { name, parentId }，兩個都會即時同步；
// 檔案內容切塊存在雲端（store.js uploadChunks），打開時才下載，下載過的存在這台裝置（filecache.js），沒網路也能看。
import { store, newId, saveDoc, removeDoc, uploadChunks, downloadChunks, deleteChunks } from './store.js';
import * as FC from './filecache.js';
import { esc } from './util.js';

let ctx = null; // { openSheet, closeSheet, toast, render, sheetData }
export function initDocs(c) { ctx = c; }

// folder: 目前所在的資料夾 id（'' = 最上層）；filter: 'all'（照資料夾瀏覽）| 'recent' | 'c:課程id'
export const docUi = { folder: '', filter: 'all', q: '' };
const uploads = new Map(); // 暫時 id → { name, done, total }

const MB = 1024 * 1024;
const QUOTA = 1024 * MB;      // Firestore 免費 1GB（跟其他資料共用，留一點空間）
const WARN_SIZE = 50 * MB;
const MAX_SIZE = 200 * MB;

const KINDS = {
  pdf:  { ico: '📄', label: 'PDF' },
  docx: { ico: '📝', label: 'Word' },
  pptx: { ico: '📊', label: 'PPT' },
};
const ACCEPT = '.pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';
const extOf = name => (/\.(\w+)$/.exec(name)?.[1] || '').toLowerCase();
const kindOf = d => d.ext || 'pdf'; // v0.12 的檔案沒有 ext，都是 PDF

// ---------- 函式庫（放在 js/vendor，檔名有版本號，sw.js 永久快取） ----------
const vendor = f => new URL(`./vendor/${f}`, import.meta.url).href;
const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168';
// 中文 PDF 沒內嵌字型時要用 cmaps；第一次用到才下載，sw.js 會留著
const PDF_OPTS = { cMapUrl: `${CDN}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${CDN}/standard_fonts/` };
const once = fn => { let p = null; return () => { if (!p) { p = fn(); p.catch(() => { p = null; }); } return p; }; };
const pdfjs = once(() => import(vendor('pdf-4.4.168.min.js')).then(m => {
  m.GlobalWorkerOptions.workerSrc = vendor('pdf.worker-4.4.168.min.js');
  return m;
}));
function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('閱讀器載入失敗，檢查網路'));
    document.head.appendChild(s);
  });
}
const jszip = once(() => (window.JSZip ? Promise.resolve() : script(vendor('jszip-3.10.1.min.js'))).then(() => window.JSZip));
const docxLib = once(() => jszip().then(() => script(vendor('docx-preview-0.4.1.min.js'))).then(() => window.docx));
const pptxLib = once(() => script(vendor('pptx-preview-1.0.7.min.js')).then(() => window.pptxPreview));

// ---------- 資料 ----------
const docs = () => store.state.docs || [];
const folderList = () => store.state.doc_folders || [];
const findDoc = id => docs().find(d => d.id === id);
const findFolder = id => folderList().find(f => f.id === id);
const courseOf = id => store.state.courses.find(c => c.id === id);
const fmtSize = n => (!n ? '0 MB' : n >= MB ? `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const cloudUsed = () => docs().reduce((s, d) => s + (d.chunks ? d.size || 0 : 0), 0);
const isCached = id => id in FC.index();
const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
// 檔案所在資料夾不存在了（例如別台刪掉）就當作在最上層
const folderOf = d => (d.folderId && findFolder(d.folderId) ? d.folderId : '');
const parentOf = f => (f.parentId && findFolder(f.parentId) ? f.parentId : '');
const subFolders = id => folderList().filter(f => parentOf(f) === id).sort(byName);
const filesIn = id => docs().filter(d => folderOf(d) === id).sort(byName);

// 從最上層到這個資料夾的路徑（防呆：資料夾互相指來指去時不會無限迴圈）
function pathTo(id) {
  const out = [];
  for (let f = findFolder(id), guard = 0; f && guard < 50; f = findFolder(parentOf(f)), guard++) out.unshift(f);
  return out;
}
function descendants(id) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folderList()) if (!out.has(f.id) && out.has(parentOf(f))) { out.add(f.id); grew = true; }
  }
  return out;
}
const countIn = id => { const ids = descendants(id); return docs().filter(d => ids.has(folderOf(d))).length; };
const pathText = id => pathTo(id).map(f => f.name).join(' › ');

// v0.12 的資料夾是檔案上的一個名字 → 換成真的資料夾（id 由名字算出來，兩台同時換也不會重複）
let migrating = false;
function migrateOldFolders() {
  const old = docs().filter(d => d.folder && d.folderId === undefined);
  if (!old.length || migrating) return;
  migrating = true;
  setTimeout(() => { // 不要在畫面重畫到一半時存檔
    const idFor = name => { let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0; return `fold_${h.toString(36)}`; };
    for (const name of new Set(old.map(d => d.folder))) {
      if (!findFolder(idFor(name))) saveDoc('doc_folders', { id: idFor(name), name, parentId: '', createdAt: Date.now() });
    }
    for (const d of old) { const { folder, ...rest } = d; saveDoc('docs', { ...rest, folderId: idFor(folder) }); }
    migrating = false;
  }, 0);
}

// ---------- 列表 ----------
function filterChips() {
  const all = docs();
  const chip = (key, label, color) => {
    const on = docUi.filter === key;
    return `<button type="button" data-action="doc-filter" data-key="${esc(key)}" class="${on ? 'on' : ''}" style="${on && color ? `background:${color};border-color:${color}` : ''}">${label}</button>`;
  };
  const courses = store.state.courses.filter(c => all.some(d => d.courseId === c.id) || docUi.filter === `c:${c.id}`);
  return chip('all', '📁 資料夾')
    + (all.some(d => d.openedAt) ? chip('recent', '🕘 最近看') : '')
    + courses.map(c => chip(`c:${c.id}`, `${esc(c.name)} <span class="n">${all.filter(d => d.courseId === c.id).length}</span>`, c.color)).join('');
}

function crumbs() {
  const path = pathTo(docUi.folder);
  const crumb = (id, label, last) => (last
    ? `<span class="crumb cur" data-drop-folder="${id}">${label}</span>`
    : `<button type="button" class="crumb" data-action="doc-folder" data-id="${id}" data-drop-folder="${id}">${label}</button>`);
  return `<div class="doc-crumbs">${crumb('', '🗂️ 全部', !path.length)}${
    path.map((f, i) => `<span class="sep">›</span>${crumb(f.id, esc(f.name), i === path.length - 1)}`).join('')}</div>`;
}

function folderRow(f) {
  const subs = subFolders(f.id).length, n = countIn(f.id);
  const meta = [subs ? `${subs} 個資料夾` : '', `${n} 個檔案`].filter(Boolean).join('、');
  return `<div class="doc-row folder" data-action="doc-folder" data-id="${f.id}" draggable="true" data-drag-doc="folder:${f.id}" data-drop-folder="${f.id}">
    <div class="doc-ico">📁</div>
    <div class="doc-main"><div class="doc-name">${esc(f.name)}</div><div class="doc-meta sub"><span>${meta}</span></div></div>
    <button type="button" class="btn ghost small" data-action="doc-folder-edit" data-id="${f.id}" aria-label="編輯資料夾">⋯</button>
  </div>`;
}

function docRow(d, { showPath = false } = {}) {
  const c = courseOf(d.courseId), k = KINDS[kindOf(d)] || KINDS.pdf;
  const unit = kindOf(d) === 'pptx' ? '張' : '頁';
  const bits = [
    kindOf(d) !== 'pdf' ? `<span class="doc-kind">${k.label}</span>` : '',
    c ? `<span class="memo-tag" style="--c:${c.color}">${esc(c.name)}</span>` : '',
    showPath && folderOf(d) ? `<span>📁 ${esc(pathText(folderOf(d)))}</span>` : '',
    `<span>${fmtSize(d.size || 0)}</span>`,
    d.pages ? `<span>${d.pages} ${unit}</span>` : '',
    d.lastPage > 1 ? `<span>看到第 ${d.lastPage} ${unit}</span>` : '',
    isCached(d.id) ? '<span title="已存在這台裝置，沒網路也能看">✓ 離線可看</span>' : '',
    !d.chunks ? '<span class="warn" title="加入時沒登入，只存在當初那台裝置">⚠ 沒上傳雲端</span>' : '',
  ].filter(Boolean).join('');
  return `<div class="doc-row" data-action="doc-open" data-id="${d.id}" draggable="true" data-drag-doc="file:${d.id}">
    <div class="doc-ico">${k.ico}</div>
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
  migrateOldFolders();
  const all = docs();
  if (docUi.folder && !findFolder(docUi.folder)) docUi.folder = '';
  if (docUi.filter.startsWith('c:') && !courseOf(docUi.filter.slice(2))) docUi.filter = 'all';
  const q = docUi.q.trim().toLowerCase();
  const browsing = docUi.filter === 'all' && !q;

  let body;
  if (browsing) {
    const subs = subFolders(docUi.folder), files = filesIn(docUi.folder);
    body = subs.map(folderRow).join('') + files.map(d => docRow(d)).join('')
      || `<div class="empty">${all.length || folderList().length ? '這個資料夾是空的。按「＋ 加入檔案」，或把檔案拖進來。'
        : '還沒有文件。按右上「＋ 加入檔案」（PDF、Word、PPT 都可以），電腦也可以直接把檔案拖進這個頁面。'}</div>`;
  } else {
    let shown = all.filter(d => (docUi.filter !== 'recent' || d.openedAt)
      && (!docUi.filter.startsWith('c:') || d.courseId === docUi.filter.slice(2))
      && (!q || d.name.toLowerCase().includes(q) || pathText(folderOf(d)).toLowerCase().includes(q)));
    shown = docUi.filter === 'recent' ? shown.sort((a, b) => b.openedAt - a.openedAt).slice(0, 15) : shown.sort(byName);
    // 搜尋時資料夾名字符合的也列出來
    const fs = q ? folderList().filter(f => f.name.toLowerCase().includes(q)).sort(byName) : [];
    body = fs.map(folderRow).join('') + shown.map(d => docRow(d, { showPath: true })).join('')
      || '<div class="empty">沒有符合的文件</div>';
  }

  const local = Object.values(FC.index()).reduce((s, n) => s + n, 0);
  return `<div class="page-head"><h1>文件</h1>
      <div class="row">
        <form data-form="doc-search" class="memo-search"><input type="text" name="q" value="${esc(docUi.q)}" placeholder="🔍 搜尋" autocomplete="off"></form>
      </div></div>
    ${all.length || folderList().length ? `<div class="chips doc-filters">${filterChips()}</div>` : ''}
    <section class="card doc-list">
      ${browsing ? `<div class="doc-head">${crumbs()}<span class="spacer"></span>
        <button type="button" class="btn small" data-action="doc-folder-new">＋ 資料夾</button>
        <label class="btn small primary doc-add">＋ 加入檔案<input type="file" accept="${ACCEPT}" multiple data-doc-upload class="vh"></label></div>`
        : `<div class="doc-head"><span class="sub">${q ? `搜尋「${esc(docUi.q)}」` : docUi.filter === 'recent' ? '最近打開的' : `${esc(courseOf(docUi.filter.slice(2))?.name || '')} 的所有檔案`}</span><span class="spacer"></span>
        <label class="btn small primary doc-add">＋ 加入檔案<input type="file" accept="${ACCEPT}" multiple data-doc-upload class="vh"></label></div>`}
      ${uploads.size ? `<div class="doc-ups">${uploadRows()}</div>` : ''}
      ${body}
    </section>
    <div class="sub doc-foot">
      ${store.mode === 'cloud' ? `☁️ 雲端已用 ${fmtSize(cloudUsed())} / 1 GB` : '⚠ 還沒登入：檔案只會存在這台裝置。到設定登入後再加入，手機電腦才看得到。'}
      ${local ? ` · 這台裝置存了 ${fmtSize(local)} <button type="button" class="linklike" data-action="doc-clear-cache">清除</button>` : ''}
      <span class="drop-hint"> · 電腦可以直接把檔案拖進來，或把檔案拖到資料夾上移動</span>
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
// 確認檔案打得開，順便算頁數／張數
async function inspect(ext, u8) {
  if (ext === 'pdf') {
    try {
      const lib = await pdfjs();
      const pdf = await lib.getDocument({ data: u8.slice(), ...PDF_OPTS }).promise;
      const n = pdf.numPages;
      pdf.destroy();
      return n;
    } catch (e) {
      if (e?.name === 'PasswordException') throw new Error('有設密碼，先解除密碼再放');
      throw new Error('打不開，可能不是正常的 PDF');
    }
  }
  let zip;
  try { zip = await (await jszip()).loadAsync(u8); } catch { throw new Error('打不開，檔案可能壞了或有設密碼'); }
  if (ext === 'docx') {
    if (!zip.file('word/document.xml')) throw new Error('不是正常的 Word 檔');
    return 0; // Word 沒有固定頁數，打開後才知道
  }
  if (!zip.file('ppt/presentation.xml')) throw new Error('不是正常的 PPT 檔');
  return zip.file(/^ppt\/slides\/slide\d+\.xml$/).length;
}

export async function addFiles(fileList) {
  const all = [...fileList];
  const old = all.filter(f => ['doc', 'ppt'].includes(extOf(f.name)));
  if (old.length) ctx.toast(`「${old[0].name}」是舊格式，請在電腦上另存成 .docx／.pptx 或 PDF 再放`);
  const files = all.filter(f => KINDS[extOf(f.name)]);
  if (!files.length) { if (!old.length) ctx.toast('只能放 PDF、Word（.docx）、PPT（.pptx）'); return; }
  const cloud = store.mode === 'cloud';
  // 放到目前所在的資料夾；在看某門課時順便標那門課
  const folderId = docUi.filter === 'all' ? docUi.folder : '';
  const courseId = docUi.filter.startsWith('c:') ? docUi.filter.slice(2) : '';
  let ok = 0;
  for (const f of files) {
    if (f.size > MAX_SIZE) { ctx.toast(`「${f.name}」超過 200 MB，太大了`); continue; }
    if (cloud && cloudUsed() + f.size > QUOTA * 0.95) { ctx.toast('雲端空間快滿了（1 GB），先刪掉一些檔案'); break; }
    if (f.size > WARN_SIZE && !confirm(`「${f.name}」有 ${fmtSize(f.size)}，上傳和第一次打開會比較久，要繼續嗎？`)) continue;
    const id = newId(), ext = extOf(f.name);
    uploads.set(id, { name: f.name, done: 0, total: 0 });
    ctx.render();
    let chunks = 0;
    try {
      const u8 = new Uint8Array(await f.arrayBuffer());
      const pages = await inspect(ext, u8);
      await FC.putIndexed(id, u8).catch(() => {}); // 這台不用再下載
      if (cloud) {
        chunks = await uploadChunks(id, u8, (d, n) => { const u = uploads.get(id); u.done = d; u.total = n; paintUpload(id); });
      }
      saveDoc('docs', {
        id, name: f.name.replace(/\.\w+$/, ''), ext, size: f.size, pages, chunks, folderId, courseId,
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
  if (ok) ctx.toast(cloud ? `已加入 ${ok} 個檔案，手機也看得到了` : `已加入 ${ok} 個檔案（只存在這台）`);
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

// ---------- 移動 ----------
function moveTo(kind, id, target) {
  if (kind === 'file') {
    const d = findDoc(id);
    if (!d || folderOf(d) === target) return;
    saveDoc('docs', { ...d, folderId: target });
    ctx.toast(`已移到「${target ? findFolder(target).name : '全部'}」`);
  } else {
    const f = findFolder(id);
    if (!f || parentOf(f) === target) return;
    if (descendants(id).has(target)) { ctx.toast('不能把資料夾移到自己裡面'); return; }
    saveDoc('doc_folders', { ...f, parentId: target });
    ctx.toast(`已移到「${target ? findFolder(target).name : '全部'}」`);
  }
}

// 電腦拖曳：外面的檔案拖進來＝加入；列表裡的檔案／資料夾拖到資料夾上＝移動
const onDocsPage = () => location.hash === '#docs';
const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
const isMove = ev => [...(ev.dataTransfer?.types || [])].includes('text/x-doc');
const clearDrop = () => document.querySelectorAll('.drop-on').forEach(x => x.classList.remove('drop-on'));
document.addEventListener('dragstart', ev => {
  const row = ev.target.closest?.('[data-drag-doc]');
  if (!row || !onDocsPage()) return;
  ev.dataTransfer.setData('text/x-doc', row.dataset.dragDoc);
  ev.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', ev => {
  if (!onDocsPage()) return;
  if (isMove(ev)) {
    const t = ev.target.closest?.('[data-drop-folder]');
    clearDrop();
    if (!t) return;
    ev.preventDefault();
    t.classList.add('drop-on');
  } else if (hasFiles(ev)) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('doc-dropping');
  }
});
document.addEventListener('dragleave', ev => { if (!ev.relatedTarget) { document.body.classList.remove('doc-dropping'); clearDrop(); } });
document.addEventListener('dragend', clearDrop);
document.addEventListener('drop', ev => {
  if (!onDocsPage()) return;
  document.body.classList.remove('doc-dropping');
  clearDrop();
  if (isMove(ev)) {
    const t = ev.target.closest?.('[data-drop-folder]');
    if (!t) return;
    ev.preventDefault();
    const [kind, id] = ev.dataTransfer.getData('text/x-doc').split(':');
    if (kind === 'folder' && id === t.dataset.dropFolder) return;
    moveTo(kind, id, t.dataset.dropFolder);
  } else if (hasFiles(ev)) {
    ev.preventDefault();
    addFiles(ev.dataTransfer.files);
  }
});

// 選資料夾的下拉選單（排除 exclude 和它底下的資料夾）
function folderSelect(name, cur, exclude = '') {
  const skip = exclude ? descendants(exclude) : new Set();
  const opts = [];
  const walk = (id, depth) => {
    for (const f of subFolders(id)) {
      if (skip.has(f.id)) continue;
      opts.push(`<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${'　'.repeat(depth)}📁 ${esc(f.name)}</option>`);
      walk(f.id, depth + 1);
    }
  };
  walk('', 1);
  return `<select name="${name}"><option value="">🗂️ 全部（最上層）</option>${opts.join('')}</select>`;
}

// ---------- 編輯 ----------
function openEdit(d) {
  const courses = store.state.courses;
  const unit = kindOf(d) === 'pptx' ? '張' : '頁';
  ctx.openSheet(`<h2>${(KINDS[kindOf(d)] || KINDS.pdf).ico} 檔案</h2>
    <form data-form="doc-edit">
      <label class="field"><span>名稱</span><input type="text" name="name" value="${esc(d.name)}" required autocomplete="off"></label>
      <label class="field"><span>放在哪個資料夾</span>${folderSelect('folderId', folderOf(d))}</label>
      ${courses.length ? `<label class="field"><span>課程</span><select name="courseId"><option value="">不分課程</option>${
        courses.map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <div class="sub">${(KINDS[kindOf(d)] || KINDS.pdf).label} · ${fmtSize(d.size || 0)}${d.pages ? ` · ${d.pages} ${unit}` : ''} · ${isCached(d.id) ? '已存在這台裝置' : '還沒下載到這台'}${d.chunks ? '' : ' · 沒上傳雲端'}</div>
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

function openFolderSheet(f) {
  const isNew = !f.id;
  ctx.openSheet(`<h2>📁 ${isNew ? '新資料夾' : '資料夾'}</h2>
    <form data-form="doc-folder">
      <label class="field"><span>名稱</span><input type="text" name="name" value="${esc(f.name || '')}" placeholder="例如：DSP 講義、論文" required autocomplete="off"></label>
      <label class="field"><span>放在</span>${folderSelect('parentId', isNew ? docUi.folder : parentOf(f), f.id || '')}</label>
      ${isNew ? '' : `<div class="sub">裡面有 ${countIn(f.id)} 個檔案</div>`}
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" data-action="doc-folder-del">刪除資料夾</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">取消</button>
        <button type="submit" class="btn primary">${isNew ? '建立' : '儲存'}</button>
      </div>
    </form>`, { kind: 'doc-folder', data: { ...f } });
  if (isNew) document.querySelector('#sheet [name=name]')?.focus();
}

export const docForms = {
  'doc-search': (form, f) => { docUi.q = f.q || ''; ctx.render(); },
  'doc-edit': (form, f, data) => {
    const name = String(f.name || '').trim();
    if (!name) return;
    const cur = findDoc(data.id) || data; // 閱讀進度可能剛同步進來
    saveDoc('docs', { ...cur, name, folderId: f.folderId || '', courseId: f.courseId ?? cur.courseId ?? '' });
    ctx.closeSheet();
    ctx.toast('已儲存');
  },
  'doc-folder': (form, f, data) => {
    const name = String(f.name || '').trim().slice(0, 40);
    if (!name) return;
    const parentId = f.parentId || '';
    if (data.id) {
      if (descendants(data.id).has(parentId)) { ctx.toast('不能把資料夾移到自己裡面'); return; }
      saveDoc('doc_folders', { ...(findFolder(data.id) || data), name, parentId });
    } else {
      saveDoc('doc_folders', { id: newId(), name, parentId, createdAt: Date.now() });
    }
    ctx.closeSheet();
    ctx.toast(data.id ? '已儲存' : `已建立「${name}」`);
  },
};

export const docActions = {
  'doc-filter': el => { docUi.filter = el.dataset.key; ctx.render(); },
  'doc-folder': el => { docUi.folder = el.dataset.id; docUi.filter = 'all'; docUi.q = ''; ctx.render(); window.scrollTo(0, 0); },
  'doc-folder-new': () => openFolderSheet({}),
  'doc-folder-edit': el => { const f = findFolder(el.dataset.id); if (f) openFolderSheet(f); },
  'doc-folder-del': () => {
    const f = ctx.sheetData();
    const up = parentOf(f);
    if (!confirm(`刪除資料夾「${f.name}」？\n裡面的檔案和資料夾不會刪，會移到「${up ? findFolder(up).name : '全部'}」。`)) return;
    for (const x of folderList()) if (x.parentId === f.id) saveDoc('doc_folders', { ...x, parentId: up });
    for (const d of docs()) if (d.folderId === f.id) saveDoc('docs', { ...d, folderId: up });
    removeDoc('doc_folders', f.id);
    if (docUi.folder === f.id) docUi.folder = up;
    ctx.closeSheet();
    ctx.toast('資料夾已刪除');
  },
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
    if (!confirm('清除這台裝置存的檔案？雲端的不會刪，下次打開會重新下載。\n（沒上傳雲端的檔案也會不見）')) return;
    await FC.clearAll().catch(() => {});
    ctx.render();
    ctx.toast('已清除');
  },
  'reader-close': () => closeReader(),
  'reader-zoom': el => zoomBy(+el.dataset.z),
  'reader-goto': () => {
    if (!R.pages.length) return;
    const n = parseInt(prompt(`跳到第幾${R.unit}？（1–${R.pages.length}）`, String(R.cur)), 10);
    if (n >= 1 && n <= R.pages.length) goTo(n);
  },
};

// ---------- 閱讀器 ----------
// 全螢幕蓋在畫面上。PDF：頁面依序往下排，捲到附近才畫（省記憶體），離太遠的清掉。
// Word／PPT：整份轉成網頁，用 CSS zoom 縮放；R.pages = 每頁（Word 的 section、PPT 的每張投影片）。
const R = {
  kind: 'pdf', unit: '頁', doc: null, pdf: null, el: null, body: null, inner: null, office: null, baseW: 1,
  pages: [], sizes: [], fit: 1, zoom: 1, cur: 1, saveT: 0, io: null, rendered: new Map(), token: 0, px: 2e6,
};
const PX_BUDGET = 50e6;      // 所有 canvas 加起來的像素上限（iPhone 記憶體有限）
const GAP = 10;

async function openReader(d) {
  closeReader(false);
  const token = ++R.token;
  R.doc = d;
  R.kind = kindOf(d);
  R.unit = R.kind === 'pptx' ? '張' : '頁';
  R.cur = d.lastPage || 1;
  R.zoom = 1;
  const el = document.createElement('div');
  el.className = `reader ${R.kind}`;
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
    const pages = R.kind === 'pdf' ? await openPdf(u8, token) : await openOffice(u8, token);
    if (pages == null) return; // 中途關掉了
    R.cur = Math.min(Math.max(1, R.cur), R.pages.length || 1);
    goTo(R.cur);
    R.body.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    bindPinch();
    const cur = findDoc(d.id) || d;
    saveDoc('docs', { ...cur, openedAt: Date.now(), pages });
  } catch (e) {
    if (token !== R.token) return;
    console.error(e);
    msg(`打不開：${e.message || e}`);
  }
}

async function openPdf(u8, token) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: u8, ...PDF_OPTS }).promise;
  if (token !== R.token) { pdf.destroy(); return null; }
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
  if (token !== R.token) return null;
  computeFit();
  layout();
  return pdf.numPages;
}

async function openOffice(u8, token) {
  const box = document.createElement('div');
  box.className = 'office';
  if (R.kind === 'docx') {
    const lib = await docxLib();
    if (token !== R.token) return null;
    await lib.renderAsync(new Blob([u8]), box, null, { inWrapper: true, breakPages: true, useBase64URL: true, ignoreLastRenderedPageBreak: true });
  } else {
    const lib = await pptxLib();
    if (token !== R.token) return null;
    // 先用 960 寬畫（16:9 = 960×540），再整體縮放到螢幕寬
    const v = lib.init(box, { width: 960, mode: 'list' });
    await v.preview(u8.slice().buffer);
  }
  if (token !== R.token) return null;
  R.inner.innerHTML = '';
  if (R.kind === 'pptx') R.inner.insertAdjacentHTML('beforeend', '<div class="reader-tip">排版跑掉的話：在電腦的 PowerPoint 按「另存新檔 → PDF」再放進來，會跟原本一模一樣。</div>');
  R.inner.appendChild(box);
  R.office = box;
  R.pages = [...box.querySelectorAll(R.kind === 'docx' ? 'section.docx' : '.pptx-preview-slide-wrapper')];
  if (!R.pages.length) throw new Error('檔案裡沒有內容');
  R.baseW = Math.max(...R.pages.map(p => p.offsetWidth));
  computeFit();
  layout();
  return R.pages.length;
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
  Object.assign(R, { doc: null, pdf: null, el: null, body: null, inner: null, office: null, pages: [], io: null });
}

// PDF 每頁各自放到螢幕寬（直的講義、橫的投影片混在一起也都看得清楚），再乘上縮放
const scale = n => Math.min(R.fit / R.sizes[n - 1][0], 2.5) * R.zoom; // 寬螢幕不要放到太大
function computeFit() { R.fit = R.body.clientWidth - 16; }

function layout() {
  R.el.querySelector('.reader-fit').classList.toggle('on', R.zoom === 1);
  if (R.office) {
    // Word 頁面在大螢幕不要放太大（像一般 Word 的頁寬）；投影片可以大一點
    R.office.style.zoom = String(Math.min(R.fit / R.baseW, R.kind === 'docx' ? 1.25 : 1.6) * R.zoom);
    return;
  }
  // PDF：依目前縮放排好每頁的空框
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

// 第 n 頁在捲動區裡的位置（Word／PPT 有 CSS zoom，所以用 getBoundingClientRect）
function topOf(n) {
  const p = R.pages[n - 1];
  return p ? p.getBoundingClientRect().top - R.body.getBoundingClientRect().top + R.body.scrollTop : 0;
}
const heightOf = n => R.pages[n - 1]?.getBoundingClientRect().height || 1;
// 目前頁 = 畫面上方那一頁（看 1/3 高、最多 100px 的位置；手機上投影片很矮，看太下面會算到下一張）
const probeY = () => Math.min(R.body.clientHeight / 3, 100);
function pageAt(y) {
  let lo = 0, hi = R.pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (topOf(mid + 1) <= y) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}
let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!R.pages.length) return;
    const n = pageAt(R.body.scrollTop + probeY());
    if (n !== R.cur) { R.cur = n; saveProgress(); }
    paintPageNo();
    // 被清掉的 PDF 頁捲回來時 IntersectionObserver 不一定會再通知，這裡補畫附近幾頁
    if (R.pdf) for (const k of [n - 1, n, n + 1]) if (k >= 1 && k <= R.pages.length) drawPage(k);
  });
}
function paintPageNo() {
  const b = R.el?.querySelector('.reader-page');
  if (b && R.pages.length) b.textContent = `${R.cur} / ${R.pages.length}`;
}

// 看到第幾頁：停下來 2 秒才存（另一台裝置打開會從這頁開始）
function saveProgress(now = false) {
  clearTimeout(R.saveT);
  const d = R.doc && findDoc(R.doc.id);
  if (!d || !R.pages.length) return;
  const n = R.cur;
  const go = () => { const x = findDoc(d.id); if (x && x.lastPage !== n) saveDoc('docs', { ...x, lastPage: n }); };
  if (now) go(); else R.saveT = setTimeout(go, 2000);
}

function goTo(n) {
  R.cur = n;
  if (R.pages[n - 1]) R.body.scrollTop = topOf(n) - GAP;
  paintPageNo();
}

// 縮放後維持畫面上同一個位置；anchor = 畫面上的點（相對 body）
function setZoom(z, anchor) {
  z = Math.min(5, Math.max(0.5, z));
  if (!R.pages.length || Math.abs(z - R.zoom) < 0.01) return;
  const ax = anchor?.x ?? R.body.clientWidth / 2, ay = anchor?.y ?? probeY();
  // 記住錨點落在哪一頁的哪個比例
  const y = R.body.scrollTop + ay;
  const n = pageAt(y);
  const fy = (y - topOf(n)) / heightOf(n);
  const fx = (R.body.scrollLeft + ax) / Math.max(1, R.inner.scrollWidth);
  R.zoom = z;
  layout();
  R.body.scrollTop = topOf(n) + fy * heightOf(n) - ay;
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
    if (!R.pages.length) return;
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
  if (!R.el || ev.target.closest?.('input, textarea, select')) return;
  const k = ev.key;
  if (k === 'Escape') closeReader();
  else if (!R.pages.length) return;
  else if (k === 'ArrowRight' || k === 'PageDown') goTo(Math.min(R.pages.length, R.cur + 1));
  else if (k === 'ArrowLeft' || k === 'PageUp') goTo(Math.max(1, R.cur - 1));
  else if (k === '+' || k === '=') zoomBy(1);
  else if (k === '-') zoomBy(-1);
  else if (k === '0') zoomBy(0);
  else return;
  ev.preventDefault();
});

// 切換頁面（上一頁／點導覽）時關掉閱讀器
window.addEventListener('hashchange', () => closeReader());
