/* ══════════════════════════════════════════════════════════════════
   main.js — 地标 = 相册。相册墙 → 相册 → 单张。
   ══════════════════════════════════════════════════════════════════ */

import { createPress, createFallbackPress } from './ink.js';
import { readExif } from './exif.js';

/* 起始四本：空相册，等你放照片进去 */
const SEED = [
  { id: 'kyoto',      name: '京都',        coord: '35.01°N 135.77°E', date: '', note: '', inks: { c: '#1B3A82', m: '#D8452C', y: '#EFC24B', k: '#161510' }, angles: [75, 15, 45, 0], seed: 1.61 },
  { id: 'reykjavik',  name: '雷克雅未克',  coord: '64.15°N 21.94°W', date: '', note: '', inks: { c: '#2C7BC4', m: '#2E6B4F', y: '#E4C558', k: '#141A18' }, angles: [45, 15, 75, 90], seed: 2.94 },
  { id: 'hongkong',   name: '香港',        coord: '22.32°N 114.17°E', date: '', note: '', inks: { c: '#E6007E', m: '#00A0B0', y: '#F5E13C', k: '#101014' }, angles: [45, 75, 0, 15], seed: 5.77 }
];

const INK_SETS = [
  { c: '#1B3A82', m: '#D8452C', y: '#EFC24B', k: '#161510' },
  { c: '#2C7BC4', m: '#2E6B4F', y: '#E4C558', k: '#141A18' },
  { c: '#B0481E', m: '#1B2E6B', y: '#DFA42A', k: '#1A1510' },
  { c: '#E6007E', m: '#00A0B0', y: '#F5E13C', k: '#101014' },
  { c: '#5C3FA8', m: '#C9432F', y: '#E8B84B', k: '#151318' },
  { c: '#1F6F5C', m: '#C64B22', y: '#E8C24A', k: '#14120E' },
  { c: '#8A2B4E', m: '#3A6B8F', y: '#E9C97A', k: '#121014' },
  { c: '#1341E0', m: '#E8402A', y: '#F2C300', k: '#12120E' }
];
const ANGLE_SETS = [[45, 75, 15, 0], [75, 15, 45, 90], [15, 45, 75, 0], [30, 60, 0, 90]];

const LS = 'atlas.landmarks.v3';
const DB_NAME = 'atlas-plates';
const DB_STORE = 'plates';
const MAX_PX = 2400;
const MAX_BYTES = 24 * 1024 * 1024;

/* ───────── 工具 ───────── */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const nextTick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* ───────── 明暗两套房间：纸不变，房间变 ───────── */
const THEME_KEY = 'atlas.theme';
let press = null;
let baker = null;

function paintPaper() {
  const cs = getComputedStyle(document.documentElement);
  const hex = (cs.getPropertyValue('--plate-paper') || '#F5F3EC').trim();
  if (press && press.setPaper) press.setPaper(hex);
  if (baker && baker.setPaper) baker.setPaper(hex);
}

function applyTheme(mode) {
  const t = mode === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const btn = document.getElementById('btn-theme');
  if (btn) btn.setAttribute('aria-pressed', String(t === 'dark'));
  paintPaper();
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  const mode = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(mode);
}

function toggleTheme() {
  const now = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = now === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme(next);
  if (albumEl.classList.contains('is-open')) {
    const list = photosOf(state.current);
    renderHero(list[0] || null, 0);
  }
}

/* ───────── IndexedDB ───────── */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const d = req.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        const s = d.createObjectStore(DB_STORE, { keyPath: 'id' });
        s.createIndex('landmarkId', 'landmarkId', { unique: false });
      } else if (e.oldVersion < 2) {
        const s = req.transaction.objectStore(DB_STORE);
        if (!s.indexNames.contains('landmarkId')) s.createIndex('landmarkId', 'landmarkId', { unique: false });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}
async function dbAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const q = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    q.onsuccess = () => res((q.result || []).map(normalizePhoto));
    q.onerror = () => rej(q.error);
  });
}
async function dbPut(rec) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, 'readwrite');
    t.objectStore(DB_STORE).put(rec);
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  });
}
async function dbDel(id) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, 'readwrite');
    t.objectStore(DB_STORE).delete(id);
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  });
}
/* 兼容早期写作 chapterId 的记录 */
function normalizePhoto(p) {
  if (!p.landmarkId && p.chapterId) p.landmarkId = p.chapterId;
  return p;
}

/* ───────── 状态 ───────── */
const state = {
  landmarks: [],
  photos: [],
  current: null,
  params: { cell: 5.6, offsetPx: 7.3, screen: 0 }
};

const photosOf = id => state.photos.filter(p => p.landmarkId === id).sort((a, b) => b.t - a.t);
const coverOf = lm => {
  const list = photosOf(lm.id);
  return list.find(p => p.id === lm.coverId) || list[0] || null;
};
const currentLandmark = () => state.landmarks.find(l => l.id === state.current);

function loadLandmarks() {
  try {
    const raw = localStorage.getItem(LS);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length) return arr;
  } catch {}
  return SEED.map(x => ({ ...x }));
}
const saveLandmarks = () => {
  try { localStorage.setItem(LS, JSON.stringify(state.landmarks)); } catch {}
};

/* ───────── 引擎 ───────── */
const stage = $('#stage');
press = createPress(stage);
if (!press.ok) {
  const fresh = stage.cloneNode(false); fresh.id = 'stage';
  stage.replaceWith(fresh);
  press = createFallbackPress(fresh);
}

const bakeCanvas = document.createElement('canvas');
bakeCanvas.width = 960; bakeCanvas.height = 720;
bakeCanvas.setAttribute('aria-hidden', 'true');
bakeCanvas.style.cssText = 'position:fixed;left:-12000px;top:0;width:960px;height:720px;pointer-events:none;opacity:0;';
document.body.appendChild(bakeCanvas);
baker = createPress(bakeCanvas);
if (!baker.ok) baker = createFallbackPress(bakeCanvas);

/* ───────── 主题 ───────── */
function paintAccent(lm) {
  const r = document.documentElement.style;
  const inks = lm ? lm.inks : INK_SETS[0];
  r.setProperty('--accent', inks.c);
  r.setProperty('--ink-c', inks.c);
  r.setProperty('--ink-m', inks.m);
  r.setProperty('--ink-y', inks.y);
  r.setProperty('--ink-k', inks.k);
}

/* ───────── 相册墙 ───────── */
function renderShelf() {
  const grid = $('#shelf-grid');
  grid.innerHTML = '';

  state.landmarks.forEach((lm, i) => {
    const photos = photosOf(lm.id);
    const cover = coverOf(lm);

    const card = el('button', 'album-card');
    card.type = 'button';
    card.style.animationDelay = `${Math.min(i, 8) * 60}ms`;
    card.style.setProperty('--ink-c', lm.inks.c);
    card.style.setProperty('--ink-m', lm.inks.m);
    card.style.setProperty('--ac', lm.inks.c);

    const frame = el('div', 'album-card__frame' + (cover ? '' : ' is-empty'));
    if (cover) frame.style.setProperty('--src', `url("${cover.thumb}")`);
    if (!cover) frame.appendChild(el('span', 'album-card__ghost', esc(lm.name)));
    if (cover) {
      const img = el('img');
      img.alt = `${lm.name} 相册封面`;
      img.loading = i > 2 ? 'lazy' : 'eager';
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
      img.src = cover.thumb;
      if (img.complete) img.classList.add('is-in');
      frame.appendChild(img);
    }
    card.appendChild(frame);

    const meta = lm.coord || lm.date || (photos.length ? `${photos.length} 张` : '空相册');
    const body = el('div', 'album-card__body', `
      <div class="album-card__row">
        <span class="album-card__name">${esc(lm.name)}</span>
        <span class="album-card__count">${photos.length} 张</span>
      </div>
      <span class="album-card__meta">${esc(meta)}</span>`);
    card.appendChild(body);

    card.addEventListener('click', () => openAlbum(lm.id));
    grid.appendChild(card);
  });

  syncStats();
}

function syncStats() {
  const n = state.landmarks.length;
  const p = state.photos.length;
  $('#stat-landmarks').textContent = n;
  $('#stat-photos').textContent = p;
  $('#colophon-stat').textContent = `${n} 个地标 · ${p} 张照片`;

}

/* ───────── 打开 / 关闭相册 ───────── */
const albumEl = $('#album');

function openAlbum(id) {
  state.current = id;
  const lm = currentLandmark();
  paintAccent(lm);

  $('#album-name').textContent = lm.name;
  const metaBits = [lm.coord, lm.date].filter(Boolean);
  const list = photosOf(lm.id);
  metaBits.push(`${list.length} 张照片`);
  $('#album-meta').textContent = metaBits.join('  ·  ');
  $('#album-note').textContent = lm.note || '';
  $('#album-crumb').textContent = lm.name;

  renderStream(list);
  renderHero(list[0] || null, 0);

  albumEl.classList.add('is-open');
  albumEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  $('#album-scroll').scrollTop = 0;
  setTimeout(() => press.setVisible(true), 60);
}

function closeAlbum() {
  albumEl.classList.remove('is-open');
  albumEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-locked');
  press.setVisible(false);
  renderShelf();
}

$('#album-close').addEventListener('click', closeAlbum);

/* 删一本：第一次点变成“确定删除？”，两秒后复原 */
{
  const del = $('#album-delete');
  let armed = 0;
  if (del) del.addEventListener('click', async () => {
    const lm = currentLandmark();
    if (!lm) return;
    if (!armed) {
      armed = setTimeout(() => { armed = 0; del.textContent = '删这一本'; }, 2600);
      del.textContent = '确定删除？';
      del.classList.add('is-armed');
      return;
    }
    clearTimeout(armed); armed = 0;
    const list = photosOf(lm.id);
    for (const p of list) await dbDel(p.id);
    state.photos = state.photos.filter(p => p.landmarkId !== lm.id);
    state.landmarks = state.landmarks.filter(x => x.id !== lm.id);
    saveLandmarks();
    closeAlbum();
    renderShelf();
    note('「' + lm.name + '」已删除 · ' + list.length + ' 张照片一并移出');
  });
}
document.addEventListener('keydown', e => {
  if (lb.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbShow(Math.max(0, lb.index - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbShow(Math.min(lb.list.length - 1, lb.index + 1)); }
    return;
  }
  if (e.key === 'Escape' && albumEl.classList.contains('is-open') && !$('#dlg').open) closeAlbum();
});

window.addEventListener('resize', () => {
  if (lb.open) { fitLbCanvas(); lbPress.setParams({}); }
});

/* ───────── 灯箱 ───────── */
const lbEl = $('#lb');
const lbCanvas = $('#lb-canvas');
let lbPress = createPress(lbCanvas);
if (!lbPress.ok) lbPress = createFallbackPress(lbCanvas);

const lb = { list: [], index: 0, open: false };
let lbToken = 0;

async function openLightbox(list, index) {
  lb.list = list;
  lb.index = index;
  lb.open = true;
  lbEl.classList.add('is-open');
  lbEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  paintPaper();
  await lbShow(index);
  const close = $('#lb-close');
  if (close) close.focus({ preventScroll: true });
}

function closeLightbox() {
  lb.open = false;
  lbEl.classList.remove('is-open');
  lbEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-locked');
}

async function lbShow(index) {
  const photo = lb.list[index];
  if (!photo) return;
  lb.index = index;
  const token = ++lbToken;

  $('#lb-no').textContent = String(index + 1).padStart(2, '0') + ' / ' + String(lb.list.length).padStart(2, '0');
  $('#lb-name').textContent = photo.name;

  const x = photo.exif;
  const bits = x ? [x.camera, x.fl, x.f, x.ss, x.iso, x.date].filter(Boolean) : [];
  $('#lb-exif').innerHTML = bits.map(v => '<span>' + esc(v) + '</span>').join('');
  $('#lb-prev').disabled = index === 0;
  $('#lb-next').disabled = index === lb.list.length - 1;

  const lm = state.landmarks.find(l => l.id === photo.landmarkId) || state.landmarks[0];
  lbPress.setAtelier({ ...lm, inkC: lm.inks.c, inkM: lm.inks.m, inkY: lm.inks.y, inkK: lm.inks.k });
  lbPress.setParams({ ...state.params, reveal: 4 });

  const img = await blobToCanvas(photo.blob);
  if (token !== lbToken) return;
  lbPress.setImage(img.canvas, img.w, img.h);
  fitLbCanvas();
  lbPress.setParams({ reveal: 4 });
}

function fitLbCanvas() {
  const stage = $('#lb-stage');
  const maxW = Math.max(120, stage.clientWidth - 2);
  const maxH = Math.max(120, stage.clientHeight - 2);
  const ar = lbPress.aspect || 1.6;
  let w = maxW;
  let h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  lbCanvas.style.width = Math.round(w) + 'px';
  lbCanvas.style.height = Math.round(h) + 'px';
}

$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-prev').addEventListener('click', () => lbShow(Math.max(0, lb.index - 1)));
$('#lb-next').addEventListener('click', () => lbShow(Math.min(lb.list.length - 1, lb.index + 1)));
lbEl.addEventListener('click', e => {
  if (e.target === lbEl || e.target.id === 'lb-stage') closeLightbox();
});

/* ───────── 相册主图 ───────── */
let heroToken = 0;

async function renderHero(photo, index) {
  const lm = currentLandmark();
  const token = ++heroToken;
  const veil = $('#veil');

  press.setAtelier({ ...lm, inkC: lm.inks.c, inkM: lm.inks.m, inkY: lm.inks.y, inkK: lm.inks.k });
  press.setParams(state.params);

  if (!photo) {
    press.clearImage();
    $('#hero-no').textContent = '—';
    $('#hero-name').textContent = '这一本还是空的';
    $('#hero-dim').textContent = '往下，添加第一张照片';
    const ex = $('#exif'); if (ex) ex.innerHTML = '';
    veil.classList.add('is-done');
    press.setParams({ reveal: 4 });
    return;
  }

  $('#hero-no').textContent = String(index + 1).padStart(2, '0');
  $('#hero-name').textContent = photo.name;
  $('#hero-dim').textContent = `${photo.w}×${photo.h}`;
  renderExif(photo);
  const heroList = photosOf(photo.landmarkId);
  const heroIdx = Math.max(0, heroList.findIndex(x => x.id === photo.id));
  $('#hero').style.cursor = 'zoom-in';
  $('#hero').onclick = () => openLightbox(heroList, heroIdx);

  veil.classList.remove('is-done');
  $('#veil-text').textContent = '上版';

  const img = await blobToCanvas(photo.blob);
  if (token !== heroToken) return;
  press.setImage(img.canvas, img.w, img.h);
  veil.classList.add('is-done');
  develop(1200);
}

function renderExif(photo) {
  const box = $('#exif');
  if (!box) return;
  const x = photo.exif;
  if (!x) { box.innerHTML = ''; return; }
  const bits = [x.camera, x.fl, x.f, x.ss, x.iso, x.date].filter(Boolean);
  box.innerHTML = bits.map((v, i) => i === 0 ? `<span><b>${esc(v)}</b></span>` : `<span>${esc(v)}</span>`).join('');
}

function develop(dur = 1100) {
  if (!press.ok) return;
  const t0 = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    press.setParams({ reveal: e * 4 });
    if (t < 1) requestAnimationFrame(tick);
    else press.setParams({ reveal: 4 });
  };
  requestAnimationFrame(tick);
}

/* ───────── 照片流 ───────── */
function renderStream(list) {
  const wrap = $('#stream');
  wrap.innerHTML = '';
  if (!list.length) return;

  list.forEach((p, i) => {
    const card = el('div', 'shot');
    const r = i % 7;
    if (r === 0) card.classList.add('shot--wide');
    else if (r === 1 || r === 2) card.classList.add('shot--small');
    else if (r === 5) card.classList.add('shot--tall');
    card.style.animationDelay = `${Math.min(i, 9) * 50}ms`;

    const frame = el('div', 'shot__frame');
    frame.style.setProperty('--src', `url("${p.thumb}")`);
    frame.style.setProperty('--ink-c', currentLandmark().inks.c);
    frame.style.setProperty('--ink-m', currentLandmark().inks.m);
    const img = el('img');
    img.alt = p.name;
    img.loading = i > 4 ? 'lazy' : 'eager';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
    img.src = p.thumb;
    if (img.complete) img.classList.add('is-in');
    frame.appendChild(img);

    frame.addEventListener('click', () => openLightbox(list, i));
    card.appendChild(frame);

    const bar = el('div', 'shot__bar');
    const name = el('span', 'shot__name', esc(p.name));
    const right = el('span', null, `${String(i + 1).padStart(2, '0')}`);

    const coverBtn = el('button', 'shot__del');
    coverBtn.type = 'button';
    coverBtn.textContent = currentLandmark().coverId === p.id ? '封面' : '设为封面';
    coverBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      currentLandmark().coverId = currentLandmark().coverId === p.id ? null : p.id;
      saveLandmarks();
      renderStream(photosOf(state.current));
      note(currentLandmark().coverId === p.id ? '已设为这本的封面' : '封面已交回最新一张');
    });

    const del = el('button', 'shot__del');
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      removePhoto(p);
    });

    bar.appendChild(name);
    const tools = el('span', null);
    tools.style.display = 'flex';
    tools.style.gap = '6px';
    tools.appendChild(coverBtn);
    tools.appendChild(del);
    tools.appendChild(right);
    bar.appendChild(tools);
    card.appendChild(bar);
    wrap.appendChild(card);
  });
}

/* ───────── 图像 ───────── */
function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function fitCanvas(img, maxPx) {
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return c;
}

async function blobToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    const c = fitCanvas(img, MAX_PX);
    return { canvas: c, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

async function bake(canvas, lm) {
  baker.setAtelier({ ...lm, inkC: lm.inks.c, inkM: lm.inks.m, inkY: lm.inks.y, inkK: lm.inks.k });
  baker.setParams({ ...state.params, reveal: 4 });
  baker.setImage(canvas, canvas.width, canvas.height);
  await nextTick();
  return baker.snapshot(900);
}

/* ───────── 添加照片 ───────── */
let busy = false;

async function addPhotos(files) {
  if (busy || !files?.length) return;
  const lm = currentLandmark();
  if (!lm) return;
  busy = true;

  const list = [...files].filter(f =>
    /^image\//.test(f.type) || /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name)
  );
  let ok = 0, skipped = 0;

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    note(`正在制版 ${i + 1} / ${list.length}`);
    if (f.size > MAX_BYTES) { skipped++; continue; }
    let img;
    try { img = await decodeImage(f); } catch { skipped++; continue; }

    const full = fitCanvas(img, MAX_PX);
    const blob = await new Promise(res => full.toBlob(res, 'image/jpeg', 0.92));
    const thumb = await bake(full, lm);
    const exif = await readExif(f).catch(() => null);

    const rec = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      landmarkId: lm.id,
      name: f.name.replace(/\.[^.]+$/, '').slice(0, 46) || '未命名',
      blob, thumb, w: full.width, h: full.height, t: Date.now(), exif
    };
    await dbPut(rec);
    state.photos.unshift(rec);
    ok++;
  }

  busy = false;
  const fresh = photosOf(lm.id);
  renderStream(fresh);
  renderHero(fresh[0] || null, 0);
  renderShelf();
  $('#veil').classList.add('is-done');

  note(ok
    ? `已上版 ${ok} 张${skipped ? ` · ${skipped} 张跳过` : ''} · 记入「${lm.name}」`
    : '没有可用的图片');
}

async function removePhoto(p) {
  await dbDel(p.id);
  state.photos = state.photos.filter(x => x.id !== p.id);
  const lm = currentLandmark();
  if (lm.coverId === p.id) { lm.coverId = null; saveLandmarks(); }
  const fresh = photosOf(lm.id);
  renderStream(fresh);
  renderHero(fresh[0] || null, 0);
  renderShelf();
  note('已从这一本里取下');
}

/* ───────── 拖放与选择 ───────── */
const addPhoto = $('#add-photo');
const fileInput = $('#file');

['dragenter', 'dragover'].forEach(ev =>
  addPhoto.addEventListener(ev, e => { e.preventDefault(); addPhoto.classList.add('is-drag'); })
);
['dragleave', 'dragend'].forEach(ev =>
  addPhoto.addEventListener(ev, () => addPhoto.classList.remove('is-drag'))
);
addPhoto.addEventListener('drop', e => {
  e.preventDefault();
  addPhoto.classList.remove('is-drag');
  addPhotos(e.dataTransfer?.files);
});
fileInput.addEventListener('change', () => {
  addPhotos(fileInput.files);
  fileInput.value = '';
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  if (!albumEl.classList.contains('is-open')) return;
  e.preventDefault();
  addPhotos(e.dataTransfer?.files);
});

/* ───────── 参数 ───────── */
const cellInput = $('#cell');
const offsetInput = $('#offset');

function syncParams() {
  state.params.cell = Number(cellInput.value) / 10;
  state.params.offsetPx = 1.2 + (Number(offsetInput.value) / 100) * 18;
  $('#cell-val').textContent = state.params.cell.toFixed(1);
  $('#offset-val').textContent = state.params.offsetPx.toFixed(1);
  press.setParams(state.params);
}
[cellInput, offsetInput].forEach(i => i.addEventListener('input', syncParams));

/* 指针：套印漂移 */
let pRaf = 0;
stage.addEventListener('pointermove', e => {
  if (pRaf) return;
  pRaf = requestAnimationFrame(() => {
    pRaf = 0;
    const r = stage.getBoundingClientRect();
    press.pointer(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  });
});
stage.addEventListener('pointerleave', () => press.pointer(0, 0));

/* ───────── 新建地标 ───────── */
const dlg = $('#dlg');
let draftInk = INK_SETS[0];
let draftAngles = ANGLE_SETS[0];

function paintInks() {
  const box = $('#inks-dots');
  box.innerHTML = '';
  [draftInk.c, draftInk.m, draftInk.y, draftInk.k].forEach(c => {
    const i = document.createElement('i');
    i.style.background = c;
    box.appendChild(i);
  });
}

function openDialog() {
  $('#dlg-form').reset();
  draftInk = INK_SETS[Math.floor(Math.random() * INK_SETS.length)];
  draftAngles = ANGLE_SETS[Math.floor(Math.random() * ANGLE_SETS.length)];
  paintInks();
  dlg.showModal();
  setTimeout(() => $('#f-name').focus(), 60);
}

$('#btn-new').addEventListener('click', openDialog);
$('#btn-new-2').addEventListener('click', openDialog);
$('#dlg-cancel').addEventListener('click', () => dlg.close());
$('#ink-shuffle').addEventListener('click', () => {
  const i = INK_SETS.indexOf(draftInk);
  draftInk = INK_SETS[(i + 1) % INK_SETS.length];
  draftAngles = ANGLE_SETS[INK_SETS.indexOf(draftInk) % ANGLE_SETS.length];
  paintInks();
});

$('#dlg-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = ($('#f-name').value || '').trim();
  if (!name) return;
  const lm = {
    id: `lm-${Date.now().toString(36)}`,
    name: name.slice(0, 16),
    coord: ($('#f-coord').value || '').trim(),
    date: ($('#f-date').value || '').trim(),
    note: ($('#f-note').value || '').trim(),
    inks: { ...draftInk },
    angles: draftAngles.slice(),
    seed: Math.random() * 9
  };
  state.landmarks.push(lm);
  saveLandmarks();
  dlg.close();
  renderShelf();
  paintAccent(lm);
  note(`「${lm.name}」已建 · 点进去放照片`);
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll('.album-card');
    cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

/* ───────── 导出一个自包含的 HTML ───────── */
function buildExportHTML() {
  const groups = state.landmarks
    .map(lm => ({ lm, list: photosOf(lm.id) }))
    .filter(g => g.list.length);

  const total = groups.reduce((a, g) => a + g.list.length, 0);
  const date = new Date().toISOString().slice(0, 10);

  const nav = groups.map(g =>
    '<a href="#' + g.lm.id + '">' + esc(g.lm.name) + '</a>').join('');

  const sections = groups.map(g => {
    const shots = g.list.map((p, i) => {
      const cls = i % 7 === 0 ? ' wide' : (i % 7 === 1 || i % 7 === 2) ? ' small' : '';
      const x = p.exif;
      const meta = x ? [x.camera, x.fl, x.f, x.ss, x.iso].filter(Boolean).join(' · ') : '';
      return '<figure class="shot' + cls + '">' +
        '<img src="' + p.thumb + '" alt="' + esc(p.name) + '" loading="' + (i > 2 ? 'lazy' : 'eager') + '">' +
        '<figcaption><span>' + esc(p.name) + '</span><em>' + esc(meta) + '</em></figcaption>' +
        '</figure>';
    }).join('');

    const metaBits = [g.lm.coord, g.lm.date].filter(Boolean).join('  ·  ');
    return '<section class="ch" id="' + g.lm.id + '" style="--ac:' + g.lm.inks.c + '">' +
      '<header><h2>' + esc(g.lm.name) + '</h2>' +
      '<p class="meta">' + esc(metaBits) + (metaBits ? '  ·  ' : '') + g.list.length + ' 张</p>' +
      (g.lm.note ? '<p class="note">' + esc(g.lm.note) + '</p>' : '') +
      '</header><div class="grid">' + shots + '</div></section>';
  }).join('');

  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>ATLAS · 图册</title>' +
    '<style>' + EXPORT_CSS + '</style></head><body>' +
    '<header class="top"><span class="mark">ATLAS<em>图册</em></span>' +
    '<nav>' + nav + '</nav>' +
    '<span class="stat">' + groups.length + ' 个地标 · ' + total + ' 张照片</span></header>' +
    '<div class="hero"><h1>去过的地方</h1>' +
    '<p>一个地标就是一本相册。同一座城市的片子待在一起，翻起来才像一次回来。</p></div>' +
    '<main>' + sections + '</main>' +
    '<footer><p>ATLAS · 图册 · ' + date + '</p>' +
    '<p>每张照片都经过四色分版与加网，再加一点故意的错位。</p></footer>' +
    '</body></html>';
}

const EXPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#E9E7E0;color:#12120E;
  font-family:"Archivo","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  font-size:15px;line-height:1.7;font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased}
a{color:inherit}
.top{position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:24px;
  height:54px;padding:0 clamp(16px,4vw,64px);
  background:rgba(233,231,224,.9);backdrop-filter:blur(14px);
  border-bottom:1px solid #C6C2B6}
.mark{font-weight:800;font-size:13px;letter-spacing:.16em}
.mark em{font-style:normal;font-size:10px;letter-spacing:.2em;color:#6E6C62;margin-left:8px}
.top nav{display:flex;gap:18px;font-size:12px;letter-spacing:.1em;color:#3C3B34}
.top nav a{text-decoration:none;padding-bottom:2px;border-bottom:1px solid transparent}
.top nav a:hover{border-bottom-color:#12120E}
.stat{margin-left:auto;font-family:Consolas,ui-monospace,monospace;font-size:10px;
  letter-spacing:.12em;text-transform:uppercase;color:#6E6C62;white-space:nowrap}
.hero{padding:clamp(40px,7vw,110px) clamp(16px,4vw,64px) clamp(24px,3vw,44px)}
.hero h1{margin:0 0 0 -.05em;font-size:clamp(2.4rem,6.4vw,5rem);line-height:.95;letter-spacing:-.01em}
.hero p{margin:16px 0 0;max-width:34em;color:#3C3B34;font-size:14px;line-height:1.85}
.ch{padding:clamp(30px,4.4vw,64px) clamp(16px,4vw,64px);border-top:1px solid #C6C2B6}
.ch header{display:grid;grid-template-columns:1fr auto;gap:8px 24px;align-items:end;margin-bottom:clamp(18px,2.4vw,32px)}
.ch h2{margin:0 0 0 -.05em;font-size:clamp(1.8rem,4.4vw,3.2rem);line-height:.98;letter-spacing:-.01em}
.ch .meta{margin:0;grid-column:2;grid-row:1;font-family:Consolas,ui-monospace,monospace;
  font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6E6C62;white-space:nowrap}
.ch .note{margin:0;grid-column:1/-1;max-width:40em;color:#3C3B34;font-size:13.5px;line-height:1.8}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:clamp(12px,1.6vw,26px)}
.shot{margin:0;grid-column:span 4}
.shot.wide{grid-column:span 6}
.shot.small{grid-column:span 3}
.shot img{display:block;width:100%;height:auto;background:#DCD9CF;
  box-shadow:0 1px 2px rgba(24,20,12,.06),0 10px 28px -16px rgba(24,20,12,.3);
  transition:transform .8s cubic-bezier(.16,1,.3,1),box-shadow .5s}
.shot img:hover{transform:scale(1.015);box-shadow:0 2px 4px rgba(24,20,12,.07),0 26px 56px -26px rgba(24,20,12,.4)}
.shot figcaption{display:flex;justify-content:space-between;gap:12px;padding-top:8px;
  font-family:Consolas,ui-monospace,monospace;font-size:9px;letter-spacing:.12em;
  text-transform:uppercase;color:#6E6C62}
.shot figcaption em{font-style:normal;opacity:.7;text-align:right}
footer{padding:clamp(36px,5vw,72px) clamp(16px,4vw,64px) 56px;border-top:1px solid #12120E;margin-top:clamp(30px,4vw,64px)}
footer p{margin:0 0 6px;font-family:Consolas,ui-monospace,monospace;font-size:10px;
  letter-spacing:.14em;text-transform:uppercase;color:#6E6C62}
@media(max-width:980px){
  .grid{grid-template-columns:repeat(6,1fr)}
  .shot,.shot.wide,.shot.small{grid-column:span 3}
  .shot.wide{grid-column:span 6}
  .ch header{grid-template-columns:1fr}
  .ch .meta{grid-column:1;grid-row:auto}
}
@media(max-width:640px){
  .top nav{display:none}
  .grid{grid-template-columns:1fr}
  .shot,.shot.wide,.shot.small{grid-column:span 1}
  .shot figcaption{font-size:9.5px}
}
@media(prefers-color-scheme:dark){
  body{background:#121210;color:#EFEDE5}
  .top{background:rgba(18,18,16,.92);border-color:#2A2A26}
  .top nav,.hero p,.ch .note{color:#B6B3A8}
  .mark em,.stat,.ch .meta,.shot figcaption,footer p{color:#7E7B72}
  .ch{border-color:#2A2A26}
  .shot img{background:#0A0A09;box-shadow:none;border:1px solid #2A2A26}
  footer{border-color:#EFEDE5}
}
`;

function exportStandalone() {
  const groups = state.landmarks.map(lm => ({ lm, list: photosOf(lm.id) })).filter(g => g.list.length);
  if (!groups.length) { note('先放几张照片，再导出', true); return; }
  const total = groups.reduce((a, g) => a + g.list.length, 0);
  const html = buildExportHTML();
  try { window.__exportSize = html.length; } catch (e) {}
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'atlas-' + new Date().toISOString().slice(0, 10) + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  note('已导出 ' + total + ' 张 · 单个 HTML，双击可看，也能直接拖到任何托管平台');
}

/* ───────── 提示 ───────── */
let noteTimer = 0;
function note(msg, isError = false) {
  const n = $('#note');
  n.textContent = msg;
  n.classList.toggle('is-error', !!isError);
  clearTimeout(noteTimer);
  if (msg && !isError) noteTimer = setTimeout(() => { n.textContent = ''; }, 6000);
}

/* ───────── 顶栏滚动阴影 ───────── */
{
  const bar = document.querySelector('.bar');
  let last = false;
  const onScroll = () => {
    const stuck = window.scrollY > 8;
    if (stuck !== last) { bar.classList.toggle('is-stuck', stuck); last = stuck; }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ───────── 主题按钮 ───────── */
{
  const btn = document.getElementById('btn-theme');
  if (btn) btn.addEventListener('click', toggleTheme);
  const btnEx = document.getElementById('btn-export');
  if (btnEx) btnEx.addEventListener('click', () => { exportStandalone(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) {}
    if (!saved) applyTheme(e.matches ? 'dark' : 'light');
  });
}

/* ───────── 启动 ───────── */
async function boot() {
  initTheme();
  state.landmarks = loadLandmarks();
  syncParams();
  paintAccent(state.landmarks[0]);

  try { state.photos = await dbAll(); }
  catch (err) { state.photos = []; if (window.console) console.warn('[atlas] idb', err); }

  renderShelf();
}

boot();
