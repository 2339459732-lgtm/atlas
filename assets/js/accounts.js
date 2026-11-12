/* ══════════════════════════════════════════════════════════════════
   accounts.js — 本地多账号

   账号库：localStorage['atlas.accounts.v1']
     { id, name, salt(b64), hash(b64), iter, createdAt }
  口令：PBKDF2-SHA256 / 21 万轮 / 每账号独立随机盐，明文与派生结果都不落盘。

   数据隔离：登录后所有键追加 `::<id>` 后缀，IndexedDB 也换成独立库名，
   因此两个账号的相册、照片、站点文案互不可见。

   这一层是「存储适配器」：后端换成云服务时，只需替换 key()/dbName()/API，
   上层调用方不用改。
   ══════════════════════════════════════════════════════════════════ */

const LS_ACCOUNTS = 'atlas.accounts.v1';
const LS_SESSION = 'atlas.session.v1';
export const GUEST_DB = 'atlas-plates';

const ITER = 210000;
const enc = new TextEncoder();

/* 仅本设备可见的会话：不写 cookie，不做跨域 */
const readJSON = (k, d) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; }
};
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

function b64(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function unb64(str) {
  const raw = atob(str);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

/* 定长比较，避免按字节提前返回 */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function accounts() {
  return readJSON(LS_ACCOUNTS, []);
}
function saveAccounts(list) {
  return writeJSON(LS_ACCOUNTS, list);
}

export function currentUser() {
  const s = readJSON(LS_SESSION, null);
  if (!s || !s.id) return null;
  const acc = accounts().find(a => a.id === s.id);
  return acc ? { id: acc.id, name: acc.name } : null;
}

/** 键名分区：未登录保持原键，登录后追加 ::<id> */
export function key(base) {
  const u = currentUser();
  return u ? `${base}::${u.id}` : base;
}

/** 每个账号一个独立 IndexedDB，物理隔离 */
export function dbName() {
  const u = currentUser();
  return u ? `${GUEST_DB}::${u.id}` : GUEST_DB;
}

export const USER_KEYS = [
  'atlas.landmarks.v4',
  'atlas.meta.v1',      /* 墓碑与未上云的脏标记：不搬的话，换账号后删除记录会丢 */
  'atlas.site.v1',
  'atlas.seeded.v1',
  'atlas.backed.v1'
];

/* ── 校验 ───────────────────────────────────────────────────────── */
const NAME_RE = /^[\w\u4e00-\u9fa5.-]{3,24}$/;

export function validateName(name) {
  if (!name) return 'name_empty';
  if (!NAME_RE.test(name)) return 'name_invalid';
  if (accounts().some(a => a.name.toLowerCase() === name.toLowerCase())) return 'name_taken';
  return null;
}
export function validatePassword(pw) {
  if (!pw) return 'pw_empty';
  if (pw.length < 8) return 'pw_short';
  return null;
}

/* ── 注册 / 登录 / 退出 ─────────────────────────────────────────── */

export async function register(name, password) {
  const e1 = validateName(name);
  if (e1) throw new Error(e1);
  const e2 = validatePassword(password);
  if (e2) throw new Error(e2);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITER);
  const rec = {
    id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    salt: b64(salt),
    hash: b64(hash),
    iter: ITER,
    createdAt: Date.now()
  };
  const list = accounts();
  list.push(rec);
  if (!saveAccounts(list)) throw new Error('storage_full');
  openSession(rec);
  return { id: rec.id, name: rec.name };
}

export async function login(name, password) {
  const acc = accounts().find(a => a.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!acc) throw new Error('bad_credentials');
  const hash = await derive(password, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(hash, unb64(acc.hash))) throw new Error('bad_credentials');
  openSession(acc);
  return { id: acc.id, name: acc.name };
}

function openSession(acc) {
  writeJSON(LS_SESSION, { id: acc.id, name: acc.name, at: Date.now() });
}

export function logout() {
  try { localStorage.removeItem(LS_SESSION); } catch {}
}

export async function changePassword(name, oldPw, newPw) {
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === String(name).toLowerCase());
  if (!acc) throw new Error('bad_credentials');
  const cur = await derive(oldPw, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(cur, unb64(acc.hash))) throw new Error('bad_credentials');
  const e2 = validatePassword(newPw);
  if (e2) throw new Error(e2);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  acc.salt = b64(salt);
  acc.hash = b64(await derive(newPw, salt, ITER));
  acc.iter = ITER;
  saveAccounts(list);
}

/** 删除账号：连同它的全部数据键与照片库，不可恢复 */
export async function removeAccount(name, password) {
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === String(name).toLowerCase());
  if (!acc) throw new Error('bad_credentials');
  const cur = await derive(password, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(cur, unb64(acc.hash))) throw new Error('bad_credentials');

  USER_KEYS.forEach(k => { try { localStorage.removeItem(`${k}::${acc.id}`); } catch {} });
  try { indexedDB.deleteDatabase(`${GUEST_DB}::${acc.id}`); } catch {}
  saveAccounts(list.filter(a => a.id !== acc.id));
  /* 云同步作用域如果指向这个账号，一并清掉，避免下次登录误判为"同一个人" */
  try {
    if (localStorage.getItem('atlas.cloud.scope.v1') === acc.id) {
      localStorage.removeItem('atlas.cloud.scope.v1');
    }
  } catch {}
  if (currentUser()?.id === acc.id) logout();
}

/* ── 访客数据迁移：注册后把当前浏览器的旧数据收进新账号 ── */
export function migrateGuestData(userId) {
  let moved = 0;
  USER_KEYS.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v == null) return;
      if (localStorage.getItem(`${k}::${userId}`) == null) {
        localStorage.setItem(`${k}::${userId}`, v);
        moved++;
      }
    } catch {}
  });
  return moved;
}

/* 照片库是按账号分库的，localStorage 迁移管不到它。
   注册时如果勾了「迁移本机作品」，必须连照片一起搬，否则相册会变成空壳。
   这里做的是复制而不是移动：退出登录后访客数据仍在，不算破坏性操作。 */
export async function migrateGuestPhotos(userId) {
  if (!userId) return 0;
  const openNamed = name => new Promise((res, rej) => {
    const req = indexedDB.open(name, 4);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('plates')) {
        d.createObjectStore('plates', { keyPath: 'id' }).createIndex('landmarkId', 'landmarkId');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const src = await openNamed(GUEST_DB);
  const rows = await new Promise((res, rej) => {
    const q = src.transaction('plates', 'readonly').objectStore('plates').getAll();
    q.onsuccess = () => res(q.result || []);
    q.onerror = () => rej(q.error);
  });
  src.close();
  if (!rows.length) return 0;

  const dst = await openNamed(`${GUEST_DB}::${userId}`);
  await new Promise((res, rej) => {
    const t = dst.transaction('plates', 'readwrite');
    const st = t.objectStore('plates');
    rows.forEach(r => st.put(r));
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  });
  dst.close();
  return rows.length;
}

/* 首次访问自动生成的示例地标：它们不算「用户作品」，不该被导入新账号 */
const DEMO_IDS = new Set(['lm-kyoto', 'lm-reyk', 'lm-hk']);

/** 只看地标：是否只是那三处示例 */
function hasGuestLandmarks() {
  let lm = null;
  try { lm = JSON.parse(localStorage.getItem('atlas.landmarks.v4') || 'null'); } catch { return false; }
  const list = Array.isArray(lm) ? lm : Array.isArray(lm?.items) ? lm.items : [];
  if (!list.length) return false;
  const pristine = list.length === DEMO_IDS.size && list.every(l => DEMO_IDS.has(l.id));
  return !pristine;
}

/* 只传过照片、没动过地标的人也算「有作品」。
   旧实现只看地标，于是"上传了一张照片但没新建相册"的访客
   会被判成空手，注册时迁移开关不出现，照片全留在访客库里。 */
let guestWork = null;

export async function probeGuestData(force = false) {
  if (!force && guestWork != null) return guestWork;
  let photos = 0;
  try {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open(GUEST_DB, 4);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('plates')) {
          d.createObjectStore('plates', { keyPath: 'id' }).createIndex('landmarkId', 'landmarkId');
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    photos = await new Promise((res, rej) => {
      const q = db.transaction('plates', 'readonly').objectStore('plates').count();
      q.onsuccess = () => res(q.result || 0);
      q.onerror = () => rej(q.error);
    });
    db.close();
  } catch {}
  guestWork = hasGuestLandmarks() || photos > 0;
  return guestWork;
}

/** 本机是否有「真正属于用户」的未登录作品 */
export function hasGuestData() {
  if (guestWork != null) return guestWork;
  return hasGuestLandmarks();
}
