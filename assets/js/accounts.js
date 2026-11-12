/* ══════════════════════════════════════════════════════════════════
   accounts.js — 本机多账号

   账号库：localStorage['atlas.accounts.v1']
     { id, name, salt(b64), hash(b64), iter, createdAt,
       recovery?: { salt, hash, iter, at },   // 恢复码，等价于第二把钥匙
       cloudId? }                              // 绑定的 WorkBuddy 云账号

   口令：PBKDF2-SHA256 / 21 万轮 / 每账号独立随机盐，明文与派生结果都不落盘。
   恢复码：20 位 base32（去易混字符），同样 PBKDF2 派生后存储；只在生成时显示一次。
   会话：localStorage，30 天有效；每次启动滑动续期。

   数据隔离：登录后所有键追加 `::<id>` 后缀，IndexedDB 也换成独立库名，
   因此两个账号的相册、照片、站点文案互不可见。

   这一层是「存储适配器」：后端换成云服务时，只需替换 key()/dbName()/API，
   上层调用方不用改。
   ══════════════════════════════════════════════════════════════════ */

const LS_ACCOUNTS = 'atlas.accounts.v1';
const LS_SESSION = 'atlas.session.v1';
const LS_GUARD = 'atlas.guard.v1';
export const GUEST_DB = 'atlas-plates';

const ITER = 210000;
const RECOVERY_ITER = 210000;
const SESSION_TTL = 30 * 864e5;

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
  if (!crypto?.subtle) throw new Error('crypto_unavailable');
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

/* ── 账号库 ── */
export function accounts() {
  const raw = readJSON(LS_ACCOUNTS, []);
  if (!Array.isArray(raw)) return [];
  /* 单条坏记录不该让整个账号库不可用：能识别的保留，坏的丢掉 */
  return raw.filter(a =>
    a && typeof a === 'object' &&
    typeof a.id === 'string' && a.id &&
    typeof a.name === 'string' && a.name &&
    typeof a.salt === 'string' && typeof a.hash === 'string'
  );
}
function saveAccounts(list) {
  return writeJSON(LS_ACCOUNTS, list);
}

export function accountExists(name) {
  const key = normName(name).toLowerCase();
  return accounts().some(a => a.name.toLowerCase() === key);
}

export function hasRecovery(name) {
  const acc = accounts().find(a => a.name.toLowerCase() === normName(name).toLowerCase());
  return !!(acc && acc.recovery && acc.recovery.hash && acc.recovery.salt);
}

/* ── 会话 ── */
export function currentUser() {
  const s = readJSON(LS_SESSION, null);
  if (!s || !s.id) return null;
  if (s.exp && Date.now() > s.exp) { logout(); return null; }
  const acc = accounts().find(a => a.id === s.id);
  return acc ? { id: acc.id, name: acc.name } : null;
}

/** 每次启动/关键操作滑动续期；旧版无 exp 的会话也在这里升级 */
export function touchSession() {
  const s = readJSON(LS_SESSION, null);
  if (!s || !s.id) return false;
  /* 过期会话不能靠"续期"复活 */
  if (s.exp && Date.now() > s.exp) { logout(); return false; }
  const left = (s.exp || 0) - Date.now();
  if (left > SESSION_TTL - 864e5) return false;
  s.exp = Date.now() + SESSION_TTL;
  s.at = Date.now();
  return writeJSON(LS_SESSION, s);
}

export function sessionExpiresAt() {
  const s = readJSON(LS_SESSION, null);
  return s?.exp || 0;
}

function openSession(acc) {
  writeJSON(LS_SESSION, {
    id: acc.id,
    name: acc.name,
    at: Date.now(),
    exp: Date.now() + SESSION_TTL
  });
}

export function logout() {
  try { localStorage.removeItem(LS_SESSION); } catch {}
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

/* ── 名称 / 密码规则 ── */
const NAME_RE = /^[\w\u4e00-\u9fa5.-]{3,24}$/;
const RESERVED = new Set(['admin', 'root', 'atlas', 'guest', 'system', 'workbuddy', 'support']);

export function normName(name) {
  return String(name ?? '').normalize('NFKC').trim();
}

export function validateName(name) {
  const n = normName(name);
  if (!n) return 'name_empty';
  if ([...n].length < 3 || [...n].length > 24) return 'name_invalid';
  if (!NAME_RE.test(n)) return 'name_invalid';
  if (RESERVED.has(n.toLowerCase())) return 'name_reserved';
  if (accounts().some(a => a.name.toLowerCase() === n.toLowerCase())) return 'name_taken';
  return null;
}

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyui', 'qwerty123', '11111111', '88888888', 'abcdefgh', 'iloveyou',
  'atlas', 'atlas123', 'workbuddy'
]);

export function passwordIssue(pw) {
  const s = String(pw ?? '');
  if (!s) return 'pw_empty';
  if ([...s].length < 8) return 'pw_short';
  if (s.length > 72) return 'pw_long';
  if (/^(.)\1+$/u.test(s)) return 'pw_weak';
  if (COMMON.has(s.toLowerCase())) return 'pw_common';
  return null;
}

/** 0 弱 / 1 一般 / 2 好 / 3 强，仅用于提示，不参与校验 */
export function passwordStrength(pw) {
  const s = String(pw ?? '');
  if (!s) return 0;
  let score = 0;
  if ([...s].length >= 10) score++;
  if ([...s].length >= 14) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  return Math.max(0, Math.min(3, score - 1));
}

export function validatePassword(pw) {
  return passwordIssue(pw);
}

/* ── 恢复码 ──
   20 位 base32（去掉 I/O/0/1），100 bit 熵；分组显示，输入时忽略大小写、
   空格与连字符。只存 PBKDF2 派生值。 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 20;

function randomCode() {
  const buf = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}
function formatCode(s) {
  return s.match(/.{1,4}/g).join('-');
}
export function normCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function makeRecovery() {
  const raw = randomCode();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(normCode(raw), salt, RECOVERY_ITER);
  return {
    code: formatCode(raw),
    record: { salt: b64(salt), hash: b64(hash), iter: RECOVERY_ITER, at: Date.now() }
  };
}

/* ── 失败节流 ──
   纯本机计数，挡的是"随手试几个"，不是有备而来的离线攻击；
   真正的基础是 PBKDF2 的 21 万轮。 */
const GUARD_STEPS = [[5, 30e3], [8, 300e3], [12, 900e3]];
const GUARD_TTL = 7 * 864e5;

function guardAll() {
  const raw = readJSON(LS_GUARD, {});
  return raw && typeof raw === 'object' ? raw : {};
}
function guardKey(name) {
  return normName(name).toLowerCase();
}
export function guardWait(name) {
  const g = guardAll()[guardKey(name)];
  if (!g || !g.until) return 0;
  return Math.max(0, g.until - Date.now());
}
function noteFail(name) {
  const all = guardAll();
  const k = guardKey(name);
  const now = Date.now();
  const g = all[k] && now - (all[k].last || 0) < GUARD_TTL ? all[k] : { n: 0, until: 0 };
  g.n = (g.n || 0) + 1;
  g.last = now;
  const hit = GUARD_STEPS.find(([n]) => g.n >= n);
  if (hit) g.until = now + hit[1];
  all[k] = g;
  /* 顺手清掉过期记录，避免无限增长 */
  Object.keys(all).forEach(key => {
    if (now - (all[key].last || 0) > GUARD_TTL) delete all[key];
  });
  writeJSON(LS_GUARD, all);
}
function noteSuccess(name) {
  const all = guardAll();
  delete all[guardKey(name)];
  writeJSON(LS_GUARD, all);
}

/* ── 注册 / 登录 ── */
export async function register(name, password) {
  const e1 = validateName(name);
  if (e1) throw new Error(e1);
  const e2 = passwordIssue(password);
  if (e2) throw new Error(e2);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITER);
  const rec = {
    id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: normName(name),
    salt: b64(salt),
    hash: b64(hash),
    iter: ITER,
    createdAt: Date.now()
  };
  const recovery = await makeRecovery();
  rec.recovery = recovery.record;

  const list = accounts();
  list.push(rec);
  if (!saveAccounts(list)) throw new Error('storage_full');
  openSession(rec);
  return { id: rec.id, name: rec.name, recoveryCode: recovery.code };
}

export async function login(name, password) {
  const wait = guardWait(name);
  if (wait > 0) throw new Error('rate_limited:' + Math.ceil(wait / 1000));

  const key = normName(name).toLowerCase();
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === key);
  if (!acc) { noteFail(name); throw new Error('bad_credentials'); }

  const hash = await derive(password, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(hash, unb64(acc.hash))) {
    noteFail(name);
    throw new Error('bad_credentials');
  }

  noteSuccess(name);

  /* 迭代轮数升级：老账号在下一次成功登录时悄悄换成当前标准 */
  if ((acc.iter || ITER) < ITER) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    acc.salt = b64(salt);
    acc.hash = b64(await derive(password, salt, ITER));
    acc.iter = ITER;
    saveAccounts(list);
  }

  openSession(acc);
  return { id: acc.id, name: acc.name };
}

/* ── 修改密码 ── */
export async function changePassword(name, oldPw, newPw) {
  const wait = guardWait(name);
  if (wait > 0) throw new Error('rate_limited:' + Math.ceil(wait / 1000));

  const key = normName(name).toLowerCase();
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === key);
  if (!acc) throw new Error('bad_credentials');

  const cur = await derive(oldPw, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(cur, unb64(acc.hash))) {
    noteFail(name);
    throw new Error('bad_credentials');
  }
  noteSuccess(name);

  const e = passwordIssue(newPw);
  if (e) throw new Error(e);
  if (newPw === oldPw) throw new Error('pw_same');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  acc.salt = b64(salt);
  acc.hash = b64(await derive(newPw, salt, ITER));
  acc.iter = ITER;
  if (!saveAccounts(list)) throw new Error('storage_full');

  openSession(acc);
  return true;
}

/* ── 恢复码：生成 / 重设 ── */
export async function setRecovery(name, password) {
  const wait = guardWait(name);
  if (wait > 0) throw new Error('rate_limited:' + Math.ceil(wait / 1000));

  const key = normName(name).toLowerCase();
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === key);
  if (!acc) throw new Error('bad_credentials');

  const cur = await derive(password, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(cur, unb64(acc.hash))) {
    noteFail(name);
    throw new Error('bad_credentials');
  }
  noteSuccess(name);

  const recovery = await makeRecovery();
  acc.recovery = recovery.record;
  if (!saveAccounts(list)) throw new Error('storage_full');
  return { code: recovery.code };
}

/** 用恢复码重设密码；成功后恢复码轮换，返回新码（只显示这一次） */
export async function resetPassword(name, code, newPw) {
  const wait = guardWait(name);
  if (wait > 0) throw new Error('rate_limited:' + Math.ceil(wait / 1000));

  const key = normName(name).toLowerCase();
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === key);
  if (!acc) { noteFail(name); throw new Error('bad_credentials'); }
  if (!acc.recovery?.salt || !acc.recovery?.hash) throw new Error('no_recovery');

  const raw = normCode(code);
  if (raw.length !== CODE_LEN) { noteFail(name); throw new Error('bad_recovery'); }

  const got = await derive(raw, unb64(acc.recovery.salt), acc.recovery.iter || RECOVERY_ITER);
  if (!equalBytes(got, unb64(acc.recovery.hash))) {
    noteFail(name);
    throw new Error('bad_recovery');
  }

  const e = passwordIssue(newPw);
  if (e) throw new Error(e);

  noteSuccess(name);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  acc.salt = b64(salt);
  acc.hash = b64(await derive(newPw, salt, ITER));
  acc.iter = ITER;

  const recovery = await makeRecovery();
  acc.recovery = recovery.record;
  if (!saveAccounts(list)) throw new Error('storage_full');

  openSession(acc);
  return { id: acc.id, name: acc.name, recoveryCode: recovery.code };
}

/* ── 云账号绑定 ──
   只记录"这个本机账号认哪一张 WorkBuddy 身份"，用于换设备后自动恢复同步，
   不存任何云凭证。 */
export function bindCloud(userId, cloudId) {
  if (!userId || !cloudId) return false;
  const list = accounts();
  const acc = list.find(a => a.id === userId);
  if (!acc || acc.cloudId === cloudId) return false;
  acc.cloudId = cloudId;
  return saveAccounts(list);
}

export function cloudIdOf(userId) {
  const acc = accounts().find(a => a.id === userId);
  return acc?.cloudId || '';
}

/* ── 删除账号 ── */
export async function removeAccount(name, password) {
  const wait = guardWait(name);
  if (wait > 0) throw new Error('rate_limited:' + Math.ceil(wait / 1000));

  const key = normName(name).toLowerCase();
  const list = accounts();
  const acc = list.find(a => a.name.toLowerCase() === key);
  if (!acc) throw new Error('bad_credentials');

  const cur = await derive(password, unb64(acc.salt), acc.iter || ITER);
  if (!equalBytes(cur, unb64(acc.hash))) {
    noteFail(name);
    throw new Error('bad_credentials');
  }

  USER_KEYS.forEach(k => { try { localStorage.removeItem(`${k}::${acc.id}`); } catch {} });
  try { indexedDB.deleteDatabase(`${GUEST_DB}::${acc.id}`); } catch {}
  saveAccounts(list.filter(a => a.id !== acc.id));

  const all = guardAll();
  delete all[key];
  writeJSON(LS_GUARD, all);

  /* 云同步作用域如果指向这个账号，一并清掉，避免下次登录误判为"同一个人" */
  try {
    if (localStorage.getItem('atlas.cloud.scope.v1') === acc.id) {
      localStorage.removeItem('atlas.cloud.scope.v1');
    }
  } catch {}
  /* 用 session 里的 id 判断，而不是 currentUser()：账号记录刚被删掉，
     currentUser() 已经查不到它，会把过期会话留在本地 */
  const sess = readJSON(LS_SESSION, null);
  if (sess?.id === acc.id) logout();
  return true;
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
