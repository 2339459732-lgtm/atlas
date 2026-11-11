/* ══════════════════════════════════════════════════════════════════
   main.js — ATLAS
   数据仍沿用 atlas.landmarks.v4 / atlas-plates，旧照片不会丢。
   ══════════════════════════════════════════════════════════════════ */

import { readExif } from './exif.js';
import { createEarth } from './earth.js';
import { createDust } from './drift.js';
import { geocode, composeIntro } from './geo.js';
import { sha256Hex, VAULT_HASH, makeBackup, readBackup, photoBlob } from './vault.js';
import { t, applyI18n, initLang, getLang, setLang, LANGS } from './i18n.js';
import { createMusic } from './audio.js';

/* 入口私钥（SHA-256）。改口令：把新口令的 sha256 填到这里 */
const GATE_HASH = 'c7efaa94c1114dfc8e1d4007d5369b11ab55fa19dea1a31ccf5aabcb3cc39a55';
/* 入口门禁开关：改为 true 即启用（口令与 GATE_HASH 对应） */
const GATE_ENABLED = false;

/* ───────── 常量 ───────── */
const ACCENTS = ['#C9A96A', '#7FA8C9', '#C98A7F', '#9BC9A0', '#B9A0D8', '#D8C08A', '#8FA6B8', '#C97F9E'];

const LS_LM = 'atlas.landmarks.v4';
const LS_SITE = 'atlas.site.v1';
const LS_THEME = 'atlas.theme.v2';
const LS_SEED = 'atlas.seeded.v1';
const SS_UNLOCK = 'atlas.unlocked.v1';
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

const THEMES = {
  noir: {
    label: '墨夜', meta: '#07070A',
    globe: {
      spaceTop: [0.055, 0.055, 0.068], spaceBottom: [0.012, 0.012, 0.018],
      glow: [0.55, 0.42, 0.22], glowAmt: 0.24, grain: 0.012,
      ambient: 0.05, atmo: [0.24, 0.46, 0.82], stars: 1,
      exposure: 1.14, nightGain: 1, cloud: 0.9, atmoIntensity: 0.72
    }
  },
  ivory: {
    label: '宣纸', meta: '#F3F0E8',
    globe: {
      spaceTop: [0.955, 0.945, 0.92], spaceBottom: [0.985, 0.978, 0.955],
      glow: [1.0, 0.93, 0.78], glowAmt: 0.55, grain: 0.006,
      ambient: 0.17, atmo: [0.52, 0.7, 0.88], stars: 0,
      exposure: 1.02, nightGain: 0.9, cloud: 0.74, atmoIntensity: 0.46
    }
  },
  slate: {
    label: '远山', meta: '#070B10',
    globe: {
      spaceTop: [0.04, 0.058, 0.085], spaceBottom: [0.012, 0.02, 0.033],
      glow: [0.22, 0.48, 0.78], glowAmt: 0.26, grain: 0.012,
      ambient: 0.06, atmo: [0.3, 0.6, 0.98], stars: 1,
      exposure: 1.16, nightGain: 1.05, cloud: 0.88, atmoIntensity: 0.78
    }
  }
};
const THEME_ORDER = ['noir', 'ivory', 'slate'];

/* 常见地名的英文写法。地标自身有 nameEn 时优先用它。 */
const EN_CITY = {
  '北京': "Beijing", '上海': 'Shanghai', '广州': 'Guangzhou', '深圳': 'Shenzhen',
  '成都': 'Chengdu', '西安': "Xi'an", '南宁': 'Nanning', '杭州': 'Hangzhou',
  '南京': 'Nanjing', '重庆': 'Chongqing', '武汉': 'Wuhan', '厦门': 'Xiamen',
  '香港': 'Hong Kong', '澳门': 'Macao', '台北': 'Taipei', '高雄': 'Kaohsiung',
  '京都': 'Kyoto', '东京': 'Tokyo', '大阪': 'Osaka', '札幌': 'Sapporo',
  '首尔': 'Seoul', '曼谷': 'Bangkok', '新加坡': 'Singapore', '吉隆坡': 'Kuala Lumpur',
  '雷克雅未克': 'Reykjavík', '里斯本': 'Lisbon', '巴黎': 'Paris', '伦敦': 'London',
  '罗马': 'Rome', '佛罗伦萨': 'Florence', '威尼斯': 'Venice', '巴塞罗那': 'Barcelona',
  '阿姆斯特丹': 'Amsterdam', '柏林': 'Berlin', '维也纳': 'Vienna', '布拉格': 'Prague',
  '纽约': 'New York', '旧金山': 'San Francisco', '洛杉矶': 'Los Angeles',
  '温哥华': 'Vancouver', '悉尼': 'Sydney', '墨尔本': 'Melbourne', '奥克兰': 'Auckland',
  '开普敦': 'Cape Town', '圣托里尼': 'Santorini', '伊斯坦布尔': 'Istanbul'
};
const placeName = lm => (getLang() === 'en' ? (lm.nameEn || EN_CITY[lm.name] || lm.name) : lm.name);

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
const fine = () => matchMedia('(pointer: fine)').matches;

/* ───────── 状态 ───────── */
const state = {
  landmarks: [],
  photos: [],
  site: null,
  theme: 'noir',
  current: null,
  editing: null,
  pendingFiles: null
};

let earth = null;
let dust = null;

/* 各册集私钥解锁状态：只在本次会话内有效 */
let unlocked = new Set();
try { unlocked = new Set(JSON.parse(sessionStorage.getItem(SS_UNLOCK) || '[]')); } catch {}
const saveUnlocked = () => {
  try { sessionStorage.setItem(SS_UNLOCK, JSON.stringify([...unlocked])); } catch {}
};
const isLocked = lm => !!lm?.keyHash && !unlocked.has(lm.id);
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="10.5" width="14" height="9.5" rx="1.6"/><path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5"/><circle cx="12" cy="15.2" r="1.3"/></svg>';

const photosOf = id => state.photos.filter(p => p.landmarkId === id).sort((a, b) => b.t - a.t);
const landmarkById = id => state.landmarks.find(l => l.id === id);
const coverOf = lm => {
  const list = photosOf(lm.id);
  return list.find(p => p.id === lm.coverId) || list[0] || null;
};
const currentLandmark = () => landmarkById(state.current);

/* ───────── 滚动锁 ───────── */
function setLock(on) {
  document.body.classList.toggle('is-locked', !!on);
}

/* ───────── objectURL ───────── */
const urlCache = new Map();
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
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
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
  let custom = false;
  try { custom = !!localStorage.getItem(LS_SITE); } catch {}
  const title = custom ? site.title : t('site.title');
  const lede = custom ? (site.lede || '') : t('site.lede');
  const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  set('site-name', site.name);
  set('site-lede', lede);
  set('hero-site', site.name);
  document.title = site.name;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute('content', lede || title);
}

/* ───────── 主题 ───────── */
function applyTheme(name) {
  const key = THEMES[name] ? name : 'noir';
  state.theme = key;
  document.documentElement.dataset.theme = key;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEMES[key].meta);
  $$('.theme__pop [data-theme]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.theme === key)));
  earth?.setTheme(THEMES[key].globe);
  dust?.retheme();
  try { localStorage.setItem(LS_THEME, key); } catch {}
}
function cycleTheme() {
  const i = THEME_ORDER.indexOf(state.theme);
  applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
}

/* ───────── 地标 ───────── */
function normalizeLM(l) {
  const geo = (l.lat != null && l.lng != null && isFinite(l.lat) && isFinite(l.lng))
    ? { lat: +l.lat, lng: +l.lng }
    : parseCoord(l.coord || '');
  return {
    id: l.id || 'lm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: l.name || (getLang() === 'en' ? 'Untitled' : '未命名'),
    nameEn: l.nameEn || '',
    coord: l.coord || (geo ? fmtCoord(geo.lat, geo.lng) : ''),
    date: l.date || '',
    note: l.note || '',
    accent: l.accent || ACCENTS[0],
    coverId: l.coverId || null,
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    keyHash: l.keyHash || '',
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
  setT('colophon-stat', `${t('planet.count', { n: lm })} · ${t('ov.count', { n: ph })}`);
  setT('planet-count', t('planet.count', { n: lm }));

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

    const card = el('button', `card card--w${span} reveal`);
    card.type = 'button';
    card.style.setProperty('--ac', lm.accent);
    card.style.transitionDelay = `${Math.min(i, 6) * 45}ms`;
    card.setAttribute('aria-label', `${placeName(lm)} · ${t('wall.photoCount', { n: photos.length })}`);

    const frame = el('div', 'card__frame' + (cover ? '' : ' is-empty'));
    if (cover) {
      const img = el('img');
      img.alt = t('wall.coverAlt', { name: placeName(lm) });
      img.loading = i > 3 ? 'lazy' : 'eager';
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
      img.src = cover.thumb || urlFor(cover);
      if (img.complete) img.classList.add('is-in');
      frame.appendChild(img);
      frame.appendChild(el('div', 'card__veil'));
      frame.appendChild(el('span', 'card__hint', t('wall.open')));
    } else {
      frame.appendChild(el('span', 'card__ghost', esc(lm.name)));
    }
    if (isLocked(lm)) {
      card.classList.add('is-locked');
      frame.appendChild(el('div', 'card__lockbadge', LOCK_SVG));
    }
    card.appendChild(frame);

    const body = el('div', 'card__body');
    body.innerHTML =
      `<span class="card__no">№${pad2(i + 1)}</span>` +
      `<span class="card__name"><i class="card__dot"></i>${esc(placeName(lm))}</span>` +
      `<span class="card__count">${isLocked(lm) ? t('ov.locked') : (photos.length ? t('wall.photoCount', { n: photos.length }) : t('wall.empty0'))}</span>` +
      `<span class="card__sub">${esc(lm.coord || lm.date || t('wall.unlocated'))}</span>`;
    card.appendChild(body);

    card.addEventListener('click', e => openAlbum(lm.id, e));
    attachTilt(card);

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
    revealObserve(card);
  });

  syncStats();
  renderIndex();
  if (typeof renderOverview === 'function') renderOverview();
}

function updateCard(lm) {
  const i = state.landmarks.indexOf(lm);
  const card = $$('.card')[i];
  if (!card) return;
  const n = photosOf(lm.id).length;
  const cnt = card.querySelector('.card__count');
  if (cnt) cnt.textContent = n ? t('wall.photoCount', { n }) : t('wall.empty0');
  const frame = card.querySelector('.card__frame');
  if (frame?.classList.contains('is-empty') && n) renderWall();
}

/* 轻量 3D 倾斜 */
function attachTilt(card) {
  if (!fine() || reduced()) return;
  let raf = 0, tx = 0, ty = 0;
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      card.style.transform =
        `perspective(900px) rotateX(${(-ty * 2.2).toFixed(2)}deg) rotateY(${(tx * 2.6).toFixed(2)}deg) translateY(-3px)`;
    });
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
}

/* ───────── 索引 ───────── */
function renderIndex() {
  const list = $('#idx-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.landmarks.length) {
    list.innerHTML = `<p class="ledger__empty">${esc(t('idx.empty'))}</p>`;
    return;
  }
  state.landmarks.forEach((lm, i) => {
    const photos = photosOf(lm.id);
    const row = el('button', 'row');
    row.type = 'button';
    row.style.setProperty('--ac', lm.accent);
    row.innerHTML =
      `<span class="row__no">${pad2(i + 1)}</span>` +
      `<span class="row__name"><i class="row__dot"></i>${esc(placeName(lm))}</span>` +
      `<span class="row__coord">${esc(lm.coord || '—')}</span>` +
      `<span class="row__date">${esc(lm.date || '—')}</span>` +
      `<span class="row__count">${t('wall.photoCount', { n: photos.length })}</span>` +
      `<span class="row__arrow">→</span>`;
    row.addEventListener('click', e => openAlbum(lm.id, e));
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
  if (!fine()) return;
  const cover = coverOf(lm);
  if (!cover) return;
  peek.querySelector('img').src = cover.thumb || urlFor(cover);
  peek.classList.add('is-on');
  peekOn = true;
}
function hidePeek() { peek.classList.remove('is-on'); peekOn = false; }
document.addEventListener('mousemove', e => {
  if (!peekOn) return;
  peek.style.transform = `translate(${Math.min(e.clientX + 24, innerWidth - 266)}px, ${Math.min(Math.max(e.clientY - 86, 12), innerHeight - 190)}px)`;
});

/* ───────── 地球 ───────── */
const earthCanvas = $('#earth-canvas');
const markerLayer = $('#markers');
const loader = $('#earth-loader');
const progressEl = $('#earth-progress');

let markers = [];
let earthStarted = false;

function initEarth() {
  if (earth || !earthCanvas) return;
  earth = createEarth(earthCanvas, {
    onPick: m => openAlbum(m.id),
    onHover: m => {
      $$('.planet__item').forEach(b => b.classList.toggle('is-lit', !!m && b.dataset.id === m.id));
      $$('.marker').forEach(x => x.classList.toggle('is-lit', !!m && x.dataset.id === m.id));
    },
    onEmpty: geo => openDialog({ lat: geo.lat, lng: geo.lng }),
    onReady: ({ ok }) => {
      if (!ok) {
        loader.classList.add('is-done');
        toast(t('planet.toastNoWebgl'), true);
        return;
      }
      loader.classList.add('is-done');
      buildMarkers();
    },
    onProject: ({ project }) => updateMarkers(project)
  });
  if (!earth) {
    loader.innerHTML = `<span class="planet__loader-t">${esc(t('planet.noWebgl'))}</span>`;
    return;
  }
  earth.setTheme(THEMES[state.theme].globe);
  window.atlasEarth = earth;   /* 调试/验收用只读句柄 */
}

function buildMarkers() {
  if (!markerLayer) return;
  markerLayer.innerHTML = '';
  markers = state.landmarks
    .filter(l => l.lat != null && l.lng != null)
    .map(l => {
      const b = el('button', 'marker');
      b.type = 'button';
      b.dataset.id = l.id;
      b.style.setProperty('--ac', l.accent);
      b.setAttribute('aria-label', `${placeName(l)} · ${t('wall.photoCount', { n: photosOf(l.id).length })}`);
      b.innerHTML =
        `<span class="marker__ring"></span>` +
        `<span class="marker__dot"></span>` +
        `<span class="marker__label">${esc(placeName(l))}</span>` +
        `<span class="marker__card"><span class="marker__name">${esc(placeName(l))}</span>` +
        `<span class="marker__meta">${esc(l.coord || t('wall.unlocated'))} · ${esc(t('wall.photoCount', { n: photosOf(l.id).length }))}</span></span>`;
      b.addEventListener('click', e => {
        e.stopPropagation();
        openAlbum(l.id, e);
      });
      b.addEventListener('mouseenter', () => {
        earth?.setHovered(l.id);
        $$('.planet__item').forEach(x => x.classList.toggle('is-lit', x.dataset.id === l.id));
      });
      b.addEventListener('mouseleave', () => {
        earth?.setHovered(null);
        $$('.planet__item').forEach(x => x.classList.remove('is-lit'));
      });
      markerLayer.appendChild(b);
      return { id: l.id, lat: l.lat, lng: l.lng, name: l.name, el: b, _x: 0, _y: 0, _visible: false };
    });
  earth?.setMarkers(markers);
  requestAnimationFrame(() => {
    markers.forEach(m => {
      const lb = m.el.querySelector('.marker__label');
      if (lb) m._lw = lb.offsetWidth;
    });
  });
  renderPlanetList();
}

const labelBoxes = [];

function updateMarkers(project) {
  labelBoxes.length = 0;

  for (const m of markers) {
    const p = project(m.lat, m.lng);
    m._x = p.x; m._y = p.y; m._visible = p.visible;
    if (!p.visible) {
      m.el.style.opacity = '0';
      m.el.style.pointerEvents = 'none';
      continue;
    }
    const depth = clamp((p.depth - 0.02) / 1.1, 0, 1);
    m._depth = depth;
    m.el.style.transform =
      `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${(0.86 + depth * 0.2).toFixed(3)})`;
    m.el.style.opacity = String(0.5 + depth * 0.5);
    m.el.style.pointerEvents = 'auto';
    m.el.style.zIndex = String(10 + Math.round(depth * 20));
    m.el.classList.toggle('is-left', p.x > state.w * 0.6);
  }

  /* 屏幕空间避让：越靠近球心越优先，重叠者只留圆点 */
  const order = markers
    .filter(m => m._visible && m._depth > 0.22)
    .sort((a, b) => (b._depth || 0) - (a._depth || 0));

  for (const m of order) {
    const w = m._lw || 86;
    const h = 22;
    const left = m.el.classList.contains('is-left') ? m._x - 18 - w : m._x + 18;
    const box = { l: left, r: left + w, t: m._y - h / 2, b: m._y + h / 2 };
    const clash = labelBoxes.some(o => !(box.r < o.l || box.l > o.r || box.b < o.t || box.t > o.b));
    m.el.style.setProperty('--label', clash ? '0' : '1');
    if (!clash) labelBoxes.push(box);
  }
  markers.forEach(m => {
    if (!m._visible || !(m._depth > 0.22)) m.el.style.setProperty('--label', '0');
  });
}

function renderPlanetList() {
  const list = $('#planet-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.landmarks.length) {
    list.innerHTML = `<li class="planet__item" style="pointer-events:none;color:var(--ink-3)">${t('planet.empty')}</li>`;
    return;
  }
  state.landmarks.forEach((l, i) => {
    const b = el('button', 'planet__item');
    b.type = 'button';
    b.dataset.id = l.id;
    b.innerHTML =
      `<i>${pad2(i + 1)}</i>` +
      `<b>${esc(placeName(l))}</b>` +
      `<em>${photosOf(l.id).length}</em>`;
    b.addEventListener('mouseenter', () => {
      earth?.setHovered(l.id);
      $$('.marker').forEach(x => x.classList.toggle('is-lit', x.dataset.id === l.id));
    });
    b.addEventListener('mouseleave', () => {
      earth?.setHovered(null);
      $$('.marker').forEach(x => x.classList.remove('is-lit'));
    });
    b.addEventListener('click', e => {
      if (l.lat != null) earth?.focus(l.lat, l.lng);
      openAlbum(l.id, e);
    });
    list.appendChild(b);
  });
}

function syncEarth() {
  initEarth();
  if (!earth) return;
  buildMarkers();
}

/* ───────── 导航与滚动 ───────── */
const navEl = $('#nav');
const scrollBar = $('#scroll-bar');
let scrollQueued = false;

function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const y = scrollY;
    navEl.classList.toggle('is-stuck', y > 20);
    const h = document.documentElement.scrollHeight - innerHeight;
    scrollBar.style.transform = `scaleX(${h > 0 ? clamp(y / h, 0, 1) : 0})`;

    /* 当前章节：取视口中线所在的区块 */
    const mid = y + innerHeight * 0.42;
    let active = '';
    ['overview', 'planet', 'wall', 'index'].forEach(id => {
      const n = document.getElementById(id);
      if (n && n.offsetTop <= mid) active = id;
    });
    $$('.nav__links a').forEach(a => a.classList.toggle('is-active', a.dataset.nav === active));
  });
}

function initNavSpy() { /* 由 onScroll 统一计算，避免隐藏区块误判 */ }

/* ───────── 入场 ───────── */
let revealIO = null;
function initRevealObserver() {
  if (!('IntersectionObserver' in window)) return;
  revealIO = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('is-in');
        revealIO.unobserve(en.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  $$('.sechead, .foot-hint, .colophon__top, .planet__panel > *').forEach((n, i) => {
    n.classList.add('reveal');
    if (i % 3 === 1) n.classList.add('reveal-d1');
    if (i % 3 === 2) n.classList.add('reveal-d2');
    revealIO.observe(n);
  });
}
function revealObserve(node) {
  if (revealIO) revealIO.observe(node);
  else node.classList.add('is-in');
}

/* ───────── 相册 ───────── */
const albumEl = $('#album');
const albumScroll = $('#album-scroll');
let albumList = [];

function openAlbum(id, ev) {
  const lm = landmarkById(id);
  if (!lm) return;
  state.current = id;
  hidePeek();

  if (ev?.clientX != null) {
    albumEl.style.setProperty('--ox', `${(ev.clientX / innerWidth) * 100}%`);
    albumEl.style.setProperty('--oy', `${(ev.clientY / innerHeight) * 100}%`);
  } else {
    albumEl.style.setProperty('--ox', '50%');
    albumEl.style.setProperty('--oy', '50%');
  }

  const list = photosOf(id);
  albumList = list;

  albumScroll.querySelector('.album__bar')?.classList.remove('is-stuck');

  $('#album-name').textContent = placeName(lm);
  $('#album-note').textContent = lm.note || '';
  $('#album-note').hidden = !lm.note;
  $('#album-crumb').textContent = placeName(lm);
  $('#album-kicker').textContent = `ALBUM ${pad2(state.landmarks.findIndex(l => l.id === id) + 1)}${lm.date ? ' · ' + lm.date : ''}`;
  $('#album-kicker').style.setProperty('--ac', lm.accent);

  const locked = isLocked(lm);
  $('#album-meta').innerHTML = [lm.coord, lm.date, locked ? t('ov.locked') : t('ov.count', { n: list.length })]
    .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');

  const lockEl = $('#album-locked');
  const gridEl = $('#album-grid');
  const dropEl = $('#dropzone');
  lockEl.hidden = !locked;
  gridEl.hidden = locked;
  dropEl.hidden = locked;
  $('#album-empty').hidden = true;

  if (locked) {
    albumList = [];
    gridEl.innerHTML = '';
    lockEl.classList.remove('is-shake');
    $('#album-lock-err').hidden = true;
    $('#album-key').value = '';
    setTimeout(() => $('#album-key').focus(), 420);
  } else {
    renderAlbumGrid();
  }

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
  if (id) {
    const i = state.landmarks.findIndex(l => l.id === id);
    $$('.card')[i]?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }
}

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
      shot.setAttribute('aria-label', t('lb.view', { name: p.name }));

      const img = el('img');
      img.alt = p.name;
      img.decoding = 'async';
      img.loading = idx < 8 ? 'eager' : 'lazy';
      img.src = urlFor(p);
      shot.appendChild(img);
      shot.appendChild(el('span', 'shot__no', pad2(idx + 1)));

      const del = el('button', 'shot__del');
      del.type = 'button';
      del.setAttribute('aria-label', t('lb.del', { name: p.name }));
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
    say(t('toast.uploading', { i: i + 1, n: list.length }));
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
      name: (f.name.replace(/\.[^.]+$/, '') || t('common.untitled')).slice(0, 46),
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
    $('#album-meta').innerHTML = [lm.coord, lm.date, t('ov.count', { n: albumList.length })]
      .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');
    albumScroll.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }
  if (ok) buildMarkers();
  say(ok
    ? (skip ? t('toast.addedSkip', { name: lm.name, n: ok, s: skip }) : t('toast.added', { name: lm.name, n: ok }))
    : t('toast.noImage'), !ok);
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
  buildMarkers();
  showNote(t('toast.removed'));
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
    coverBtn.textContent = isCover ? t('lb.isCover') : t('lb.cover');
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
  { id: 'act-new', label: () => t('act.new'), meta: '', key: 'N', run: () => openDialog() },
  { id: 'act-planet', label: () => t('act.planet'), meta: '', key: 'G', run: () => document.getElementById('planet')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
  { id: 'act-index', label: () => t('act.index'), meta: '', key: 'I', run: () => document.getElementById('index')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
  { id: 'act-theme', label: () => t('act.theme'), meta: '', key: 'T', run: cycleTheme },
  { id: 'act-settings', label: () => t('act.settings'), meta: '', key: 'S', run: () => openSettings() },
  { id: 'act-export', label: () => t('act.export'), meta: '', key: 'E', run: () => exportStandalone() }
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
      id: l.id, label: placeName(l), meta: t('wall.photoCount', { n: photosOf(l.id).length }), kind: 'landmark',
      thumb: coverOf(l)?.thumb || '', run: () => openAlbum(l.id)
    }));
  if (lms.length) groups.push({ name: t('pal.places'), items: lms });

  if (query) {
    const shots = state.photos
      .filter(p => (p.name || '').toLowerCase().includes(ql))
      .slice(0, 6)
      .map(p => {
        const lm = landmarkById(p.landmarkId);
        return {
          id: p.id, label: p.name, meta: lm ? placeName(lm) : t('common.photo'), kind: 'photo',
          thumb: p.thumb || '', run: () => {
            openAlbum(p.landmarkId);
            setTimeout(() => {
              const list = photosOf(p.landmarkId);
              const i = list.findIndex(x => x.id === p.id);
              if (i >= 0) openLightbox(list, i);
            }, 420);
          }
        };
      });
    if (shots.length) groups.push({ name: t('pal.photos'), items: shots });
  }

  const acts = ACTIONS.filter(a => !ql || a.label().toLowerCase().includes(ql));
  if (acts.length) groups.push({ name: t('pal.commands'), items: acts });

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
        `<span class="pal__label">${mark(typeof it.label === 'function' ? it.label() : it.label, query)}</span>` +
        `<span class="pal__meta">${esc(it.meta || '')}</span>`;
      b.addEventListener('click', () => { closePalette(); it.run(); });
      palList.appendChild(b);
      palItems.push(it);
      i++;
    });
  });

  if (!palItems.length) palList.innerHTML = `<p class="pal__none">${t('pal.none')}</p>`;
  $('#pal-count').textContent = palItems.length ? t('pal.count', { n: palItems.length }) : '';
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
    b.setAttribute('aria-label', t('common.swatch', { c }));
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
  $('#dlg-kicker').textContent = t('dlg.newKicker');
  $('#dlg-title').textContent = t('dlg.newTitle');
  $('#dlg-submit').textContent = t('dlg.create');
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
  $('#dlg-kicker').textContent = t('dlg.editKicker');
  $('#dlg-title').textContent = t('dlg.editTitle');
  $('#dlg-submit').textContent = t('dlg.save');
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
$('#dlg-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = ($('#f-name').value || '').trim();
  if (!name) { $('#dlg-err').hidden = false; $('#dlg-err').textContent = t('dlg.errName'); return; }
  const coordRaw = ($('#f-coord').value || '').trim();
  let geo = parseCoord(coordRaw) || pickGeo;
  const hasCJK = /[\u4e00-\u9fa5]/.test(name);

  /* 需要坐标，或英文界面下需要把中文名转成英文名时，都走一次解析（有缓存） */
  let hit = null;
  if (!geo || (getLang() === 'en' && hasCJK)) {
    try { hit = await geocode(name); } catch {}
  }
  if (!geo && hit) {
    geo = { lat: hit.lat, lng: hit.lng };
    $('#f-coord').value = fmtCoord(geo.lat, geo.lng);
  }

  /* 中英双名：name 保留用户输入，nameEn 用于英文界面 */
  const nameEn = (hit && hit.labelEn) || (hasCJK ? '' : name);

  const keyRaw = ($('#f-key').value || '').trim();
  const keyHash = keyRaw ? await sha256Hex(keyRaw) : '';
  const noteVal = ($('#f-note').value || '').trim()
    || composeIntro({
      name: getLang() === 'en' ? (nameEn || name) : name,
      lat: geo?.lat ?? null, lng: geo?.lng ?? null,
      date: $('#f-date').value, lang: getLang()
    });

  if (state.editing) {
    const lm = landmarkById(state.editing);
    if (!lm) return;
    lm.name = name.slice(0, 16);
    lm.nameEn = nameEn.slice(0, 24);
    lm.coord = coordRaw || (geo ? fmtCoord(geo.lat, geo.lng) : '');
    lm.date = ($('#f-date').value || '').trim();
    lm.note = noteVal;
    lm.accent = swatchPick;
    lm.lat = geo ? geo.lat : null;
    lm.lng = geo ? geo.lng : null;
    if (keyHash) lm.keyHash = keyHash;
    saveLandmarks();
    dlg.close();
    buildMarkers();
    renderWall();
    if (geo) { earth?.focus(geo.lat, geo.lng); setTimeout(() => highlightMarker(lm.id), 60); }
    openAlbum(lm.id);
    return;
  }

  const lm = normalizeLM({
    id: 'lm-' + Date.now().toString(36),
    name: name.slice(0, 16),
    nameEn: nameEn.slice(0, 24),
    coord: coordRaw || (geo ? fmtCoord(geo.lat, geo.lng) : ''),
    date: ($('#f-date').value || '').trim(),
    note: ($('#f-note').value || '').trim(),
    accent: swatchPick,
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    keyHash,
    note: noteVal,
    createdAt: Date.now()
  });
  state.landmarks.unshift(lm);
  saveLandmarks();
  dlg.close();
  renderWall();
  buildMarkers();
  deckIndex = 0;
  if (geo) {
    earth?.focus(geo.lat, geo.lng);
    setTimeout(() => highlightMarker(lm.id), 60);
  }

  const pending = state.pendingFiles;
  state.pendingFiles = null;
  setTimeout(() => {
    openAlbum(lm.id);
    if (pending?.length) uploadTo(lm.id, pending);
  }, 160);
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
        del.textContent = t('common.delete');
        del.classList.remove('is-armed');
      }, 2800);
      del.textContent = t('album.confirm');
      del.classList.add('is-armed');
      return;
    }
    clearTimeout(armed); armed = 0;
    del.textContent = t('common.delete');
    del.classList.remove('is-armed');
    for (const p of photosOf(lm.id)) {
      await dbDel(p.id);
      dropURL(p.id);
    }
    state.photos = state.photos.filter(p => p.landmarkId !== lm.id);
    state.landmarks = state.landmarks.filter(x => x.id !== lm.id);
    saveLandmarks();
    closeAlbum();
    buildMarkers();
    renderWall();
  });
}

/* ───────── 菜单 / 主题 ───────── */
const menuBtn = $('#menu-btn');
const menuPop = $('#menu-pop');
const themeBtn = $('#theme-btn');
const themePop = $('#theme-pop');

function closeMenu() {
  menuPop.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
function closeTheme() {
  themePop.hidden = true;
  themeBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = menuPop.hidden;
  menuPop.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  closeTheme();
});
themeBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = themePop.hidden;
  themePop.hidden = !open;
  themeBtn.setAttribute('aria-expanded', String(open));
  closeMenu();
});
document.addEventListener('click', e => {
  closeMenu();
  if (!e.target.closest('.theme')) closeTheme();
});
menuPop.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  closeMenu();
  const act = b.dataset.act;
  if (act === 'new') openDialog();
  if (act === 'settings') openSettings();
  if (act === 'export') exportStandalone();
});
themePop.addEventListener('click', e => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  applyTheme(b.dataset.theme);
  closeTheme();
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
  toast(t('toast.pending'));
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
      `<h2>${esc(placeName(g.lm))}</h2>` +
      `<p class="meta">${esc(meta)}${meta ? '  ·  ' : ''}${esc(t('wall.photoCount', { n: g.list.length }))}</p>` +
      (g.lm.note ? `<p class="note">${esc(g.lm.note)}</p>` : '') +
      `</header><div class="grid">${shots}</div></section>`;
  }).join('');

  return `<!doctype html><html lang="${getLang() === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(state.site.name)} ${esc(state.site.cn)}</title><style>${EXPORT_CSS}</style></head><body>` +
    `<header class="top"><span class="mark">${esc(state.site.name)}<em>${esc(state.site.cn)}</em></span>` +
    `<span class="stat">${esc(t('common.stats', { a: groups.length, b: total }))}</span></header>` +
    `<div class="hero"><h1>${esc(state.site.title)}</h1>` +
    (state.site.lede ? `<p>${esc(state.site.lede)}</p>` : '') + `</div>` +
    `<main>${sections}</main>` +
    `<footer><p>${esc(state.site.name)} · ${date}</p></footer></body></html>`;
}

const EXPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#07070A;color:#F4F1E9;font-family:Archivo,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:9;display:flex;align-items:center;height:62px;padding:0 clamp(18px,5vw,92px);background:rgba(7,7,10,.86);backdrop-filter:blur(18px);border-bottom:1px solid rgba(244,241,233,.09)}
.mark{font-weight:600;font-size:13px;letter-spacing:.3em}
.mark em{font-style:normal;font-size:10px;letter-spacing:.34em;color:#7C766C;margin-left:10px;font-family:"Songti SC",Georgia,serif}
.stat{margin-left:auto;font-family:Consolas,ui-monospace,monospace;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#7C766C}
.hero{padding:clamp(56px,10vw,150px) clamp(18px,5vw,92px) clamp(28px,4vw,54px);max-width:1100px}
.hero h1{margin:0;font-weight:400;font-size:clamp(2.6rem,8vw,7rem);line-height:.98;letter-spacing:.01em;font-family:"Songti SC",Georgia,serif}
.hero p{margin:22px 0 0;max-width:34em;color:#ADA79C;font-size:14.5px;line-height:1.95}
.ch{padding:clamp(34px,5vw,80px) clamp(18px,5vw,92px);border-top:1px solid rgba(244,241,233,.09)}
.ch header{margin-bottom:clamp(20px,2.6vw,36px)}
.kick{font-family:Consolas,ui-monospace,monospace;font-size:9px;letter-spacing:.28em;color:#C9A96A;margin:0 0 10px;text-transform:uppercase}
.ch h2{margin:0;font-weight:400;font-size:clamp(1.8rem,4.4vw,3.2rem);letter-spacing:.02em;font-family:"Songti SC",Georgia,serif}
.ch .meta{font-family:Consolas,ui-monospace,monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#7C766C;margin:10px 0 0}
.ch .note{max-width:40em;color:#ADA79C;font-size:13.5px;line-height:1.9;margin:8px 0 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1.2vw,16px)}
figure{margin:0}
figure img{display:block;width:100%;height:auto;background:#0D0D12}
figcaption{padding-top:7px;font-family:Consolas,ui-monospace,monospace;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#7C766C;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{padding:clamp(36px,5vw,72px) clamp(18px,5vw,92px) 56px;border-top:1px solid rgba(244,241,233,.09)}
footer p{margin:0;font-family:Consolas,ui-monospace,monospace;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#7C766C}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
`;

function exportStandalone() {
  const groups = state.landmarks.map(lm => ({ lm, list: photosOf(lm.id) })).filter(g => g.list.length);
  if (!groups.length) { toast(t('toast.exportFirst'), true); return; }
  const blob = new Blob([buildExport()], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `atlas-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(t('toast.exported'));
}

/* ───────── 交互绑定 ───────── */
$('#btn-new')?.addEventListener('click', () => openDialog());
$('#lang-btn')?.addEventListener('click', () => {
  const i = LANGS.indexOf(getLang());
  setLang(LANGS[(i + 1) % LANGS.length]);
  applyLang();
});
$('#album-locate')?.addEventListener('click', () => {
  if (state.current) locateOnGlobe(state.current);
});
$('#ov-new')?.addEventListener('click', () => openDialog());
$('#car-prev')?.addEventListener('click', () => deckGo(-1));
$('#car-next')?.addEventListener('click', () => deckGo(1));
$('#wall-empty-new')?.addEventListener('click', () => openDialog());
$('#hero-new')?.addEventListener('click', () => openDialog());
$('#planet-new')?.addEventListener('click', () => openDialog());
$('#palette-btn').addEventListener('click', openPalette);
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
  btn.textContent = t('lb.isCover');
  btn.disabled = true;
  showNote(t('toast.coverSet'));
});
lbEl.addEventListener('click', e => {
  if (e.target === lbEl || e.target === lbStage) closeLightbox();
});
albumScroll.addEventListener('scroll', () => {
  albumScroll.querySelector('.album__bar')?.classList.toggle('is-stuck', albumScroll.scrollTop > 36);
}, { passive: true });
addEventListener('scroll', onScroll, { passive: true });

$('#earth-auto')?.addEventListener('click', e => {
  const btn = e.currentTarget;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  earth?.setAuto(on);
});
$('#earth-reset')?.addEventListener('click', () => earth?.reset());

/* 缩放按钮：滚轮之外的第二条路，触屏也能推拉 */
$('#earth-zoom-in')?.addEventListener('click', () => earth?.zoomBy(0.86));
$('#earth-zoom-out')?.addEventListener('click', () => earth?.zoomBy(1.16));

/* 磁吸 */
if (fine() && !reduced()) {
  $$('.btn').forEach(btn => {
    btn.addEventListener('pointermove', e => {
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      btn.style.transform = `translate(${(dx * 3).toFixed(2)}px, ${(dy * 2).toFixed(2)}px)`;
    });
    btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  });
}

/* 开篇光晕 */
const heroEl = $('#hero');
const halo = $('#hero-halo');
heroEl?.addEventListener('pointermove', e => {
  if (!fine()) return;
  const r = heroEl.getBoundingClientRect();
  halo.style.setProperty('--hx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
  halo.style.setProperty('--hy', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
}, { passive: true });

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
    if (themePop && !themePop.hidden) { closeTheme(); return; }
    if (albumEl.classList.contains('is-open')) closeAlbum();
    return;
  }

  if (typing || dlg.open || $('#dlg-site').open) return;

  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openDialog(); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSettings(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); cycleTheme(); }
  else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); exportStandalone(); }
  else if (e.key === 'g' || e.key === 'G') { document.getElementById('planet')?.scrollIntoView({ behavior: 'smooth' }); }
  else if (e.key === 'i' || e.key === 'I') { document.getElementById('index')?.scrollIntoView({ behavior: 'smooth' }); }
  else if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key === 'ArrowLeft') { deckGo(-1); }
  else if (e.key === 'ArrowRight') { deckGo(1); }
});


/* ───────── 地理识别：地名 → 坐标 ───────── */
const geoEl = $('#geo');
const geoText = $('#geo-text');
const geoBtn = $('#geo-btn');
let geoBusy = false;

function setGeo(stateName, text) {
  if (!geoEl) return;
  geoEl.dataset.state = stateName;
  geoText.textContent = text;
  geoBtn.disabled = stateName === 'loading';
}

async function locateFromName() {
  if (!geoEl || geoBusy) return;
  const name = ($('#f-name').value || '').trim();
  if (name.length < 2) { setGeo('idle', t('geo.idle')); return; }

  geoBusy = true;
  setGeo('loading', t('geo.loading'));
  let hit = null;
  try { hit = await geocode(name); } catch { hit = null; }
  geoBusy = false;

  if (hit) {
    pickGeo = { lat: hit.lat, lng: hit.lng };
    $('#f-coord').value = fmtCoord(hit.lat, hit.lng);
    const shown = getLang() === 'en' ? (hit.labelEn || hit.label) : hit.label;
    setGeo('ok', `${shown} · ${hit.source}`);
    if (!$('#f-note').value.trim()) {
      $('#f-note').value = composeIntro({
        name: getLang() === 'en' ? (hit.labelEn || name) : name,
        lat: hit.lat, lng: hit.lng,
        date: $('#f-date').value, lang: getLang()
      });
    }
  } else {
    setGeo('fail', t('geo.fail'));
  }
}

$('#f-name')?.addEventListener('blur', () => {
  if (!$('#f-coord').value.trim() && ($('#f-name').value || '').trim().length >= 2) locateFromName();
});
geoBtn?.addEventListener('click', locateFromName);

/* ───────── 概览：虚影轮播 ───────── */
let deckIndex = 0;
let deckTimer = 0;

function renderOverview() {
  renderDeck();
  renderTags();
  renderReco();
}

function renderDeck() {
  const stage = $('#deck-stage');
  if (!stage) return;
  stage.innerHTML = '';
  const albums = state.landmarks;
  if (!albums.length) {
    $('#car-no').textContent = '№ 00';
    $('#car-name').textContent = t('ov.emptyTitle');
    $('#car-sub').textContent = t('ov.emptySub');
    $('#car-prev').disabled = true;
    $('#car-next').disabled = true;
    return;
  }

  albums.forEach((lm, i) => {
    const cover = coverOf(lm);
    const b = el('button', 'slide');
    b.type = 'button';
    b.dataset.i = String(i);
    b.setAttribute('aria-label', t('planet.markerAria', { name: placeName(lm), n: photosOf(lm.id).length }));

    const card = el('div', 'slide__card');
    if (cover) {
      const img = el('img');
      img.src = cover.thumb || urlFor(cover);
      img.alt = lm.name;
      img.loading = i > 4 ? 'lazy' : 'eager';
      card.appendChild(img);
    } else {
      card.appendChild(el('div', 'slide__empty', `<span>${esc(lm.name)}</span>`));
    }
    if (isLocked(lm)) card.appendChild(el('div', 'slide__lock', LOCK_SVG));
    b.appendChild(card);

    const ghost = el('div', 'slide__ghost');
    if (cover) ghost.style.backgroundImage = `url("${cover.thumb || urlFor(cover)}")`;
    b.appendChild(ghost);

    b.appendChild(el('span', 'slide__tag', isLocked(lm) ? 'LOCKED' : t('ov.count', { n: photosOf(lm.id).length })));
    b.addEventListener('click', e => {
      /* 刚拖动过就不算点击，避免松手时误开相册 */
      if (Date.now() - deckClickGuard < 260) { e.preventDefault(); e.stopPropagation(); return; }
      openAlbum(lm.id, e);
    });
    stage.appendChild(b);
  });

  deckIndex = clamp(deckIndex, 0, albums.length - 1);
  bindDeckDrag();
  layoutDeck();
}

function layoutDeck(fi = deckIndex) {
  const slides = $$('.slide');
  if (!slides.length) return;
  const w = slides[0].offsetWidth || 240;

  slides.forEach((s, i) => {
    const d = i - fi;
    const ad = Math.abs(d);
    s.style.transform =
      `translate(-50%, -50%) translateX(${(d * w * 0.62).toFixed(1)}px) translateZ(${(-ad * 120).toFixed(0)}px)` +
      ` rotateY(${(-d * 15).toFixed(1)}deg) scale(${d === 0 ? 1 : 0.94})`;
    s.style.opacity = ad > 3 ? '0' : String(Math.max(0, 1 - ad * 0.26));
    s.style.zIndex = String(20 - Math.round(ad));
    s.style.filter = ad >= 2 ? 'blur(2px) brightness(.72)' : 'none';
    s.style.pointerEvents = ad > 3 ? 'none' : 'auto';
    s.classList.toggle('is-active', Math.abs(d) < 0.5);
  });

  const lm = state.landmarks[deckIndex];
  if (lm) {
    $('#car-no').textContent = `№ ${pad2(deckIndex + 1)}`;
    $('#car-name').textContent = placeName(lm);
    $('#car-sub').textContent = isLocked(lm)
      ? t('ov.lockedSub')
      : `${t('ov.count', { n: photosOf(lm.id).length })} · ${lm.coord || '—'}`;
  }
  $('#car-prev').disabled = deckIndex === 0;
  $('#car-next').disabled = deckIndex >= state.landmarks.length - 1;
}

/* ── 轮播拖拽：跟手转动，松手吸附到最近一张 ── */
let deckDrag = null;
let deckClickGuard = 0;

function deckStepWidth() {
  const s = $$('.slide')[0];
  return (s?.offsetWidth || 240) * 0.62;
}

function bindDeckDrag() {
  const stage = $('#deck-stage');
  if (!stage || stage.dataset.drag === '1') return;
  stage.dataset.drag = '1';

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!state.landmarks.length) return;
    deckDrag = { x: e.clientX, start: deckIndex, moved: 0 };
    clearInterval(deckTimer);
    stage.classList.add('is-dragging');
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });

  stage.addEventListener('pointermove', e => {
    if (!deckDrag) return;
    const dx = e.clientX - deckDrag.x;
    deckDrag.moved = Math.max(deckDrag.moved, Math.abs(dx));
    const fi = deckDrag.start - dx / deckStepWidth();
    layoutDeck(clamp(fi, -0.55, state.landmarks.length - 0.45));
  });

  const settle = e => {
    if (!deckDrag) return;
    const dx = (e.clientX ?? deckDrag.x) - deckDrag.x;
    const w = deckStepWidth();
    const dragged = Math.abs(dx) > 6;
    let steps = Math.round(-dx / w);
    if (!steps && Math.abs(dx) > w * 0.22) steps = dx < 0 ? 1 : -1;
    deckIndex = clamp(deckDrag.start + steps, 0, state.landmarks.length - 1);
    deckDrag = null;
    stage.classList.remove('is-dragging');
    layoutDeck();
    restartDeckTimer();
    if (dragged) deckClickGuard = Date.now();
  };
  stage.addEventListener('pointerup', settle);
  stage.addEventListener('pointercancel', settle);
  stage.addEventListener('lostpointercapture', settle);
}

function deckGo(step) {
  const n = state.landmarks.length;
  if (!n) return;
  deckIndex = clamp(deckIndex + step, 0, n - 1);
  layoutDeck();
  restartDeckTimer();
}

function restartDeckTimer() {
  clearInterval(deckTimer);
  if (reduced() || state.landmarks.length < 2) return;
  deckTimer = setInterval(() => {
    if (albumEl.classList.contains('is-open')) return;
    const n = state.landmarks.length;
    if (!n) return;
    deckIndex = (deckIndex + 1) % n;
    layoutDeck();
  }, 6500);
}

/* ───────── 自动标签与建议 ───────── */
function albumTags(lm) {
  const tags = [];
  if (lm.lat != null) {
    const a = Math.abs(lm.lat);
    tags.push(a < 23.5 ? '热带' : a < 55 ? '温带' : '高纬');
    tags.push(lm.lat >= 0 ? '北半球' : '南半球');
  }
  const y = /(\d{4})/.exec(lm.date || '');
  if (y) tags.push(y[1]);
  const mo = /(\d{1,2})\s*月/.exec(lm.date || '');
  if (mo) {
    const k = +mo[1];
    tags.push(k === 12 || k <= 2 ? '冬' : k <= 5 ? '春' : k <= 8 ? '夏' : '秋');
  }
  const ps = photosOf(lm.id);
  if (!ps.length) tags.push('空册');
  else {
    const land = ps.filter(p => (p.w || 0) >= (p.h || 0)).length;
    tags.push(land * 2 >= ps.length ? '横构图' : '竖构图');
    if (ps.some(p => p.exif)) tags.push('有拍摄参数');
    if (ps.length < 3) tags.push('待补');
  }
  return tags;
}

function renderTags() {
  const box = $('#tag-cloud');
  if (!box) return;
  box.innerHTML = '';
  const counts = new Map();
  state.landmarks.forEach(lm => albumTags(lm).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  if (!counts.size) {
    box.innerHTML = `<p class="ov__note">${esc(t('ov.noTag'))}</p>`;
    return;
  }
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .forEach(([t, n]) => {
      box.appendChild(el('span', 'tag', `${esc(t)}<i>${n}</i>`));
    });
}

function renderReco() {
  const list = $('#reco-list');
  if (!list) return;
  list.innerHTML = '';
  const out = [];

  const empty = state.landmarks.filter(l => photosOf(l.id).length < 2);
  if (empty.length) out.push(['补全', `给《${empty[0].name}》再补几张，凑成一组。`]);

  const withPhotos = state.landmarks.filter(l => photosOf(l.id).length);
  if (withPhotos.length) {
    const oldest = withPhotos.slice().sort((a, b) => (photosOf(a.id)[0]?.t || 0) - (photosOf(b.id)[0]?.t || 0))[0];
    const days = Math.round((Date.now() - (photosOf(oldest.id)[0]?.t || Date.now())) / 86400000);
    if (days > 7) out.push(['回访', `《${oldest.name}》已经 ${days} 天没有新照片。`]);
  }

  if (state.landmarks.length >= 2) {
    const a = state.landmarks.find(l => l.lat != null);
    const peer = a && state.landmarks.find(l => l.id !== a.id && l.lat != null && Math.abs(l.lat - a.lat) < 8);
    if (peer) out.push(['关联', `《${a.name}》与《${peer.name}》纬度相近，适合并在一起看。`]);
  }

  if (state.photos.length && !localStorage.getItem('atlas.backed.v1')) {
    out.push(['备份', '还没有导出备份。备份入口在页脚的「私钥」里。']);
  }

  if (!out.length) out.push(['开始', '一切就绪。新建一处地标，第一本相册就开始了。']);

  out.slice(0, 4).forEach(([k, text], i) => {
    list.appendChild(el('li', '', `<i>${pad2(i + 1)}</i><span><b>${esc(k)}</b> · ${esc(text)}</span>`));
  });
}

/* ───────── 册集私钥 ───────── */
$('#album-lock-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const lm = currentLandmark();
  if (!lm) return;
  const box = $('#album-locked');
  const input = $('#album-key');
  const err = $('#album-lock-err');
  const h = await sha256Hex(input.value || '');
  if (h && h === lm.keyHash) {
    unlocked.add(lm.id);
    saveUnlocked();
    err.hidden = true;
    openAlbum(lm.id);
    toast(t('album.unlocked', { name: placeName(lm) }));
  } else {
    err.hidden = false;
    err.textContent = t('vault.err');
    box.classList.remove('is-shake');
    void box.offsetWidth;
    box.classList.add('is-shake');
    input.select();
  }
});

/* ───────── 保险库 ───────── */
const vaultEl = $('#vault');
const vaultBox = $('#vault-box');
let vaultUnlocked = false;

function openVault() {
  vaultEl.classList.add('is-open');
  vaultEl.setAttribute('aria-hidden', 'false');
  setLock(true);
  if (vaultUnlocked) showVaultPanel();
  else {
    $('#vault-lock').hidden = false;
    $('#vault-panel').hidden = true;
    $('#vault-pass').value = '';
    $('#vault-err').hidden = true;
    setTimeout(() => $('#vault-pass').focus(), 240);
  }
}
function closeVault() {
  vaultEl.classList.remove('is-open');
  vaultEl.setAttribute('aria-hidden', 'true');
  setLock(albumEl.classList.contains('is-open') || lbState.open);
}
function showVaultPanel() {
  vaultUnlocked = true;
  $('#vault-lock').hidden = true;
  $('#vault-panel').hidden = false;
  updateVaultStats();
}
async function updateVaultStats() {
  $('#vault-lm').textContent = state.landmarks.length;
  $('#vault-ph').textContent = state.photos.length;
  let size = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    size = est?.usage || 0;
  } catch {}
  if (!size) {
    size = state.photos.reduce((a, p) => a + (p.blob?.size || 0), 0);
  }
  $('#vault-size').textContent = size > 1048576
    ? (size / 1048576).toFixed(1) + ' MB'
    : Math.max(0, Math.round(size / 1024)) + ' KB';
}

$('#vault-open')?.addEventListener('click', openVault);
$('#vault-close')?.addEventListener('click', closeVault);
vaultEl?.addEventListener('click', e => { if (e.target === vaultEl) closeVault(); });
$('#vault-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const pass = $('#vault-pass').value || '';
  const h = await sha256Hex(pass);
  const err = $('#vault-err');
  if (h && h === VAULT_HASH) {
    err.hidden = true;
    showVaultPanel();
  } else {
    err.hidden = false;
    err.textContent = t('vault.err');
    vaultBox.classList.remove('is-shake');
    void vaultBox.offsetWidth;
    vaultBox.classList.add('is-shake');
    $('#vault-pass').select();
  }
});
$('#vault-lock-btn')?.addEventListener('click', () => {
  vaultUnlocked = false;
  closeVault();
  toast(t('vault.lockedToast'));
});

$('#vault-export')?.addEventListener('click', async () => {
  const btn = $('#vault-export');
  const pass = $('#vault-pass2').value || '';
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = t('vault.exporting');
  try {
    const text = await makeBackup({
      site: state.site,
      landmarks: state.landmarks,
      photos: state.photos,
      passphrase: pass
    });
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas-vault-${new Date().toISOString().slice(0, 10)}.atlas`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    try { localStorage.setItem('atlas.backed.v1', String(Date.now())); } catch {}
    btn.textContent = t('vault.exported');
    toast(t('vault.exportedToast'));
  } catch (err) {
    btn.textContent = t('vault.export');
    toast(err?.message || t('toast.exportFail'), true);
  } finally {
    btn.removeAttribute('aria-busy');
    setTimeout(() => { btn.textContent = t('vault.export'); }, 3200);
  }
});

$('#vault-file')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const pass = $('#vault-pass2').value || '';
  try {
    const payload = await readBackup(await file.text(), pass);
    await mergeBackup(payload);
    toast(`已恢复 ${payload.landmarks?.length || 0} 处地标`);
  } catch (err) {
    toast(err?.message || '导入失败', true);
  }
});

async function mergeBackup(payload) {
  const byId = new Map(state.landmarks.map(l => [l.id, l]));
  (payload.landmarks || []).forEach(raw => {
    const next = normalizeLM(raw);
    const cur = byId.get(next.id);
    if (cur) Object.assign(cur, next, { coverId: cur.coverId || next.coverId });
    else { state.landmarks.push(next); byId.set(next.id, next); }
  });
  saveLandmarks();

  const have = new Set(state.photos.map(p => p.id));
  const added = [];
  for (const p of payload.photos || []) {
    if (have.has(p.id)) continue;
    const blob = photoBlob(p.data);
    if (!blob) continue;
    const rec = {
      id: p.id, landmarkId: p.landmarkId, name: p.name,
      blob, thumb: p.thumb, exif: p.exif || null,
      w: p.w, h: p.h, t: p.t || Date.now()
    };
    try { await dbPut(rec); added.push(rec); } catch {}
  }
  state.photos.push(...added);

  if (payload.site) {
    applySite({ ...DEFAULT_SITE, ...payload.site });
    try { localStorage.setItem(LS_SITE, JSON.stringify(state.site)); } catch {}
  }

  syncStats();
  renderWall();
  renderOverview();
  buildMarkers();
  updateVaultStats();
  return added.length;
}

/* ───────── 语言 ───────── */
function applyLang() {
  applyI18n(document);
  const label = $('#lang-label');
  if (label) label.textContent = getLang() === 'zh' ? '中' : 'EN';
  const lb = $('#lang-btn');
  if (lb) lb.setAttribute('title', t('nav.lang'));
  document.documentElement.setAttribute('lang', getLang() === 'zh' ? 'zh-CN' : 'en');
  /* 站点标题与导语跟随语言（未自定义时） */
  applySite(state.site || loadSite());
  /* 动态区域重绘，保证切换后不残留旧语言 */
  renderWall();
  renderOverview();
  if (state.current) {
    const lm = currentLandmark();
    if (lm && !isLocked(lm)) {
      $('#album-meta').innerHTML = [lm.coord, lm.date, t('ov.count', { n: photosOf(lm.id).length })]
        .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');
    }
  }
  syncStats();
}

/* 新地标高亮：4 秒后自动褪去 */
let highlightTimer = 0;
function highlightMarker(id) {
  const node = $$('.marker').find(m => m.dataset.id === id);
  if (!node) return;
  $$('.marker').forEach(m => m.classList.remove('is-new'));
  node.classList.add('is-new');
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => node.classList.remove('is-new'), 4200);
  earth?.setHovered(id);
  setTimeout(() => earth?.setHovered(null), 4200);
}

/* 在地球上定位某本相册 */
function locateOnGlobe(id) {
  const lm = landmarkById(id);
  if (!lm || lm.lat == null) { toast(t('geo.fail'), true); return; }
  closeAlbum();
  const planet = document.getElementById('planet');
  planet?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  setTimeout(() => {
    earth?.focus(lm.lat, lm.lng);
    highlightMarker(id);
  }, 420);
}

/* ───────── 入口门禁 ───────── */
function initGate() {
  const gate = document.getElementById('gate');
  if (!gate) return;
  if (!GATE_ENABLED) {
    gate.hidden = true;
    document.documentElement.removeAttribute('data-gate');
    return;
  }
  gate.hidden = false;
  if (sessionStorage.getItem('atlas.gate') === '1') {
    document.documentElement.setAttribute('data-gate', 'open');
    return;
  }
  document.documentElement.setAttribute('data-gate', 'locked');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-pass');
  const err = document.getElementById('gate-err');
  setTimeout(() => input?.focus(), 120);

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const h = await sha256Hex(input.value || '');
    if (h && h === GATE_HASH) {
      try { sessionStorage.setItem('atlas.gate', '1'); } catch {}
      document.documentElement.setAttribute('data-gate', 'open');
      err.hidden = true;
    } else {
      err.hidden = false;
      gate.classList.remove('is-shake');
      void gate.offsetWidth;
      gate.classList.add('is-shake');
      input.select();
    }
  });
}

/* ───────── 背景音乐 ───────── */
const LS_MUTED = 'atlas.muted.v1';

function initMusic() {
  const btn = $('#sound-btn');
  const hint = $('#audio-hint');
  const hintBtn = $('#audio-hint-btn');
  if (!btn) return null;

  const music = createMusic();
  const paint = ({ playing }) => {
    btn.setAttribute('aria-pressed', String(!!playing));
    if (playing) hint && (hint.hidden = true);
  };
  music.onChange(paint);
  paint({ playing: false });

  const wanted = () => {
    try { return localStorage.getItem(LS_MUTED) !== '1'; } catch { return true; }
  };

  const begin = async () => {
    if (!wanted()) return;
    const ok = await music.start();
    if (!ok) {
      /* 被自动播放策略拦下：先给一个不打扰的提示，等任意一次手势再起 */
      setTimeout(() => { if (hint && !music.isPlaying()) hint.hidden = false; }, 900);
      music.armUnlock(() => { if (hint) hint.hidden = true; });
    }
  };

  btn.addEventListener('click', async () => {
    const on = await music.toggle();
    try { localStorage.setItem(LS_MUTED, on ? '0' : '1'); } catch {}
    if (hint) hint.hidden = true;
    toast(t(on ? 'music.on' : 'music.off'));
  });

  hintBtn?.addEventListener('click', async () => {
    await music.start();
    if (hint) hint.hidden = true;
  });

  window.atlasMusic = music;   /* 调试/验收用只读句柄 */
  begin();
  return music;
}

/* ───────── 启动 ───────── */

async function boot() {
  initLang();
  initGate();
  state.site = loadSite();
  applySite(state.site);

  applyTheme(localStorage.getItem(LS_THEME) || 'noir');

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

  renderWall();
  applyLang();
  initRevealObserver();
  initNavSpy();
  restartDeckTimer();
  onScroll();

  /* 轮播：悬停暂停 */
  const deck = $('#deck');
  deck?.addEventListener('pointerenter', () => clearInterval(deckTimer));
  deck?.addEventListener('pointerleave', restartDeckTimer);
  addEventListener('resize', () => { clearTimeout(deck._t); deck._t = setTimeout(layoutDeck, 160); });

  const stage = $('#planet-stage');
  if (stage && 'IntersectionObserver' in window) {
    const loadIO = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || earthStarted) return;
      earthStarted = true;
      initEarth();
      earth?.load(p => { if (progressEl) progressEl.textContent = Math.round(p * 100) + '%'; });
      loadIO.disconnect();
    }, { rootMargin: '400px 0px', threshold: 0 });
    loadIO.observe(stage);

    const runIO = new IntersectionObserver(entries => {
      const on = entries[0].isIntersecting;
      if (on && !earthStarted) return;
      on ? earth?.start() : earth?.stop();
    }, { threshold: 0 });
    runIO.observe(stage);
  } else {
    earthStarted = true;
    initEarth();
    earth?.load(p => { if (progressEl) progressEl.textContent = Math.round(p * 100) + '%'; });
    earth?.start();
  }

  if (!stored && !localStorage.getItem(LS_SEED)) {
    state.landmarks = [
      normalizeLM({ id: 'lm-kyoto', name: '京都', coord: '35.01°N 135.77°E', accent: ACCENTS[0] }),
      normalizeLM({ id: 'lm-reyk', name: '雷克雅未克', coord: '64.15°N 21.94°W', accent: ACCENTS[1] }),
      normalizeLM({ id: 'lm-hk', name: '香港', coord: '22.32°N 114.17°E', accent: ACCENTS[2] })
    ];
    saveLandmarks();
    try { localStorage.setItem(LS_SEED, '1'); } catch {}
    renderWall();
    syncEarth();
  }

  initMusic();
}

boot();
