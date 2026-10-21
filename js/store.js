// 資料層：沒設定 Firebase 或沒登入時存在本機；登入後改用 Firestore 即時同步。
import { firebaseConfig } from './firebase-config.js';

const LS_KEY = 'studydash.v1';
const COLS = ['events', 'topics', 'todos', 'courses', 'sessions', 'rw_redeems', 'expenses', 'decks', 'cards', 'memos', 'docs', 'doc_folders', 'units', 'workouts', 'body', 'habits'];
const PREFS_KEY = 'studydash.prefs';
// 這台裝置上次是登入狀態 → 開啟時先顯示「載入中」，不要先秀出空的本機資料
const CLOUD_FLAG = 'studydash.cloudUser';
const EMPTY = () => Object.fromEntries(COLS.map(c => [c, []]));
const pick = data => Object.fromEntries(COLS.map(c => [c, data[c] || []]));
const FB_VER = '10.12.2';

const listeners = new Set();
let backend = null;

export const store = {
  state: EMPTY(),
  prefs: readPrefs(),     // { bg } 外觀設定，登入後跟著帳號同步
  mode: 'local',          // 'local' | 'cloud'
  user: null,             // { email, uid } when signed in
  cloudAvailable: !!firebaseConfig,
  ready: false,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(store); }
function setData(data) {
  store.state = pick(data);
  store.ready = true;
  emit();
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- 本機 ----------
function readLocal() {
  try { return pick(JSON.parse(localStorage.getItem(LS_KEY)) || {}); }
  catch { return EMPTY(); }
}
function writeLocal(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* 空間不足或隱私模式 */ }
}

function localBackend() {
  let data = readLocal();
  const onStorage = e => { if (e.key === LS_KEY) { data = readLocal(); setData(data); } };
  window.addEventListener('storage', onStorage);
  const commit = () => { writeLocal(data); setData(data); };
  return {
    start() { setData(data); },
    stop() { window.removeEventListener('storage', onStorage); },
    put(col, doc) {
      const arr = data[col] || (data[col] = []);
      const i = arr.findIndex(d => d.id === doc.id);
      if (i >= 0) arr[i] = doc; else arr.push(doc);
      commit();
    },
    remove(col, id) { data[col] = (data[col] || []).filter(d => d.id !== id); commit(); },
    async replaceAll(next) { data = { ...data, ...Object.fromEntries(COLS.filter(c => Array.isArray(next[c])).map(c => [c, next[c]])) }; commit(); },
    putPrefs() { /* 本機模式只存 localStorage */ },
  };
}

// ---------- 雲端 ----------
let fb = null; // { auth, db, authMod, fsMod }

async function loadFirebase() {
  if (fb) return fb;
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fsMod.initializeFirestore(app, {
    localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
  });
  fb = { auth, db, authMod, fsMod };
  return fb;
}

function cloudBackend(uid) {
  const { db, fsMod } = fb;
  const { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, getDocs } = fsMod;
  const cur = EMPTY();
  const unsubs = [];
  const colRef = col => collection(db, 'users', uid, col);
  // 每個集合和設定都第一次載入完才顯示，不然先到的集合會讓還沒到的看起來是空的
  const waiting = new Set([...COLS, 'prefs']);
  const loaded = key => {
    if (!waiting.delete(key)) return;
    if (!waiting.size) setData(cur);
  };
  return {
    start() {
      prefsLoaded = false;
      store.ready = false;
      emit();
      for (const col of COLS) {
        unsubs.push(onSnapshot(colRef(col), snap => {
          cur[col] = snap.docs.map(d => d.data());
          if (waiting.size) loaded(col); else setData(cur);
        }, err => { console.error('snapshot', col, err); loaded(col); }));
      }
      unsubs.push(onSnapshot(doc(db, 'users', uid, 'prefs', 'ui'), snap => {
        const keys = Object.keys(pendingPrefs);
        if (!prefsLoaded && keys.length) {
          // 載入前改過的欄位疊在雲端設定上，再補寫上去
          setPrefs({ ...(snap.exists() ? snap.data() : {}), ...pendingPrefs }, null);
          pendingPrefs = {};
          this.putPrefs(store.prefs, keys);
        } else if (snap.exists()) setPrefs(snap.data(), null);
        prefsLoaded = true;
        loaded('prefs');
      }, err => { console.error('snapshot prefs', err); prefsLoaded = true; loaded('prefs'); }));
    },
    stop() { unsubs.forEach(u => u()); },
    put(col, d) { setDoc(doc(db, 'users', uid, col, d.id), d).catch(e => console.error(e)); },
    remove(col, id) { deleteDoc(doc(db, 'users', uid, col, id)).catch(e => console.error(e)); },
    // 只寫這次改的欄位：別台裝置的舊設定不會蓋掉雲端其他欄位
    putPrefs(p, keys) { setDoc(doc(db, 'users', uid, 'prefs', 'ui'), p, { mergeFields: keys }).catch(e => console.error(e)); },
    async replaceAll(next) {
      // Firestore 一個 batch 上限 500 筆，分批寫
      const ops = [];
      // 備份檔裡沒有的資料（例如舊備份沒有字卡）就不動
      for (const col of COLS.filter(c => Array.isArray(next[c]))) {
        const existing = await getDocs(colRef(col));
        existing.forEach(s => ops.push(['del', col, s.id]));
        for (const d of next[col] || []) ops.push(['set', col, d]);
      }
      for (let i = 0; i < ops.length; i += 450) {
        const b = writeBatch(db);
        for (const [op, col, x] of ops.slice(i, i + 450)) {
          if (op === 'del') b.delete(doc(db, 'users', uid, col, x));
          else b.set(doc(db, 'users', uid, col, x.id), x);
        }
        await b.commit();
      }
    },
    async mergeIn(local) {
      const b = writeBatch(db);
      let n = 0;
      for (const col of COLS) for (const d of local[col] || []) { b.set(doc(db, 'users', uid, col, d.id), d); n++; }
      if (n) await b.commit();
      return n;
    },
  };
}

let prefsLoaded = true;

function useBackend(b, mode) {
  if (backend) backend.stop();
  backend = b;
  store.mode = mode;
  backend.start();
}

function hadCloudUser() {
  try { return !!localStorage.getItem(CLOUD_FLAG); } catch { return false; }
}
function setCloudFlag(on) {
  try { on ? localStorage.setItem(CLOUD_FLAG, '1') : localStorage.removeItem(CLOUD_FLAG); } catch { /* ignore */ }
}

export async function initStore() {
  if (firebaseConfig && hadCloudUser()) {
    // 等雲端；10 秒都連不上才先用本機（離線時至少能新增，之後登入會搬上去）
    backend = localBackend();
    store.mode = 'local';
    setTimeout(() => { if (!store.ready && store.mode === 'local') backend.start(); }, 10000);
  } else {
    useBackend(localBackend(), 'local');
  }
  if (!firebaseConfig) return;
  try {
    const { auth, authMod } = await loadFirebase();
    authMod.onAuthStateChanged(auth, async user => {
      if (user) {
        setCloudFlag(true);
        store.user = { email: user.email, uid: user.uid };
        const cloud = cloudBackend(user.uid);
        // 登入前在本機新增的資料一併搬上雲端，然後清掉本機那份
        const local = readLocal();
        if (COLS.some(c => local[c]?.length)) {
          await cloud.mergeIn(local);
          writeLocal(EMPTY());
        }
        useBackend(cloud, 'cloud');
      } else {
        setCloudFlag(false);
        store.user = null;
        useBackend(localBackend(), 'local');
      }
    });
  } catch (e) {
    console.error('Firebase 載入失敗，改用本機模式', e);
    store.cloudAvailable = false;
    if (!store.ready) backend.start();
    emit();
  }
}

export async function login(email, password) {
  const { auth, authMod } = await loadFirebase();
  await authMod.signInWithEmailAndPassword(auth, email, password);
}
export async function signup(email, password) {
  const { auth, authMod } = await loadFirebase();
  await authMod.createUserWithEmailAndPassword(auth, email, password);
}
export async function logout() {
  const { auth, authMod } = await loadFirebase();
  await authMod.signOut(auth);
}

// ---------- 給畫面用的操作 ----------
export function saveEvent(ev) { backend.put('events', { ...ev, updatedAt: Date.now() }); }
export function deleteEvent(id) { backend.remove('events', id); }
export function saveTopic(t) { backend.put('topics', { ...t, updatedAt: Date.now() }); }
export function deleteTopic(id) { backend.remove('topics', id); }
export function saveTodo(t) { backend.put('todos', { ...t, updatedAt: Date.now() }); }
export function deleteTodo(id) { backend.remove('todos', id); }
export function saveCourse(c) { backend.put('courses', { ...c, updatedAt: Date.now() }); }
export function deleteCourse(id) { backend.remove('courses', id); }
export function saveSession(x) { backend.put('sessions', { ...x, updatedAt: Date.now() }); }
export function deleteSession(id) { backend.remove('sessions', id); }
// 模擬投資等其他集合用
export function saveDoc(col, d) { backend.put(col, { ...d, updatedAt: Date.now() }); }
export function removeDoc(col, id) { backend.remove(col, id); }

// ---------- PDF 檔案內容 ----------
// 切成 900KB 一塊存在 users/{uid}/doc_chunks/{檔案id}_{序號}（Firestore 一筆上限 1MB）。
// 不在 COLS 裡：不會即時同步，要看的時候才下載。
export const CHUNK = 900 * 1024;

async function pool(n, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < n) await fn(next++); };
  await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
}
const chunkRef = (fileId, i) => fb.fsMod.doc(fb.db, 'users', store.user.uid, 'doc_chunks', `${fileId}_${i}`);

export async function uploadChunks(fileId, u8, onProgress) {
  if (store.mode !== 'cloud') throw new Error('沒有登入');
  const { setDoc, Bytes } = fb.fsMod;
  const n = Math.max(1, Math.ceil(u8.length / CHUNK));
  let done = 0;
  await pool(n, 3, async i => {
    await setDoc(chunkRef(fileId, i), { fileId, i, data: Bytes.fromUint8Array(u8.subarray(i * CHUNK, (i + 1) * CHUNK)) });
    onProgress?.(++done, n);
  });
  return n;
}

export async function downloadChunks(fileId, n, size, onProgress) {
  if (store.mode !== 'cloud') throw new Error('要登入才能從雲端下載');
  const { getDoc } = fb.fsMod;
  const out = new Uint8Array(size);
  let done = 0;
  await pool(n, 4, async i => {
    const snap = await getDoc(chunkRef(fileId, i));
    if (!snap.exists()) throw new Error('雲端的檔案不完整，請重新加入');
    out.set(snap.data().data.toUint8Array(), i * CHUNK);
    onProgress?.(++done, n);
  });
  return out;
}

export async function deleteChunks(fileId, n) {
  if (store.mode !== 'cloud' || !n) return;
  const { deleteDoc } = fb.fsMod;
  await pool(n, 6, i => deleteDoc(chunkRef(fileId, i)));
}

// ---------- 外觀設定 ----------
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function setPrefs(p, keys) {
  store.prefs = { ...p };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs)); } catch { /* ignore */ }
  if (keys) {
    // 雲端設定還沒載入就改：先記著，載入後補寫（不然會拿這台的舊設定去蓋）
    if (store.mode === 'cloud' && !prefsLoaded) for (const k of keys) pendingPrefs[k] = store.prefs[k];
    else backend.putPrefs(store.prefs, keys);
  }
  emit();
}
let pendingPrefs = {};
export function savePrefs(patch) {
  const keys = [...Object.keys(patch), 'updatedAt'];
  setPrefs({ ...store.prefs, ...patch, updatedAt: Date.now() }, keys);
}

export function exportData() {
  return { app: 'studydash', version: 1, exportedAt: new Date().toISOString(), ...store.state };
}
export async function importData(obj) {
  if (obj && COLS.some(c => Array.isArray(obj[c])) && (!Array.isArray(obj.events) || !Array.isArray(obj.topics))) {
    throw new Error('這不是完整備份，請改按「加入檔案」');
  }
  if (!obj || !Array.isArray(obj.events) || !Array.isArray(obj.topics)) throw new Error('檔案格式不對');
  await backend.replaceAll(obj);
}
// 只新增／覆寫同 id 的項目，不刪其他資料
export function mergeData(obj) {
  if (!obj || !COLS.some(c => Array.isArray(obj[c]))) throw new Error('檔案格式不對');
  for (const e of obj.events || []) saveEvent(e);
  for (const t of obj.topics || []) saveTopic(t);
  for (const t of obj.todos || []) saveTodo(t);
  for (const c of obj.courses || []) saveCourse(c);
  for (const x of obj.sessions || []) saveSession(x);
  for (const col of ['expenses', 'decks', 'cards', 'memos', 'units', 'workouts', 'body', 'habits']) for (const d of obj[col] || []) saveDoc(col, d);
}
