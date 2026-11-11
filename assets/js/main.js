/* ══════════════════════════════════════════════════════════════════
   main.js — 图册。照片原样显示，只做编排。
   ══════════════════════════════════════════════════════════════════ */

import { readExif } from './exif.js';

/* ───────── 起始三本 ───────── */
const SEED = [
  { id: 'kyoto',     name: '京都',       coord: '35.01°N 135.77°E', date: '', note: '', accent: '#1B3A82' },
  { id: 'reykjavik', name: '雷克雅未克', coord: '64.15°N 21.94°W', date: '', note: '', accent: '#1F6F5C' },
  { id: 'hongkong',  name: '香港',       coord: '22.32°N 114.17°E', date: '', note: '', accent: '#C0397A' }
];

const ACCENTS = ['#1B3A82', '#1F6F5C', '#C0397A', '#B0481E', '#5C3FA8', '#1F6FA8', '#8A2B4E', '#3B7A57'];

const LS_LM = 'atlas.landmarks.v4';
const LS_SITE = 'atlas.site.v1';
const LS_THEME = 'atlas.theme';
const DB_NAME = 'atlas-plates';
const DB_STORE = 'plates';
const MAX_PX = 2400;
const MAX_BYTES = 32 * 1024 * 1024;

const DEFAULT_SITE = {
  name: 'ATLAS', cn: '图册',
  title: '去过的地方',
  lede: '每个地标是一本相册。先在地图上钉一个点，再把那里的照片放进去——同一座城市的片子待在一起，翻起来才像一次回来。',
  accent: '#1B3A82'
};

/* ───────── 小工具 ───────── */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const pad2 = n => String(n).padStart(2, '0');

/* ───────── 状态 ───────── */
const state = {
  landmarks: [],
  photos: [],
  current: null,
  site: null,
  view: 'wall'
};

const photosOf = id => state.photos.filter(p => p.landmarkId === id).sort((a, b) => b.t - a.t);
const coverOf = lm => {
  const list = photosOf(lm.id);
  return list.find(p => p.id === lm.coverId) || list[0] || null;
};
const currentLandmark = () => state.landmarks.find(l => l.id === state.current);

/* 每张照片只创建一次 objectURL */
const urlCache = new Map();
function urlFor(photo) {
  if (!urlCache.has(photo.id)) {
    try { urlCache.set(photo.id, URL.createObjectURL(photo.blob)); }
    catch (e) { return ''; }
  }
  return urlCache.get(photo.id);
}

/* ───────── IndexedDB ───────── */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 3);
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
    q.onsuccess = () => res((q.result || []).map(p => {
      if (!p.landmarkId && p.chapterId) p.landmarkId = p.chapterId;
      return p;
    }));
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

/* ───────── 站点 ───────── */
function loadSite() {
  try {
    const raw = localStorage.getItem(LS_SITE);
    if (raw) return { ...DEFAULT_SITE, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULT_SITE };
}
function applySite(site) {
  state.site = site;
  const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  set('site-name', site.name);
  set('site-cn', site.cn);
  set('site-sig', site.name);
  set('site-title', site.title);
  set('site-lede', site.lede || '');
  const lede = document.getElementById('site-lede');
  if (lede) lede.hidden = !site.lede;
  document.documentElement.style.setProperty('--site', site.accent);
  document.title = (site.title || site.name) + ' · ' + site.cn;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute('content', site.lede || site.title);
}

/* ───────── 主题 ───────── */
function applyTheme(mode) {
  const t = mode === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(LS_THEME); } catch (e) {}
  const mode = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(mode);
}
function toggleTheme() {
  const now = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = now === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(LS_THEME, next); } catch (e) {}
  applyTheme(next);
}

/* ───────── 地标持久化 ───────── */
function loadLandmarks() {
  try {
    const raw = localStorage.getItem(LS_LM);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  try {
    const old = localStorage.getItem('atlas.landmarks.v3');
    if (old) {
      const arr = JSON.parse(old);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((l, i) => ({
          id: l.id, name: l.name, coord: l.coord || '', date: l.date || '',
          note: l.note || '', accent: (l.inks && l.inks.c) || ACCENTS[i % ACCENTS.length],
          coverId: l.coverId || null
        }));
      }
    }
  } catch (e) {}
  return SEED.map(l => ({ ...l }));
}
const saveLandmarks = () => {
  try { localStorage.setItem(LS_LM, JSON.stringify(state.landmarks)); } catch (e) {}
};

/* ───────── 相册墙 ───────── */
function renderWall() {
  const grid = $('#wall-grid');
  if (!grid) return;
  grid.innerHTML = '';

  state.landmarks.forEach((lm, i) => {
    const photos = photosOf(lm.id);
    const cover = coverOf(lm);

    const card = el('button', 'card');
    card.type = 'button';
    card.style.animationDelay = Math.min(i, 5) * 60 + 'ms';
    card.style.setProperty('--accent', lm.accent);
    card.setAttribute('aria-label', lm.name + ' · ' + photos.length + ' 张照片');

    const frame = el('div', 'card__frame' + (cover ? '' : ' is-empty'));
    if (cover) {
      const img = el('img');
      img.alt = lm.name + ' 封面';
      img.loading = i > 2 ? 'lazy' : 'eager';
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
      img.src = urlFor(cover);
      if (img.complete) img.classList.add('is-in');
      frame.appendChild(img);
    } else {
      frame.appendChild(el('span', 'card__ghost', esc(lm.name)));
    }
    card.appendChild(frame);

    const body = el('div', 'card__body');
    body.innerHTML =
      '<span><span class="card__name">' + esc(lm.name) + '</span>' +
      '<span class="card__sub">' + esc(lm.coord || lm.date || '—') + '</span></span>' +
      '<span class="card__meta">' + (photos.length ? photos.length + ' 张' : '空') + '</span>';
    card.appendChild(body);

    card.addEventListener('click', () => openAlbum(lm.id));
    grid.appendChild(card);
  });

  syncStats();
}

function syncStats() {
  const lm = state.landmarks.length;
  const ph = state.photos.length;
  const a = $('#stat-landmarks'); if (a) a.textContent = lm;
  const b = $('#stat-photos'); if (b) b.textContent = ph;
  const c = $('#intro-count'); if (c) c.textContent = lm + ' 个地标 · ' + ph + ' 张照片';
  const d = $('#colophon-stat'); if (d) d.textContent = lm + ' 个地标 · ' + ph + ' 张照片';
  if (state.view === 'index') renderIndex();
  if (state.view === 'atlas') renderMap();
}

/* ───────── 视图 ───────── */
const VIEWS = ['wall', 'index', 'atlas'];
function setView(v) {
  if (!VIEWS.includes(v)) v = 'wall';
  state.view = v;
  try { localStorage.setItem('atlas.view', v); } catch (e) {}
  document.querySelectorAll('.views button').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.view === v));
  });
  VIEWS.forEach(k => {
    const n = document.getElementById(k);
    if (!n) return;
    if (k === v) {
      n.hidden = false;
      n.style.animation = 'none';
      void n.offsetWidth;
      n.style.animation = '';
    } else n.hidden = true;
  });
  if (v === 'index') renderIndex();
  if (v === 'atlas') renderMap();
}

/* ───────── 索引 ───────── */
function renderIndex() {
  const list = $('#idx-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.landmarks.length) {
    list.innerHTML = '<p class="idx-empty">还没有地标。</p>';
    return;
  }
  state.landmarks.forEach((lm, i) => {
    const photos = photosOf(lm.id);
    const row = el('button', 'idx-row');
    row.type = 'button';
    row.style.setProperty('--ac', lm.accent);
    row.innerHTML =
      '<span class="idx-row__no">' + pad2(i + 1) + '</span>' +
      '<span class="idx-row__name"><i class="idx-row__dot"></i>' + esc(lm.name) + '</span>' +
      '<span class="idx-row__coord">' + esc(lm.coord || '—') + '</span>' +
      '<span class="idx-row__date">' + esc(lm.date || '—') + '</span>' +
      '<span class="idx-row__count">' + photos.length + ' 张</span>' +
      '<span class="idx-row__arrow">→</span>';
    row.addEventListener('click', () => openAlbum(lm.id));
    row.addEventListener('mouseenter', () => showPeek(lm));
    row.addEventListener('mouseleave', hidePeek);
    list.appendChild(row);
  });
}

const peekEl = document.createElement('div');
peekEl.className = 'peek';
peekEl.innerHTML = '<img alt="">';
document.body.appendChild(peekEl);
let peekOn = false;
function showPeek(lm) {
  const cover = coverOf(lm);
  if (!cover) return;
  peekEl.querySelector('img').src = urlFor(cover);
  peekEl.classList.add('is-on');
  peekOn = true;
}
function hidePeek() { peekEl.classList.remove('is-on'); peekOn = false; }
document.addEventListener('mousemove', e => {
  if (!peekOn) return;
  peekEl.style.left = Math.min(e.clientX + 22, window.innerWidth - 220) + 'px';
  peekEl.style.top = Math.min(Math.max(e.clientY - 76, 12), window.innerHeight - 170) + 'px';
});

/* ───────── 地图 ───────── */
function parseCoord(s) {
  if (!s) return null;
  const m = /([\d.]+)\s*°?\s*([NS])\s*[, ]*\s*([\d.]+)\s*°?\s*([EW])/i.exec(s);
  if (!m) return null;
  const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
  const lng = parseFloat(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
  return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
}

function renderMap() {
  const grid = $('#map-grid');
  const pins = $('#map-pins');
  if (!grid || !pins) return;

  let svg = '';
  const line = (x1, y1, x2, y2, o) =>
    '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
    '" stroke="rgba(244,242,236,' + o + ')" stroke-width="1"/>';
  for (let lng = -180; lng <= 180; lng += 30) {
    const x = ((lng + 180) / 360) * 100;
    svg += line(x + '%', '0', x + '%', '100%', lng === 0 ? 0.2 : 0.08);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * 100;
    svg += line('0', y + '%', '100%', y + '%', lat === 0 ? 0.2 : 0.08);
  }
  grid.innerHTML = svg;

  pins.innerHTML = '';
  let un = 0;
  state.landmarks.forEach(lm => {
    const c = parseCoord(lm.coord);
    const n = photosOf(lm.id).length;
    const d = 14 + Math.min(20, n * 2.4);
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'map__pin';
    pin.style.setProperty('--ac', lm.accent);
    pin.style.setProperty('--d', d + 'px');
    pin.setAttribute('aria-label', lm.name);
    let x, y;
    if (c) {
      x = ((c.lng + 180) / 360) * 100;
      y = ((90 - c.lat) / 180) * 100;
    } else {
      un += 1;
      x = 94 - un * 5;
      y = 93;
    }
    pin.style.left = x + '%';
    pin.style.top = y + '%';
    pin.addEventListener('click', () => openAlbum(lm.id));
    pins.appendChild(pin);

    const lab = document.createElement('span');
    lab.className = 'map__label';
    lab.textContent = lm.name;
    lab.style.left = x + '%';
    lab.style.top = 'calc(' + y + '% + ' + (d / 2 + 7) + 'px)';
    lab.style.translate = '-50% 0';
    pins.appendChild(lab);
  });
}

/* ───────── 相册 ───────── */
const albumEl = $('#album');

function openAlbum(id) {
  state.current = id;
  const lm = currentLandmark();
  if (!lm) return;
  document.documentElement.style.setProperty('--accent', lm.accent);

  const list = photosOf(lm.id);
  const meta = [lm.coord, lm.date, list.length + ' 张'].filter(Boolean).join('  ·  ');
  $('#album-name').textContent = lm.name;
  $('#album-meta').textContent = meta;
  $('#album-note').textContent = lm.note || '';
  $('#album-crumb').textContent = lm.name;

  renderLead(list[0] || null, 0);
  renderStrip(list);

  albumEl.classList.add('is-open');
  albumEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  $('#album-scroll').scrollTop = 0;
}

function closeAlbum() {
  albumEl.classList.remove('is-open');
  albumEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-locked');
  renderWall();
}

function renderLead(photo, index) {
  const img = $('#lead-img');
  const lead = $('#lead');
  if (!img || !lead) return;
  if (!photo) {
    lead.hidden = true;
    return;
  }
  lead.hidden = false;
  img.src = urlFor(photo);
  img.alt = photo.name;
  $('#lead-no').textContent = pad2(index + 1);
  $('#lead-name').textContent = photo.name;
  $('#lead-dim').textContent = photo.w + '×' + photo.h;

  const x = photo.exif;
  const bits = x ? [x.camera, x.fl, x.f, x.ss, x.iso, x.date].filter(Boolean) : [];
  $('#exif').innerHTML = bits.map(v => '<span>' + esc(v) + '</span>').join('');

  const list = photosOf(photo.landmarkId);
  const idx = Math.max(0, list.findIndex(p => p.id === photo.id));
  img.onclick = () => openLightbox(list, idx);
}

function renderStrip(list) {
  const strip = $('#strip');
  if (!strip) return;
  strip.innerHTML = '';
  if (!list.length) return;

  list.forEach((p, i) => {
    const card = el('button', 'shot');
    card.type = 'button';
    card.style.animationDelay = Math.min(i, 8) * 45 + 'ms';

    const frame = el('div', 'shot__frame');
    const img = el('img');
    img.alt = p.name;
    img.loading = i > 4 ? 'lazy' : 'eager';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
    img.src = urlFor(p);
    if (img.complete) img.classList.add('is-in');
    frame.appendChild(img);
    card.appendChild(frame);

    const bar = el('div', 'shot__bar');
    bar.innerHTML =
      '<span class="shot__name">' + esc(p.name) + '</span>' +
      '<span>' + pad2(i + 1) + '</span>';
    const del = el('button', 'shot__del');
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', e => { e.stopPropagation(); removePhoto(p); });
    bar.appendChild(del);
    card.appendChild(bar);

    card.addEventListener('click', () => {
      renderLead(p, i);
      $('#lead').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    strip.appendChild(card);
  });
}

/* ───────── 大图 ───────── */
const lbEl = $('#lb');
const lbImg = $('#lb-img');
const lbState = { list: [], index: 0, open: false };

function openLightbox(list, index) {
  lbState.list = list;
  lbState.open = true;
  lbEl.classList.add('is-open');
  lbEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  lbShow(index);
  $('#lb-close').focus({ preventScroll: true });
}
function closeLightbox() {
  lbState.open = false;
  lbEl.classList.remove('is-open');
  lbEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-locked');
}
function lbShow(i) {
  const p = lbState.list[i];
  if (!p) return;
  lbState.index = i;
  lbImg.src = urlFor(p);
  lbImg.alt = p.name;
  $('#lb-no').textContent = pad2(i + 1) + ' / ' + pad2(lbState.list.length);
  $('#lb-name').textContent = p.name;
  const x = p.exif;
  const bits = x ? [x.camera, x.fl, x.f, x.ss, x.iso, x.date].filter(Boolean) : [];
  $('#lb-exif').innerHTML = bits.map(v => '<span>' + esc(v) + '</span>').join('');
  $('#lb-prev').disabled = i === 0;
  $('#lb-next').disabled = i === lbState.list.length - 1;
}

$('#album-close').addEventListener('click', closeAlbum);
$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-prev').addEventListener('click', () => lbShow(Math.max(0, lbState.index - 1)));
$('#lb-next').addEventListener('click', () => lbShow(Math.min(lbState.list.length - 1, lbState.index + 1)));
lbEl.addEventListener('click', e => { if (e.target === lbEl || e.target.id === 'lb-stage') closeLightbox(); });

document.addEventListener('keydown', e => {
  if (lbState.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbShow(Math.max(0, lbState.index - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbShow(Math.min(lbState.list.length - 1, lbState.index + 1)); }
    return;
  }
  if (e.key === 'Escape') {
    if ($('#dlg')?.open) return;
    if ($('#dlg-site')?.open) return;
    if (albumEl.classList.contains('is-open')) closeAlbum();
  }
});

/* ───────── 图像处理 ───────── */
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

async function makeThumb(canvas) {
  const w = 720;
  const h = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.84);
}

/* ───────── 上传 ───────── */
let busy = false;
async function addPhotos(files) {
  if (busy || !files || !files.length) return;
  const lm = currentLandmark();
  if (!lm) return;
  busy = true;

  const list = [...files].filter(f =>
    /^image\//.test(f.type) || /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name));
  let ok = 0, skip = 0;

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    showNote('正在保存 ' + (i + 1) + ' / ' + list.length);
    if (f.size > MAX_BYTES) { skip++; continue; }
    let img;
    try { img = await decodeImage(f); } catch (e) { skip++; continue; }

    const full = fitCanvas(img, MAX_PX);
    const blob = await new Promise(r => full.toBlob(r, 'image/jpeg', 0.93));
    const thumb = await makeThumb(full);
    const exif = await readExif(f).catch(() => null);

    const rec = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      landmarkId: lm.id,
      name: (f.name.replace(/\.[^.]+$/, '') || '未命名').slice(0, 46),
      blob, thumb, exif,
      w: full.width, h: full.height,
      t: Date.now() + i
    };
    await dbPut(rec);
    state.photos.unshift(rec);
    ok++;
  }

  busy = false;
  const fresh = photosOf(lm.id);
  renderLead(fresh[0] || null, 0);
  renderStrip(fresh);
  syncStats();
  showNote(ok ? '已加入 ' + ok + ' 张' + (skip ? ' · ' + skip + ' 张跳过' : '') : '没有可用的图片');
}

async function removePhoto(p) {
  await dbDel(p.id);
  const u = urlCache.get(p.id);
  if (u) { try { URL.revokeObjectURL(u); } catch (e) {} urlCache.delete(p.id); }
  state.photos = state.photos.filter(x => x.id !== p.id);
  const lm = currentLandmark();
  if (lm && lm.coverId === p.id) { lm.coverId = null; saveLandmarks(); }
  const fresh = photosOf(lm.id);
  renderLead(fresh[0] || null, 0);
  renderStrip(fresh);
  syncStats();
  showNote('已移除');
}

/* ───────── 提示 ───────── */
let noteTimer = 0;
function showNote(msg, isError) {
  const n = $('#note');
  if (!n) return;
  n.textContent = msg;
  n.classList.toggle('is-error', !!isError);
  clearTimeout(noteTimer);
  if (msg && !isError) noteTimer = setTimeout(() => { n.textContent = ''; }, 5200);
}

/* ───────── 拖放 ───────── */
const addEl = $('#add-photo');
const fileInput = $('#file');
['dragenter', 'dragover'].forEach(ev =>
  addEl.addEventListener(ev, e => { e.preventDefault(); addEl.classList.add('is-drag'); }));
['dragleave', 'dragend'].forEach(ev =>
  addEl.addEventListener(ev, () => addEl.classList.remove('is-drag')));
addEl.addEventListener('drop', e => {
  e.preventDefault();
  addEl.classList.remove('is-drag');
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
  if (e.dataTransfer?.files?.length) addPhotos(e.dataTransfer.files);
});

/* ───────── 菜单 ───────── */
const menuBtn = $('#btn-menu');
const menuPop = $('#menu-pop');
function closeMenu() {
  menuPop.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = menuPop.hidden;
  menuPop.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', closeMenu);
menuPop.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  closeMenu();
  const act = b.dataset.act;
  if (act === 'new') openDialog();
  if (act === 'settings') openSettings();
  if (act === 'theme') toggleTheme();
  if (act === 'export') exportStandalone();
});

/* ───────── 色板 ───────── */
function paintSwatches(box, current, onPick) {
  if (!box) return;
  box.innerHTML = '';
  box.dataset.pick = current || ACCENTS[0];
  ACCENTS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-pressed', String(c.toUpperCase() === String(current).toUpperCase()));
    b.addEventListener('click', () => {
      [...box.children].forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      box.dataset.pick = c;
      if (onPick) onPick(c);
    });
    box.appendChild(b);
  });
}

/* ───────── 新建地标 ───────── */
const dlg = $('#dlg');
function openDialog() {
  $('#dlg-form').reset();
  paintSwatches($('#swatches-new'), ACCENTS[Math.floor(Math.random() * ACCENTS.length)]);
  dlg.showModal();
  setTimeout(() => $('#f-name').focus(), 50);
}
$('#btn-new')?.addEventListener('click', openDialog);
$('#dlg-cancel').addEventListener('click', () => dlg.close());
$('#dlg-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = ($('#f-name').value || '').trim();
  if (!name) return;
  const lm = {
    id: 'lm-' + Date.now().toString(36),
    name: name.slice(0, 16),
    coord: ($('#f-coord').value || '').trim(),
    date: ($('#f-date').value || '').trim(),
    note: ($('#f-note').value || '').trim(),
    accent: $('#swatches-new').dataset.pick || ACCENTS[0]
  };
  state.landmarks.push(lm);
  saveLandmarks();
  dlg.close();
  renderWall();
  if (state.view === 'index') renderIndex();
  if (state.view === 'atlas') renderMap();
  setTimeout(() => openAlbum(lm.id), 120);
});

/* ───────── 站点设置 ───────── */
function openSettings() {
  const s = state.site || DEFAULT_SITE;
  $('#s-name').value = s.name;
  $('#s-cn').value = s.cn;
  $('#s-title').value = s.title;
  $('#s-lede').value = s.lede;
  $('#dlg-site').showModal();
  setTimeout(() => $('#s-name').focus(), 50);
}
$('#site-cancel').addEventListener('click', () => $('#dlg-site').close());
$('#site-form').addEventListener('submit', e => {
  e.preventDefault();
  const next = {
    ...state.site,
    name: ($('#s-name').value || '').trim() || DEFAULT_SITE.name,
    cn: ($('#s-cn').value || '').trim() || DEFAULT_SITE.cn,
    title: ($('#s-title').value || '').trim() || DEFAULT_SITE.title,
    lede: ($('#s-lede').value || '').trim()
  };
  applySite(next);
  try { localStorage.setItem(LS_SITE, JSON.stringify(next)); } catch (err) {}
  $('#dlg-site').close();
  showNote('已保存');
});

/* ───────── 删除整本 ───────── */
{
  const del = $('#album-delete');
  let armed = 0;
  del.addEventListener('click', async () => {
    const lm = currentLandmark();
    if (!lm) return;
    if (!armed) {
      armed = setTimeout(() => { armed = 0; del.textContent = '删这一本'; del.classList.remove('is-armed'); }, 2600);
      del.textContent = '确定删除？';
      del.classList.add('is-armed');
      return;
    }
    clearTimeout(armed); armed = 0;
    del.textContent = '删这一本';
    del.classList.remove('is-armed');
    const list = photosOf(lm.id);
    for (const p of list) {
      await dbDel(p.id);
      const u = urlCache.get(p.id);
      if (u) { try { URL.revokeObjectURL(u); } catch (e) {} urlCache.delete(p.id); }
    }
    state.photos = state.photos.filter(p => p.landmarkId !== lm.id);
    state.landmarks = state.landmarks.filter(x => x.id !== lm.id);
    saveLandmarks();
    closeAlbum();
    renderWall();
    showNote('「' + lm.name + '」已删除');
  });
}

/* ───────── 导出 ───────── */
function buildExport() {
  const groups = state.landmarks
    .map(lm => ({ lm, list: photosOf(lm.id) }))
    .filter(g => g.list.length);
  const total = groups.reduce((a, g) => a + g.list.length, 0);
  const date = new Date().toISOString().slice(0, 10);

  const nav = groups.map(g => '<a href="#' + g.lm.id + '">' + esc(g.lm.name) + '</a>').join('');

  const sections = groups.map(g => {
    const shots = g.list.map(p =>
      '<figure><img src="' + p.thumb + '" alt="' + esc(p.name) + '" loading="lazy">' +
      '<figcaption>' + esc(p.name) + '</figcaption></figure>').join('');
    const meta = [g.lm.coord, g.lm.date].filter(Boolean).join('  ·  ');
    return '<section class="ch" id="' + g.lm.id + '" style="--ac:' + g.lm.accent + '">' +
      '<header><h2>' + esc(g.lm.name) + '</h2>' +
      '<p class="meta">' + esc(meta) + (meta ? '  ·  ' : '') + g.list.length + ' 张</p>' +
      (g.lm.note ? '<p class="note">' + esc(g.lm.note) + '</p>' : '') +
      '</header><div class="grid">' + shots + '</div></section>';
  }).join('');

  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(state.site.name) + ' · ' + esc(state.site.cn) + '</title>' +
    '<style>' + EXPORT_CSS + '</style></head><body>' +
    '<header class="top"><span class="mark">' + esc(state.site.name) + '<em>' + esc(state.site.cn) + '</em></span>' +
    '<nav>' + nav + '</nav><span class="stat">' + groups.length + ' 地标 · ' + total + ' 张</span></header>' +
    '<div class="hero"><h1>' + esc(state.site.title) + '</h1>' +
    (state.site.lede ? '<p>' + esc(state.site.lede) + '</p>' : '') + '</div>' +
    '<main>' + sections + '</main>' +
    '<footer><p>' + esc(state.site.name) + ' · ' + date + '</p></footer></body></html>';
}

const EXPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F4F2EC;color:#14130F;font-family:"Archivo","PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit}
.top{position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:26px;height:56px;padding:0 clamp(16px,4vw,64px);background:rgba(244,242,236,.9);backdrop-filter:blur(16px);border-bottom:1px solid #D8D4C9}
.mark{font-weight:800;font-size:14px;letter-spacing:.16em}
.mark em{font-style:normal;font-size:10px;letter-spacing:.22em;color:#7A776D;margin-left:9px}
.top nav{display:flex;gap:20px;font-size:12.5px;letter-spacing:.08em;color:#3F3D36}
.top nav a{text-decoration:none;padding-bottom:2px;border-bottom:1px solid transparent}
.top nav a:hover{border-bottom-color:#14130F}
.stat{margin-left:auto;font-family:Consolas,ui-monospace,monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#7A776D}
.hero{padding:clamp(44px,8vw,124px) clamp(16px,4vw,64px) clamp(24px,3vw,44px);max-width:1000px}
.hero h1{margin:0;font-size:clamp(2.4rem,6vw,4.8rem);line-height:1.03;letter-spacing:-.02em}
.hero p{margin:20px 0 0;max-width:32em;color:#3F3D36;font-size:14.5px;line-height:1.86}
.ch{padding:clamp(32px,4.6vw,68px) clamp(16px,4vw,64px);border-top:1px solid #D8D4C9}
.ch header{display:grid;grid-template-columns:1fr auto;gap:6px 24px;align-items:baseline;margin-bottom:clamp(18px,2.4vw,32px)}
.ch h2{margin:0;font-size:clamp(1.8rem,4vw,2.9rem);line-height:1.05;letter-spacing:-.02em}
.ch .meta{margin:0;grid-column:2;grid-row:1;font-family:Consolas,ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7A776D;white-space:nowrap}
.ch .note{margin:0;grid-column:1/-1;max-width:38em;color:#3F3D36;font-size:13.5px;line-height:1.8}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(12px,1.6vw,26px)}
figure{margin:0}
figure img{display:block;width:100%;height:auto;background:#E7E4DB;box-shadow:0 1px 2px rgba(24,20,12,.05),0 14px 34px -22px rgba(24,20,12,.3);transition:transform .7s cubic-bezier(.16,1,.3,1),box-shadow .45s}
figure img:hover{transform:scale(1.015);box-shadow:0 2px 5px rgba(24,20,12,.06),0 30px 62px -30px rgba(24,20,12,.38)}
figcaption{padding-top:8px;font-family:Consolas,ui-monospace,monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#7A776D;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{padding:clamp(36px,5vw,72px) clamp(16px,4vw,64px) 56px;border-top:1px solid #14130F}
footer p{margin:0;font-family:Consolas,ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7A776D}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.ch header{grid-template-columns:1fr}.ch .meta{grid-column:1;grid-row:auto}}
@media(max-width:600px){.top nav{display:none}.grid{grid-template-columns:1fr}}
@media(prefers-color-scheme:dark){
body{background:#121211;color:#F0EEE6}
.top{background:rgba(18,18,17,.92);border-color:#2B2A26}
.top nav,.hero p,.ch .note{color:#BCB9AE}
.mark em,.stat,.ch .meta,figcaption,footer p{color:#837F75}
.ch{border-color:#2B2A26}
figure img{background:#0A0A09;box-shadow:none;border:1px solid #2B2A26}
footer{border-color:#F0EEE6}
}`;

function exportStandalone() {
  const groups = state.landmarks.map(lm => ({ lm, list: photosOf(lm.id) })).filter(g => g.list.length);
  if (!groups.length) { showNote('先放几张照片，再导出', true); return; }
  const html = buildExport();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'album-' + new Date().toISOString().slice(0, 10) + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showNote('已导出 · 单个 HTML，双击可看，也能直接发给别人');
}

/* ───────── 顶栏与全局事件 ───────── */
document.querySelectorAll('.views button').forEach(b => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

/* ───────── 启动 ───────── */
async function boot() {
  initTheme();
  state.site = loadSite();
  applySite(state.site);
  state.landmarks = loadLandmarks();

  try { state.photos = await dbAll(); }
  catch (e) { state.photos = []; }

  renderWall();

  let savedView = null;
  try { savedView = localStorage.getItem('atlas.view'); } catch (e) {}
  setView(savedView || 'wall');
}

boot();
