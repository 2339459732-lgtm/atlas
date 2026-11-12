/* ══════════════════════════════════════════════════════════════════
   cloud.js — 云端同步（WorkBuddy Cloud Service）

   身份用 WorkBuddy 账号（OAuth），数据落在 atlas_albums / atlas_photos
   两张表，照片原图放在对象存储的 users/<uid>/photos/ 下。
   RLS 以 auth.uid() 为界，前端永远不发送 owner_id。

   设计取舍：
   · 只在这台机器上用过的人，本地账号（assets/accounts.js）照旧可用；
     云同步是叠加层，不是替换——没登录云也能离线用。
   · 拉取不是「云端覆盖本地」，而是按 rev/updated_at 合并：
     本地改得更晚的留在本地并在下一轮推上去，云端更晚的才落地。
   · 删除是墓碑（deleted=true + rev+1），不是物理删——否则旧设备
     一推就把条目复活了。墓碑保留 45 天后由 store 清理。
   · 缩略图随元数据一起拉，原图按需下载，避免首次登录就下几百张。
   ══════════════════════════════════════════════════════════════════ */

import { APP, CLOUD_CFG } from './config.js';

/* 端点与密钥集中在 config.js：换环境不改这个文件 */
const CFG = CLOUD_CFG;

let client = null;
let session = null;
let ready = false;
let reason = 'init';
const listeners = new Set();

const emit = () => listeners.forEach(fn => { try { fn(); } catch {} });

/* 数据面按 Origin 精确匹配：只有这套域名（以及本地调试）能真的调通。
   GitHub Pages 上 SDK 照样能初始化，但任何请求都会被拒，
   所以这里直接按域名判定可用性，避免给访客一个点不通的按钮。 */
function originBound() {
  const h = location.hostname;
  if (APP.cloud.allowLocalhost && (h === 'localhost' || h === '127.0.0.1')) return true;
  return APP.cloud.hosts.some(s => h === s || h.endsWith('.' + s));
}

export function cloudAvailable() { return ready && originBound(); }
export function cloudUser() {
  if (!session?.user) return null;
  const u = session.user;
  return { id: u.id, name: u.name || u.nickname || u.email || '你' };
}
export function cloudReason() { return reason; }
export function onCloudChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* OAuth 回来时 URL 上会挂 code/state，登录成功后要抹掉，否则刷新会重放 */
function stripCallback() {
  const url = new URL(location.href);
  ['code', 'state', 'provider', 'error', 'error_description'].forEach(k => url.searchParams.delete(k));
  const q = url.searchParams.toString();
  history.replaceState({}, '', url.pathname + (q ? '?' + q : '') + url.hash);
}

export async function initCloud() {
  const g = window.WorkBuddyCloud;
  if (!g || typeof g.createWorkBuddyCloud !== 'function') { reason = 'sdk-missing'; return false; }
  try {
    client = g.createWorkBuddyCloud(CFG);

    const url = new URL(location.href);
    if (url.searchParams.has('code') || url.searchParams.has('error')) {
      try {
        await client.auth.handleWorkBuddyCallback();
      } catch (e) {
        console.warn('[cloud] callback failed', e);
        reason = 'callback-failed';
      }
      stripCallback();
    }

    const { data } = await client.auth.getSession();
    session = data || null;
    client.auth.onAuthStateChange((ev, s) => { session = s || null; emit(); });
    ready = true;
    reason = 'ok';
    emit();
    return true;
  } catch (e) {
    console.warn('[cloud] init failed', e);
    reason = 'init-failed';
    return false;
  }
}

export async function signInCloud() {
  if (!client) return false;
  const back = new URL(location.href);
  back.pathname = new URL('.', location.href).pathname;
  back.search = '';
  back.hash = '';
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'workbuddy', redirectTo: back.toString() });
  if (error) throw error;
  location.assign(data.url);
  return true;
}

export async function signOutCloud() {
  if (!client) return;
  try { await client.auth.signOut(); } catch {}
  session = null;
  emit();
}

/* ── 数据 ── */

/* updated_at 是服务端的 timestamptz，比较新旧时用毫秒整数更稳。
   rev 由客户端维护，updated_at_ms 只作为同 rev 时的次序依据。 */
const withMs = rows => (rows || []).map(r => ({
  ...r,
  updated_at_ms: Date.parse(r.updated_at) || 0
}));

export async function pullAll() {
  if (!client || !session) return { albums: [], photos: [] };
  const [a, p] = await Promise.all([
    client.database.from('atlas_albums')
      .select('local_id, payload, rev, deleted, updated_at')
      .order('updated_at', { ascending: true }),
    client.database.from('atlas_photos')
      .select('local_id, album_local_id, name, w, h, taken_at, thumb, remote_path, exif, rev, deleted, updated_at')
      .order('taken_at', { ascending: true })
  ]);
  if (a.error) throw a.error;
  if (p.error) throw p.error;
  return { albums: withMs(a.data), photos: withMs(p.data) };
}

export async function pushAlbums(rows) {
  if (!client || !session || !rows.length) return;
  const { error } = await client.database
    .from('atlas_albums')
    .upsert(rows, { onConflict: 'owner_id,local_id' });
  if (error) throw error;
}

export async function pushPhotos(rows) {
  if (!client || !session || !rows.length) return;
  const { error } = await client.database
    .from('atlas_photos')
    .upsert(rows, { onConflict: 'owner_id,local_id' });
  if (error) throw error;
}

/* 删除一律走「墓碑」：把行标记成 deleted 并抬 rev，而不是物理删。
   物理删的话，另一台设备下次把自己的旧副本推上来，条目就复活了。 */
export async function deletePhotos(ids) {
  if (!client || !session || !ids.length) return;
  const { error } = await client.database.from('atlas_photos')
    .update({ deleted: true })
    .in('local_id', ids);
  if (error) throw error;
}

export async function deleteAlbum(localId) {
  if (!client || !session) return;
  const { error } = await client.database.from('atlas_albums')
    .update({ deleted: true })
    .eq('local_id', localId);
  if (error) throw error;
}

/* 原图上传：路径由 SDK 的 userPath 生成，不接受外部拼串 */
export async function uploadPhotoBlob(uid, localId, blob) {
  if (!client || !session) return null;
  const path = client.storage.userPath(uid, `photos/${localId}.jpg`);
  const { error } = await client.storage.upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    cacheControl: '3600',
    upsert: true
  });
  if (error) throw error;
  return path;
}

/* 墓碑推送成功后清掉对象存储里的原图。失败不影响下次同步，
   最多留一个孤儿文件，不会让数据变得不一致。 */
export async function removePhotoBlob(uid, localId) {
  if (!client || !session || !uid) return;
  const path = client.storage.userPath(uid, `photos/${localId}.jpg`);
  const { error } = await client.storage.remove([path]);
  if (error) throw error;
}

export async function downloadPhotoBlob(path) {
  if (!client || !session || !path) return null;
  const { data, error } = await client.storage.download(path);
  if (error) throw error;
  return data instanceof Blob ? data : null;
}
