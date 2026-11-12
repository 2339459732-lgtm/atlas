/* ══════════════════════════════════════════════════════════════════
   model.js — 数据契约（唯一真相）

   四条写入路径共用这一份定义：
     ① localStorage 里的地标     ② IndexedDB 里的照片
     ③ 云端 atlas_albums/photos  ④ 加密备份的导入导出
   任何一条路径都不允许自己拼字段、自己截断、自己判空。
   这样做的好处很实际：改一个上限只改这里；导入一份坏文件不会
   把 NaN 塞进布局；云端回来的行和本地的行能直接比较新旧。

   约定：
   · 时间一律是毫秒时间戳（0 表示未知），不用字符串排序。
   · rev 是「第几次修改」，at 是「最后一次修改的时间」。
     比较新旧先看 rev，再看 at，最后本地优先（宁可保留不删）。
   · deleted 是墓碑标记。删除不是「消失」，而是「带着更晚的时间
     留在原地」，否则另一台设备的旧副本会把它顶回来。
   ══════════════════════════════════════════════════════════════════ */

export const SCHEMA = 5;

export const LIMITS = {
  id: 64,
  name: 60,
  nameEn: 80,
  coord: 40,
  date: 40,
  note: 600,
  memoirTitle: 60,
  memoirBody: 900,
  photoName: 60,
  thumb: 600 * 1024,
  remote: 300,
  maxPx: 12000,
  maxFile: 40 * 1024 * 1024
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/* 可按字段合并的元数据。lat/lng 合成一个 geo 单元，
   避免出现"纬度来自 A、经度来自 B"的错位组合。 */
export const ALBUM_MT_FIELDS = [
  'name', 'nameEn', 'coord', 'date', 'note', 'memoir',
  'accent', 'coverId', 'geo', 'keyHash'
];
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;
const REMOTE_RE = /^users\/[A-Za-z0-9_-]{2,64}\/photos\/[A-Za-z0-9_-]{3,80}\.jpg$/;

export const isId = v => typeof v === 'string' && ID_RE.test(v);

export function newId(prefix = 'lm') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* 单行文本：控制字符换成空格，折叠空白，截断 */
function line(v, max) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* 多行文本：保留换行与制表，其余控制字符去掉，连续空行压成一行 */
function block(v, max) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function int(v, min, max, def = 0) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseCoord(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = /([\d.]+)\s*°?\s*([NS])\s*[, ]*\s*([\d.]+)\s*°?\s*([EW])/i.exec(t);
  if (m) {
    const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
    const lng = parseFloat(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    return null;
  }
  m = /(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)/.exec(t);
  if (m) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

export function fmtCoord(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
}

/* 字段修改时间表：{ name: 1700000000000, note: … } */
function normalizeMt(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const f of ALBUM_MT_FIELDS) {
    const t = int(raw[f], 0, 4e12, 0);
    if (t) out[f] = t;
  }
  return out;
}

/* ── 手记 ── */
export function normalizeMemoir(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = line(raw.t, LIMITS.memoirTitle);
  const b = block(raw.b, LIMITS.memoirBody);
  if (!t && !b) return null;
  const m = raw.m == null || raw.m === '' ? null : int(raw.m, 0, 3, 0);
  return { t: t || '', b: b || '', m, at: int(raw.at, 0, 4e12) };
}

/* ── 地标 / 相册 ── */
export function normalizeAlbum(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const lat = finite(raw.lat), lng = finite(raw.lng);
  let geo = (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
    ? { lat, lng }
    : parseCoord(raw.coord || '');

  const id = isId(raw.id) ? raw.id : newId('lm');
  const coord = line(raw.coord, LIMITS.coord) || (geo ? fmtCoord(geo.lat, geo.lng) : '');

  return {
    id,
    name: line(raw.name, LIMITS.name) || opts.untitled || '未命名',
    nameEn: line(raw.nameEn, LIMITS.nameEn),
    coord,
    date: line(raw.date, LIMITS.date),
    note: block(raw.note, LIMITS.note),
    memoir: normalizeMemoir(raw.memoir),
    accent: HEX6.test(raw.accent || '') ? String(raw.accent).toLowerCase() : (opts.accent || '#c9a96a'),
    coverId: isId(raw.coverId) ? raw.coverId : null,
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    keyHash: SHA256.test(raw.keyHash || '') ? String(raw.keyHash).toLowerCase() : '',
    createdAt: int(raw.createdAt, 0, 4e12),
    /* 每个字段最后被改的时间，用于"两个人改了不同字段"时的合并 */
    mt: normalizeMt(raw.mt),
    rev: int(raw.rev, 0, 1e9),
    at: int(raw.at, 0, 4e12),
    deleted: raw.deleted === true
  };
}

/* 诊断用：把「被规范化悄悄修掉的东西」显式列出来，
   备份导入与云同步都用它统计「修复了几项」。 */
export function albumIssues(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object') return ['not_object'];
  if (!isId(raw.id)) out.push('bad_id');
  if (!line(raw.name, LIMITS.name)) out.push('empty_name');
  if (String(raw.name || '').length > LIMITS.name) out.push('name_truncated');
  if (raw.accent && !HEX6.test(raw.accent)) out.push('bad_accent');
  if (raw.keyHash && !SHA256.test(raw.keyHash)) out.push('bad_keyhash');
  if (raw.lat != null || raw.lng != null) {
    const la = Number(raw.lat), ln = Number(raw.lng);
    if (!(Math.abs(la) <= 90 && Math.abs(ln) <= 180)) out.push('bad_geo');
  }
  if (raw.memoir && typeof raw.memoir === 'object' && String(raw.memoir.b || '').length > LIMITS.memoirBody) {
    out.push('memoir_truncated');
  }
  return out;
}

/* ── 照片 ── */
function normalizeExif(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    camera: line(raw.camera, 60),
    f: line(raw.f, 12),
    ss: line(raw.ss, 14),
    iso: line(raw.iso, 14),
    fl: line(raw.fl, 12),
    date: line(raw.date, 20),
    ts: int(raw.ts, 0, 4e12)
  };
  Object.keys(out).forEach(k => { if (!out[k]) delete out[k]; });
  return Object.keys(out).length ? out : null;
}

function normalizeThumb(v) {
  const s = String(v || '');
  if (!s.startsWith('data:image/')) return '';
  if (s.length > LIMITS.thumb) return '';
  return s;
}

export function isRemotePath(v) {
  return typeof v === 'string' && REMOTE_RE.test(v);
}

export function normalizePhoto(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const albumId = isId(raw.landmarkId) ? raw.landmarkId
    : isId(raw.chapterId) ? raw.chapterId
      : '';
  const id = isId(raw.id) ? raw.id : newId('ph');

  const dim = (v, def) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(LIMITS.maxPx, n) : def;
  };
  const w = dim(raw.w, 4);
  const h = dim(raw.h, 3);

  /* 拍摄时间：优先 EXIF，其次入库时间。允许 1990 年起，
     晚于现在 1 天的视为设备时钟错误，退回当前时间。 */
  const now = Date.now();
  let t = int(raw.t, 0, now + 864e5, 0);
  if (!t) t = now;

  return {
    id,
    landmarkId: albumId,
    name: line(raw.name, LIMITS.photoName) || (opts.untitled || '未命名'),
    w, h, t,
    thumb: normalizeThumb(raw.thumb),
    remote: isRemotePath(raw.remote) ? raw.remote : null,
    exif: normalizeExif(raw.exif),
    rev: int(raw.rev, 0, 1e9),
    at: int(raw.at, 0, 4e12),
    deleted: raw.deleted === true
  };
}

export function photoIssues(raw, albumIds) {
  const out = [];
  if (!raw || typeof raw !== 'object') return ['not_object'];
  if (!isId(raw.id)) out.push('bad_id');
  if (!isId(raw.landmarkId) && !isId(raw.chapterId)) out.push('no_album');
  if (albumIds && !albumIds.has(raw.landmarkId || raw.chapterId)) out.push('orphan');
  const w = Number(raw.w), h = Number(raw.h);
  if (!(w > 0 && h > 0)) out.push('bad_size');
  if (raw.thumb && !String(raw.thumb).startsWith('data:image/')) out.push('bad_thumb');
  if (raw.remote && !isRemotePath(raw.remote)) out.push('bad_remote');
  return out;
}

/* ── 合并 ──
   LWW（last-write-wins），但比较顺序是 rev → at → 本地。
   墓碑本质上只是一条「更新更晚的记录」，所以不需要单独逻辑。 */
export function pickNewer(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  /* 删除优先：墓碑在保留期内压过任何"还活着"的副本。
     否则离线久一点的设备一推，删掉的相册就复活了。
     真要恢复，走"导入备份"——那是明确的用户意图，会清掉墓碑。 */
  if (local.deleted !== remote.deleted) return local.deleted ? local : remote;

  const lr = local.rev | 0, rr = remote.rev | 0;
  if (lr !== rr) return lr > rr ? local : remote;
  const la = local.at | 0, ra = remote.at | 0;
  if (la !== ra) return la > ra ? local : remote;
  /* rev/at 完全相同但内容不同：用序列化结果做确定性选择，
     否则两台设备都会保留自己那份，永远合不到一起。 */
  const ls = JSON.stringify(local), rs = JSON.stringify(remote);
  if (ls === rs) return local;
  return ls < rs ? local : remote;
}

/**
 * 地标合并：先按整条记录选基准（rev → at → 内容哈希），
 * 再逐字段用 mt 覆盖——A 改了名字、B 改了手记，两边都能留住。
 */
export function mergeAlbums(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  if (local.deleted !== remote.deleted) return local.deleted ? local : remote;

  const base = pickNewer(local, remote);
  const other = base === local ? remote : local;
  if (!other) return base;

  const out = { ...base };
  const mt = { ...(base.mt || {}) };
  const baseMt = base.mt || {};
  const otherMt = other.mt || {};

  const take = (key, field) => {
    const to = otherMt[key] | 0;
    const tb = baseMt[key] | 0;
    if (to > tb) {
      out[field] = other[field];
      mt[key] = to;
      return true;
    }
    return false;
  };

  ['name', 'nameEn', 'coord', 'date', 'note', 'memoir', 'accent', 'coverId', 'keyHash']
    .forEach(f => take(f, f));

  /* 经纬度作为整体替换，避免一半新一半旧 */
  if ((otherMt.geo | 0) > (baseMt.geo | 0)) {
    out.lat = other.lat;
    out.lng = other.lng;
    mt.geo = otherMt.geo;
  }

  out.mt = mt;
  out.rev = Math.max(local.rev | 0, remote.rev | 0);
  out.at = Math.max(local.at | 0, remote.at | 0);
  return out;
}

/* 只比"内容字段"，用来判断合并后的记录是否与云端行不同（需要回推） */
const CONTENT_FIELDS = ['name', 'nameEn', 'coord', 'date', 'note', 'memoir', 'accent', 'coverId', 'lat', 'lng', 'keyHash'];

export function sameAlbumContent(a, b) {
  if (!a || !b) return false;
  return CONTENT_FIELDS.every(f => JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

export function mergeAlbumCollections(local, remote) {
  const map = new Map((local || []).map(x => [x.id, x]));
  const conflicts = [];
  for (const r of remote || []) {
    if (!r || !isId(r.id)) continue;
    const l = map.get(r.id);
    if (!l) { map.set(r.id, r); continue; }
    const win = mergeAlbums(l, r);
    if (win !== l) conflicts.push({ id: r.id, kept: 'merged' });
    map.set(r.id, win);
  }
  return { items: [...map.values()], conflicts };
}

export function mergeCollections(local, remote) {
  const map = new Map((local || []).map(x => [x.id, x]));
  const conflicts = [];
  for (const r of remote || []) {
    if (!r || !isId(r.id)) continue;
    const l = map.get(r.id);
    if (!l) { map.set(r.id, r); continue; }
    const win = pickNewer(l, r);
    if (win !== l) conflicts.push({ id: r.id, kept: 'remote', localRev: l.rev | 0, remoteRev: r.rev | 0 });
    map.set(r.id, win);
  }
  return { items: [...map.values()], conflicts };
}

/* 线上行 ↔ 本地记录的唯一转换点 */
export function albumFromRow(row) {
  if (!row || !row.local_id) return null;
  return normalizeAlbum({ ...(row.payload || {}), id: row.local_id, rev: row.rev, at: row.updated_at_ms || 0, deleted: row.deleted });
}

export function photoFromRow(row) {
  if (!row || !row.local_id) return null;
  return normalizePhoto({
    id: row.local_id,
    landmarkId: row.album_local_id,
    name: row.name,
    w: row.w, h: row.h,
    t: row.taken_at,
    thumb: row.thumb,
    remote: row.remote_path,
    exif: row.exif,
    rev: row.rev,
    at: row.updated_at_ms || 0,
    deleted: row.deleted
  });
}

/* 本地记录 → 线上行。只在这里决定「哪些字段上云」，
   避免 main.js 和 cloud.js 各写一份字段清单再慢慢跑偏。 */
export function albumToRow(a) {
  return {
    local_id: a.id,
    payload: {
      name: a.name, nameEn: a.nameEn, coord: a.coord, date: a.date,
      note: a.note, memoir: a.memoir, accent: a.accent, coverId: a.coverId,
      lat: a.lat, lng: a.lng, keyHash: a.keyHash, createdAt: a.createdAt,
      /* 字段时钟随 payload 走：换设备后才能做字段级合并 */
      mt: a.mt && Object.keys(a.mt).length ? a.mt : undefined
    },
    rev: a.rev | 0,
    deleted: a.deleted === true
  };
}

export function photoToRow(p) {
  const row = {
    local_id: p.id,
    album_local_id: p.landmarkId,
    name: p.name,
    w: p.w, h: p.h, taken_at: p.t,
    thumb: p.thumb || null,
    exif: p.exif || null,
    rev: p.rev | 0,
    deleted: p.deleted === true
  };
  /* 本地还没有原图/缩略图时不要把这些列写成 null：
     upsert 省略的列在冲突更新时保持原值，避免把另一台设备
     已经上传好的 remote_path / thumb 抹掉。 */
  if (p.remote) row.remote_path = p.remote;
  return row;
}
