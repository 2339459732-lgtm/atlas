/* ══════════════════════════════════════════════════════════════════
   vault.js — 加密备份。
   结构：JSON → gzip → AES-GCM(PBKDF2-SHA256, 18 万轮)。
   全部在浏览器本地完成，文件由用户自己保管。
   ══════════════════════════════════════════════════════════════════ */

/* 私钥的 SHA-256（用于本机校验，不存明文） */
export const VAULT_HASH = 'c7efaa94c1114dfc8e1d4007d5369b11ab55fa19dea1a31ccf5aabcb3cc39a55';

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sha256Hex(text) {
  if (!crypto?.subtle) return '';
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToB64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function gzip(u8) {
  if (!('CompressionStream' in window)) return { data: u8, packed: false };
  const cs = new CompressionStream('gzip');
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  return { data: new Uint8Array(await new Response(stream).arrayBuffer()), packed: true };
}

async function gunzip(u8) {
  if (!('DecompressionStream' in window)) return u8;
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 180000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* 生成备份文件内容（字符串） */
export async function makeBackup({ site, landmarks, photos, passphrase }) {
  if (!crypto?.subtle) throw new Error('当前环境不支持加密（需要 https）');
  if (!passphrase || passphrase.length < 6) throw new Error('备份口令至少 6 位');

  const shots = [];
  for (const p of photos) {
    const buf = p.blob ? new Uint8Array(await p.blob.arrayBuffer()) : null;
    shots.push({
      id: p.id, landmarkId: p.landmarkId, name: p.name,
      w: p.w, h: p.h, t: p.t, exif: p.exif || null,
      thumb: p.thumb || '', data: buf ? bytesToB64(buf) : ''
    });
  }

  const payload = { app: 'atlas', v: 1, createdAt: Date.now(), site, landmarks, photos: shots };
  const json = enc.encode(JSON.stringify(payload));
  const { data, packed } = await gzip(json);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));

  return JSON.stringify({
    app: 'atlas-vault',
    v: 1,
    packed,
    createdAt: Date.now(),
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(ct)
  });
}

/* 解析备份文件 */
export async function readBackup(text, passphrase) {
  let outer;
  try { outer = JSON.parse(text); } catch { throw new Error('不是有效的备份文件'); }
  if (outer.app !== 'atlas-vault') throw new Error('不是 ATLAS 备份文件');
  if (!passphrase) throw new Error('请输入备份口令');

  const salt = b64ToBytes(outer.salt);
  const iv = b64ToBytes(outer.iv);
  const data = b64ToBytes(outer.data);
  const key = await deriveKey(passphrase, salt);

  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch {
    throw new Error('口令不正确，无法解密');
  }

  let u8 = new Uint8Array(plain);
  if (outer.packed) {
    try { u8 = await gunzip(u8); } catch { /* 未压缩或已损坏 */ }
  }
  const payload = JSON.parse(dec.decode(u8));
  if (payload.app !== 'atlas') throw new Error('备份内容不完整');
  return payload;
}

/* 备份照片还原成 Blob */
export function photoBlob(b64) {
  if (!b64) return null;
  return new Blob([b64ToBytes(b64)], { type: 'image/jpeg' });
}
