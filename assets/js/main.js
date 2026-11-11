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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && albumEl.classList.contains('is-open') && !$('#dlg').open) closeAlbum();
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

    frame.addEventListener('click', () => {
      renderHero(p, i);
      $('#hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
