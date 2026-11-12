/* ══════════════════════════════════════════════════════════════════
   store.js — 持久化适配层

   职责边界（只有它碰 localStorage 与 IndexedDB）：
     · 读：返回已经过 model 校验的数据，坏记录被丢掉并计数
     · 写：先校验、再落盘；写不进去要如实报错（不静默截断）
     · 版本：envelope {v, at, items}，旧版裸数组自动升级
     · 墓碑：删除留痕，防止另一台设备的旧副本把条目顶回来
     · 脏标记：哪些改动还没上云，刷新页面也不丢
     · 变更广播：多标签页之间的数据不再各改各的
     · 体检：孤儿照片、重复 id、丢失原图、配额，一次说清

   上层（main.js / 将来的任何 UI）不应再直接调用 indexedDB 或
   自己拼 localStorage 键。换后端时只改这一层。
   ══════════════════════════════════════════════════════════════════ */

import { key, dbName } from './accounts.js';
import { APP } from './config.js';
import {
  SCHEMA, LIMITS, normalizeAlbum, normalizePhoto,
  albumIssues, photoIssues, isId
} from './model.js';

const K_ALBUMS = 'atlas.landmarks.v4';   /* 键名保留：旧浏览器的数据不能丢 */
const K_META = 'atlas.meta.v1';
const DB_STORE = 'plates';
const DB_VERSION = 4;
const TOMB_TTL = APP.limits.tombstoneDays * 864e5;

const tabId = Math.random().toString(36).slice(2, 9);
const bus = typeof BroadcastChannel === 'function' ? new BroadcastChannel('atlas-store') : null;

let prevAlbums = new Map();   /* id → 上次落盘的规范化记录，用来算 rev */
let metaCache = null;
let legacyFlag = false;
let corruptFlag = false;

/* ── meta：墓碑 / 脏标记 / 同步水位 ── */
function readMeta() {
  if (metaCache) return metaCache;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(key(K_META)) || 'null'); } catch {}
  const m = raw && typeof raw === 'object' ? raw : {};
  m.tomb = m.tomb && typeof m.tomb === 'object' ? m.tomb : {};
  m.tomb.albums = m.tomb.albums && typeof m.tomb.albums === 'object' ? m.tomb.albums : {};
  m.tomb.photos = m.tomb.photos && typeof m.tomb.photos === 'object' ? m.tomb.photos : {};
  m.dirty = m.dirty && typeof m.dirty === 'object' ? m.dirty : {};
  m.dirty.albums = +m.dirty.albums || 0;
  m.dirty.photos = m.dirty.photos && typeof m.dirty.photos === 'object' ? m.dirty.photos : {};
  m.dirty.settings = +m.dirty.settings || 0;
  m.syncedAt = +m.syncedAt || 0;
  metaCache = m;
  return m;
}

function writeMeta() {
  const m = readMeta();
  try {
    localStorage.setItem(key(K_META), JSON.stringify(m));
    return true;
  } catch {
    /* 写不进去时先丢最老的墓碑：它们已经过期，留着也没意义 */
    const cut = Date.now() - 7 * 864e5;
    Object.keys(m.tomb.albums).forEach(id => { if (m.tomb.albums[id].at < cut) delete m.tomb.albums[id]; });
    Object.keys(m.tomb.photos).forEach(id => { if (m.tomb.photos[id].at < cut) delete m.tomb.photos[id]; });
    try { localStorage.setItem(key(K_META), JSON.stringify(m)); return true; } catch { return false; }
  }
}

export function meta() {
  const m = readMeta();
  return {
    syncedAt: m.syncedAt,
    tombstones: { albums: { ...m.tomb.albums }, photos: { ...m.tomb.photos } },
    pending: {
      albums: !!m.dirty.albums,
      photos: Object.keys(m.dirty.photos).length,
      settings: !!m.dirty.settings
    }
  };
}

export function markSynced(at = Date.now()) {
  const m = readMeta();
  m.syncedAt = at;
  writeMeta();
}

/* ── 变更广播 ── */
const watchers = new Set();

export function onExternalChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function announce(kind) {
  /* BroadcastChannel 不会把消息投给自己；storage 事件也只给别的标签页。
     两边都不会形成回声，所以不需要再判 tab。 */
  try { bus?.postMessage({ kind, tab: tabId, at: Date.now() }); } catch {}
}

if (bus) {
  bus.onmessage = e => {
    const msg = e.data;
    if (!msg || msg.tab === tabId) return;
    watchers.forEach(fn => { try { fn(msg); } catch {} });
  };
}

/* storage 作为 BroadcastChannel 的兜底（Safari 旧版 / 隐私模式） */
addEventListener('storage', e => {
  if (e.key !== key(K_ALBUMS) && e.key !== key(K_META)) return;
  const msg = { kind: e.key === key(K_META) ? 'meta' : 'albums', tab: 'storage', at: Date.now() };
  watchers.forEach(fn => { try { fn(msg); } catch {} });
});

/* ── 相册 ── */
function readEnvelope() {
  let raw;
  try { raw = localStorage.getItem(key(K_ALBUMS)); } catch { return { exists: false, items: [], at: 0 }; }
  if (raw == null) return { exists: false, items: [], at: 0 };

  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    return { exists: true, items: [], at: 0, corrupted: true };
  }

  const list = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.items) ? parsed.items
      : [];
  const legacy = Array.isArray(parsed);

  const seen = new Set();
  const items = [];
  let dropped = 0;
  for (const row of list) {
    const a = normalizeAlbum(row);
    if (!a || seen.has(a.id)) { dropped++; continue; }
    seen.add(a.id);
    items.push(a);
  }
  return { exists: true, items, at: +parsed?.at || 0, legacy, dropped, corrupted: false };
}

/**
 * 读取相册。exists=false 表示「这个账号从来没有数据」，
 * 与「有数据但被删空了」是两件事——前者才允许灌示例。
 */
export function loadAlbums() {
  const env = readEnvelope();
  legacyFlag = !!env.legacy;
  corruptFlag = !!env.corrupted;
  prevAlbums = new Map(env.items.map(a => [a.id, clone(a)]));
  if (env.legacy) writeAlbums(env.items, false);
  return env;
}

/* 内容签名：忽略 rev/at/mt 这些"元数据"，只比真正的字段 */
const clone = a => JSON.parse(JSON.stringify(a));
const signature = a => JSON.stringify({ ...a, rev: 0, at: 0, mt: {} });

const MT_KEYS = ['name', 'nameEn', 'coord', 'date', 'note', 'memoir', 'accent', 'coverId', 'keyHash', 'geo'];

function changedMt(prev, next) {
  if (!prev) return [];
  const out = [];
  for (const k of MT_KEYS) {
    if (k === 'geo') {
      if ((prev.lat ?? null) !== (next.lat ?? null) || (prev.lng ?? null) !== (next.lng ?? null)) out.push('geo');
      continue;
    }
    if (JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null)) out.push(k);
  }
  return out;
}

function writeAlbums(items, bump) {
  const now = Date.now();
  const out = [];
  const seen = new Set();

  for (const raw of items || []) {
    const a = normalizeAlbum(raw);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);

    if (bump) {
      const old = prevAlbums.get(a.id);
      if (old && signature(old) !== signature(a)) {
        a.rev = (old.rev | 0) + 1;
        a.at = now;
        /* 记下"哪些字段变了"，字段级合并靠它 */
        const touched = changedMt(old, a);
        a.mt = { ...(old.mt || {}) };
        touched.forEach(k => { a.mt[k] = now; });
      } else if (!old) {
        /* 新条目：至少是第 1 版，时间取创建时间或当下 */
        a.rev = Math.max(a.rev, 1);
        if (!a.at) a.at = a.createdAt || now;
      }
    }
    out.push(a);
  }

  const body = JSON.stringify({ v: SCHEMA, at: now, items: out });
  try {
    localStorage.setItem(key(K_ALBUMS), body);
  } catch (e) {
    return { ok: false, error: e, items: out };
  }

  prevAlbums = new Map(out.map(a => [a.id, clone(a)]));
  corruptFlag = false;
  if (bump) {
    const m = readMeta();
    m.dirty.albums = now;
    writeMeta();
  }
  return { ok: true, items: out };
}

/**
 * 保存相册。
 * bump=true 时自动为「内容真的变了」的条目 +1 rev 并盖时间戳，
 * 调用方不需要在每个编辑点手写 rev++。
 */
export function saveAlbums(items, { bump = true } = {}) {
  const res = writeAlbums(items, bump);
  if (res.ok) announce('albums');
  return res;
}

let saveTimer = 0;
export function scheduleSaveAlbums(getItems, delay = 120) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveAlbums(getItems()), delay);
}

/* ── 墓碑 ── */
/**
 * 留墓碑。pushed=true 表示云端本来就有这条删除记录（拉取时学到的），
 * 不需要再推一次；本地主动删除则 pushed=false，等下一轮同步送上去。
 *
 * 墓碑不随推送成功而删除：本地必须一直记得"这条被删过"，
 * 否则另一台设备（或一条更晚的旧副本）推上来时就判断不出该不该复活它。
 * 45 天后由 pruneTombstones 统一清掉。
 */
export function tombstone(kind, id, rev = 0, { pushed = false } = {}) {
  if (!isId(id)) return;
  const m = readMeta();
  const table = kind === 'album' ? m.tomb.albums : m.tomb.photos;
  table[id] = { at: Date.now(), rev: Math.max(0, rev | 0), pushedAt: pushed ? Date.now() : 0 };
  if (kind === 'album') m.dirty.albums = Date.now();
  else m.dirty.photos[id] = Date.now();
  writeMeta();
  announce('meta');
}

/* 还没送到云端的墓碑 */
export function unpushedTombstones() {
  const m = readMeta();
  const pick = table => Object.entries(table)
    .filter(([, t]) => !t.pushedAt)
    .reduce((acc, [id, t]) => { acc[id] = t; return acc; }, {});
  return { albums: pick(m.tomb.albums), photos: pick(m.tomb.photos) };
}

export function markTombstonesPushed(kind, ids = []) {
  const m = readMeta();
  const table = kind === 'album' ? m.tomb.albums : m.tomb.photos;
  let n = 0;
  for (const id of ids) {
    if (table[id] && !table[id].pushedAt) { table[id].pushedAt = Date.now(); n++; }
  }
  if (n) writeMeta();
  return n;
}

export function clearTombstones(kind, ids) {
  const m = readMeta();
  const table = kind === 'album' ? m.tomb.albums : m.tomb.photos;
  let hit = 0;
  for (const id of ids || []) {
    if (table[id]) { delete table[id]; hit++; }
  }
  if (hit) { writeMeta(); announce('meta'); }
  return hit;
}

export function pruneTombstones(ttl = TOMB_TTL) {
  const m = readMeta();
  const cut = Date.now() - ttl;
  let n = 0;
  [m.tomb.albums, m.tomb.photos].forEach(t => {
    Object.keys(t).forEach(id => { if (t[id].at < cut) { delete t[id]; n++; } });
  });
  if (n) writeMeta();
  return n;
}

/* ── 脏标记（未上云的改动） ── */
export function markDirty(kind, id) {
  const m = readMeta();
  if (kind === 'album') m.dirty.albums = Date.now();
  else if (kind === 'settings') m.dirty.settings = Date.now();
  else if (kind === 'photo' && isId(id)) m.dirty.photos[id] = Date.now();
  writeMeta();
}

export function clearDirty(kind, ids = []) {
  const m = readMeta();
  if (kind === 'album') m.dirty.albums = 0;
  else if (kind === 'settings') m.dirty.settings = 0;
  else if (kind === 'photo') ids.forEach(id => { delete m.dirty.photos[id]; });
  writeMeta();
}

export function pending() {
  const m = readMeta();
  return {
    albums: !!m.dirty.albums,
    photos: Object.keys(m.dirty.photos),
    settings: !!m.dirty.settings,
    tombstones: {
      albums: Object.keys(m.tomb.albums),
      photos: Object.keys(m.tomb.photos)
    }
  };
}

/* ── 照片（IndexedDB） ── */
let dbCache = { name: '', p: null };

function openDB() {
  const name = dbName();
  if (dbCache.name !== name) dbCache = { name, p: null };
  if (dbCache.p) return dbCache.p;

  dbCache.p = new Promise((res, rej) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      let store;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        store = d.createObjectStore(DB_STORE, { keyPath: 'id' });
      } else {
        store = req.transaction.objectStore(DB_STORE);
      }
      if (!store.indexNames.contains('landmarkId')) {
        store.createIndex('landmarkId', 'landmarkId', { unique: false });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { dbCache.p = null; rej(req.error); };
    req.onblocked = () => console.warn('[store] IndexedDB 升级被其他标签页阻塞');
  });
  return dbCache.p;
}

/**
 * 列出照片。默认只返回元数据。
 *
 * 为什么不连 blob 一起返回：Blob 是磁盘句柄，几百张一起捧着不会立刻爆，
 * 但一旦被 `URL.createObjectURL` 用在网格里，浏览器会为每张图保留解码后的
 * 位图（1280×800 ≈ 4 MB），500 张就是 2 GB —— 页面会被系统直接杀掉。
 * 所以启动只读元数据，原图按需（大图 / 导出 / 上传）单独取。
 */
export async function allPhotos({ blobs = false } = {}) {
  const d = await openDB();
  const rows = await new Promise((res, rej) => {
    const q = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    q.onsuccess = () => res(q.result || []);
    q.onerror = () => rej(q.error);
  });

  const out = [];
  let dropped = 0;
  for (const row of rows) {
    const p = normalizePhoto(row);
    if (!p) { dropped++; continue; }
    p.hasBlob = row.blob instanceof Blob;
    p.blob = blobs && p.hasBlob ? row.blob : null;
    out.push(p);
  }
  if (dropped) console.warn('[store] 丢弃无法识别的照片记录', dropped);
  return out;
}

/** 按 id 取原图。找不到或不是 Blob 时返回 null。 */
export async function getPhotoBlob(id) {
  if (!isId(id)) return null;
  const d = await openDB();
  const row = await new Promise((res, rej) => {
    const q = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => rej(q.error);
  });
  return row && row.blob instanceof Blob ? row.blob : null;
}

/**
 * 写一条照片记录。
 *
 * 关键细节：调用方现在只持有元数据（没有 blob），如果直接 put 整条记录，
 * `blob` 字段会被写成 undefined —— 下一次打开就"原图丢了"。
 * 所以没带 blob 时先把库里那条读出来，把原图接回去。
 */
export async function putPhoto(rec) {
  const p = normalizePhoto(rec);
  if (!p) throw new Error('bad_photo');
  const incoming = rec?.blob instanceof Blob ? rec.blob : null;

  const d = await openDB();
  await new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, 'readwrite');
    const st = t.objectStore(DB_STORE);
    const get = st.get(p.id);
    get.onsuccess = () => {
      const old = get.result;
      p.blob = incoming || (old && old.blob instanceof Blob ? old.blob : null);
      p.hasBlob = !!p.blob;
      st.put(p);
    };
    get.onerror = () => rej(get.error);
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error || new Error('idb_put_failed'));
  });
  announce('photos');
  return p;
}

export async function delPhotos(ids = []) {
  const list = (ids || []).filter(isId);
  if (!list.length) return 0;
  const d = await openDB();
  await new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, 'readwrite');
    const st = t.objectStore(DB_STORE);
    list.forEach(id => st.delete(id));
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  });
  announce('photos');
  return list.length;
}

/**
 * 整理照片库（显式调用，不自动跑）：
 *   · 无法通过契约的记录（坏类型、缺 id）
 *   · 所属相册已不存在的孤儿
 * 返回删了多少、留了多少。相册本身不动。
 */
export async function repairPhotos(albumIds) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, 'readwrite');
    const st = t.objectStore(DB_STORE);
    const req = st.openCursor();
    let removed = 0, kept = 0;

    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const p = normalizePhoto(cur.value);
      const orphan = p && albumIds && !albumIds.has(p.landmarkId);
      if (!p || orphan) { cur.delete(); removed++; }
      else kept++;
      cur.continue();
    };
    t.oncomplete = () => { if (removed) announce('photos'); res({ removed, kept }); };
    t.onerror = () => rej(t.error);
  });
}

export async function delPhotosOfAlbum(albumId) {
  if (!isId(albumId)) return 0;
  const d = await openDB();
  return new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, 'readwrite');
    const idx = t.objectStore(DB_STORE).index('landmarkId');
    const req = idx.openCursor(IDBKeyRange.only(albumId));
    let n = 0;
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      cur.delete();
      n++;
      cur.continue();
    };
    t.oncomplete = () => { announce('photos'); res(n); };
    t.onerror = () => rej(t.error);
  });
}

/* ── 体检 ── */
export async function health({ albums = [], photos = [] } = {}) {
  const issues = [];
  const albumIds = new Set(albums.map(a => a.id));
  const photoIds = new Set();

  const dupAlbums = albums.length - albumIds.size;
  if (dupAlbums > 0) issues.push({ code: 'dup_album', level: 'error', n: dupAlbums });

  let orphans = 0, badSize = 0, noSource = 0;
  for (const p of photos) {
    if (photoIds.has(p.id)) issues.push({ code: 'dup_photo', level: 'warn', n: 1, id: p.id });
    photoIds.add(p.id);
    if (!albumIds.has(p.landmarkId)) orphans++;
    if (!(p.w > 0 && p.h > 0)) badSize++;
    if (!p.hasBlob && !p.blob && !p.remote) noSource++;
  }
  if (orphans) issues.push({ code: 'orphan_photo', level: 'warn', n: orphans });
  if (badSize) issues.push({ code: 'bad_size', level: 'error', n: badSize });
  if (noSource) issues.push({ code: 'no_source', level: 'info', n: noSource });

  if (corruptFlag) issues.push({ code: 'store_corrupt', level: 'error', n: 1 });

  const coverMiss = albums.filter(a => a.coverId && !photoIds.has(a.coverId)).length;
  if (coverMiss) issues.push({ code: 'cover_missing', level: 'info', n: coverMiss });

  let quota = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) quota = { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {}

  const m = readMeta();
  const stats = {
    schema: SCHEMA,
    legacy: legacyFlag,
    corrupted: corruptFlag,
    albums: albums.length,
    photos: photos.length,
    tombstones: Object.keys(m.tomb.albums).length + Object.keys(m.tomb.photos).length,
    pending: (m.dirty.albums ? 1 : 0) + Object.keys(m.dirty.photos).length + (m.dirty.settings ? 1 : 0),
    syncedAt: m.syncedAt,
    quota
  };

  return { ok: issues.filter(i => i.level === 'error').length === 0, issues, stats };
}

export function limits() { return LIMITS; }
export { SCHEMA };
