/* ══════════════════════════════════════════════════════════════════
   nomenclature.js — 地名志（对应参考站的 F08.nomenclature）

   参考站把 IAU 的 1100 个地形名钉在旋转的球面上：圈是地形范围，
   推近后更小的地形逐个出现，点开看介绍。ATLAS 没有环形山，但有
   "去过的地方"——同样是钉在球面上、有编号、有层级、可点开的注记。

   这一层做三件事：
     1. 给每个地标一个稳定编号：<区域>·<序号>，如 EAS·03
     2. 圈径按片量加权；缩放越近，露出越多（三档）
     3. 屏幕空间避让：重叠时先保高权重的标签，其余只留圈

   编号只由经纬度与创建顺序决定，不随语言、主题、窗口变化。
   ══════════════════════════════════════════════════════════════════ */

const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* 区域判定：先特殊（极地），再按经纬度盒；都不中归公海 */
const REGIONS = [
  { key: 'ARC', zh: '北极圈', en: 'Arctic', test: (lat) => lat >= 66.56 },
  { key: 'ANT', zh: '南极', en: 'Antarctic', test: (lat) => lat <= -60 },
  { key: 'EUR', zh: '欧洲', en: 'Europe', test: (lat, lng) => lng >= -25 && lng < 40 && lat >= 35 && lat < 72 },
  { key: 'AFR', zh: '非洲', en: 'Africa', test: (lat, lng) => lng >= -20 && lng < 52 && lat >= -35 && lat < 35 },
  { key: 'WAS', zh: '西亚', en: 'West Asia', test: (lat, lng) => lng >= 40 && lng < 60 && lat >= 12 && lat < 40 },
  { key: 'SAS', zh: '南亚', en: 'South Asia', test: (lat, lng) => lng >= 60 && lng < 100 && lat >= 5 && lat < 35 },
  { key: 'EAS', zh: '东亚', en: 'East Asia', test: (lat, lng) => lng >= 100 && lng < 150 && lat >= 20 && lat < 55 },
  { key: 'SEA', zh: '东南亚', en: 'Southeast Asia', test: (lat, lng) => lng >= 95 && lng < 141 && lat >= -12 && lat < 20 },
  { key: 'OCE', zh: '大洋洲', en: 'Oceania', test: (lat, lng) => lng >= 110 && lng <= 180 && lat >= -50 && lat < -10 },
  { key: 'NAM', zh: '北美', en: 'North America', test: (lat, lng) => lng >= -170 && lng < -50 && lat >= 15 && lat < 75 },
  { key: 'CAM', zh: '中美', en: 'Central America', test: (lat, lng) => lng >= -120 && lng < -60 && lat >= 5 && lat < 30 },
  { key: 'SAM', zh: '南美', en: 'South America', test: (lat, lng) => lng >= -85 && lng < -30 && lat >= -56 && lat < 12 },
  { key: 'OCN', zh: '公海', en: 'Open ocean', test: () => true }
];

export function regionOf(lat, lng) {
  for (const r of REGIONS) {
    if (r.test(lat, lng)) return r;
  }
  return REGIONS[REGIONS.length - 1];
}

/* 三档：远看只留最重要的几个，推近逐个露出。
   阈值对应 earth.js 的 distTo（0.5 最近 / 1 默认 / 1.9 最远）。 */
const TIERS = [
  { max: 1.30, count: 5 },
  { max: 0.86, count: 11 },
  { max: 0, count: Infinity }
];

export function createNomenclature({ layer, stage, getLang, getName, onOpen, onHover }) {
  let items = [];
  let zoom = 1;
  let enabled = false;
  let activeId = null;
  let card = null;
  let reserve = 0;

  function tierCount() {
    for (const t of TIERS) if (zoom > t.max) return t.count;
    return Infinity;
  }

  /* 建立编号：同区域按创建时间排序，序号从 01 起 */
  function assignCodes(list) {
    const buckets = new Map();
    const sorted = [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return sorted.map(l => {
      const r = regionOf(l.lat, l.lng);
      const n = (buckets.get(r.key) || 0) + 1;
      buckets.set(r.key, n);
      return {
        id: l.id,
        lat: l.lat,
        lng: l.lng,
        name: l.name,
        nameEn: l.nameEn,
        coord: l.coord,
        accent: l.accent,
        created: l.createdAt || 0,
        code: `${r.key}·${pad2(n)}`,
        full: `F08.${r.key}.${pad2(n)}`,
        region: r,
        photos: 0,
        year: null,
        weight: 1
      };
    });
  }

  function measure(buf) {
    if (buf) buf._w = buf.querySelector('.nm__text')?.offsetWidth || 96;
  }

  function build(list, photosOf) {
    if (!layer) return;
    items = assignCodes(list.filter(l => l.lat != null && l.lng != null));
    for (const it of items) {
      const ph = photosOf ? photosOf(it.id) : [];
      it.photos = ph.length;
      it.year = ph.reduce((y, p) => {
        const d = String(p.date || p.takenAt || '').slice(0, 4);
        const n = Number(d);
        return Number.isFinite(n) && n > 1900 ? Math.max(y || 0, n) : y;
      }, 0) || null;
      it.weight = it.photos * 1000 + it.created / 1e9;
    }
    layer.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nm';
      b.dataset.id = it.id;
      b.dataset.code = it.code;
      b.style.setProperty('--ac', it.accent || 'var(--accent)');
      b.setAttribute('aria-label', `${it.name} · ${it.code}`);
      b.innerHTML =
        `<span class="nm__ring"></span>` +
        `<span class="nm__dot"></span>` +
        `<span class="nm__lead"></span>` +
        `<span class="nm__text"><b>${escapeHtml(nameOf(it))}</b><em>${it.code}</em></span>`;
      /* 指针停在名字上就停自转：旋转中的球面上点一个 12px 的标签太难了 */
      b.addEventListener('pointerenter', () => onHover?.());
      b.addEventListener('click', e => {
        e.stopPropagation();
        openCard(it, b);
      });
      layer.appendChild(b);
      it.el = b;
      it._visible = false;
      it._depth = 0;
    }
    /* 宽度在下一帧才可靠（字体可能还没换完） */
    requestAnimationFrame(() => items.forEach(it => measure(it.el)));
    if (activeId) closeCard();
  }

  function nameOf(it) {
    /* 名字由 main 统一给（它知道中英城市对照表），地名志不另建一套译名 */
    if (getName) return getName(it);
    if (getLang() === 'en') return it.nameEn || it.name;
    return it.name;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openCard(it, el) {
    closeCard();
    activeId = it.id;
    card = document.createElement('div');
    card.className = 'nmcard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${nameOf(it)} ${it.code}`);
    const zh = getLang() === 'zh';
    const coord = it.coord || `${Math.abs(it.lat).toFixed(2)}°${it.lat >= 0 ? 'N' : 'S'} ${Math.abs(it.lng).toFixed(2)}°${it.lng >= 0 ? 'E' : 'W'}`;
    card.innerHTML =
      `<p class="nmcard__code">${it.full}<span>${zh ? it.region.zh : it.region.en}</span></p>` +
      `<h4 class="nmcard__name">${escapeHtml(nameOf(it))}</h4>` +
      `<dl class="nmcard__meta">` +
        `<div><dt>${zh ? '坐标' : 'Coord'}</dt><dd>${escapeHtml(coord)}</dd></div>` +
        `<div><dt>${zh ? '照片' : 'Photos'}</dt><dd>${it.photos}</dd></div>` +
        (it.year ? `<div><dt>${zh ? '最近' : 'Latest'}</dt><dd>${it.year}</dd></div>` : '') +
      `</dl>` +
      `<div class="nmcard__acts">` +
        `<button type="button" class="nmcard__open">${zh ? '进入相册' : 'Open album'}</button>` +
        `<button type="button" class="nmcard__x" aria-label="${zh ? '关闭' : 'Close'}">×</button>` +
      `</div>`;
    stage.appendChild(card);
    card.style.setProperty('--nm-ac', it.accent || 'var(--accent)');
    /* 卡片贴在标签外侧：左翻的标签把卡片放到更左，不盖住圆环与名字；
       横向放不下时翻到标签上方/下方。 */
    const sr = stage.getBoundingClientRect();
    const rr = el.getBoundingClientRect();
    const px = rr.left - sr.left;
    const py = rr.top - sr.top;
    const cw = card.offsetWidth || 226;
    const ch = card.offsetHeight || 140;
    /* 以圆环为锚点上下展开，而不是接着标签继续向左排：
       卡片盖住名字时把名字暂时隐去，避免同一处出现两遍。 */
    let x = clamp(px - cw / 2, 10, sr.width - cw - 10);
    let y = py - ch - 20;
    if (y < 8) y = py + 24;
    card.style.left = `${x}px`;
    card.style.top = `${clamp(y, 8, sr.height - ch - 8)}px`;
    el.classList.add('is-active');
    card.querySelector('.nmcard__open')?.addEventListener('click', e => {
      e.stopPropagation();
      closeCard();
      onOpen?.(it.id);
    });
    card.querySelector('.nmcard__x')?.addEventListener('click', e => {
      e.stopPropagation();
      closeCard();
    });
  }

  function closeCard() {
    card?.remove();
    card = null;
    layer?.querySelectorAll('.nm.is-active').forEach(n => n.classList.remove('is-active'));
    activeId = null;
  }

  document.addEventListener('pointerdown', e => {
    if (!card) return;
    if (card.contains(e.target) || e.target.closest?.('.nm')) return;
    closeCard();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCard();
  });

  /* 每帧：投影、分档、避让 */
  const boxes = [];
  function update(project) {
    if (!enabled || !items.length) return;
    boxes.length = 0;
    const limit = tierCount();
    const order = [...items].sort((a, b) => b.weight - a.weight);

    for (const m of items) {
      m._visible = false;
      m._depth = 0;
    }

    let shown = 0;
    for (const m of order) {
      if (shown >= limit) break;
      const p = project(m.lat, m.lng);
      if (!p || !p.visible) continue;
      /* 贴边的地方不画：标签会被球区裁掉半行，不如不出现 */
      const pad = 26;
      if (p.x < pad || p.y < pad
        || p.x > stage.clientWidth - reserve - pad
        || p.y > stage.clientHeight - pad) continue;
      shown++;
      const depth = clamp((p.depth - 0.02) / 1.1, 0, 1);
      m._x = p.x; m._y = p.y; m._depth = depth; m._visible = true;

      const r = clamp(7 + Math.sqrt(Math.max(1, m.photos)) * 2.6, 7, 17);
      m.el.style.setProperty('--r', r.toFixed(1));
      m.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      m.el.style.opacity = String(0.42 + depth * 0.58);
      m.el.style.zIndex = String(20 + Math.round(depth * 20));
      m.el.classList.toggle('is-left', p.x > (stage.clientWidth - reserve) * 0.56);
      m.el.classList.add('is-on');
      m.el.style.pointerEvents = 'auto';
    }

    /* 标签避让：高权重先占位，撞上的只留圈 */
    for (const m of order) {
      if (!m._visible) { m.el.classList.remove('is-on'); m.el.style.pointerEvents = 'none'; continue; }
      const w = m.el._w || 96;
      const h = 20;
      const left = m.el.classList.contains('is-left') ? m._x - 18 - w : m._x + 18;
      const box = { l: left, r: left + w, t: m._y - h / 2, b: m._y + h / 2 };
      const clash = boxes.some(o => !(box.r < o.l || box.l > o.r || box.b < o.t || box.t > o.b));
      m.el.style.setProperty('--show', clash ? '0' : '1');
      if (!clash) boxes.push(box);
    }
  }

  return {
    build,
    update,
    measureAll: () => items.forEach(it => measure(it.el)),
    setEnabled(v) {
      enabled = !!v;
      layer?.classList.toggle('is-on', enabled);
      stage?.classList.toggle('has-nm', enabled);
      if (!enabled) {
        closeCard();
        items.forEach(it => { it.el.style.opacity = '0'; it.el.style.pointerEvents = 'none'; });
      } else {
        layer?.classList.remove('is-on');
        requestAnimationFrame(() => layer?.classList.add('is-on'));
      }
    },
    setZoom(z) { zoom = z; },
    /* 右侧停靠宽度：标签靠右时翻到左边，避免钻进面板 */
    setReserve(px) { reserve = px || 0; },
    closeCard,
    isEnabled: () => enabled,
    count: () => items.length,
    /* 验收用 */
    _items: () => items.map(i => ({ id: i.id, code: i.code, photos: i.photos, visible: i._visible })),
    _tier: tierCount
  };
}
