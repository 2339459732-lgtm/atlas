/* ══════════════════════════════════════════════════════════════════
   cloud.js — 云端同步（WorkBuddy Cloud Service）

   身份用 WorkBuddy 账号（OAuth），数据落在 atlas_albums / atlas_photos
   两张表，照片原图放在对象存储的 users/<uid>/photos/ 下。
   RLS 以 auth.uid() 为界，前端永远不发送 owner_id。

   设计取舍：
   · 只在这台机器上用过的人，本地账号（assets/accounts.js）照旧可用；
     云同步是叠加层，不是替换——没登录云也能离线用。
   · 拉取时以云端为准（跨设备的事实源），本地独有的条目推上去。
   · 缩略图随元数据一起拉，原图按需下载，避免首次登录就下几百张。
   ══════════════════════════════════════════════════════════════════ */

/* 应用激活时下发的 publicConfig，原样写死在这里（纯静态站点没有服务端可传） */
const CFG = {
  endpoint: 'https://atlas-gallery.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_l0wwPqEszeiVMFjenfHdwT_WtB8XdT5HZ94wVcwIpck7NGYW4CTI04P'
};

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
  return h === 'atlas-gallery.app.workbuddy.host'
    || h.endsWith('.workbuddy.host')
    || h === 'localhost' || h === '127.0.0.1';
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

export async function pullAll() {
  if (!client || !session) return { albums: [], photos: [] };
  const [a, p] = await Promise.all([
    client.database.from('atlas_albums').select('local_id, payload, updated_at').order('updated_at', { ascending: true }),
    client.database.from('atlas_photos').select('local_id, album_local_id, name, w, h, taken_at, thumb, remote_path, updated_at')
      .order('taken_at', { ascending: true })
  ]);
  if (a.error) throw a.error;
  if (p.error) throw p.error;
  return { albums: a.data || [], photos: p.data || [] };
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

export async function deletePhotos(ids) {
  if (!client || !session || !ids.length) return;
  const { error } = await client.database.from('atlas_photos').delete().in('local_id', ids);
  if (error) throw error;
}

export async function deleteAlbum(localId) {
  if (!client || !session) return;
  const { error } = await client.database.from('atlas_albums').delete().eq('local_id', localId);
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

export async function downloadPhotoBlob(path) {
  if (!client || !session || !path) return null;
  const { data, error } = await client.storage.download(path);
  if (error) throw error;
  return data instanceof Blob ? data : null;
}
