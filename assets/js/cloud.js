/* ══════════════════════════════════════════════════════════════════
   cloud.js — 云端同步（WorkBuddy Cloud Service）

   身份：ATLAS 云账号 = 邮箱验证码注册/登录（WorkBuddy 云认证）。
   数据：atlas_albums / atlas_photos 两张表 + atlas_settings 单行文档，
        照片原图放在对象存储的 users/<uid>/photos/ 下。
   RLS 以 auth.uid() 为界，前端永远不发送 owner_id。

   设计取舍：
   · 云端是主路径，本机账号与离线模式是降级路径：
     配置异常（域名未绑定 / SDK 加载失败 / 断网 / 令牌失效）时
     一律降级为「本地可用 + 明确提示」，绝不静默。
   · 拉取不是「云端覆盖本地」，而是按 rev/updated_at 合并：
     本地改得更晚的留在本地并在下一轮推上去，云端更晚的才落地。
   · 删除是墓碑（deleted=true + rev+1），不是物理删——否则旧设备
     一推就把条目复活了。墓碑保留期由 store 管理。
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

/* 数据面按 Origin 精确匹配：只有绑定的域名（以及本地调试）能真的调通。
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
  return {
    id: u.id,
    name: u.name || u.nickname || (u.email ? u.email.split('@')[0] : '你'),
    email: u.email || ''
  };
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

/* ── ATLAS 云账号：邮箱验证码，注册与登录同一入口 ── */

/* 待验证的挑战：{ email, verificationId, isExistingUser }。
   提交时只消费已保存的挑战，绝不在提交里重发验证码。 */
let pendingOtp = null;

export function otpPending() {
  return pendingOtp ? { email: pendingOtp.email } : null;
}

export async function sendEmailCode(email) {
  if (!client) throw new Error('sdk_not_ready');
  const mail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw new Error('bad_email');
  const sent = await client.auth.sendOtp({ email: mail });
  if (sent.error) throw sent.error;
  pendingOtp = {
    email: mail,
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser
  };
  return { isNew: !sent.data.isExistingUser };
}

export async function submitEmailOtp(email, code) {
  if (!client) throw new Error('sdk_not_ready');
  const p = pendingOtp;
  const mail = String(email || '').trim();
  if (!p || p.email !== mail) throw new Error('need_code');
  const token = String(code || '').trim();
  if (!/^\d{6}$/.test(token)) throw new Error('bad_code');
  const completed = await client.auth.verifyOtp({
    email: p.email,
    verificationId: p.verificationId,
    isExistingUser: p.isExistingUser,
    token
  });
  if (completed.error) throw completed.error;
  const wasNew = !p.isExistingUser;
  pendingOtp = null;
  /* verifyOtp 完成后 SDK 已持有会话（注册/登录都建立会话）：
     这里读一次最新的会话并广播，登录态随之持久化。 */
  try {
    const { data } = await client.auth.getSession();
    session = data || null;
  } catch { session = null; }
  emit();
  return { isNew: wasNew, email: mail };
}

export function dropOtp() { pendingOtp = null; }

/* ── 会话：持久化由 SDK 负责；这里只做「保证可用」与「手动刷新」 ── */

/** 取会话；临近过期 SDK 会自动刷新。令牌失效时尝试一次强制刷新，
    仍失败才把会话置空——配置异常的最后一层防御。 */
export async function ensureSession() {
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getSession();
    if (!error && data) { session = data; return data; }
    const r = await client.auth.refreshSession();
    if (!r.error && r.data) { session = r.data; emit(); return r.data; }
  } catch { /* 网络失败等：保留现有 session，由上层按 offline 处理 */ }
  if (!session) return null;
  return session;
}

export async function refreshCloudSession() {
  if (!client) return null;
  const { data, error } = await client.auth.refreshSession();
  if (error || !data) return null;
  session = data;
  emit();
  return data;
}

/* WorkBuddy OAuth 登录（备用入口，当前界面不展示） */
export async function signInCloud() {
  if (!client) return false;
  const back = new URL(location.href);
  back.pathname = new URL('.', location.href).pathname;
  /* 只去掉 OAuth 自己的参数，保留 sharecode 等站点参数：
     应用域名靠 sharecode 放行，回调若丢它会 403。 */
  ['code', 'state', 'provider', 'error', 'error_description'].forEach(k => back.searchParams.delete(k));
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
  pendingOtp = null;
  emit();
}

/* ── 数据 ── */

/* 网络调用一律加超时：没有它，一次挂起的请求会让 syncNow 的 running
   永远为 true，之后所有同步（包括手动"立即同步"）都被静默挡掉。 */
const NET_TIMEOUT = 25000;
function guard(p, label, ms = NET_TIMEOUT) {
  let timer = 0;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => {
      const e = new Error('network_timeout');
      e.code = 'timeout';
      e.label = label;
      rej(e);
    }, ms);
  });
  return Promise.race([Promise.resolve(p), t]).finally(() => clearTimeout(timer));
}

/* 分页：PostgREST 默认每次最多返回 1000 行。不分页的话，
   第 1001 张照片之后的内容永远不会出现在新设备上——
   看起来像"数据没同步"，实际是只拉了第一页。
   按 local_id 排序保证分页稳定（taken_at 会重复）。 */
const PAGE = 500;
async function fetchAll(table, cols) {
  const out = [];
  for (let from = 0; from < 200000; from += PAGE) {
    const { data, error } = await guard(
      client.database.from(table)
        .select(cols)
        .order('local_id', { ascending: true })
        .range(from, from + PAGE - 1),
      table
    );
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/* updated_at 是服务端的 timestamptz，比较新旧时用毫秒整数更稳。
   rev 由客户端维护，updated_at_ms 只作为同 rev 时的次序依据。 */
const withMs = rows => (rows || []).map(r => ({
  ...r,
  updated_at_ms: Date.parse(r.updated_at) || 0
}));

export async function pullAll() {
  if (!client || !session) return { albums: [], photos: [] };
  const [a, p] = await Promise.all([
    fetchAll('atlas_albums', 'local_id, payload, rev, deleted, updated_at'),
    fetchAll('atlas_photos', 'local_id, album_local_id, name, w, h, taken_at, thumb, remote_path, exif, rev, deleted, updated_at')
  ]);
  return { albums: withMs(a), photos: withMs(p) };
}

/* 站点设置 + 账号资料：单行文档，按 rev → updated_at 合并 */
export async function pullSettings() {
  if (!client || !session) return null;
  const { data, error } = await guard(
    client.database.from('atlas_settings').select('payload, rev, updated_at').limit(1),
    'atlas_settings'
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { ...row, updated_at_ms: Date.parse(row.updated_at) || 0 };
}

export async function pushSettings(payload, rev) {
  if (!client || !session) return;
  const { error } = await guard(
    client.database.from('atlas_settings')
      .upsert([{ payload, rev: rev | 0, updated_at: new Date().toISOString() }], { onConflict: 'owner_id' }),
    'settings_push', 15000
  );
  if (error) throw error;
}

/* 写入行统一带 updated_at：rev 相同时用它裁决谁更晚（LWW）。 */
const stamp = rows => rows.map(r => ({ ...r, updated_at: new Date().toISOString() }));

export async function pushAlbums(rows) {
  if (!client || !session || !rows.length) return;
  const { error } = await guard(
    client.database.from('atlas_albums').upsert(stamp(rows), { onConflict: 'owner_id,local_id' }),
    'albums_push', 20000
  );
  if (error) throw error;
}

export async function pushPhotos(rows) {
  if (!client || !session || !rows.length) return;
  const { error } = await guard(
    client.database.from('atlas_photos').upsert(stamp(rows), { onConflict: 'owner_id,local_id' }),
    'photos_push', 20000
  );
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
  const { error } = await guard(
    client.storage.upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      cacheControl: '3600',
      upsert: true
    }),
    'photo_upload', 60000
  );
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
  const { data, error } = await guard(client.storage.download(path), 'photo_download', 45000);
  if (error) throw error;
  return data instanceof Blob ? data : null;
}
