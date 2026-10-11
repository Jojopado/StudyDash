// 這台裝置上的 PDF 快取（IndexedDB）：下載過或自己加入的檔案存在這裡，之後打開不用再下載、沒網路也能看。
const DB = 'studydash-files';
const STORE = 'files';
let dbP = null;

function open() {
  if (!dbP) {
    dbP = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbP.catch(() => { dbP = null; });
  }
  return dbP;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('快取寫入失敗（手機空間可能不足）'));
  });
}

// 存 { bytes: ArrayBuffer, size }，回傳 Uint8Array（找不到回傳 null）
export async function get(id) {
  const v = await run('readonly', s => s.get(id));
  return v?.bytes ? new Uint8Array(v.bytes) : null;
}
// 先同步複製一份：交給 pdf.js 的那份可能會被搬走（detach）
export function put(id, u8) {
  const rec = { bytes: u8.slice().buffer, size: u8.length, at: Date.now() };
  return run('readwrite', s => s.put(rec, id));
}
export const del = id => run('readwrite', s => s.delete(id));

// { id: 大小 } —— 用游標只讀 key 和 size 會讀到整個檔案，所以分開記一份清單在 localStorage
const LS = 'studydash.filecache';
function readIndex() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function writeIndex(x) { try { localStorage.setItem(LS, JSON.stringify(x)); } catch { /* ignore */ } }
export const index = readIndex;
export async function putIndexed(id, u8) { const len = u8.length; await put(id, u8); writeIndex({ ...readIndex(), [id]: len }); }
export async function delIndexed(id) { await del(id); const x = readIndex(); delete x[id]; writeIndex(x); }
export async function clearAll() { await run('readwrite', s => s.clear()); writeIndex({}); }
