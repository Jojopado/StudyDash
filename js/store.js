// 資料層：沒設定 Firebase 或沒登入時存在本機；登入後改用 Firestore 即時同步。
import { firebaseConfig } from './firebase-config.js';

const LS_KEY = 'studydash.v1';
const COLS = ['events', 'topics', 'todos', 'courses', 'sessions'];
const PREFS_KEY = 'studydash.prefs';
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
    async replaceAll(next) { data = pick(next); commit(); },
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
  return {
    start() {
      for (const col of COLS) {
        unsubs.push(onSnapshot(colRef(col), snap => {
          cur[col] = snap.docs.map(d => d.data());
          setData(cur);
        }, err => console.error('snapshot', col, err)));
      }
      unsubs.push(onSnapshot(doc(db, 'users', uid, 'prefs', 'ui'), snap => {
        if (snap.exists()) setPrefs(snap.data(), false);
      }, err => console.error('snapshot prefs', err)));
    },
    stop() { unsubs.forEach(u => u()); },
    put(col, d) { setDoc(doc(db, 'users', uid, col, d.id), d).catch(e => console.error(e)); },
    remove(col, id) { deleteDoc(doc(db, 'users', uid, col, id)).catch(e => console.error(e)); },
    putPrefs(p) { setDoc(doc(db, 'users', uid, 'prefs', 'ui'), p).catch(e => console.error(e)); },
    async replaceAll(next) {
      // Firestore 一個 batch 上限 500 筆，分批寫
      const ops = [];
      for (const col of COLS) {
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

function useBackend(b, mode) {
  if (backend) backend.stop();
  backend = b;
  store.mode = mode;
  backend.start();
}

export async function initStore() {
  useBackend(localBackend(), 'local');
  if (!firebaseConfig) return;
  try {
    const { auth, authMod } = await loadFirebase();
    authMod.onAuthStateChanged(auth, async user => {
      if (user) {
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
        store.user = null;
        useBackend(localBackend(), 'local');
      }
    });
  } catch (e) {
    console.error('Firebase 載入失敗，改用本機模式', e);
    store.cloudAvailable = false;
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

// ---------- 外觀設定 ----------
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function setPrefs(p, upload) {
  store.prefs = { ...p };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs)); } catch { /* ignore */ }
  if (upload) backend.putPrefs(store.prefs);
  emit();
}
export function savePrefs(patch) { setPrefs({ ...store.prefs, ...patch, updatedAt: Date.now() }, true); }

export function exportData() {
  return { app: 'studydash', version: 1, exportedAt: new Date().toISOString(), ...store.state };
}
export async function importData(obj) {
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
}
