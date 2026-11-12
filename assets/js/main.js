/* ══════════════════════════════════════════════════════════════════
   main.js — ATLAS
   数据仍沿用 atlas.landmarks.v4 / atlas-plates，旧照片不会丢。
   ══════════════════════════════════════════════════════════════════ */

import { readExif } from './exif.js';
import { createEarth } from './earth.js';
import { createOverlay } from './earth-overlay.js';
import { createNomenclature } from './nomenclature.js';
import { createLayerStore } from './layers.js';
import { createLayerPanel } from './layer-panel.js';
import { createDust } from './drift.js';
import { geocode, searchPlaces, composeIntro } from './geo.js';
import { sha256Hex, VAULT_HASH, makeBackup, readBackup, photoBlob } from './vault.js';
import { t, applyI18n, initLang, getLang, setLang, LANGS } from './i18n.js';
import { createMusic } from './audio.js';
import { APP } from './config.js';
import {
  initCloud, cloudAvailable, cloudUser, onCloudChange, cloudReason,
  signOutCloud, refreshCloudSession,
  sendEmailCode, submitEmailOtp,
  pullAll, pushAlbums, pushPhotos, pullSettings, pushSettings,
  uploadPhotoBlob, downloadPhotoBlob, removePhotoBlob
} from './cloud.js';
import {
  SCHEMA, LIMITS, normalizeAlbum, normalizePhoto, parseCoord, fmtCoord,
  albumIssues, photoIssues, mergeCollections, mergeAlbumCollections, sameAlbumContent,
  albumFromRow, photoFromRow, albumToRow, photoToRow
} from './model.js';
import {
  loadAlbums, saveAlbums, allPhotos, getPhotoBlob, putPhoto, delPhotos, delPhotosOfAlbum,
  tombstone, clearTombstones, unpushedTombstones, markTombstonesPushed,
  pruneTombstones, markDirty, clearDirty, pending, repairPhotos,
  meta as storeMeta, markSynced, onExternalChange, health as storeHealth
} from './store.js';
import {
  key as acctKey, dbName, currentUser, accounts,
  register as acctRegister, login as acctLogin, logout as acctLogout,
  changePassword as acctChangePassword,
  setRecovery as acctSetRecovery,
  resetPassword as acctResetPassword,
  hasRecovery, removeAccount, migrateGuestData, migrateGuestPhotos,
  hasGuestData, probeGuestData, touchSession, sessionExpiresAt, normName,
  bindCloud, cloudIdOf,
  validateName, validatePassword, passwordIssue, passwordStrength
} from './accounts.js';

/* 入口私钥（SHA-256）。改口令：把新口令的 sha256 填到这里 */
const GATE_HASH = 'c7efaa94c1114dfc8e1d4007d5369b11ab55fa19dea1a31ccf5aabcb3cc39a55';
/* 入口门禁开关（配置在 config.js 的 features.gate） */
const GATE_ENABLED = APP.features.gate;

/* ───────── 常量 ───────── */
const ACCENTS = ['#C9A96A', '#7FA8C9', '#C98A7F', '#9BC9A0', '#B9A0D8', '#D8C08A', '#8FA6B8', '#C97F9E'];
/* 首次访问的示例册：换设备拉到真实数据后，没被动过的示例应当让位 */
const DEMO_ALBUMS = new Set(['lm-kyoto', 'lm-reyk', 'lm-hk']);

const LS_LM = 'atlas.landmarks.v4';
const LS_SITE = 'atlas.site.v1';
const LS_THEME = 'atlas.theme.v2';
const LS_SEED = 'atlas.seeded.v1';
const SS_UNLOCK = 'atlas.unlocked.v1';
const DB_NAME = 'atlas-plates';
const DB_STORE = 'plates';
const MAX_PX = APP.limits.photoMaxPx;
const MAX_BYTES = APP.limits.photoMaxBytes;

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
      spaceTop: [0.020, 0.020, 0.026], spaceBottom: [0.005, 0.005, 0.008],
      glow: [0.55, 0.42, 0.22], glowAmt: 0.085, grain: 0.012,
      ambient: 0.05, atmo: [0.24, 0.46, 0.82], stars: 1,
      exposure: 1.06, nightGain: 1.05, cloud: 0.9, atmoIntensity: 0.56
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
      spaceTop: [0.016, 0.024, 0.036], spaceBottom: [0.004, 0.007, 0.011],
      glow: [0.22, 0.48, 0.78], glowAmt: 0.10, grain: 0.012,
      ambient: 0.06, atmo: [0.3, 0.6, 0.98], stars: 1,
      exposure: 1.16, nightGain: 1.05, cloud: 0.88, atmoIntensity: 0.60
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

/* 自动标签是脚本现场生成的，内部仍用中文做键，显示时按语言换名 */
const TAG_EN = {
  '热带': 'Tropical', '温带': 'Temperate', '高纬': 'High latitude', '寒带': 'Polar',
  '北半球': 'Northern', '南半球': 'Southern', '赤道': 'Equatorial', '极圈': 'Arctic circle',
  '季风圈': 'Monsoon belt', '春': 'Spring', '夏': 'Summer', '秋': 'Autumn', '冬': 'Winter',
  '空册': 'Empty', '横构图': 'Landscape', '竖构图': 'Portrait',
  '有拍摄参数': 'EXIF', '待补': 'Needs more'
};
const tagLabel = tag => (getLang() === 'en' ? (TAG_EN[tag] || tag) : tag);

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

/* 兜底：任何没被接住的错误只记一条日志，不让整页白屏。
   相册、地球、音乐都是独立模块，一个模块出错不该拖垮其余部分。 */
addEventListener('error', e => console.warn('[atlas] error:', e.message || e.error));
addEventListener('unhandledrejection', e => console.warn('[atlas] unhandled:', e.reason));

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
/* 上限 80 个：相册翻到几百张时，不回收的 blob URL 会一直占着内存 */
const urlCache = new Map();
const URL_CAP = 80;
function urlFor(photo) {
  if (!photo.blob) return photo.thumb || '';
  const hit = urlCache.get(photo.id);
  if (hit) {
    /* 命中就挪到队尾，实现 LRU */
    urlCache.delete(photo.id);
    urlCache.set(photo.id, hit);
    return hit;
  }
  try {
    const u = URL.createObjectURL(photo.blob);
    urlCache.set(photo.id, u);
    while (urlCache.size > URL_CAP) {
      const oldest = urlCache.keys().next().value;
      const ou = urlCache.get(oldest);
      urlCache.delete(oldest);
      try { URL.revokeObjectURL(ou); } catch {}
    }
    return u;
  } catch { return photo.thumb || ''; }
}
function dropURL(id) {
  const u = urlCache.get(id);
  if (u) { try { URL.revokeObjectURL(u); } catch {} urlCache.delete(id); }
}

/**
 * 原图按需取：本地有就读 IndexedDB，云端有就下载并落库。
 * 只在大图、导出、上传这三处调用——网格永远用缩略图，
 * 这样打开一个有几百张照片的相册不会把解码后的位图全堆进内存。
 */
const blobPending = new Map();
function ensureBlob(photo) {
  if (!photo) return Promise.resolve(null);
  if (photo.blob) return Promise.resolve(photo.blob);
  if (blobPending.has(photo.id)) return blobPending.get(photo.id);

  const job = (async () => {
    let blob = null;
    try { blob = await getPhotoBlob(photo.id); } catch {}
    if (!blob && photo.remote && cloudUser()) {
      try {
        blob = await downloadPhotoBlob(photo.remote);
        if (blob) { photo.blob = blob; photo.hasBlob = true; await dbPut(photo); photo.blob = null; }
      } catch (e) { console.warn('[photo] download', e); }
    }
    if (!blob) return null;
    photo.blob = blob;
    photo.hasBlob = true;
    return blob;
  })().finally(() => blobPending.delete(photo.id));

  blobPending.set(photo.id, job);
  return job;
}

/* 大图 / 缩略轨：先把缩略图显示出来，原图就绪后替换，避免空白等待 */
function showPhoto(img, photo) {
  if (!img || !photo) return;
  img.src = photo.thumb || urlFor(photo);
  if (photo.blob) { img.src = urlFor(photo); return; }
  if (!photo.hasBlob && !photo.remote) return;
  ensureBlob(photo).then(blob => {
    if (!blob || !img.isConnected) return;
    img.src = urlFor(photo);
  }).catch(() => {});
}

/* ───────── 照片存储（委托 store.js） ─────────
   上层仍然叫 dbAll/dbPut/dbDel，但实现只有一个，且带契约校验。 */
const dbAll = () => allPhotos();
const dbPut = rec => putPhoto(rec);
const dbDel = id => delPhotos([id]);

/* ───────── 站点 ───────── */
function loadSite() {
  try {
    const raw = localStorage.getItem(acctKey(LS_SITE));
    if (raw) return { ...DEFAULT_SITE, rev: 0, at: 0, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SITE, rev: 0, at: 0 };
}

const sitePayload = s => ({
  name: s.name, cn: s.cn, title: s.title, lede: s.lede, accent: s.accent,
  /* 账号资料（昵称等）与站点设置共用 settings 单行文档 */
  profile: s.profile && Object.keys(s.profile).length ? s.profile : undefined
});

/* 站点设置也是数据：写本地 + 标脏 + 排队上云。
   touch=true 时抬 rev/at；从云端落地时用 touch=false，避免反向触发推送。 */
function saveSite(next, { touch = true, mark = true } = {}) {
  const base = state.site || { ...DEFAULT_SITE, rev: 0, at: 0 };
  const site = { ...base, ...next };
  if (touch) {
    site.rev = (base.rev | 0) + 1;
    site.at = Date.now();
  }
  state.site = site;
  try { localStorage.setItem(acctKey(LS_SITE), JSON.stringify(site)); } catch {}
  if (mark) { markDirty('settings'); schedulePush(600); }
  return site;
}
function applySite(site) {
  state.site = site;
  let custom = false;
  try { custom = !!localStorage.getItem(acctKey(LS_SITE)); } catch {}
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
  /* 手机上主题按钮收进"更多"菜单，这里同步显示当前主题名 */
  const mt = document.getElementById('menu-theme-name');
  if (mt) mt.textContent = t('theme.' + key);
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
  return normalizeAlbum(l, {
    untitled: getLang() === 'en' ? 'Untitled' : '未命名',
    accent: ACCENTS[0]
  });
}
function loadLandmarks() {
  const env = loadAlbums();
  /* exists=false 才是「这台机器上还没有这个账号的数据」，
     空数组代表用户把相册删光了，不能重新灌示例。 */
  if (!env.exists) return null;
  if (env.corrupted) toast(t('toast.corrupt'), true);
  return env.items.map(normalizeLM);
}

const saveLandmarks = () => {
  const res = saveAlbums(state.landmarks);
  if (!res.ok) {
    checkQuota(res.error);
    toast(t('toast.noSpace'), true);
    return;
  }
  state.landmarks = res.items;
  schedulePush();
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
  setT('stat-latest', nl ? placeName(nl) : '—');

  /* 首屏右上：最近一处落点，没有照片时退回最新的地标 */
  const recent = nl || state.landmarks[0];
  const nameEl = $('#hero-latest-name');
  const coordEl = $('#hero-latest-coord');
  if (nameEl) nameEl.textContent = recent ? placeName(recent) : '—';
  if (coordEl) coordEl.textContent = recent ? (recent.coord || t('wall.unlocated')) : '—';
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
      frame.appendChild(el('span', 'card__ghost', esc(placeName(lm))));
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
let markersOn = true;   /* 地标层开关：关掉后同时撤掉拾取，避免点到看不见的点 */
let earthStarted = false;
let earthReady = false;

function initEarth() {
  if (earth || !earthCanvas) return;
  earth = createEarth(earthCanvas, {
    onPick: m => openAlbum(m.id),
    onHover: m => {
      $$('.planet__item').forEach(b => b.classList.toggle('is-lit', !!m && b.dataset.id === m.id));
      $$('.marker').forEach(x => x.classList.toggle('is-lit', !!m && x.dataset.id === m.id));
    },
    onEmpty: geo => {
      /* 拾取模式：对话框为「点选地球」临时让路，选完带着原表单内容回来 */
      if (globePick) {
        globePick = false;
        setGlobePick(false);
        reopenPickDialog({ lat: geo.lat, lng: geo.lng });
        return;
      }
      openDialog({ lat: geo.lat, lng: geo.lng });
    },
    onReady: ({ ok }) => {
      if (!ok) {
        loader.classList.add('is-done');
        toast(t('planet.toastNoWebgl'), true);
        return;
      }
      /* 贴图分批到：第一次就揭开遮罩，之后只补画质，不重复建标记 */
      loader.classList.add('is-done');
      if (earthReady) return;
      earthReady = true;
      buildMarkers();
      paintRes();
    },
    onProject: payload => {
      updateMarkers(payload.project);
      overlay?.draw(payload);
      if (nomenclature) {
        nomenclature.setZoom(earth.getZoom());
        nomenclature.update(payload.project);
      }
    }
  });
  if (!earth) {
    loader.innerHTML = `<span class="planet__loader-t">${esc(t('planet.noWebgl'))}</span>`;
    /* 没有画布就没有图层可切：把空面板收起来，不留一个假开关 */
    const panel = $('#layer-panel');
    if (panel) panel.hidden = true;
    const toggle = $('#lyr-toggle');
    if (toggle) toggle.hidden = true;
    return;
  }
  earth.setTheme(THEMES[state.theme].globe);
  earth.initTier(currentRes());
  window.atlasEarth = earth;   /* 调试/验收用只读句柄 */
  initLayers();

  /* 兜底：无论贴图多慢，18 秒后都撤掉遮罩，交互不被挡住 */
  setTimeout(() => {
    if (!earthReady) loader.classList.add('is-done');
  }, 18000);
}

/* ───────── 图层仪表 ─────────
   三层职责：layers.js 管状态与依赖，earth-overlay/nomenclature 管画法，
   layer-panel.js 管呈现。main 只负责把它们接起来，不持有开关状态。 */
let overlay = null;
let nomenclature = null;
let layerStore = null;
let layerPanel = null;
const LAYER_RAIL = 336;   /* 面板 316 + 右距 18 + 缝 2 */

function initLayers() {
  if (layerStore || !earth) return;
  const stage = $('#planet-stage');
  const overlayCanvas = $('#earth-overlay');
  const namesEl = $('#nomenclature');
  if (!stage || !overlayCanvas || !namesEl) return;

  overlay = createOverlay(overlayCanvas);
  overlay.setPlaces(state.landmarks);
  window.atlasOverlay = overlay;   /* 验收用只读句柄 */
  nomenclature = createNomenclature({
    layer: namesEl,
    stage,
    getLang,
    getName: l => placeName(l),
    onOpen: id => openAlbum(id),
    onHover: () => {
      if (!earth) return;
      earth.setAuto(false);
      $('#earth-auto')?.setAttribute('aria-pressed', 'false');
    }
  });
  nomenclature.build(state.landmarks, photosOf);

  const markerEl = $('#markers');
  const ctx = {
    earth,
    overlay,
    nomenclature,
    markers: {
      setEnabled(on) {
        markersOn = !!on;
        if (markerEl) {
          markerEl.dataset.on = on ? 'yes' : 'no';
          markerEl.style.opacity = on ? '' : '0';
          markerEl.style.pointerEvents = on ? '' : 'none';
        }
        earth?.setMarkers(markersOn ? markers : []);
      }
    }
  };

  const panelEl = $('#layer-panel');
  layerStore = createLayerStore({
    ctx,
    onChange: () => { layerPanel?.sync(); paintLayerChrome(); },
    onNotice: n => layerPanel?.flash(getLang() === 'zh' ? n.zh : n.en)
  });
  layerPanel = createLayerPanel({
    panel: panelEl,
    list: $('#lyr-list'),
    presets: $('#lyr-presets'),
    countEl: $('#lyr-count'),
    noticeEl: $('#lyr-notice'),
    getLang,
    store: layerStore,
    onClose: () => setPanelOpen(false)
  });
  layerPanel.build();
  window.atlasLayers = layerStore;   /* 验收用只读句柄 */

  /* 小屏先看球，图层收进抽屉；大屏默认摊开 */
  const mq = matchMedia('(max-width: 1080px)');
  setPanelOpen(!mq.matches, false);
  mq.addEventListener?.('change', e => setPanelOpen(!e.matches));

  $('#lyr-toggle')?.addEventListener('click', () => {
    const open = panelEl?.dataset.open !== 'yes';
    setPanelOpen(open);
    if (open) panelEl.querySelector('.lyr__close')?.focus();
  });
  $('#lyr-share')?.addEventListener('click', async () => {
    const url = layerStore.shareUrl();
    try { await navigator.clipboard.writeText(url); layerPanel.flash(t('layer.shared')); }
    catch { layerPanel.flash(url); }
    try { history.replaceState(null, '', url); } catch {}
  });
  $('#lyr-reset')?.addEventListener('click', () => layerStore.reset());

  layerStore.init();
  layerPanel.sync();
  paintLayerChrome();
}

function setPanelOpen(open, focus = false) {
  const panelEl = $('#layer-panel');
  if (!panelEl) return;
  panelEl.dataset.open = open ? 'yes' : 'no';
  $('#lyr-toggle')?.setAttribute('aria-expanded', String(open));
  /* 球在停靠区左侧重新取景：不是把面板盖在球上，而是给仪器让出一栏 */
  const compact = matchMedia('(max-width: 1080px)').matches;
  const reserve = open && !compact ? LAYER_RAIL : 0;
  earth?.setReserve(reserve);
  nomenclature?.setReserve(reserve);
  if (open) {
    layerPanel?.sync();
    if (focus) panelEl.querySelector('.lyr__close')?.focus();
  }
}

/* 徽章与图例：只显示"有单位/有数量"的层，避免复述面板 */
function paintLayerChrome() {
  if (!layerStore) return;
  const L = getLang();
  const badge = $('#lyr-badge');
  if (badge) badge.textContent = String(layerStore.count());

  const box = $('#planet-legend');
  if (!box) return;
  const items = layerStore.legend().map(x => {
    let label = L === 'zh' ? x.label.zh : x.label.en;
    /* 里程与点数直接并进对应的图例项，避免把项数挤掉 */
    if (x.id === 'F02.thread') {
      const st = overlay?.stats();
      if (st?.legs) label += ` · ${st.km.toLocaleString(L === 'zh' ? 'zh-CN' : 'en-US')} km`;
    }
    if (x.id === 'F08.nomenclature') {
      const n = nomenclature?.count() || 0;
      if (n) label += ` · ${n}${L === 'zh' ? ' 处' : ' sites'}`;
    }
    return label;
  });
  const uniq = [...new Set(items)].slice(0, 4);
  box.innerHTML = uniq.map(v => `<span><i></i>${esc(v)}</span>`).join('');
  box.hidden = uniq.length === 0;
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
  earth?.setMarkers(markersOn ? markers : []);
  overlay?.setPlaces(state.landmarks);
  nomenclature?.build(state.landmarks, photosOf);
  paintLayerChrome();
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

  albumEl.querySelector('.album__bar')?.classList.remove('is-stuck');

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
  const memoirEl = $('#album-memoir');
  lockEl.hidden = !locked;
  gridEl.hidden = locked;
  dropEl.hidden = locked;
  if (memoirEl) memoirEl.hidden = locked;
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
    renderMemoir();
  }

  albumEl.classList.add('is-open');
  albumEl.setAttribute('aria-hidden', 'false');
  setLock(true);
  albumScroll.scrollTop = 0;
}

function closeAlbum() {
  const id = state.current;
  /* 编辑到一半就退出：静默收起，内容不写库（和点「取消」一致） */
  const form = $('#memoir-form');
  if (form && !form.hidden) form.hidden = true;
  albumEl.classList.remove('is-open');
  albumEl.setAttribute('aria-hidden', 'true');
  setLock(lbState.open || palette.classList.contains('is-open'));
  state.current = null;
  if (id) {
    const i = state.landmarks.findIndex(l => l.id === id);
    $$('.card')[i]?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }
}

/* 相册网格：先算出每行的高度（纯数组运算，很便宜），再按滚动分批插 DOM。
   一本三百张的册子如果一次性铺 300 个节点 + 300 个 <img>，
   打开时要卡住半秒以上；分批之后首屏只处理 6 行。 */
let gridIO = null;
function renderAlbumGrid() {
  const grid = $('#album-grid');
  if (!grid) return;
  if (gridIO) { gridIO.disconnect(); gridIO = null; }
  grid.innerHTML = '';

  const empty = $('#album-empty');
  if (empty) empty.hidden = albumList.length > 0;
  if (!albumList.length) return;

  /* clientWidth 把左右内边距也算进来了，直接拿来分行会让每行宽出 2×pad，
     最后一列被裁掉。减掉 padding 才是真正可用的宽度。 */
  const gcs = getComputedStyle(grid);
  const W = Math.max(240,
    grid.clientWidth - (parseFloat(gcs.paddingLeft) || 0) - (parseFloat(gcs.paddingRight) || 0)) || 900;
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

  const BATCH = 6;
  let cursor = 0;
  let idx = 0;
  let sentinel = null;

  function paintRows(count) {
    const end = Math.min(cursor + count, rows.length);
    const frag = document.createDocumentFragment();
    for (; cursor < end; cursor++) {
      const r = rows[cursor];
      const rowEl = el('div', 'agrow');
      rowEl.style.gap = gap + 'px';
      rowEl.style.contentVisibility = 'auto';
      rowEl.style.containIntrinsicSize = `auto ${r.h}px`;
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
        img.src = p.thumb || urlFor(p);
        img.dataset.pid = p.id;
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
    }
    grid.insertBefore(frag, sentinel);
  }

  /* 哨兵：滚到底部前 600px 就补下一批，用户不会看到空白 */
  sentinel = el('div', 'agrow-sentinel');
  sentinel.setAttribute('aria-hidden', 'true');
  grid.appendChild(sentinel);

  paintRows(BATCH);
  if (cursor < rows.length) {
    if ('IntersectionObserver' in window) {
      gridIO = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return;
        paintRows(BATCH);
        if (cursor >= rows.length) { gridIO.disconnect(); gridIO = null; sentinel.remove(); }
      }, { rootMargin: '600px 0px' });
      gridIO.observe(sentinel);
    } else {
      paintRows(rows.length);
      sentinel.remove();
    }
  } else {
    sentinel.remove();
  }
}

/* ───────── 手记 ─────────
   每本相册一段自己写的感受：一句话标题 + 正文 + 四档余味。
   存在地标记录里（lm.memoir），跟账号一起走，跟着备份一起导。 */
let memoirMood = -1;   /* -1 = 未选 */

function fmtMemoirTime(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function paintTastes() {
  $$('#memoir-tastes .taste').forEach(b => {
    b.setAttribute('aria-pressed', String(+b.dataset.taste === memoirMood));
  });
}

function updateMemoirCount() {
  const el = $('#memoir-count');
  const n = $('#memoir-in-body')?.value.length || 0;
  if (el) el.textContent = t('memoir.count', { n });
}

function renderMemoir() {
  const lm = currentLandmark();
  if (!lm) return;
  const view = $('#memoir-view');
  const blank = $('#memoir-blank');
  const form = $('#memoir-form');
  if (!view || !blank || !form) return;

  const m = lm.memoir;
  const has = !!(m && (m.b || m.t));

  form.hidden = true;
  view.hidden = !has;
  blank.hidden = has;
  $('#memoir-kicker')?.style.setProperty('--ac', lm.accent);

  if (has) {
    const ti = $('#memoir-title');
    const bo = $('#memoir-body');
    ti.textContent = m.t || '';
    ti.hidden = !m.t;
    bo.textContent = m.b || '';
    bo.hidden = !m.b;
    const mood = $('#memoir-mood');
    if (mood) {
      mood.hidden = m.m == null;
      mood.textContent = m.m == null ? '' : t('memoir.m' + m.m);
    }
    const stamp = $('#memoir-stamp');
    if (stamp) stamp.textContent = m.at ? t('memoir.at', { t: fmtMemoirTime(m.at) }) : '';
  } else {
    const stamp = $('#memoir-stamp');
    if (stamp) stamp.textContent = '';
  }
}

function openMemoirEdit() {
  const lm = currentLandmark();
  if (!lm) return;
  const m = lm.memoir || {};
  $('#memoir-view').hidden = true;
  $('#memoir-blank').hidden = true;
  const form = $('#memoir-form');
  form.hidden = false;
  $('#memoir-in-title').value = m.t || '';
  $('#memoir-in-body').value = m.b || '';
  memoirMood = (m.m == null) ? -1 : +m.m;
  paintTastes();
  updateMemoirCount();
  const ta = $('#memoir-in-body');
  requestAnimationFrame(() => {
    /* 有正文就接着改正文，否则从标题开始 */
    (ta.value ? ta : $('#memoir-in-title')).focus({ preventScroll: true });
    if (ta.value) ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

function closeMemoirEdit() {
  const form = $('#memoir-form');
  if (form) form.hidden = true;
  renderMemoir();
}

function saveMemoir(e) {
  e?.preventDefault();
  const lm = currentLandmark();
  if (!lm) return;
  const ti = $('#memoir-in-title').value.trim();
  const bo = $('#memoir-in-body').value.trim();
  if (!ti && !bo) { toast(t('memoir.needText'), true); return; }
  lm.memoir = { t: ti.slice(0, 40), b: bo.slice(0, 800), m: memoirMood < 0 ? null : memoirMood, at: Date.now() };
  saveLandmarks();
  closeMemoirEdit();
  toast(t('memoir.toastSaved'));
}

function initMemoir() {
  $('#memoir-blank')?.addEventListener('click', openMemoirEdit);
  $('#memoir-edit')?.addEventListener('click', openMemoirEdit);
  $('#memoir-cancel')?.addEventListener('click', closeMemoirEdit);
  $('#memoir-form')?.addEventListener('submit', saveMemoir);
  $('#memoir-in-body')?.addEventListener('input', updateMemoirCount);

  $$('#memoir-tastes .taste').forEach(b => {
    /* 再点一次已选的可以取消，余味是可选项 */
    b.addEventListener('click', () => {
      const v = +b.dataset.taste;
      memoirMood = memoirMood === v ? -1 : v;
      paintTastes();
    });
  });

  /* Ctrl / ⌘ + Enter 保存，Esc 取消 */
  $('#memoir-form')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMemoirEdit(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveMemoir(); }
  });
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
/* 缩略图是"能认出这是哪张"的最小尺寸，不是预览图。
   640 px 长边在 2× 屏的网格里已经够锐；再大只会让同步体积
   和内存翻倍（旧版 1280 一张要 200 KB+）。 */
function makeThumb(canvas) {
  const long = Math.max(canvas.width, canvas.height);
  const k = Math.min(1, 640 / long);
  const w = Math.max(1, Math.round(canvas.width * k));
  const h = Math.max(1, Math.round(canvas.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

/* 配额写满时给出可执行的提示，而不是默默少几张 */
let quotaWarned = false;
function checkQuota(err) {
  if (quotaWarned) return;
  const name = err?.name || '';
  if (name === 'QuotaExceededError' || err?.code === 22) {
    quotaWarned = true;
    toast(t('toast.noSpace'), true);
    setTimeout(() => { quotaWarned = false; }, 6000);
  }
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

    /* 入库前统一过契约：尺寸、名称、缩略图前缀、EXIF 白名单都在
       model.js 里判一次，避免坏字段流到布局和云同步里。 */
    const rec = normalizePhoto({
      id: 'ph-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      landmarkId,
      name: f.name.replace(/\.[^.]+$/, '') || t('common.untitled'),
      w: full.width, h: full.height,
      /* 有拍摄时间就用拍摄时间：相册按 t 倒序，用上传时间会把
         一次旅行里不同日子的片子打乱。 */
      t: exif?.ts || (Date.now() + i),
      thumb, exif
    }, { untitled: t('common.untitled') });
    rec.blob = blob;
    rec.hasBlob = true;
    rec.rev = 1;
    rec.at = Date.now();

    try { await dbPut(rec); } catch (err) { checkQuota(err); skip++; continue; }
    markDirty('photo', rec.id);
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
  /* 墓碑 + 脏标记：登出状态或断网时删掉的照片，下次同步仍然会删云端，
     否则另一台设备的旧副本会把它推回来。 */
  tombstone('photo', p.id, p.rev | 0);
  state.photos = state.photos.filter(x => x.id !== p.id);
  schedulePush(600);
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
  showPhoto(lbImg, p);
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
let gazHit = null;       /* 联想选中的地名库条目（含中英名与坐标） */
let globePick = false;   /* 「点选地球」拾取模式：对话框让位，点球回填 */

function hideSuggest() {
  const box = $('#ac-suggest');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function setGlobePick(on) {
  globePick = on;
  $('#earth-canvas')?.classList.toggle('is-picking', on);
}

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
  gazHit = null;
  globePick = false;
  setGlobePick(false);
  hideSuggest();
  $('#dlg-form').reset();
  $('#dlg-kicker').textContent = t('dlg.newKicker');
  $('#dlg-title').textContent = t('dlg.newTitle');
  $('#dlg-submit').textContent = t('dlg.create');
  $('#dlg-err').hidden = true;
  paintSwatches(ACCENTS[Math.floor(Math.random() * ACCENTS.length)]);
  if (geo) {
    $('#f-coord').value = fmtCoord(geo.lat, geo.lng);
    setGeo('ok', `${t('geo.picked')} · ${fmtCoord(geo.lat, geo.lng)}`);
  }
  dlg.showModal();
  setTimeout(() => $('#f-name').focus(), 60);
}

/* 「点选地球」回来：保留表单内容，只回填坐标 */
function reopenPickDialog(geo) {
  if (!dlg) return;
  pickGeo = geo || pickGeo;
  if (pickGeo) {
    $('#f-coord').value = fmtCoord(pickGeo.lat, pickGeo.lng);
    setGeo('ok', `${t('geo.picked')} · ${fmtCoord(pickGeo.lat, pickGeo.lng)}`);
  }
  if (!dlg.open) dlg.showModal();
  setTimeout(() => $('#f-name').focus(), 60);
}

function openEditDialog(lm) {
  if (!lm) return;
  state.editing = lm.id;
  pickGeo = lm.lat != null ? { lat: lm.lat, lng: lm.lng } : null;
  gazHit = null;
  globePick = false;
  setGlobePick(false);
  hideSuggest();
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
  if (!geo || (getLang() === 'en' && hasCJK && !gazHit)) {
    /* 地名库先答：本地联想没选中的，这里再补一次即时检索 */
    let places = [];
    try { places = await searchPlaces(name, 1); } catch { places = []; }
    if (places.length) { hit = { labelEn: places[0].en, labelZh: places[0].zh || '', lat: places[0].lat, lng: places[0].lng }; }
    else { try { hit = await geocode(name); } catch {} }
  }
  if (!geo && hit) {
    geo = { lat: hit.lat, lng: hit.lng };
    $('#f-coord').value = fmtCoord(geo.lat, geo.lng);
  }

  /* 中英双名：联想/识别的英文名优先，name 保留用户输入 */
  const nameEn = (gazHit && gazHit.en) || (hit && hit.labelEn) || (hasCJK ? '' : name);

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
  const site = saveSite(next);
  applySite(site);
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
    const gone = state.photos.filter(p => p.landmarkId === lm.id).map(p => p.id);
    for (const p of photosOf(lm.id)) dropURL(p.id);
    await delPhotosOfAlbum(lm.id);
    tombstone('album', lm.id, lm.rev | 0);
    gone.forEach(id => tombstone('photo', id));
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
  if (act === 'theme') cycleTheme();
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
  albumEl.querySelector('.album__bar')?.classList.toggle('is-stuck', albumScroll.scrollTop > 36);
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
/* ── 实时：按真实时间计算直射点，同步光照与地球转向 ── */
let liveTimer = 0;

function subsolarPoint(d = new Date()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const day = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000;
  /* 太阳赤纬：年内正弦变化，冬至约 -23.44° */
  const decl = -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365.24);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  let lng = 180 - hours * 15;
  lng = ((lng + 540) % 360) - 180;
  return { decl, lng };
}

function paintClock() {
  const el2 = $('#earth-clock-t');
  if (!el2) return;
  const d = new Date();
  el2.textContent = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

function setLive(on) {
  const btn = $('#earth-live');
  const clock = $('#earth-clock');
  btn?.setAttribute('aria-pressed', String(on));
  if (clock) clock.hidden = !on;
  clearInterval(liveTimer);
  liveTimer = 0;
  if (!on) { earth?.clearSunGeo(); return; }

  const apply = () => {
    const s = subsolarPoint();
    earth?.setSunGeo(s.decl, s.lng);
    paintClock();
  };
  apply();
  const s0 = subsolarPoint();
  /* 对准晨昏线：一半白天、一半夜灯，比正午点居中好看也更有信息量 */
  earth?.focus(0, s0.lng + 90);
  earth?.setAuto(false);
  const auto = $('#earth-auto');
  auto?.setAttribute('aria-pressed', 'false');
  liveTimer = setInterval(apply, 30000);   /* 半分钟校准一次，足够准也几乎不耗性能 */
}

$('#earth-live')?.addEventListener('click', e => {
  const btn = e.currentTarget;
  setLive(btn.getAttribute('aria-pressed') !== 'true');
});

/* ── 画质档位：1K / 2K / 4K ── */
const LS_RES = 'atlas.res.v1';

function currentRes() {
  try {
    const v = localStorage.getItem(LS_RES);
    if (v && ['1k', '2k', '4k'].includes(v)) return v;
  } catch {}
  /* 低端设备（核数/内存不足或省流量）不上 4K：首屏那 1 MB 只会拖慢出图 */
  if (earth?.caps?.().lowEnd) return '2k';
  if (matchMedia('(max-width: 860px)').matches) return '2k';
  /* 按"有效像素"而不是"是不是桌面"来选档：
     球体在屏幕上大约占短边的 56%，2K 贴图（可见半球 1024 纹素）
     已经能覆盖 1080p 以内的显示；只有高 DPI 或大屏才需要 4K。
     1440×900 @1x 拉 4K 是白下 1.3 MB，看不出差别。 */
  const px = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 2));
  return px >= 1900 ? '4k' : '2k';
}

function paintRes() {
  const cur = earth?.getResolution?.() || currentRes();
  $$('.planet__res-btns button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.res === cur));
  });
}

$$('.planet__res-btns button').forEach(btn => {
  btn.addEventListener('click', async () => {
    const r = btn.dataset.res;
    if (!earth || btn.getAttribute('aria-pressed') === 'true') return;
    const all = $$('.planet__res-btns button');
    all.forEach(b => { b.disabled = true; });
    toast(t('planet.loadingRes', { r: r.toUpperCase() }));
    try {
      await earth.setResolution(r);
      try { localStorage.setItem(LS_RES, r); } catch {}
      toast(t('planet.resDone', { r: r.toUpperCase() }));
    } catch {
      toast(t('planet.resFail', { r: r.toUpperCase() }), true);
    } finally {
      all.forEach(b => { b.disabled = false; });
      paintRes();
    }
  });
});

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


/* ───────── 地理识别：地名 → 坐标 ─────────
   两级识别：本地地名库（离线、即时）→ 线上 geocode（Wikipedia + OSM）。 */
const geoEl = $('#geo');
const geoText = $('#geo-text');
const geoBtn = $('#geo-btn');
const geoPickBtn = $('#geo-pick');
let geoBusy = false;

function setGeo(stateName, text) {
  if (!geoEl) return;
  geoEl.dataset.state = stateName;
  geoText.textContent = text;
  geoBtn.disabled = stateName === 'loading';
}

function applyGeoHit(place, source) {
  gazHit = place;
  pickGeo = { lat: place.lat, lng: place.lng };
  $('#f-coord').value = fmtCoord(place.lat, place.lng);
  const shown = getLang() === 'en' ? place.en : (place.zh || place.en);
  setGeo('ok', `${shown} · ${place.country} · ${source}`);
  if (!$('#f-note').value.trim()) {
    $('#f-note').value = composeIntro({
      name: getLang() === 'en' ? place.en : (place.zh || place.en),
      lat: place.lat, lng: place.lng,
      date: $('#f-date').value, lang: getLang()
    });
  }
}

async function locateFromName() {
  if (!geoEl || geoBusy) return;
  const name = ($('#f-name').value || '').trim();
  if (name.length < 2) { setGeo('idle', t('geo.idle')); return; }
  let places = [];
  try { places = await searchPlaces(name, 1); } catch { places = []; }
  if (places.length) {
    applyGeoHit(places[0], t('geo.gaz'));
    return;
  }

  /* ② 线上识别（Wikipedia / OSM），带缓存 */
  geoBusy = true;
  setGeo('loading', t('geo.loading'));
  let hit = null;
  try { hit = await geocode(name); } catch { hit = null; }
  geoBusy = false;

  if (hit) {
    applyGeoHit(
      { zh: hit.labelZh || '', en: hit.labelEn || hit.label, country: hit.source, lat: hit.lat, lng: hit.lng },
      hit.source
    );
  } else {
    gazHit = null;
    setGeo('fail', t('geo.fail'));
  }
}

/* ── 联想下拉：输入即查地名库 ── */
const acBox = $('#ac-suggest');
let gazList = [];
let gazIdx = -1;
let suggestTimer = 0;

function renderSuggest() {
  if (!acBox) return;
  acBox.innerHTML = '';
  gazList.forEach((p, i) => {
    const b = el('button', 'ac-item');
    b.type = 'button';
    b.dataset.i = String(i);
    const name = getLang() === 'en' ? p.en : (p.zh || p.en);
    b.innerHTML = `<span class="ac-item__name">${esc(name)}</span>` +
      `<span class="ac-item__sub">${esc([getLang() === 'en' ? (p.zh || '') : p.en, p.country].filter(Boolean).join(' · '))}</span>` +
      `<span class="ac-item__geo">${esc(fmtCoord(p.lat, p.lng))}</span>`;
    b.addEventListener('click', () => choosePlace(p));
    acBox.appendChild(b);
  });
  acBox.hidden = false;
}

function paintSuggestActive() {
  $$('.ac-item', acBox).forEach((b, i) => {
    b.dataset.active = String(i === gazIdx);
    if (i === gazIdx) b.scrollIntoView({ block: 'nearest' });
  });
}

function choosePlace(p) {
  gazHit = p;
  pickGeo = { lat: p.lat, lng: p.lng };
  $('#f-name').value = (getLang() === 'en' ? p.en : (p.zh || p.en)).slice(0, 16);
  $('#f-coord').value = fmtCoord(p.lat, p.lng);
  setGeo('ok', `${p.zh || p.en} · ${p.country} · ${t('geo.gaz')}`);
  hideSuggest();
  if (!$('#f-note').value.trim()) {
    $('#f-note').value = composeIntro({
      name: getLang() === 'en' ? p.en : (p.zh || p.en),
      lat: p.lat, lng: p.lng,
      date: $('#f-date').value, lang: getLang()
    });
  }
}

async function refreshSuggest() {
  clearTimeout(suggestTimer);
  const name = $('#f-name')?.value || '';
  suggestTimer = setTimeout(async () => {
    const q = name.trim();
    if (!q || q.length < 1) { hideSuggest(); return; }
    try { gazList = await searchPlaces(q, 7); } catch { gazList = []; }
    gazIdx = -1;
    if (gazList.length) renderSuggest(); else hideSuggest();
  }, 120);
}

$('#f-name')?.addEventListener('input', refreshSuggest);
$('#f-name')?.addEventListener('keydown', e => {
  if (acBox?.hidden) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    gazIdx = Math.min(gazList.length - 1, gazIdx + 1);
    paintSuggestActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    gazIdx = Math.max(-1, gazIdx - 1);
    paintSuggestActive();
  } else if (e.key === 'Enter' && gazIdx >= 0) {
    e.preventDefault();
    choosePlace(gazList[gazIdx]);
  } else if (e.key === 'Escape') {
    hideSuggest();
  }
});
$('#f-name')?.addEventListener('blur', () => {
  /* 给点击留出时间，点击联想项会先于 blur 完成 */
  setTimeout(hideSuggest, 150);
  if (!$('#f-coord').value.trim() && ($('#f-name').value || '').trim().length >= 2) locateFromName();
});
geoBtn?.addEventListener('click', locateFromName);

/* 点选地球：对话框让位，点击球面回填坐标（Esc 取消并回到表单） */
geoPickBtn?.addEventListener('click', () => {
  hideSuggest();
  setGlobePick(true);
  dlg.close();
  toast(t('geo.pickHint'));
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && globePick) {
    /* Esc 的默认行为是"取消已打开的模态框"——它会在本次 keydown 的
       处理器全部跑完之后执行。若在这里同步重开对话框，刚打开就被
       默认行为关掉。所以：阻断默认 + 下一帧再开。 */
    e.preventDefault();
    setGlobePick(false);
    setTimeout(() => reopenPickDialog(null), 0);
  }
});

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
      card.appendChild(el('div', 'slide__empty', `<span>${esc(placeName(lm))}</span>`));
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
      /* 英文用空格分隔计数，中文直接连写更紧凑 */
      const gap = getLang() === 'en' ? ' ' : '';
      box.appendChild(el('span', 'tag', `${esc(tagLabel(t))}${gap}<i>${n}</i>`));
    });
}

function renderReco() {
  const list = $('#reco-list');
  if (!list) return;
  list.innerHTML = '';
  const out = [];

  const empty = state.landmarks.filter(l => photosOf(l.id).length < 2);
  if (empty.length) {
    out.push(['reco.fill', t('reco.fillText', { name: placeName(empty[0]) })]);
  }

  const withPhotos = state.landmarks.filter(l => photosOf(l.id).length);
  if (withPhotos.length) {
    const oldest = withPhotos.slice().sort((a, b) => (photosOf(a.id)[0]?.t || 0) - (photosOf(b.id)[0]?.t || 0))[0];
    const days = Math.round((Date.now() - (photosOf(oldest.id)[0]?.t || Date.now())) / 86400000);
    if (days > 7) out.push(['reco.revisit', t('reco.revisitText', { name: placeName(oldest), n: days })]);
  }

  if (state.landmarks.length >= 2) {
    const a = state.landmarks.find(l => l.lat != null);
    const peer = a && state.landmarks.find(l => l.id !== a.id && l.lat != null && Math.abs(l.lat - a.lat) < 8);
    if (peer) out.push(['reco.peer', t('reco.peerText', { a: placeName(a), b: placeName(peer) })]);
  }

  if (state.photos.length && !localStorage.getItem(acctKey('atlas.backed.v1'))) {
    out.push(['reco.backup', t('reco.backupText')]);
  }

  if (!out.length) out.push(['reco.start', t('reco.startText')]);

  out.slice(0, 4).forEach(([k, text], i) => {
    list.appendChild(el('li', '', `<i>${pad2(i + 1)}</i><span><b>${esc(t(k))}</b> · ${esc(text)}</span>`));
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
let vaultTimer = 0;
function updateVaultStats(delay = 240) {
  /* 体检是 O(n) 的（还要读 storage.estimate），每次落盘都跑会让
     大相册的编辑操作明显发涩。这里合并成一次，260ms 内只算一遍。 */
  clearTimeout(vaultTimer);
  vaultTimer = setTimeout(runVaultStats, delay);
}

async function runVaultStats() {
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

  /* 数据体检：把「有记录但打不开」的情况摆在明面上，
     而不是等用户发现照片少了几张。 */
  const el = $('#vault-health');
  if (!el) return;
  try {
    const h = await storeHealth({ albums: state.landmarks, photos: state.photos });
    const errs = h.issues.filter(i => i.level === 'error').reduce((a, i) => a + (i.n || 0), 0);
    /* info 级（比如"原图还没下载"）是正常状态，不计入提示数 */
    const warns = h.issues.filter(i => i.level === 'warn').reduce((a, i) => a + (i.n || 0), 0);
    el.textContent = errs ? t('vault.bad', { n: errs })
      : warns ? t('vault.warn', { n: warns })
        : t('vault.ok');
    el.dataset.state = errs ? 'bad' : warns ? 'warn' : 'ok';
  } catch {
    el.textContent = '—';
  }
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

$('#vault-repair')?.addEventListener('click', async () => {
  const btn = $('#vault-repair');
  btn.disabled = true;
  try {
    const r = await window.atlasData.repair();
    const n = (r.removed || 0) + (r.covers || 0);
    toast(n ? t('vault.repairDone', { n }) : t('vault.repairNone'));
  } catch (e) {
    toast(String(e?.message || e), true);
  } finally {
    btn.disabled = false;
  }
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
      passphrase: pass,
      loadBlob: p => ensureBlob(p)
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
    try { localStorage.setItem(acctKey('atlas.backed.v1'), String(Date.now())); } catch {}
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
    const r = await mergeBackup(payload);
    const bits = [`${r.albums} 处地标`, `${r.photos} 张照片`];
    if (r.fixed) bits.push(`修正 ${r.fixed} 项`);
    if (r.skipped) bits.push(`跳过 ${r.skipped} 条无效记录`);
    toast('已恢复 ' + bits.join(' · '), r.skipped > 0 && !r.albums && !r.photos);
  } catch (err) {
    toast(err?.message || '导入失败', true);
  }
});

/* 导入备份：外部文件是最不可信的数据源，逐条过契约。
   修掉字段就计一次 fixed，整条无法成立（没有 id / 找不到所属相册）就跳过。
   与本地已有条目合并时把 rev 抬到两者之上——用户是主动导入，
   这次导入必须赢过本地旧副本，也必须赢过云端旧副本。 */
async function mergeBackup(payload) {
  const now = Date.now();
  let fixed = 0, skipped = 0, addedAlbums = 0, addedPhotos = 0;

  const byId = new Map(state.landmarks.map(l => [l.id, l]));
  for (const raw of payload.landmarks || []) {
    const issues = albumIssues(raw);
    const next = normalizeAlbum(raw, {
      untitled: t('common.untitled'),
      accent: ACCENTS[0]
    });
    if (!next) { skipped++; continue; }
    fixed += issues.length;

    const cur = byId.get(next.id);
    if (cur) {
      const rev = Math.max(cur.rev | 0, next.rev | 0) + 1;
      Object.assign(cur, next, {
        coverId: cur.coverId || next.coverId,
        rev,
        at: now,
        deleted: false
      });
    } else {
      next.rev = Math.max(1, next.rev | 0);
      next.at = next.at || now;
      state.landmarks.push(next);
      byId.set(next.id, next);
      addedAlbums++;
    }
  }
  saveLandmarks();

  /* 导入是明确的"恢复"意图：清掉这些条目的墓碑，否则云端的删除记录
     会在下一次同步时把它们再删一遍。 */
  clearTombstones('album', state.landmarks.map(l => l.id));
  markDirty('album');

  /* 照片必须挂在已存在的相册上，否则会变成统计里有、界面里永远看不到的孤儿 */
  const albumIds = new Set(state.landmarks.map(l => l.id));
  const have = new Set(state.photos.map(p => p.id));
  const added = [];

  for (const raw of payload.photos || []) {
    const issues = photoIssues(raw, albumIds);
    if (issues.includes('orphan') || issues.includes('no_album') || issues.includes('not_object')) {
      skipped++;
      continue;
    }
    const p = normalizePhoto(raw, { untitled: t('common.untitled') });
    if (!p || have.has(p.id)) { if (!p) skipped++; continue; }

    const blob = photoBlob(raw.data);
    if (!blob) { skipped++; continue; }

    p.blob = blob;
    p.rev = Math.max(1, p.rev | 0);
    p.at = now;
    fixed += issues.length;

    try {
      await dbPut(p);
      markDirty('photo', p.id);
      added.push(p);
      have.add(p.id);
    } catch (err) {
      checkQuota(err);
      skipped++;
    }
  }
  state.photos.push(...added);
  addedPhotos = added.length;
  if (added.length) clearTombstones('photo', added.map(p => p.id));

  if (payload.site) {
    const site = saveSite({ ...DEFAULT_SITE, ...payload.site }, { touch: true, mark: true });
    applySite(site);
  }

  syncStats();
  renderWall();
  renderOverview();
  buildMarkers();
  updateVaultStats();
  schedulePush(400);
  return { albums: addedAlbums, photos: addedPhotos, fixed, skipped };
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
  /* 云同步条的文字是运行时算的，applyI18n 会把它重置成默认词条，
     所以这里再画一次（未连接时它自己会隐藏） */
  renderCloud();
  /* 动态区域重绘，保证切换后不残留旧语言 */
  renderWall();
  renderOverview();
  renderIndex();
  renderPlanetList();
  buildMarkers();
  layerPanel?.rebuild();
  if (state.current) {
    const lm = currentLandmark();
    if (lm && !isLocked(lm)) {
      $('#album-meta').innerHTML = [lm.coord, lm.date, t('ov.count', { n: photosOf(lm.id).length })]
        .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');
      renderMemoir();
      paintTastes();
      updateMemoirCount();
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
  const paint = ({ playing, muted }) => {
    const st = muted ? 'off' : (playing ? 'on' : 'pending');
    btn.dataset.state = st;
    btn.setAttribute('aria-pressed', String(st === 'on'));
    if (playing) hint && (hint.hidden = true);
  };
  music.onChange(paint);

  const wanted = () => {
    try { return localStorage.getItem(LS_MUTED) !== '1'; } catch { return true; }
  };
  paint({ playing: false, muted: !wanted() });

  const begin = async () => {
    if (!wanted()) return;
    const ok = await music.start();
    if (!ok) {
      /* 被自动播放策略拦下：先给一个不打扰的提示，等任意一次手势再起 */
      setTimeout(() => { if (hint && !music.isPlaying()) hint.hidden = false; }, 900);
      /* 提示是一次性引导：十几秒后自动收起，免得一直压着内容 */
      setTimeout(() => { if (hint && !music.isPlaying()) hint.hidden = true; }, 18000);
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

/* ───────── 账号 ───────── */
const ACCT_OPEN = 'atlas.acct.open';

/* ───────── 云同步 ─────────
   本地账号解决"这台机器"，云同步解决"换台机器"。

   分工：
     store.js  记住哪些改动还没上云、哪些条目被删了（墓碑）
     cloud.js  只做传输，不含任何"谁该赢"的判断
     这里      编排：先拉后推 → 合并 → 退避重试 → 更新界面

   一致性规则（与 model.pickNewer 一致）：
     rev 大者赢；rev 相同看时间；再相同保留本地。
     删除是一条"更新更晚的墓碑"，所以旧设备的副本顶不回来。
   ─────────────────────────────── */
const SYNC = { phase: 'idle', error: '', lastAt: 0, tries: 0 };
let syncTimer = 0, retryTimer = 0, running = false, pulledOnce = false, queued = false;
let lastPullAt = 0;

/* 云同步的作用域 = 当前本机账号（未登录时是 guest）。
   同一个浏览器里换本机账号，不能把上一个账号的云端数据静默灌进新分区；
   要么在当前账号下重新启用（会走一次合并），要么保持暂停。 */
const LS_CLOUD_SCOPE = 'atlas.cloud.scope.v1';
const scopeId = () => currentUser()?.id || 'guest';
function scopeBound() {
  try {
    const v = localStorage.getItem(LS_CLOUD_SCOPE);
    if (!v || v === scopeId()) return true;
    /* 本机账号已绑定同一张 WorkBuddy 身份：换设备/重新登录后自动恢复，
       不再让用户点一次"在此账号下启用" */
    const u = currentUser();
    if (u && cloudUser() && cloudIdOf(u.id) === cloudUser().id) {
      bindScope();
      return true;
    }
    return false;
  } catch { return true; }
}
function bindScope() {
  try { localStorage.setItem(LS_CLOUD_SCOPE, scopeId()); } catch {}
}

function setCloudState(kind, text) {
  const box = $('#acct-cloud');
  if (!box) return;
  box.classList.toggle('is-on', kind === 'on');
  box.classList.toggle('is-busy', kind === 'busy');
  box.classList.toggle('is-err', kind === 'error');
  const sub = $('#acct-cloud-sub');
  if (sub && text) sub.textContent = text;
}

function syncSummary() {
  const m = storeMeta();
  return m.syncedAt
    ? t('cloud.synced', { a: state.landmarks.length, p: state.photos.length })
    : t('cloud.sub');
}

/* 云登录成功后，把当前本机分区绑定到这张云身份：
   换设备后本机账号（或访客分区）会自动认领同一张云身份，无需二次确认 */
function bindScopeToUser() {
  const u = currentUser();
  const cid = cloudUser()?.id;
  if (u && cid && cloudIdOf(u.id) !== cid) bindCloud(u.id, cid);
  bindScope();
}

function renderCloud() {
  const box = $('#acct-cloud');
  if (!box) return;
  /* 默认展示跨设备同步入口：账号与作品随 ATLAS 云账号走 */
  if (!APP.features.cloudSync) { box.hidden = true; return; }
  box.hidden = false;

  const me = $('#acct-cloud-me');
  const form = $('#acct-cloud-form');
  const note = $('#acct-cloud-note');
  const u = cloudUser();

  /* ① 已登录：昵称 + 同步状态 */
  if (u) {
    form.hidden = true;
    note.hidden = true;
    me.hidden = false;
    $('#acct-cloud-title').textContent = t('cloud.connected', { name: u.name });
    const nick = $('#acct-cloud-nick');
    if (nick && document.activeElement !== nick) {
      nick.value = (state.site?.profile?.nickname) || u.name || '';
    }
    $('#acct-cloud-sync').textContent = SYNC.phase === 'error' ? t('cloud.retry') : t('cloud.syncNow');
    if (SYNC.phase === 'busy') setCloudState('busy', t('cloud.syncing'));
    else if (SYNC.phase === 'error') setCloudState('error', t('cloud.failed', { msg: SYNC.error || '—' }));
    else if (navigator.onLine === false) setCloudState('on', t('cloud.offlineMode'));
    else setCloudState('on', syncSummary());
    return;
  }

  /* ② 未登录：先看降级原因，再看验证码表单 */
  me.hidden = true;
  $('#acct-cloud-title').textContent = t('cloud.title');

  if (!cloudAvailable()) {
    form.hidden = true;
    note.hidden = false;
    /* 区分两类原因：域名没绑定（GitHub Pages/本地预览）说"去应用域名"；
       域名对了但组件没加载成功，才说"组件失败、刷新重试"。 */
    const host = location.hostname;
    const onCloudHost = APP.cloud.hosts.some(s => host === s || host.endsWith('.' + s))
      || (APP.cloud.allowLocalhost && (host === 'localhost' || host === '127.0.0.1'));
    if (!onCloudHost) note.textContent = t('cloud.unbound', { host: APP.cloud.endpoint.replace(/^https?:\/\//, '') });
    else note.textContent = t('cloud.sdkFail');
    setCloudState('', t('cloud.offline'));
    return;
  }
  if (navigator.onLine === false) {
    form.hidden = false;
    note.hidden = false;
    note.textContent = t('cloud.offlineMode');
    setCloudState('', t('cloud.offlineMode'));
    return;
  }
  note.hidden = true;
  form.hidden = false;
  setCloudState('', t('cloud.sub'));
}

function schedulePush(delay = 1200) {
  if (!APP.features.cloudSync) return;
  if (!cloudUser() || !cloudAvailable() || !scopeBound()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (running) { queued = true; return; }
    syncNow('edit');
  }, delay);
}

/* 墓碑也要作为记录参与合并：它们不是"不存在"，而是"更晚的删除" */
function tombstoneAlbums() {
  const { tombstones } = storeMeta();
  return Object.entries(tombstones.albums).map(([id, t]) => ({
    id, name: '', nameEn: '', coord: '', date: '', note: '', memoir: null,
    accent: ACCENTS[0], coverId: null, lat: null, lng: null, keyHash: '',
    createdAt: 0, rev: t.rev | 0, at: t.at | 0, deleted: true
  }));
}

async function syncPull() {
  setCloudState('busy', t('cloud.syncing'));

  const { albums: aRows, photos: pRows } = await pullAll();
  const remoteAlbums = aRows.map(albumFromRow).filter(Boolean);
  const remotePhotos = pRows.map(photoFromRow).filter(Boolean);

  /* ① 相册 */
  /* 只有"整机还是三本示例、没有任何照片"时才允许让位；
     用户已经动过其中一本，就不能再删别的示例 */
  const pristineGuest = state.landmarks.length > 0 &&
    state.photos.length === 0 &&
    state.landmarks.every(l =>
      DEMO_ALBUMS.has(l.id) && (l.rev | 0) <= 1 && !l.memoir && !l.coverId
    );

  const localAlbums = state.landmarks.map(normalizeLM).concat(tombstoneAlbums());
  const mergedARes = mergeAlbumCollections(localAlbums, remoteAlbums);
  const mergedA = mergedARes.items;
  let liveAlbums = mergedA.filter(a => !a.deleted);

  /* 新设备首次登录云端：本机可能刚灌了三本示例册。
     云端有真实数据时，把"没照片、没手记、没改过"的示例让位，避免混在一起。 */
  if (pristineGuest && remoteAlbums.some(a => !a.deleted)) {
    liveAlbums = liveAlbums.filter(a => !DEMO_ALBUMS.has(a.id));
  }
  const deadAlbums = mergedA.filter(a => a.deleted);
  const deadAlbumIds = new Set(deadAlbums.map(a => a.id));

  /* 合并后的内容与云端不一致（本地较新，或字段级合并拼出了新组合）
     → 需要回推。只看"内容"，避免因为 rev/at 的差异白推一遍。 */
  const remoteAById = new Map(remoteAlbums.map(a => [a.id, a]));
  let pushedNeeded = mergedA.some(a => {
    if (a.deleted) return false;
    const r = remoteAById.get(a.id);
    return !r || !sameAlbumContent(a, r);
  });

  /* 云端删掉的相册：本地连照片一起删，并给照片留墓碑，
     避免下次从第三台设备把它们推回来 */
  let removedAlbums = 0;
  /* 云端还"活着"、本地却是墓碑：说明有设备推了旧副本回来。
     本地挡住它，同时把墓碑重新标记为待推送，让云端也回到删除状态。 */
  const liveOnRemote = new Set(remoteAlbums.filter(a => !a.deleted).map(a => a.id));

  for (const dead of deadAlbums) {
    const id = dead.id;

    if (liveOnRemote.has(id)) {
      tombstone('album', id, dead.rev | 0, { pushed: false });
      continue;
    }
    /* 云端删掉的条目也要在本地留墓碑：否则第三台设备再推一次旧副本，
       本地没有"这是删除"的记忆，就跟着复活了。 */
    if (state.landmarks.some(l => l.id === id)) tombstone('album', id, dead.rev | 0, { pushed: true });
    if (!state.landmarks.some(l => l.id === id)) continue;
    state.photos.filter(p => p.landmarkId === id).forEach(p => tombstone('photo', p.id, p.rev | 0));
    await delPhotosOfAlbum(id);
    state.photos = state.photos.filter(p => p.landmarkId !== id);
    removedAlbums++;
  }
  if (removedAlbums) state.landmarks = state.landmarks.filter(l => !deadAlbumIds.has(l.id));

  state.landmarks = liveAlbums.map(normalizeLM);
  const savedA = saveAlbums(state.landmarks, { bump: false });
  if (!savedA.ok) throw savedA.error || new Error('album_write_failed');

  /* ② 照片 */
  const localPhotos = state.photos.map(p => ({ ...p, deleted: false })).concat(
    Object.entries(storeMeta().tombstones.photos).map(([id, t]) => ({
      id, landmarkId: '', name: '', w: 4, h: 3, t: 0,
      thumb: '', remote: null, exif: null, rev: t.rev | 0, at: t.at | 0, deleted: true
    }))
  );
  const mergedP = mergeCollections(localPhotos, remotePhotos).items;

  const deadPhotoRecords = mergedP.filter(p => p.deleted);
  const deadPhotos = deadPhotoRecords.map(p => p.id);
  if (deadPhotos.length) {
    /* 同理：远端删除在本地落成墓碑；如果云端反而"活着"，重新排队推送 */
    const livePhotoOnRemote = new Set(remotePhotos.filter(x => !x.deleted).map(x => x.id));
    deadPhotoRecords.forEach(p => tombstone('photo', p.id, p.rev | 0, {
      pushed: !livePhotoOnRemote.has(p.id)
    }));
    await delPhotos(deadPhotos);
    const dead = new Set(deadPhotos);
    state.photos = state.photos.filter(p => !dead.has(p.id));
  }

  const albumIds = new Set(state.landmarks.map(l => l.id));
  const byId = new Map(state.photos.map(p => [p.id, p]));
  let addedPhotos = 0;

  for (const rp of mergedP) {
    if (rp.deleted) continue;
    if (!albumIds.has(rp.landmarkId)) continue;   /* 孤儿：宁可不上屏也不制造幽灵卡片 */
    const cur = byId.get(rp.id);

    if (cur) {
      const newer = (rp.rev | 0) > (cur.rev | 0)
        || ((rp.rev | 0) === (cur.rev | 0) && (rp.at | 0) > (cur.at | 0));
      if (newer) {
        const blob = cur.blob;
        Object.assign(cur, rp, {
          blob,
          /* 远端这一行可能没带缩略图/原图路径（旧行或上传失败），
             不要用它覆盖本地已有的那份 */
          thumb: rp.thumb || cur.thumb,
          remote: rp.remote || cur.remote
        });
        try { await dbPut(cur); } catch (e) { console.warn('[sync] photo meta', e); }
      }
    } else {
      const rec = { ...rp, blob: null };
      state.photos.push(rec);
      byId.set(rec.id, rec);
      try { await dbPut(rec); } catch (e) { console.warn('[sync] photo add', e); }
      addedPhotos++;
    }
  }

  if (pushedNeeded || Object.keys(unpushedTombstones().albums).length) markDirty('album');

  /* ③ 站点设置：单行文档，LWW（rev → at） */
  try {
    const rs = await pullSettings();
    const localRev = state.site?.rev | 0;
    const localAt = state.site?.at | 0;
    if (rs) {
      const remote = {
        ...DEFAULT_SITE,
        ...(rs.payload || {}),
        rev: rs.rev | 0,
        at: rs.updated_at_ms | 0
      };
      const newer = remote.rev > localRev || (remote.rev === localRev && remote.at > localAt);
      if (newer) {
        const site = saveSite(remote, { touch: false, mark: false });
        applySite(site);
      } else if (localRev > remote.rev || (localRev === remote.rev && localAt > remote.at)) {
        markDirty('settings');
      }
    } else if (localRev > 0) {
      /* 第一次上云：本地已有自定义设置，排队推上去 */
      markDirty('settings');
    }
  } catch (e) {
    console.warn('[sync] settings', e);
  }

  lastPullAt = Date.now();
  applyRemote();

  return {
    albums: liveAlbums.length,
    photos: addedPhotos,
    removed: removedAlbums,
    /* 字段级合并解决掉的冲突（云端较新的字段并入本地） */
    merged: mergedARes.conflicts.length
  };
}

/* 同步/跨标签刷新时，正在写的手记不能被关掉——用户手里的草稿优先 */
function refreshMemoirIfIdle() {
  const form = $('#memoir-form');
  if (form && !form.hidden) return;
  renderMemoir();
}

/* 拉取之后统一刷新视图，避免每个分支各写一遍 */
function applyRemote() {
  renderWall();
  syncStats();
  syncEarth();
  if (state.current && albumEl.classList.contains('is-open')) {
    albumList = photosOf(state.current);
    renderAlbumGrid();
    refreshMemoirIfIdle();
    const lm = currentLandmark();
    if (lm) {
      $('#album-meta').innerHTML = [lm.coord, lm.date, t('ov.count', { n: albumList.length })]
        .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');
    }
  }
  updateVaultStats();
}

async function syncPush() {
  const u = cloudUser();
  if (!u) return;

  const p = pending();
  const todoTomb = unpushedTombstones();

  /* ⓪ 站点设置：单行文档 */
  if (p.settings) {
    await pushSettings(sitePayload(state.site || DEFAULT_SITE), state.site?.rev | 0);
    clearDirty('settings');
  }

  /* ① 相册：只有真的有改动（或还有没送出去的墓碑）才推 */
  if (p.albums || Object.keys(todoTomb.albums).length) {
    const rows = state.landmarks.map(albumToRow);
    for (const [id, tb] of Object.entries(todoTomb.albums)) {
      rows.push({ local_id: id, payload: {}, rev: tb.rev | 0, deleted: true });
    }
    await pushAlbums(rows);
    clearDirty('album');
    markTombstonesPushed('album', Object.keys(todoTomb.albums));
  }

  /* ② 原图：每轮最多 6 张，失败累计 3 次就跳过（不阻塞其他条目） */
  const dirtyPhotos = new Set(p.photos);
  const todo = state.photos.filter(x => !x.remote && (x.hasBlob || x.blob) && (x.upFail || 0) < 3);
  const batch = todo.slice(0, APP.limits.syncPhotosPerRound);

  for (let i = 0; i < batch.length; i++) {
    const ph = batch[i];
    setCloudState('busy', t('cloud.uploading', { i: i + 1, n: batch.length }));
    try {
      const blob = await ensureBlob(ph);
      if (!blob) { ph.upFail = (ph.upFail || 0) + 1; continue; }
      ph.remote = await uploadPhotoBlob(u.id, ph.id, blob);
      ph.rev = (ph.rev | 0) + 1;
      ph.at = Date.now();
      ph.upFail = 0;
      await dbPut(ph);
      /* 原图已经进了对象存储，本地只留元数据 */
      ph.blob = null;
      dirtyPhotos.add(ph.id);
    } catch (e) {
      ph.upFail = (ph.upFail || 0) + 1;
      console.warn('[sync] upload', e);
      /* 失败计数要落库，否则刷新后又会从头重试同一张 */
      try { await dbPut(ph); } catch {}
    }
  }

  /* ③ 元数据：只推行有变化的 + 墓碑，缩略图不再每次全量上传 */
  const changed = state.photos.filter(x => dirtyPhotos.has(x.id) || !x.remote);
  if (changed.length || Object.keys(todoTomb.photos).length) {
    const rows = changed.map(photoToRow);
    for (const [id, tb] of Object.entries(todoTomb.photos)) {
      rows.push({
        local_id: id, album_local_id: '', name: '', w: 1, h: 1, taken_at: 0,
        thumb: null, remote_path: null, rev: tb.rev | 0, deleted: true
      });
    }
    await pushPhotos(rows);
    clearDirty('photo', [...dirtyPhotos, ...changed.map(x => x.id)]);
    markTombstonesPushed('photo', Object.keys(todoTomb.photos));
    /* 行已经标成 deleted，原图就不必再占对象存储了 */
    Object.keys(todoTomb.photos).forEach(id => {
      removePhotoBlob(u.id, id).catch(e => console.warn('[sync] remove file', e));
    });
  }

  if (todo.length > batch.length) schedulePush(700);
}

/* 正在写东西的时候不要拉取：syncPull 会用合并结果整体替换 state.landmarks，
   而编辑弹窗持有的是替换前的对象引用，提交时会写到已经被丢弃的那一份上。 */
function isEditing() {
  const dlg = document.getElementById('dlg');
  if (dlg && dlg.open) return true;
  const form = $('#memoir-form');
  return !!(form && !form.hidden);
}

async function syncNow(reason = 'auto') {
  if (!APP.features.cloudSync) return;
  if (running || !cloudUser() || !cloudAvailable() || !scopeBound()) return;
  if (navigator.onLine === false) { renderCloud(); return; }

  /* 切回标签页、断网重连：如果距上次拉取超过阈值，先拉一次，
     这样另一台设备的删除/改名不用等刷新页面才出现。 */
  if ((reason === 'visible' || reason === 'online') &&
      Date.now() - lastPullAt > APP.limits.pullFreshMs) {
    pulledOnce = false;
  }

  running = true;
  clearTimeout(syncTimer);
  SYNC.phase = 'busy';
  renderCloud();

  try {
    const canPull = !isEditing();
    let pulled = null;
    if (!pulledOnce && canPull) pulled = await syncPull();
    await syncPush();
    if (canPull) pulledOnce = true;
    SYNC.phase = 'idle';
    SYNC.error = '';
    SYNC.tries = 0;
    SYNC.lastAt = Date.now();
    markSynced(SYNC.lastAt);
    pruneTombstones();
    renderCloud();
    /* 手动/登录触发的同步把结果说清楚：取回多少、合并了多少 */
    if (pulled && (reason === 'manual' || reason === 'auth' || reason === 'boot')) {
      const n = { a: pulled.albums, p: pulled.photos };
      if (pulled.merged) toast(t('cloud.merged', { a: pulled.merged }));
      else toast(t('cloud.pulled', n));
    }
  } catch (e) {
    SYNC.phase = 'error';
    SYNC.error = String(e?.message || e).slice(0, 48);
    SYNC.tries++;
    console.warn('[sync]', reason, e);
    renderCloud();

    /* 令牌级失败（401/凭据错误）：先试一次强制刷新，
       仍拿不到会话就退出登录并提示——这是配置异常的最后一道降级。 */
    const authFlavor = e && (
      e.status === 401 || e.status === 403 ||
      /token|jwt|credential|sign ?in/i.test(String(e?.code || '') + ' ' + String(e?.message || ''))
    );
    if (authFlavor && SYNC.tries === 1) {
      const s = await refreshCloudSession();
      if (!s) {
        await signOutCloud();
        renderCloud();
        toast(t('cloud.sessionLost'));
        SYNC.phase = 'idle';
        SYNC.error = '';
      }
    }

    /* 指数退避：2s / 4s / 8s … 最多 60s，最多 6 次。
       之后交给下一次编辑、上线事件或重新登录触发，不无限重试。 */
    if (SYNC.tries <= APP.limits.syncRetryMax && SYNC.phase === 'error') {
      clearTimeout(retryTimer);
      const wait = Math.min(
        APP.limits.syncRetryMaxMs,
        APP.limits.syncRetryBaseMs * 2 ** (SYNC.tries - 1)
      );
      retryTimer = setTimeout(() => syncNow('retry'), wait);
    }
  } finally {
    running = false;
    if (queued) { queued = false; schedulePush(400); }
  }
}

/* 原图不再批量预取：网格只显示缩略图，大图 / 导出 / 上传时
   各自调用 ensureBlob 单张取。旧实现在打开相册时会排队下载全部原图，
   几十张就把移动端的内存和流量吃光。 */

/* 云同步默认关闭：连 SDK 都不加载——少一个第三方请求，也少一条外部依赖。
   真要开启时（config.features.cloudSync = true）再按需注入，不需要改 HTML。 */
const CLOUD_SDK = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';
function loadCloudSdk() {
  if (window.WorkBuddyCloud) return Promise.resolve(true);
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = CLOUD_SDK;
    s.async = true;
    s.onload = () => res(!!window.WorkBuddyCloud);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}

async function initCloudSync() {
  if (!APP.features.cloudSync) return;
  await loadCloudSdk();
  initCloud().then(ok => {
    if (ok && cloudUser()) bindScopeToUser();
    renderCloud();
    /* 登录态由 SDK 持久化：重启后 getSession 自动恢复，近过期自动刷新。
       这里只做一件事——有会话就立即同步（首次登录=全量拉取合并）。 */
    if (ok && cloudUser()) syncNow('boot');
  }).catch(e => { console.warn('[cloud]', e); renderCloud(); });

  onCloudChange(() => {
    pulledOnce = false;
    if (cloudUser()) bindScopeToUser();
    renderCloud();
    if (cloudUser()) syncNow('auth');
  });

  /* 断网重连、切回标签页：把积压的改动补推一次 */
  addEventListener('online', () => {
    renderCloud();
    if (cloudUser()) syncNow('online');
  });
  addEventListener('offline', () => renderCloud());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !cloudUser() || running) return;
    /* 是否真的要拉，由 syncNow 里的 30s 阈值判断；
       有本地改动时它会先拉后推，不会丢。 */
    syncNow('visible');
  });

  /* ── 验证码登录 / 注册 ── */
  const emailEl = $('#acct-cloud-email');
  const codeEl = $('#acct-cloud-code');
  const sendBtn = $('#acct-cloud-send');
  const goBtn = $('#acct-cloud-go');
  const resendBtn = $('#acct-cloud-resend');
  const codeRow = $('#acct-cloud-code-row');
  const errBox = $('#acct-cloud-err');

  if (emailEl) {
    let cdTimer = 0;
    const setErr = msg => { if (!errBox) return; errBox.hidden = !msg; if (msg) errBox.textContent = msg; };
    const clearCd = () => { clearInterval(cdTimer); cdTimer = 0; };

    const startCountdown = (s = 60) => {
      let left = s;
      clearCd();
      resendBtn.disabled = true;
      const tick = () => {
        resendBtn.textContent = `${t('cloud.resend')} (${left}s)`;
        if (--left <= 0) {
          clearCd();
          resendBtn.disabled = false;
          resendBtn.textContent = t('cloud.resend');
        }
      };
      tick();
      cdTimer = setInterval(tick, 1000);
    };

    const send = async () => {
      setErr('');
      const email = (emailEl.value || '').trim();
      sendBtn.disabled = true;
      try {
        const { isNew } = await sendEmailCode(email);
        codeRow.hidden = false;
        startCountdown();
        toast(t('cloud.codeSent', { email }));
        setTimeout(() => codeEl?.focus(), 80);
      } catch (e) {
        setErr(e?.message === 'bad_email' ? t('cloud.emailBad')
          : (e?.message || t('cloud.failed', { msg: '—' })));
      } finally {
        sendBtn.disabled = false;
      }
    };

    const go = async () => {
      setErr('');
      const email = (emailEl.value || '').trim();
      const code = (codeEl.value || '').trim();
      if (!/^\d{6}$/.test(code)) { setErr(t('cloud.codeBad')); return; }
      goBtn.disabled = true;
      try {
        const { isNew } = await submitEmailOtp(email, code);
        clearCd();
        codeRow.hidden = true;
        codeEl.value = '';
        toast(isNew ? t('cloud.created') : t('cloud.toastLogin'));
        /* session 变化由 onCloudChange 接住 → bindScopeToUser + syncNow('auth') */
      } catch (e) {
        const msg = e?.message === 'need_code' ? t('cloud.needCode')
          : e?.message === 'bad_code' ? t('cloud.codeBad')
          : (e?.message || t('cloud.failed', { msg: '—' }));
        setErr(msg);
      } finally {
        goBtn.disabled = false;
      }
    };

    sendBtn.addEventListener('click', send);
    goBtn.addEventListener('click', go);
    resendBtn.addEventListener('click', send);
    emailEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    emailEl.addEventListener('input', setErr.bind(null, ''));
    codeEl.addEventListener('input', setErr.bind(null, ''));
  }

  /* ── 昵称（账号资料随 settings 单行文档同步） ── */
  $('#acct-cloud-nick-save')?.addEventListener('click', () => {
    const v = ($('#acct-cloud-nick').value || '').trim().slice(0, 24);
    saveSite({ profile: { ...(state.site?.profile || {}), nickname: v } });
    toast(t('cloud.nickSaved'));
    renderCloud();
  });

  $('#acct-cloud-sync')?.addEventListener('click', async () => {
    pulledOnce = false;
    SYNC.tries = 0;
    await syncNow('manual');
  });

  $('#acct-cloud-out')?.addEventListener('click', async () => {
    await signOutCloud();
    renderCloud();
    toast(t('cloud.signedOut'));
  });
}

function initAccounts() {
  const btn = $('#acct-btn');
  const dlg = $('#acct-dlg');
  if (!btn || !dlg) return;

  const me = $('#acct-me');
  const form = $('#acct-form');
  const tabsWrap = $('.acct-tabs', dlg);
  const tabs = $$('.acct-tabs button');
  const errBox = $('#acct-err');
  const submit = $('#acct-submit');
  const passForm = $('#acct-pass-form');
  const recPanel = $('#acct-rec-panel');
  const delPanel = $('#acct-del-panel');

  let mode = 'login';
  let afterCode = 'reload';
  let pendingToast = '';
  let needsReload = false;

  const ERR = {
    name_empty: 'acct.e.nameEmpty',
    name_invalid: 'acct.e.nameInvalid',
    name_taken: 'acct.e.nameTaken',
    name_reserved: 'acct.e.nameReserved',
    pw_empty: 'acct.e.pwEmpty',
    pw_short: 'acct.e.pwShort',
    pw_long: 'acct.e.pwLong',
    pw_weak: 'acct.e.pwWeak',
    pw_common: 'acct.e.pwCommon',
    pw_mismatch: 'acct.e.pwMismatch',
    pw_same: 'acct.e.pwSame',
    bad_credentials: 'acct.e.bad',
    bad_recovery: 'acct.e.badRecovery',
    no_recovery: 'acct.e.noRecovery',
    storage_full: 'acct.e.storage',
    crypto_unavailable: 'acct.e.crypto',
    delete_name: 'acct.e.deleteName'
  };

  const shake = () => {
    dlg.classList.remove('is-shake');
    void dlg.offsetWidth;
    dlg.classList.add('is-shake');
  };

  const clearErr = box => { if (box) { box.hidden = true; box.textContent = ''; } };

  const showErr = (box, code) => {
    if (!box) return;
    const raw = String(code || '');
    const m = /^rate_limited:(\d+)$/.exec(raw);
    const key = m ? 'acct.e.rate' : (ERR[raw] || 'acct.e.generic');
    box.textContent = t(key, m ? { s: m[1] } : undefined);
    box.hidden = false;
    shake();
  };

  const setHead = (kicker, title) => {
    $('#acct-kicker').textContent = kicker;
    $('#acct-title').textContent = title;
  };

  const hidePanels = () => {
    [passForm, recPanel, delPanel].forEach(n => { if (n) n.hidden = true; });
  };

  const paint = () => {
    const u = currentUser();
    const initial = u ? u.name.slice(0, 1).toUpperCase() : '';
    $('#acct-initial').textContent = initial;
    $('#acct-avatar').classList.toggle('is-on', !!u);
    btn.setAttribute('aria-pressed', String(!!u));
    btn.classList.toggle('is-on', !!u);

    hidePanels();
    me.hidden = !u;
    form.hidden = !!u;

    if (u) {
      $('#acct-me-avatar').textContent = initial;
      $('#acct-me-name').textContent = u.name;
      $('#acct-me-meta').textContent = t('acct.signedIn');
      $('#acct-stat-lm').textContent = state.landmarks.length;
      $('#acct-stat-ph').textContent = state.photos.length;
      setHead('SIGNED IN', t('acct.me'));
    } else {
      setHead('ACCOUNT', t('acct.title'));
      clearErr(errBox);
    }
  };

  const setMode = (m) => {
    mode = m;
    const isLogin = m === 'login';
    const isReg = m === 'register';
    const isReset = m === 'reset';

    me.hidden = true;
    form.hidden = false;
    hidePanels();

    tabsWrap.hidden = isReset;
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));

    $('#acct-pass2-wrap').hidden = isLogin;
    $('#acct-code-wrap').hidden = !isReset;
    $('#acct-forgot-wrap').hidden = !isLogin;
    $('#acct-back-wrap').hidden = !isReset;
    $('#acct-strength').hidden = true;

    $('#acct-pass-label').textContent = isReset ? t('acct.newPass') : t('acct.pass');
    $('#acct-pass').value = '';
    $('#acct-pass2').value = '';
    $('#acct-code').value = '';
    $('#acct-pass').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');

    const key = isReg ? 'acct.create' : isReset ? 'acct.reset' : 'acct.login';
    submit.setAttribute('data-i18n', key);
    submit.textContent = t(key);

    setHead(isReset ? 'RESET' : 'ACCOUNT', isReset ? t('acct.reset') : t('acct.title'));
    clearErr(errBox);

    /* 每次切到注册都重新探一次：用户可能刚刚才上传了照片 */
    $('#acct-migrate-wrap').hidden = true;
    if (isReg) {
      probeGuestData(true).then(v => {
        if (mode === 'register') $('#acct-migrate-wrap').hidden = !v;
      }).catch(() => {});
    }
  };

  const open = (m) => {
    paint();
    renderCloud();   /* 打开面板时刷新云账号状态（登录/降级提示） */
    if (!currentUser()) setMode(m || mode);
    if (!dlg.open) dlg.showModal();
    btn.setAttribute('aria-expanded', 'true');
    if (!currentUser()) setTimeout(() => $('#acct-name').focus(), 60);
  };
  const close = () => {
    if (dlg.open) dlg.close();
    btn.setAttribute('aria-expanded', 'false');
  };

  const finish = (msg, reopen) => {
    toast(msg);
    if (reopen) { try { sessionStorage.setItem(ACCT_OPEN, reopen); } catch {} }
    setTimeout(() => location.reload(), 460);
  };

  const bindStrength = (input, out) => {
    input?.addEventListener('input', () => {
      const v = input.value;
      if (!v) { out.hidden = true; return; }
      const lv = passwordStrength(v);
      out.hidden = false;
      out.dataset.level = String(lv);
      out.textContent = t('acct.strength' + lv);
    });
  };
  bindStrength($('#acct-pass'), $('#acct-strength'));
  bindStrength($('#acct-new'), $('#acct-new-strength'));

  const showRecovery = (code, after, msg) => {
    afterCode = after || 'panel';
    pendingToast = msg || '';
    /* 弹窗是模态的；只要用户还没点"我已保存"就关掉，也要落到新账号，
       不能让页面继续以访客状态写入新账号的命名空间 */
    needsReload = afterCode === 'reload';
    me.hidden = true;
    form.hidden = true;
    passForm.hidden = true;
    delPanel.hidden = true;
    recPanel.hidden = false;
    $('#acct-rec-form').hidden = true;
    $('#acct-rec-show').hidden = false;
    $('#acct-code-view').textContent = code;
    setHead('RECOVERY', t('acct.recovery'));
  };

  const openRecovery = () => {
    const u = currentUser();
    if (!u) return;
    me.hidden = true;
    form.hidden = true;
    passForm.hidden = true;
    delPanel.hidden = true;
    recPanel.hidden = false;
    $('#acct-rec-form').hidden = false;
    $('#acct-rec-show').hidden = true;
    $('#acct-rec-pass').value = '';
    clearErr($('#acct-rec-err'));
    $('#acct-rec-sub').textContent = hasRecovery(u.name)
      ? t('acct.recoveryRegen')
      : t('acct.recoverySub');
    setHead('RECOVERY', t('acct.recovery'));
    setTimeout(() => $('#acct-rec-pass').focus(), 60);
  };

  const openPass = () => {
    if (!currentUser()) return;
    me.hidden = true;
    form.hidden = true;
    recPanel.hidden = true;
    delPanel.hidden = true;
    passForm.hidden = false;
    passForm.reset();
    clearErr($('#acct-pass-err'));
    $('#acct-new-strength').hidden = true;
    setHead('SECURITY', t('acct.change'));
    setTimeout(() => $('#acct-old').focus(), 60);
  };

  const openDelete = () => {
    if (!currentUser()) return;
    me.hidden = true;
    form.hidden = true;
    passForm.hidden = true;
    recPanel.hidden = true;
    delPanel.hidden = false;
    delPanel.reset();
    clearErr($('#acct-del-err'));
    setHead('DANGER', t('acct.delete'));
    setTimeout(() => $('#acct-del-name').focus(), 60);
  };

  btn.addEventListener('click', () => (dlg.open ? close() : open()));
  $('#acct-close').addEventListener('click', close);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  /* 编辑期间同步会跳过拉取（避免覆盖手里的表单），关窗后补一次 */
  dlg.addEventListener('close', () => schedulePush(400));
  dlg.addEventListener('close', () => {
    btn.setAttribute('aria-expanded', 'false');
    if (needsReload) { needsReload = false; location.reload(); }
  });

  tabs.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ── 登录 / 注册 / 重设 ── */
  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErr(errBox);
    const name = $('#acct-name').value;
    const pw = $('#acct-pass').value || '';
    submit.disabled = true;

    try {
      if (mode === 'register') {
        if (pw !== ($('#acct-pass2').value || '')) throw new Error('pw_mismatch');
        const u = await acctRegister(name, pw);
        const want = !$('#acct-migrate-wrap').hidden && $('#acct-migrate').checked;
        if (want) {
          migrateGuestData(u.id);
          /* 地标搬完还要搬照片：两套存储，缺一边相册就是空壳 */
          try { await migrateGuestPhotos(u.id); } catch (e) { console.warn('[acct] photo migrate', e); }
        }
        showRecovery(u.recoveryCode, 'reload', t('acct.hello', { name: u.name }));
        return;
      }

      if (mode === 'reset') {
        if (pw !== ($('#acct-pass2').value || '')) throw new Error('pw_mismatch');
        const u = await acctResetPassword(name, $('#acct-code').value, pw);
        showRecovery(u.recoveryCode, 'reload', t('acct.back', { name: u.name }));
        return;
      }

      const u = await acctLogin(name, pw);
      finish(t('acct.back', { name: u.name }));
    } catch (ex) {
      const raw = ex?.message || '';
      showErr(errBox, mode === 'reset' && raw === 'bad_credentials' ? 'bad_recovery' : raw);
      submit.disabled = false;
    }
  });

  $('#acct-forgot').addEventListener('click', () => setMode('reset'));
  $('#acct-back').addEventListener('click', () => setMode('login'));

  /* ── 恢复码 ── */
  $('#acct-rec-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = currentUser();
    if (!u) return;
    const box = $('#acct-rec-err');
    clearErr(box);
    const pass = $('#acct-rec-pass').value || '';
    const b = $('#acct-rec-submit');
    b.disabled = true;
    try {
      const r = await acctSetRecovery(u.name, pass);
      showRecovery(r.code, 'panel');
    } catch (ex) {
      showErr(box, ex?.message || '');
    } finally {
      b.disabled = false;
    }
  });

  $('#acct-rec-back').addEventListener('click', paint);

  $('#acct-code-copy')?.addEventListener('click', async () => {
    const code = $('#acct-code-view').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast(t('acct.copied'));
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('#acct-code-view'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  $('#acct-code-done').addEventListener('click', () => {
    if (afterCode === 'reload') {
      needsReload = false;
      if (pendingToast) toast(pendingToast);
      setTimeout(() => location.reload(), 320);
    } else {
      paint();
    }
  });

  /* ── 恢复码（已登录时生成新码） ── */
  $('#acct-rec-btn').addEventListener('click', openRecovery);

  /* ── 修改密码 ── */
  $('#acct-pass-btn').addEventListener('click', openPass);
  $('#acct-pass-cancel').addEventListener('click', paint);

  passForm.addEventListener('submit', async e => {
    e.preventDefault();
    const u = currentUser();
    if (!u) return;
    const box = $('#acct-pass-err');
    clearErr(box);
    const oldPw = $('#acct-old').value || '';
    const np = $('#acct-new').value || '';
    const np2 = $('#acct-new2').value || '';
    if (!oldPw) { showErr(box, 'pw_empty'); return; }
    if (np !== np2) { showErr(box, 'pw_mismatch'); return; }
    const bad = passwordIssue(np);
    if (bad) { showErr(box, bad); return; }

    const b = passForm.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await acctChangePassword(u.name, oldPw, np);
      toast(t('acct.passChanged'));
      paint();
    } catch (ex) {
      showErr(box, ex?.message || '');
    } finally {
      b.disabled = false;
    }
  });

  /* ── 删除账号 ── */
  $('#acct-del-btn').addEventListener('click', openDelete);
  $('#acct-del-cancel').addEventListener('click', paint);

  delPanel.addEventListener('submit', async e => {
    e.preventDefault();
    const u = currentUser();
    if (!u) return;
    const box = $('#acct-del-err');
    clearErr(box);
    const typed = normName($('#acct-del-name').value);
    if (typed.toLowerCase() !== u.name.toLowerCase()) {
      showErr(box, 'delete_name');
      return;
    }
    const b = delPanel.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      await removeAccount(u.name, $('#acct-del-pass').value || '');
      toast(t('acct.deleteDone'));
      setTimeout(() => location.reload(), 360);
    } catch (ex) {
      showErr(box, ex?.message || '');
      b.disabled = false;
    }
  });

  $('#acct-logout').addEventListener('click', () => {
    acctLogout();
    close();
    toast(t('acct.bye'));
    setTimeout(() => location.reload(), 360);
  });

  $('#acct-switch').addEventListener('click', () => {
    acctLogout();
    try { sessionStorage.setItem(ACCT_OPEN, 'login'); } catch {}
    setTimeout(() => location.reload(), 260);
  });

  paint();

  /* 登录/退出后回到页面：把对话框状态还原 */
  try {
    const want = sessionStorage.getItem(ACCT_OPEN);
    if (want) {
      sessionStorage.removeItem(ACCT_OPEN);
      open(want === 'register' ? 'register' : 'login');
    }
  } catch {}
}

/* ───────── 启动 ───────── */

async function boot() {
  initLang();
  /* 30 天会话：启动时校验并滑动续期；过期则回到访客 */
  touchSession();
  const sessionGuard = () => {
    const exp = sessionExpiresAt();
    if (exp && exp < Date.now()) { location.reload(); return true; }
    return false;
  };
  setInterval(sessionGuard, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !sessionGuard()) touchSession();
  });
  initGate();
  state.site = loadSite();
  applySite(state.site);

  applyTheme(localStorage.getItem(LS_THEME) || APP.defaults.theme);

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
    /* 两个观察器之间有一个顺序竞态：如果「可见」先于「预加载 400px」回调，
       此时 earth 还没建出来，start() 就丢了；而 IntersectionObserver 只在
       状态变化时触发，之后不会自己补一次。表现为地球区块一片黑、画布停在 300×150。
       所以这里不靠回调顺序，只记可见性，谁准备好了谁来启动。 */
    let earthVisible = false;
    const kickStart = () => { if (earth && earthVisible) earth.start(); };

    const loadIO = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || earthStarted) return;
      earthStarted = true;
      initEarth();
      earth?.load(p => { if (progressEl) progressEl.textContent = Math.round(p * 100) + '%'; });
      kickStart();
      loadIO.disconnect();
    }, { rootMargin: '400px 0px', threshold: 0 });
    loadIO.observe(stage);

    const runIO = new IntersectionObserver(entries => {
      earthVisible = entries[0].isIntersecting;
      if (!earthVisible) { earth?.stop(); return; }
      kickStart();
    }, { threshold: 0 });
    runIO.observe(stage);
  } else {
    earthStarted = true;
    initEarth();
    earth?.load(p => { if (progressEl) progressEl.textContent = Math.round(p * 100) + '%'; });
    earth?.start();
  }

  /* 示例数据只给未登录的访客；新账号从空白开始，避免把别人的作品当成自己的 */
  if (!stored && !currentUser() && !localStorage.getItem(acctKey(LS_SEED))) {
    state.landmarks = [
      normalizeLM({ id: 'lm-kyoto', name: '京都', coord: '35.01°N 135.77°E', accent: ACCENTS[0] }),
      normalizeLM({ id: 'lm-reyk', name: '雷克雅未克', coord: '64.15°N 21.94°W', accent: ACCENTS[1] }),
      normalizeLM({ id: 'lm-hk', name: '香港', coord: '22.32°N 114.17°E', accent: ACCENTS[2] })
    ];
    saveLandmarks();
    try { localStorage.setItem(acctKey(LS_SEED), '1'); } catch {}
    renderWall();
    syncEarth();
  }

  /* 数据自检：不阻塞首屏，异常只写控制台 */
  pruneTombstones();
  storeHealth({ albums: state.landmarks, photos: state.photos })
    .then(h => { if (!h.ok || h.issues.length) console.info('[atlas] 数据体检', h); })
    .catch(() => {});
  updateVaultStats();

  /* 多标签页：另一个标签写了数据，这边跟着重读。
     正在编辑地标的弹窗不打断——用户手里的表单优先。 */
  let reloadTimer = 0;
  onExternalChange(msg => {
    if (!msg || !['albums', 'photos', 'meta'].includes(msg.kind)) return;
    if (document.getElementById('dlg')?.open) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      if (msg.kind !== 'photos') {
        const env = loadAlbums();
        if (env.exists) {
          state.landmarks = env.items.map(normalizeLM);
          renderWall();
          syncStats();
          syncEarth();
        }
      }
      if (msg.kind !== 'albums') {
        try { state.photos = await allPhotos(); } catch {}
      }
      if (state.current && albumEl.classList.contains('is-open')) {
        albumList = photosOf(state.current);
        renderAlbumGrid();
        refreshMemoirIfIdle();
      }
      updateVaultStats();
    }, 180);
  });

  /* 验证入口：控制台 atlasData.health() / atlasData.pending() / atlasData.sync() */
  window.atlasData = {
    schema: SCHEMA,
    limits: LIMITS,
    health: () => storeHealth({ albums: state.landmarks, photos: state.photos }),
    pending,
    meta: storeMeta,
    sync: () => syncNow('manual'),
    /* 强制重新走一次"先拉后推"，用于验证跨设备合并 */
    pull: () => { pulledOnce = false; return syncNow('manual'); },
    reload: async () => {
      const env = loadAlbums();
      state.landmarks = env.exists ? env.items.map(normalizeLM) : [];
      state.photos = await allPhotos();
      renderWall(); syncStats(); syncEarth();
      return { albums: state.landmarks.length, photos: state.photos.length };
    },
    /* 整理：删掉坏记录与孤儿照片，清掉失效封面 */
    repair: async () => {
      const ids = new Set(state.landmarks.map(l => l.id));
      const r = await repairPhotos(ids);
      state.photos = await allPhotos();
      let covers = 0;
      const have = new Set(state.photos.map(p => p.id));
      state.landmarks.forEach(l => {
        if (l.coverId && !have.has(l.coverId)) { l.coverId = null; covers++; }
      });
      if (covers) saveLandmarks();
      renderWall(); syncStats(); syncEarth(); updateVaultStats();
      return { ...r, covers };
    }
  };

  /* 先探一下访客库里有没有照片：注册弹窗的"迁移"开关要用 */
  probeGuestData().catch(() => {});
  initAccounts();
  initCloudSync();
  initMusic();
  initMemoir();
}

boot();
