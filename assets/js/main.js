/* ══════════════════════════════════════════════════════════════════
   main.js — 图册
   数据沿用原来的 IndexedDB / localStorage 键，旧照片不会丢。
   ══════════════════════════════════════════════════════════════════ */

import { readExif } from './exif.js';
import { createGlobe } from './globe.js';
import { createDust } from './drift.js';

/* ───────── 常量 ───────── */
const ACCENTS = ['#C9A96A', '#7FA8C9', '#C98A7F', '#9BC9A0', '#B9A0D8', '#D8C08A', '#8FA6B8', '#C97F9E'];

const LS_LM = 'atlas.landmarks.v4';
const LS_SITE = 'atlas.site.v1';
const LS_THEME = 'atlas.theme';
const LS_VIEW = 'atlas.view';
const LS_SEED = 'atlas.seeded.v1';
const DB_NAME = 'atlas-plates';
const DB_STORE = 'plates';
const MAX_PX = 2400;
const MAX_BYTES = 40 * 1024 * 1024;

const DEFAULT_SITE = {
  name: 'ATLAS',
  cn: '图册',
  title: '去过的地方',
  lede: '一处地标，一本相册。先在地球上落一个点，再把那里的照片放进去——同一座城的片子待在一起，翻起来才像一次回来。',
  accent: '#C9A96A'
};

/* ───────── 小工具 ───────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────── 状态 ───────── */
const state = {
  landmarks: [],
  photos: [],
  site: null,
  view: 'wall',
  current: null,
  editing: null,
  pendingFiles: null
};

let globe = null;
let dust = null;

const photosOf = id => state.photos.filter(p => p.landmarkId === id).sort((a, b) => b.t - a.t);
const landmarkById = id => state.landmarks.find(l => l.id === id);
const coverOf = lm => {
  const list = photosOf(lm.id);
  return list.find(p => p.id === lm.coverId) || list[0] || null;
};
const currentLandmark = () => landmarkById(state.current);

/* 每个 blob 只生成一次 objectURL */
const urlCache = new Map();
function syncLock() {
  const need = document.body.dataset.lock === '1';
  document.body.classList.toggle('is-locked', need);
}
function setLock(on) {
  document.body.dataset.lock = on ? '1' : '0';
  syncLock();
}

function urlFor(photo) {
  if (!photo.blob) return photo.thumb || '';
  if (!urlCache.has(photo.id)) {
    try { urlCache.set(photo.id, URL.createObjectURL(photo.blob)); }
    catch { return photo.thumb || ''; }
  }
  return urlCache.get(photo.id);
}
function dropURL(id) {
  const u = urlCache.get(id);
  if (u) { try { URL.revokeObjectURL(u); } catch {} urlCache.delete(id); }
}

/* ───────── IndexedDB ───────── */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        const s = d.createObjectStore(DB_STORE, { keyPath: 'id' });
        s.createIndex('landmarkId', 'landmarkId', { unique: false });
      } else if (!req.transaction.objectStore(DB_STORE).indexNames.contains('landmarkId')) {
        req.transaction.objectStore(DB_STORE).createIndex('landmarkId', 'landmarkId', { unique: false });
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

/* ───────── 坐标 ───────── */
function parseCoord(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = /([\d.]+)\s*°?\s*([NS])\s*[, ]*\s*([\d.]+)\s*°?\s*([EW])/i.exec(t);
  if (m) {
    const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
    const lng = parseFloat(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
    return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
  }
  m = /(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)/.exec(t);
  if (m) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
function fmtCoord(lat, lng) {
  if (lat == null || lng == null) return '';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lng).toFixed(2)}°${ew}`;
}

/* ───────── 站点 ───────── */
function loadSite() {
  try {
    const raw = localStorage.getItem(LS_SITE);
    if (raw) return { ...DEFAULT_SITE, ...JSON.parse(raw) };
  } catch {}
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
  document.title = `${site.title || site.name} · ${site.cn}`;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute('content', site.lede || site.title);
}

/* ───────── 主题 ───────── */
function applyTheme(mode) {
  const t = mode === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#F2F0EA' : '#08080A');
  globe?.refresh();
  dust?.retheme();
}
function toggleTheme() {
  const now = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next = now === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(LS_THEME, next); } catch {}
  applyTheme(next);
}

/* ───────── 地标 ───────── */
function normalizeLM(l) {
  const geo = (l.lat != null && l.lng != null && isFinite(l.lat) && isFinite(l.lng))
    ? { lat: +l.lat, lng: +l.lng }
    : parseCoord(l.coord || '');
  return {
    id: l.id || 'lm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: l.name || '未命名',
    coord: l.coord || (geo ? fmtCoord(geo.lat, geo.lng) : ''),
    date: l.date || '',
    note: l.note || '',
    accent: l.accent || ACCENTS[0],
    coverId: l.coverId || null,
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    createdAt: l.createdAt || 0
  };
}
function loadLandmarks() {
  try {
    const raw = localStorage.getItem(LS_LM);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(normalizeLM);
    }
  } catch {}
  return null;
}
const saveLandmarks = () => {
  try { localStorage.setItem(LS_LM, JSON.stringify(state.landmarks)); } catch {}
};

/* ───────── 统计 ───────── */
function syncStats() {
  const lm = state.landmarks.length;
  const ph = state.photos.length;
  const setT = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  setT('stat-landmarks', lm);
  setT('stat-photos', ph);
  setT('tab-count', lm);
  setT('colophon-stat', `${lm} 处地标 · ${ph} 张照片`);
  setT('wall-note', lm ? `${lm} 处地标 · ${ph} 张照片` : '一处地标，一本');

  const newest = state.photos.slice().sort((a, b) => b.t - a.t)[0];
  const nl = newest ? landmarkById(newest.landmarkId) : null;
  setT('stat-latest', nl ? nl.name : '—');
}

/* ───────── 相册墙 ───────── */
const SPAN_CYCLE = [5, 4, 3, 4, 3, 5, 3, 5, 4];

function renderWall() {
  const grid = $('#wall-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const empty = $('#wall-empty');
  if (empty) empty.hidden = state.landmarks.length > 0;

  state.landmarks.forEach((lm, i) => {
    const photos = photosOf(lm.id);
    const cover = coverOf(lm);
    const span = SPAN_CYCLE[i % SPAN_CYCLE.length];

    const card = el('button', `card card--w${span}`);
    card.type = 'button';
    card.style.setProperty('--ac', lm.accent);
    card.style.animationDelay = Math.min(i, 7) * 55 + 'ms';
    card.setAttribute('aria-label', `${lm.name}，${photos.length} 张照片`);

    const frame = el('div', 'card__frame' + (cover ? '' : ' is-empty'));
    if (cover) {
      const img = el('img');
      img.alt = `${lm.name} 封面`;
      img.loading = i > 3 ? 'lazy' : 'eager';
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
      img.src = cover.thumb || urlFor(cover);
      if (img.complete) img.classList.add('is-in');
      frame.appendChild(img);
      frame.appendChild(el('div', 'card__veil'));
      frame.appendChild(el('div', 'card__spot'));
      frame.appendChild(el('span', 'card__hint', '打开相册&nbsp;&nbsp;→'));
    } else {
      frame.appendChild(el('span', 'card__ghost', esc(lm.name)));
      frame.appendChild(el('span', 'card__hint', '拖入照片 · 或打开'));
    }
    card.appendChild(frame);

    const body = el('div', 'card__body');
    body.innerHTML =
      `<span class="card__no">N°${pad2(i + 1)}</span>` +
      `<span class="card__name"><i class="card__dot"></i>${esc(lm.name)}</span>` +
      `<span class="card__count">${photos.length ? photos.length + ' 张' : '空'}</span>` +
      `<span class="card__sub">${esc(lm.coord || lm.date || '尚未落点')}</span>`;
    card.appendChild(body);

    card.addEventListener('click', () => openAlbum(lm.id));

    if (cover) {
      card.addEventListener('pointermove', e => {
        const r = frame.getBoundingClientRect();
        frame.style.setProperty('--mx', `${e.clientX - r.left}px`);
        frame.style.setProperty('--my', `${e.clientY - r.top}px`);
      }, { passive: true });
    }

    /* 把照片直接拖到某本相册上 */
    card.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.add('is-drop');
    });
    card.addEventListener('dragleave', () => card.classList.remove('is-drop'));
    card.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('is-drop');
      uploadTo(lm.id, e.dataTransfer.files);
    });

    grid.appendChild(card);
  });

  syncStats();
  if (state.view === 'index') renderIndex();
  if (state.view === 'globe') renderOrbList();
}

/* 上传后只更新那一张卡，避免整墙重绘造成闪动 */
function updateCard(lm) {
  const i = state.landmarks.indexOf(lm);
  const card = $$('.card')[i];
  if (!card) return;
  const n = photosOf(lm.id).length;
  const cnt = card.querySelector('.card__count');
  if (cnt) cnt.textContent = n ? n + ' 张' : '空';
  const frame = card.querySelector('.card__frame');
  if (frame?.classList.contains('is-empty') && n) renderWall();
}

/* ───────── 索引 ───────── */
function renderIndex() {
  const list = $('#idx-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.landmarks.length) {
    list.innerHTML = '<p class="ledger__empty">还没有地标。先建一处，再往里放照片。</p>';
    return;
  }
  state.landmarks.forEach((lm, i) => {
    const photos = photosOf(lm.id);
    const row = el('button', 'row');
    row.type = 'button';
    row.style.setProperty('--ac', lm.accent);
    row.innerHTML =
      `<span class="row__no">${pad2(i + 1)}</span>` +
      `<span class="row__name"><i class="row__dot"></i>${esc(lm.name)}</span>` +
      `<span class="row__coord">${esc(lm.coord || '—')}</span>` +
      `<span class="row__date">${esc(lm.date || '—')}</span>` +
      `<span class="row__count">${photos.length} 张</span>` +
      `<span class="row__arrow">→</span>`;
    row.addEventListener('click', () => openAlbum(lm.id));
    row.addEventListener('mouseenter', () => showPeek(lm));
    row.addEventListener('mouseleave', hidePeek);
    row.addEventListener('focus', () => showPeek(lm));
    row.addEventListener('blur', hidePeek);
    list.appendChild(row);
  });
}

/* 悬停预览 */
const peek = el('div', 'peek');
peek.innerHTML = '<img alt="">';
document.body.appendChild(peek);
let peekOn = false;
function showPeek(lm) {
  const cover = coverOf(lm);
  if (!cover) return;
  peek.querySelector('img').src = cover.thumb || urlFor(cover);
  peek.classList.add('is-on');
  peekOn = true;
}
function hidePeek() { peek.classList.remove('is-on'); peekOn = false; }
document.addEventListener('mousemove', e => {
  if (!peekOn) return;
  peek.style.transform = `translate(${Math.min(e.clientX + 24, innerWidth - 250)}px, ${Math.min(Math.max(e.clientY - 80, 12), innerHeight - 180)}px)`;
});

/* ───────── 地球 ───────── */
const globeCanvas = $('#globe-canvas');

function initGlobe() {
  if (!globeCanvas || globe) return;
  globe = createGlobe(globeCanvas, {
    onPick: it => openAlbum(it.id),
    onEmpty: geo => openDialog({ lat: geo.lat, lng: geo.lng }),
    onHover: it => {
      $$('.orb__item').forEach(b => b.classList.toggle('is-lit', !!it && b.dataset.id === it.id));
    }
  });
  globe.setItems(globeItems());
}

const globeItems = () => state.landmarks
  .filter(l => l.lat != null && l.lng != null)
  .map(l => ({
    id: l.id, name: l.name, lat: l.lat, lng: l.lng,
    accent: l.accent, count: photosOf(l.id).length
  }));

function renderOrbList() {
  const list = $('#orb-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.landmarks.length) {
    list.appendChild(el('p', 'orb__none', '还没有地标'));
    return;
  }
  state.landmarks.forEach((lm, i) => {
    const b = el('button', 'orb__item');
    b.type = 'button';
    b.dataset.id = lm.id;
    b.style.animationDelay = Math.min(i, 9) * 45 + 'ms';
    b.innerHTML =
      `<i>${pad2(i + 1)}</i>` +
      `<b>${esc(lm.name)}</b>` +
      `<em>${photosOf(lm.id).length}</em>`;
    b.addEventListener('mouseenter', () => globe?.setLit(lm.id));
    b.addEventListener('mouseleave', () => globe?.setLit(null));
    b.addEventListener('focus', () => globe?.setLit(lm.id));
    b.addEventListener('blur', () => globe?.setLit(null));
    b.addEventListener('click', () => {
      if (lm.lat != null) globe?.focusLandmark(lm);
      openAlbum(lm.id);
    });
    list.appendChild(b);
  });
}

function syncGlobe() {
  initGlobe();
  if (!globe) return;
  globe.setItems(globeItems());
  renderOrbList();
  globe.refresh();
}

/* ───────── 视图 ───────── */
const VIEWS = ['wall', 'index', 'globe'];
function setView(v, opts = {}) {
  if (!VIEWS.includes(v)) v = 'wall';
  state.view = v;
  try { localStorage.setItem(LS_VIEW, v); } catch {}
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
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
  if (v === 'globe') {
    syncGlobe();
    requestAnimationFrame(() => {
      globe?.resize();
      globe?.start();
    });
  } else {
    globe?.stop();
  }
  hidePeek();

  if (opts.scroll !== false) {
    const target = document.getElementById(v);
    const top = target?.getBoundingClientRect().top ?? 0;
    if (target && (top > innerHeight * 0.55 || top < -8)) {
      target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }
}

/* ───────── 相册 ───────── */
const albumEl = $('#album');
const albumScroll = $('#album-scroll');
let albumList = [];

function openAlbum(id) {
  const lm = landmarkById(id);
  if (!lm) return;
  state.current = id;
  hidePeek();

  const list = photosOf(id);
  albumList = list;

  const barEl = albumScroll.querySelector('.album__bar');
  barEl?.classList.remove('is-stuck');

  $('#album-name').textContent = lm.name;
  $('#album-note').textContent = lm.note || '';
  $('#album-note').hidden = !lm.note;
  $('#album-crumb').textContent = lm.name;
  $('#album-kicker').textContent = `ALBUM ${pad2(state.landmarks.findIndex(l => l.id === id) + 1)}${lm.date ? ' · ' + lm.date : ''}`;
  $('#album-kicker').style.setProperty('--ac', lm.accent);

  $('#album-meta').innerHTML = [lm.coord, lm.date, `${list.length} 张照片`, list[0]?.exif?.camera]
    .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');

  renderAlbumGrid();

  albumEl.classList.add('is-open');
  albumEl.setAttribute('aria-hidden', 'false');
  setLock(true);
  albumScroll.scrollTop = 0;
}

function closeAlbum() {
  const id = state.current;
  albumEl.classList.remove('is-open');
  albumEl.setAttribute('aria-hidden', 'true');
  setLock(lbState.open || palette.classList.contains('is-open'));
  state.current = null;
  renderWall();
  const idx = state.landmarks.findIndex(l => l.id === id);
  const card = $$('.card')[idx];
  if (card) card.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
}

/* justified 版面：按原始比例排，不裁切 */
function renderAlbumGrid() {
  const grid = $('#album-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const empty = $('#album-empty');
  if (empty) empty.hidden = albumList.length > 0;
  if (!albumList.length) return;

  const W = grid.clientWidth || 900;
  const compact = W < 720;
  const gap = compact ? 8 : clamp(8, W * 0.008, 14);
  const target = compact ? 190 : (W > 1300 ? 330 : 260);
  const ratioOf = p => clamp((p.w || 4) / (p.h || 3), 0.5, 2.6);

  const rows = [];
  let row = [], sum = 0;
  let n = 0;

  if (compact) {
    for (let i = 0; i < albumList.length; i += 2) {
      const pair = albumList.slice(i, i + 2);
      const w = (W - gap) / 2;
      const h = Math.round(pair.length === 2 ? w / 1.25 : w / ratioOf(pair[0]));
      rows.push({ items: pair.map(p => ({ p, w })), h });
    }
  } else {
    for (const p of albumList) {
      const r = ratioOf(p);
      row.push({ p, r });
      sum += r;
      const avail = W - gap * (row.length - 1);
      if (avail / sum <= target && row.length >= 2) {
        rows.push({ items: row.slice(), h: Math.round(avail / sum) });
        row = []; sum = 0;
      }
    }
    if (row.length) {
      const avail = W - gap * (row.length - 1);
      rows.push({ items: row.slice(), h: Math.round(Math.min(avail / sum, target)) });
    }
  }

  const frag = document.createDocumentFragment();
  let idx = 0;
  rows.forEach(r => {
    const rowEl = el('div', 'agrow');
    rowEl.style.gap = gap + 'px';
    r.items.forEach(it => {
      const p = it.p;
      const w = it.w || Math.round(it.r * r.h);
      const shot = el('button', 'shot');
      shot.type = 'button';
      shot.style.width = w + 'px';
      shot.style.height = r.h + 'px';
      shot.style.flex = `0 0 ${w}px`;
      shot.style.transitionDelay = Math.min(idx, 8) * 25 + 'ms';
      shot.setAttribute('aria-label', `查看 ${p.name}`);

      const img = el('img');
      img.alt = p.name;
      img.decoding = 'async';
      img.loading = idx < 8 ? 'eager' : 'lazy';
      img.src = urlFor(p);
      shot.appendChild(img);

      shot.appendChild(el('span', 'shot__no', pad2(idx + 1)));

      const del = el('button', 'shot__del');
      del.type = 'button';
      del.setAttribute('aria-label', `删除 ${p.name}`);
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>';
      del.addEventListener('click', e => { e.stopPropagation(); removePhoto(p); });
      shot.appendChild(del);

      const at = idx;
      shot.addEventListener('click', () => openLightbox(albumList, at));

      rowEl.appendChild(shot);
      requestAnimationFrame(() => shot.classList.add('is-in'));
      idx++;
    });
    frag.appendChild(rowEl);
  });
  grid.appendChild(frag);
}

let relayoutT = 0;
addEventListener('resize', () => {
  clearTimeout(relayoutT);
  relayoutT = setTimeout(() => {
    globe?.resize();
    if (albumEl.classList.contains('is-open')) renderAlbumGrid();
    dust?.resize();
  }, 180);
});

/* ───────── 上传 ───────── */
let busy = false;

function hasFiles(e) {
  const t = e.dataTransfer?.types;
  return !!t && [...t].includes('Files');
}

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
function makeThumb(canvas) {
  const w = Math.min(1280, canvas.width);
  const h = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.82);
}

async function uploadTo(landmarkId, files) {
  if (busy || !files?.length) return;
  const lm = landmarkById(landmarkId);
  if (!lm) return;

  const inline = albumEl.classList.contains('is-open') && state.current === landmarkId;
  const say = (m, err) => (inline ? showNote(m, err) : toast(m, err));

  busy = true;
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name));
  let ok = 0, skip = 0;

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    say(`正在入库 ${i + 1} / ${list.length}`);
    if (f.size > MAX_BYTES) { skip++; continue; }
    let img;
    try { img = await decodeImage(f); } catch { skip++; continue; }

    const full = fitCanvas(img, MAX_PX);
    const blob = await new Promise(r => full.toBlob(r, 'image/jpeg', 0.93));
    const thumb = makeThumb(full);
    const exif = await readExif(f).catch(() => null);

    const rec = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      landmarkId,
      name: (f.name.replace(/\.[^.]+$/, '') || '未命名').slice(0, 46),
      blob, thumb, exif,
      w: full.width, h: full.height,
      t: Date.now() + i
    };
    try { await dbPut(rec); } catch { skip++; continue; }
    state.photos.unshift(rec);
    ok++;
  }

  busy = false;
  syncStats();
  updateCard(lm);
  if (state.current === landmarkId) {
    albumList = photosOf(landmarkId);
    renderAlbumGrid();
    $('#album-meta').innerHTML = [lm.coord, lm.date, `${albumList.length} 张照片`]
      .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');
    albumScroll.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }
  say(ok ? `${lm.name} · 已加入 ${ok} 张${skip ? ` · ${skip} 张跳过` : ''}` : '没有可用的图片', !ok);
}

async function removePhoto(p) {
  await dbDel(p.id);
  dropURL(p.id);
  state.photos = state.photos.filter(x => x.id !== p.id);
  const lm = currentLandmark();
  if (lm && lm.coverId === p.id) { lm.coverId = null; saveLandmarks(); }
  albumList = lm ? photosOf(lm.id) : [];
  renderAlbumGrid();
  syncStats();
  renderWall();
  showNote('已移除');
}

/* ───────── 大图 ───────── */
const lbEl = $('#lb');
const lbImg = $('#lb-img');
const lbStage = $('#lb-stage');
const lbState = { list: [], index: 0, open: false, s: 1, x: 0, y: 0 };

function openLightbox(list, index) {
  lbState.list = list;
  lbState.open = true;
  lbEl.classList.add('is-open');
  lbEl.setAttribute('aria-hidden', 'false');
  setLock(true);
  buildRail();
  lbShow(index);
  $('#lb-close').focus({ preventScroll: true });
}
function closeLightbox() {
  lbState.open = false;
  lbEl.classList.remove('is-open');
  lbEl.setAttribute('aria-hidden', 'true');
  setLock(albumEl.classList.contains('is-open'));
  resetZoom();
}
function buildRail() {
  const rail = $('#lb-rail');
  rail.innerHTML = '';
  lbState.list.forEach((p, i) => {
    const b = el('button', 'lb__thumb');
    b.type = 'button';
    b.setAttribute('aria-label', p.name);
    const im = el('img');
    im.src = p.thumb || urlFor(p);
    im.alt = '';
    b.appendChild(im);
    b.addEventListener('click', () => lbShow(i));
    rail.appendChild(b);
  });
}
function lbShow(i) {
  const p = lbState.list[i];
  if (!p) return;
  lbState.index = i;
  lbImg.src = urlFor(p);
  lbImg.alt = p.name;
  $('#lb-no').textContent = `${pad2(i + 1)} / ${pad2(lbState.list.length)}`;
  $('#lb-name').textContent = p.name;
  const x = p.exif;
  const bits = x ? [x.camera, x.fl, x.f, x.ss, x.iso, x.date].filter(Boolean) : [];
  $('#lb-exif').innerHTML = bits.length
    ? bits.map(v => `<span>${esc(v)}</span>`).join('')
    : `<span>${p.w}×${p.h}</span>`;
  $('#lb-prev').disabled = i === 0;
  $('#lb-next').disabled = i === lbState.list.length - 1;
  $$('.lb__thumb').forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
  $$('.lb__thumb')[i]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });

  const lm = landmarkById(p.landmarkId);
  const coverBtn = $('#lb-cover');
  if (coverBtn) {
    const isCover = lm?.coverId ? lm.coverId === p.id : photosOf(p.landmarkId)[0]?.id === p.id;
    coverBtn.textContent = isCover ? '已是封面' : '设为封面';
    coverBtn.disabled = isCover;
  }
  resetZoom();
}

function resetZoom() {
  lbState.s = 1; lbState.x = 0; lbState.y = 0;
  applyZoom();
}
function applyZoom() {
  lbImg.style.transform = `translate(${lbState.x}px, ${lbState.y}px) scale(${lbState.s})`;
  lbStage.classList.toggle('is-zoom', lbState.s > 1.01);
}
function clampPan() {
  if (lbState.s <= 1.01) { lbState.x = 0; lbState.y = 0; return; }
  const r = lbImg.getBoundingClientRect();
  const w = r.width / lbState.s, h = r.height / lbState.s;
  const maxX = Math.max(0, (w * (lbState.s - 1)) / 2);
  const maxY = Math.max(0, (h * (lbState.s - 1)) / 2);
  lbState.x = clamp(lbState.x, -maxX, maxX);
  lbState.y = clamp(lbState.y, -maxY, maxY);
}

lbImg.addEventListener('dblclick', e => {
  e.preventDefault();
  if (lbState.s > 1.01) resetZoom();
  else { lbState.s = 2.2; applyZoom(); clampPan(); }
});
lbStage.addEventListener('wheel', e => {
  if (!lbState.open) return;
  e.preventDefault();
  lbState.s = clamp(lbState.s * (e.deltaY > 0 ? 0.88 : 1.12), 1, 4);
  if (lbState.s <= 1.01) { lbState.x = 0; lbState.y = 0; }
  applyZoom(); clampPan();
}, { passive: false });

let panning = null;
lbImg.addEventListener('pointerdown', e => {
  if (lbState.s <= 1.01) return;
  e.preventDefault();
  panning = { x: e.clientX, y: e.clientY, ox: lbState.x, oy: lbState.y };
  lbStage.classList.add('is-pan');
  lbImg.setPointerCapture?.(e.pointerId);
});
lbImg.addEventListener('pointermove', e => {
  if (!panning) return;
  lbState.x = panning.ox + (e.clientX - panning.x);
  lbState.y = panning.oy + (e.clientY - panning.y);
  applyZoom();
});
lbImg.addEventListener('pointerup', () => {
  panning = null;
  lbStage.classList.remove('is-pan');
  clampPan(); applyZoom();
});

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

let toastTimer = 0;
function toast(msg, isError) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('is-error', !!isError);
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

/* ───────── 命令面板 ───────── */
const palette = $('#palette');
const palInput = $('#pal-input');
const palList = $('#pal-list');
let palItems = [], palIndex = 0;

const ACTIONS = [
  { id: 'act-new', label: '新建地标', meta: '', key: 'N', run: () => openDialog() },
  { id: 'act-globe', label: '打开地球', meta: '', key: 'G', run: () => { setView('globe'); document.getElementById('globe')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
  { id: 'act-index', label: '打开索引', meta: '', key: 'I', run: () => { setView('index'); document.getElementById('index')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
  { id: 'act-theme', label: '切换明暗主题', meta: '', key: 'T', run: toggleTheme },
  { id: 'act-settings', label: '站点设置', meta: '', key: 'S', run: () => openSettings() },
  { id: 'act-export', label: '导出作品集', meta: '', key: 'E', run: () => exportStandalone() }
];

function openPalette() {
  palette.classList.add('is-open');
  palette.setAttribute('aria-hidden', 'false');
  setLock(true);
  palInput.value = '';
  renderPalette('');
  setTimeout(() => palInput.focus(), 30);
}
function closePalette() {
  palette.classList.remove('is-open');
  palette.setAttribute('aria-hidden', 'true');
  setLock(albumEl.classList.contains('is-open') || lbState.open);
}

function mark(label, q) {
  if (!q) return esc(label);
  const i = label.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(label);
  return esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + q.length)) + '</mark>' + esc(label.slice(i + q.length));
}

function renderPalette(q) {
  const query = q.trim();
  const ql = query.toLowerCase();
  palItems = [];
  palList.innerHTML = '';

  const groups = [];

  const lms = state.landmarks
    .filter(l => !ql || l.name.toLowerCase().includes(ql) || (l.coord || '').toLowerCase().includes(ql) || (l.note || '').toLowerCase().includes(ql))
    .slice(0, 6)
    .map(l => ({
      id: l.id, label: l.name, meta: `${photosOf(l.id).length} 张`, kind: 'landmark',
      thumb: coverOf(l)?.thumb || '', run: () => openAlbum(l.id)
    }));
  if (lms.length) groups.push({ name: '地标', items: lms });

  if (query) {
    const shots = state.photos
      .filter(p => (p.name || '').toLowerCase().includes(ql))
      .slice(0, 6)
      .map(p => {
        const lm = landmarkById(p.landmarkId);
        return {
          id: p.id, label: p.name, meta: lm?.name || '照片', kind: 'photo',
          thumb: p.thumb || '', run: () => {
            openAlbum(p.landmarkId);
            setTimeout(() => {
              const list = photosOf(p.landmarkId);
              const i = list.findIndex(x => x.id === p.id);
              if (i >= 0) openLightbox(list, i);
            }, 380);
          }
        };
      });
    if (shots.length) groups.push({ name: '照片', items: shots });
  }

  const acts = ACTIONS.filter(a => !ql || a.label.toLowerCase().includes(ql));
  if (acts.length) groups.push({ name: '命令', items: acts });

  let i = 0;
  groups.forEach(g => {
    palList.appendChild(el('p', 'pal__group', g.name));
    g.items.forEach(it => {
      const b = el('button', 'pal__item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.dataset.i = i;
      b.innerHTML =
        `<span class="pal__key">${it.thumb ? `<img src="${it.thumb}" alt="">` : esc(it.key || '·')}</span>` +
        `<span class="pal__label">${mark(it.label, query)}</span>` +
        `<span class="pal__meta">${esc(it.meta || '')}</span>`;
      b.addEventListener('click', () => { closePalette(); it.run(); });
      palList.appendChild(b);
      palItems.push(it);
      i++;
    });
  });

  if (!palItems.length) palList.innerHTML = '<p class="pal__none">没有匹配的地标或照片。</p>';
  $('#pal-count').textContent = palItems.length ? `${palItems.length} 项` : '';
  palIndex = 0;
  paintPalSelection();
}

function paintPalSelection() {
  $$('.pal__item').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.i === palIndex)));
  $$('.pal__item')[palIndex]?.scrollIntoView({ block: 'nearest' });
}

palInput.addEventListener('input', () => renderPalette(palInput.value));
palInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    palIndex = Math.min(palItems.length - 1, palIndex + 1);
    paintPalSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    palIndex = Math.max(0, palIndex - 1);
    paintPalSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const it = palItems[palIndex];
    if (it) { closePalette(); it.run(); }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  }
});
palette.addEventListener('click', e => { if (e.target === palette) closePalette(); });

/* ───────── 地标表单 ───────── */
const dlg = $('#dlg');
let swatchPick = ACCENTS[0];
let pickGeo = null;

function paintSwatches(active) {
  const box = $('#swatches');
  box.innerHTML = '';
  swatchPick = active || ACCENTS[0];
  ACCENTS.forEach(c => {
    const b = el('button');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', `颜色 ${c}`);
    b.setAttribute('aria-pressed', String(c.toLowerCase() === swatchPick.toLowerCase()));
    b.addEventListener('click', () => {
      $$('button', box).forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      swatchPick = c;
    });
    box.appendChild(b);
  });
}

function openDialog(geo) {
  state.editing = null;
  pickGeo = geo || null;
  $('#dlg-form').reset();
  $('#dlg-kicker').textContent = 'NEW LANDMARK';
  $('#dlg-title').textContent = '新建地标';
  $('#dlg-submit').textContent = '建这一本';
  $('#dlg-err').hidden = true;
  paintSwatches(ACCENTS[Math.floor(Math.random() * ACCENTS.length)]);
  if (geo) $('#f-coord').value = fmtCoord(geo.lat, geo.lng);
  dlg.showModal();
  setTimeout(() => $('#f-name').focus(), 60);
}

function openEditDialog(lm) {
  if (!lm) return;
  state.editing = lm.id;
  pickGeo = lm.lat != null ? { lat: lm.lat, lng: lm.lng } : null;
  $('#dlg-kicker').textContent = 'EDIT LANDMARK';
  $('#dlg-title').textContent = '编辑地标';
  $('#dlg-submit').textContent = '保存';
  $('#dlg-err').hidden = true;
  $('#f-name').value = lm.name;
  $('#f-coord').value = lm.coord || '';
  $('#f-date').value = lm.date || '';
  $('#f-note').value = lm.note || '';
  paintSwatches(lm.accent);
  dlg.showModal();
  setTimeout(() => $('#f-name').focus(), 60);
}

$('#dlg-cancel').addEventListener('click', () => dlg.close());
$('#dlg-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = ($('#f-name').value || '').trim();
  if (!name) { $('#dlg-err').hidden = false; $('#dlg-err').textContent = '给这处地方一个名字。'; return; }
  const coordRaw = ($('#f-coord').value || '').trim();
  const geo = parseCoord(coordRaw) || pickGeo;

  if (state.editing) {
    const lm = landmarkById(state.editing);
    if (!lm) return;
    lm.name = name.slice(0, 16);
    lm.coord = coordRaw || (geo ? fmtCoord(geo.lat, geo.lng) : '');
    lm.date = ($('#f-date').value || '').trim();
    lm.note = ($('#f-note').value || '').trim();
    lm.accent = swatchPick;
    lm.lat = geo ? geo.lat : null;
    lm.lng = geo ? geo.lng : null;
    saveLandmarks();
    dlg.close();
    openAlbum(lm.id);
    syncGlobe();
    return;
  }

  const lm = normalizeLM({
    id: 'lm-' + Date.now().toString(36),
    name: name.slice(0, 16),
    coord: coordRaw || (geo ? fmtCoord(geo.lat, geo.lng) : ''),
    date: ($('#f-date').value || '').trim(),
    note: ($('#f-note').value || '').trim(),
    accent: swatchPick,
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    createdAt: Date.now()
  });
  state.landmarks.unshift(lm);
  saveLandmarks();
  dlg.close();
  renderWall();
  syncGlobe();

  const pending = state.pendingFiles;
  state.pendingFiles = null;
  setTimeout(() => {
    openAlbum(lm.id);
    if (pending?.length) uploadTo(lm.id, pending);
  }, 140);
});

/* ───────── 站点设置 ───────── */
function openSettings() {
  const s = state.site || DEFAULT_SITE;
  $('#s-name').value = s.name;
  $('#s-cn').value = s.cn;
  $('#s-title').value = s.title;
  $('#s-lede').value = s.lede || '';
  $('#dlg-site').showModal();
  setTimeout(() => $('#s-name').focus(), 60);
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
  try { localStorage.setItem(LS_SITE, JSON.stringify(next)); } catch {}
  $('#dlg-site').close();
});

/* ───────── 删除 ───────── */
{
  const del = $('#album-delete');
  let armed = 0;
  del.addEventListener('click', async () => {
    const lm = currentLandmark();
    if (!lm) return;
    if (!armed) {
      armed = setTimeout(() => {
        armed = 0;
        del.textContent = '删除';
        del.classList.remove('is-armed');
      }, 2800);
      del.textContent = '确定删除？';
      del.classList.add('is-armed');
      return;
    }
    clearTimeout(armed); armed = 0;
    del.textContent = '删除';
    del.classList.remove('is-armed');
    for (const p of photosOf(lm.id)) {
      await dbDel(p.id);
      dropURL(p.id);
    }
    state.photos = state.photos.filter(p => p.landmarkId !== lm.id);
    state.landmarks = state.landmarks.filter(x => x.id !== lm.id);
    saveLandmarks();
    closeAlbum();
    syncGlobe();
  });
}

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

/* ───────── 拖放 ───────── */
const dropzone = $('#dropzone');
const fileInput = $('#file');

['dragenter', 'dragover'].forEach(ev =>
  dropzone.addEventListener(ev, e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('is-drag');
  }));
['dragleave', 'dragend'].forEach(ev =>
  dropzone.addEventListener(ev, () => dropzone.classList.remove('is-drag')));
dropzone.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  dropzone.classList.remove('is-drag');
  if (state.current) uploadTo(state.current, e.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  if (state.current) uploadTo(state.current, fileInput.files);
  fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('is-dragging');
});
window.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('is-dragging');
});
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging');
  if (albumEl.classList.contains('is-open')) {
    if (state.current) uploadTo(state.current, e.dataTransfer.files);
    return;
  }
  state.pendingFiles = [...e.dataTransfer.files];
  openDialog();
  showNote('地标签好之后，这些照片会入这本书');
});

/* ───────── 导出 ───────── */
function buildExport() {
  const groups = state.landmarks
    .map(lm => ({ lm, list: photosOf(lm.id) }))
    .filter(g => g.list.length);
  const total = groups.reduce((a, g) => a + g.list.length, 0);
  const date = new Date().toISOString().slice(0, 10);

  const sections = groups.map(g => {
    const shots = g.list.map(p =>
      `<figure><img src="${p.thumb || ''}" alt="${esc(p.name)}" loading="lazy">` +
      `<figcaption>${esc(p.name)}</figcaption></figure>`).join('');
    const meta = [g.lm.coord, g.lm.date].filter(Boolean).join('  ·  ');
    return `<section class="ch"><header><p class="kick">ALBUM ${pad2(state.landmarks.indexOf(g.lm) + 1)}</p>` +
      `<h2>${esc(g.lm.name)}</h2>` +
      `<p class="meta">${esc(meta)}${meta ? '  ·  ' : ''}${g.list.length} 张</p>` +
      (g.lm.note ? `<p class="note">${esc(g.lm.note)}</p>` : '') +
      `</header><div class="grid">${shots}</div></section>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(state.site.name)} · ${esc(state.site.cn)}</title><style>${EXPORT_CSS}</style></head><body>` +
    `<header class="top"><span class="mark">${esc(state.site.name)}<em>${esc(state.site.cn)}</em></span>` +
    `<span class="stat">${groups.length} 地标 · ${total} 张</span></header>` +
    `<div class="hero"><h1>${esc(state.site.title)}</h1>` +
    (state.site.lede ? `<p>${esc(state.site.lede)}</p>` : '') + `</div>` +
    `<main>${sections}</main>` +
    `<footer><p>${esc(state.site.name)} · ${date}</p></footer></body></html>`;
}

const EXPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#08080A;color:#F4F1E9;font-family:Archivo,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:9;display:flex;align-items:center;height:60px;padding:0 clamp(18px,5vw,80px);background:rgba(8,8,10,.86);backdrop-filter:blur(18px);border-bottom:1px solid rgba(244,241,233,.1)}
.mark{font-weight:700;font-size:13px;letter-spacing:.24em}
.mark em{font-style:normal;font-size:10px;letter-spacing:.3em;color:#6A665F;margin-left:10px}
.stat{margin-left:auto;font-family:Consolas,ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6A665F}
.hero{padding:clamp(56px,10vw,150px) clamp(18px,5vw,80px) clamp(28px,4vw,54px);max-width:1100px}
.hero h1{margin:0;font-weight:400;font-size:clamp(2.6rem,8vw,7rem);line-height:.98;letter-spacing:.01em;font-family:"Songti SC",Georgia,serif}
.hero p{margin:22px 0 0;max-width:34em;color:#A6A198;font-size:14.5px;line-height:1.95}
.ch{padding:clamp(34px,5vw,80px) clamp(18px,5vw,80px);border-top:1px solid rgba(244,241,233,.1)}
.ch header{margin-bottom:clamp(20px,2.6vw,36px)}
.kick{font-family:Consolas,ui-monospace,monospace;font-size:9px;letter-spacing:.26em;color:#C9A96A;margin:0 0 10px;text-transform:uppercase}
.ch h2{margin:0;font-weight:400;font-size:clamp(1.8rem,4.4vw,3.2rem);letter-spacing:.02em;font-family:"Songti SC",Georgia,serif}
.ch .meta{font-family:Consolas,ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6A665F;margin:10px 0 0}
.ch .note{max-width:40em;color:#A6A198;font-size:13.5px;line-height:1.9;margin:8px 0 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1.2vw,16px)}
figure{margin:0}
figure img{display:block;width:100%;height:auto;background:#101014}
figcaption{padding-top:7px;font-family:Consolas,ui-monospace,monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#6A665F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{padding:clamp(36px,5vw,72px) clamp(18px,5vw,80px) 56px;border-top:1px solid rgba(244,241,233,.1)}
footer p{margin:0;font-family:Consolas,ui-monospace,monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6A665F}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
`;

function exportStandalone() {
  const groups = state.landmarks.map(lm => ({ lm, list: photosOf(lm.id) })).filter(g => g.list.length);
  if (!groups.length) { showNote('先放几张照片，再导出', true); return; }
  const blob = new Blob([buildExport()], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `atlas-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showNote('已导出 · 单个 HTML，双击可看');
}

/* ───────── 滚动、磁吸与入场 ───────── */
const bar = $('#top');
const progressBar = $('#progress-bar');

function onScroll() {
  const y = scrollY;
  bar.classList.toggle('is-stuck', y > 24);
  const h = document.documentElement.scrollHeight - innerHeight;
  progressBar.style.transform = `scaleX(${h > 0 ? clamp(y / h, 0, 1) : 0})`;
}

const heroGlow = $('#hero-glow');
const heroEl = $('#hero');
heroEl?.addEventListener('pointermove', e => {
  const r = heroEl.getBoundingClientRect();
  heroGlow.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
  heroGlow.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
}, { passive: true });

$$('.cta').forEach(btn => {
  btn.addEventListener('pointermove', e => {
    const r = btn.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    btn.style.transform = `translate(${dx * 4}px, ${dy * 3}px)`;
  });
  btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
});

/* ───────── 键盘 ───────── */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.classList.contains('is-open') ? closePalette() : openPalette();
    return;
  }

  if (lbState.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbShow(Math.max(0, lbState.index - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbShow(Math.min(lbState.list.length - 1, lbState.index + 1)); }
    else if (e.key === '0') { resetZoom(); }
    return;
  }

  if (e.key === 'Escape') {
    if (palette.classList.contains('is-open')) { closePalette(); return; }
    if (dlg.open || $('#dlg-site').open) return;
    if (albumEl.classList.contains('is-open')) closeAlbum();
    return;
  }

  if (typing || dlg.open || $('#dlg-site').open) return;
  if (albumEl.classList.contains('is-open')) return;

  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openDialog(); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSettings(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleTheme(); }
  else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); exportStandalone(); }
  else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setView('globe'); }
  else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setView('index'); }
  else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); setView('wall'); }
  else if (e.key === '/') { e.preventDefault(); openPalette(); }
});

/* ───────── 绑定 ───────── */
$$('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#btn-palette').addEventListener('click', openPalette);
$('#btn-theme').addEventListener('click', toggleTheme);
$('#btn-new').addEventListener('click', () => openDialog());
$('#wall-empty-new')?.addEventListener('click', () => openDialog());
$('#hero-new').addEventListener('click', () => openDialog());
$('#hero-globe').addEventListener('click', () => {
  setView('globe');
  document.getElementById('globe')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
});
$('#orb-reset')?.addEventListener('click', () => globe?.reset());
$('#album-close').addEventListener('click', closeAlbum);
$('#album-edit').addEventListener('click', () => openEditDialog(currentLandmark()));
$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-prev').addEventListener('click', () => lbShow(Math.max(0, lbState.index - 1)));
$('#lb-next').addEventListener('click', () => lbShow(Math.min(lbState.list.length - 1, lbState.index + 1)));
$('#lb-cover')?.addEventListener('click', () => {
  const p = lbState.list[lbState.index];
  const lm = p && landmarkById(p.landmarkId);
  if (!lm) return;
  lm.coverId = p.id;
  saveLandmarks();
  renderWall();
  const btn = $('#lb-cover');
  btn.textContent = '已是封面';
  btn.disabled = true;
  showNote('已设为这本的封面');
});
lbEl.addEventListener('click', e => {
  if (e.target === lbEl || e.target === lbStage) closeLightbox();
});
albumScroll.addEventListener('scroll', () => {
  albumScroll.querySelector('.album__bar')?.classList.toggle('is-stuck', albumScroll.scrollTop > 36);
}, { passive: true });
addEventListener('scroll', onScroll, { passive: true });

/* ───────── 启动 ───────── */
async function boot() {
  applyTheme(localStorage.getItem(LS_THEME) === 'light' ? 'light' : 'dark');

  state.site = loadSite();
  applySite(state.site);

  const stored = loadLandmarks();
  if (stored) state.landmarks = stored;

  try { state.photos = await dbAll(); }
  catch { state.photos = []; }

  const dustCanvas = $('#dust');
  if (dustCanvas) dust = createDust(dustCanvas);

  const year = new Date().getFullYear();
  const yn = $('#year-now'); if (yn) yn.textContent = year;
  const hy = $('#hero-year'); if (hy) hy.textContent = year;
  const km = $('#kbd-mod'); if (km) km.textContent = isMac ? '⌘K' : 'Ctrl K';

  initGlobe();
  renderWall();
  syncGlobe();

  let savedView = null;
  try { savedView = localStorage.getItem(LS_VIEW); } catch {}
  setView(savedView || 'wall', { scroll: false });
  onScroll();

  /* 首次到访：三处空白地标作引子 */
  if (!stored && !localStorage.getItem(LS_SEED)) {
    state.landmarks = [
      normalizeLM({ id: 'lm-kyoto', name: '京都', coord: '35.01°N 135.77°E', accent: ACCENTS[0] }),
      normalizeLM({ id: 'lm-reyk', name: '雷克雅未克', coord: '64.15°N 21.94°W', accent: ACCENTS[1] }),
      normalizeLM({ id: 'lm-hk', name: '香港', coord: '22.32°N 114.17°E', accent: ACCENTS[2] })
    ];
    saveLandmarks();
    try { localStorage.setItem(LS_SEED, '1'); } catch {}
    renderWall();
    syncGlobe();
  }
}

boot();
