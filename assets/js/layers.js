/* ══════════════════════════════════════════════════════════════════
   layers.js — 图层注册表与状态机（单一事实来源）

   命名契约（与参考站一致）：
     <家族><两位序号>.<小写语义名>    /^[A-Z]\d{2}\.[a-z0-9-]+$/
       L = 渲染层（画在球体/天空上的光与几何）
       F = 要素层（由数据生成的注记与连线）

   序号是稳定地址，不是排序：新增图层占一个新号，不复用旧号。
   两位序号在家族内连续：L01–L08 是"画什么"，F01–F08 是"标注什么"。
   L 与 F 不是等级，而是两种渲染方式（WebGL / 2D / DOM）。

   每条注册项只描述"是什么、依赖谁、开关时做什么"，
   不持有 DOM，也不直接 import 渲染模块——这样注册表可以被文档、
   校验脚本和面板同时消费。apply(on, ctx) 是唯一的副作用入口。
   ══════════════════════════════════════════════════════════════════ */

export const LAYER_ID_RE = /^[A-Z]\d{2}\.[a-z0-9-]+$/;

export const PROVENANCE = {
  obs: { zh: '观测', en: 'OBS', tone: 'obs' },
  der: { zh: '推算', en: 'DER', tone: 'der' },
  per: { zh: '私有', en: 'PER', tone: 'per' }
};

/* 组序 = 阅读顺序：先读"你留下的"，再读"你站的地方"，最后读"背景"。
   序号只用于呈现，不参与 ID；图层 ID 里的两位数才是稳定地址。 */
export const GROUPS = [
  {
    id: 'annotation', no: '01', zh: '注记', en: 'Annotation',
    descZh: '你的地点、旅程与命名', descEn: 'Your places, routes and names'
  },
  {
    id: 'surface', no: '02', zh: '地表', en: 'Surface',
    descZh: '经纬、昼夜、云与大气', descEn: 'Grid, daylight, cloud and air'
  },
  {
    id: 'sky', no: '03', zh: '深空', en: 'Deep sky',
    descZh: '真实星表、银河与偶发流星', descEn: 'Real stars, the Milky Way, meteors'
  },
  {
    id: 'base', no: '04', zh: '基底', en: 'Base',
    descZh: '球体与它的光照，永远在场', descEn: 'The body and its light — always on'
  }
];

const S = (name, url, license) => ({ name, url, license });

export const LAYERS = [
  {
    id: 'L01.base',
    group: 'base',
    title: { zh: '地球本体', en: 'The globe' },
    summary: {
      zh: 'NASA Blue Marble 昼面、Black Marble 夜面与地形法线；球体本身不可关闭。',
      en: 'Blue Marble daylight, Black Marble night lights and terrain normals. The body itself cannot be hidden.'
    },
    provenance: 'obs',
    sources: [S('NASA Visible Earth · Blue Marble', 'https://visibleearth.nasa.gov/collection/1484/blue-marble', '公有领域'),
              S('NASA Black Marble（VIIRS DNB）', 'https://earthobservatory.nasa.gov/features/NightLights', '公有领域')],
    defaultOn: true, locked: true,
    cost: { vramMB: 24, ms: 2.4 },
    params: { zh: ['1K / 2K / 4K 三档', '夜面随晨昏线亮起', '画质随帧率自适应'], en: ['1K / 2K / 4K tiers', 'Night lights follow the terminator', 'Resolution adapts to frame rate'] },
    legend: null,
    apply() {}
  },

  {
    id: 'L02.graticule',
    group: 'surface',
    title: { zh: '经纬网', en: 'Graticule' },
    summary: {
      zh: '15° 网格、赤道与本初子午线加重，回归线与极圈用虚线另注。',
      en: 'A 15° grid with a heavier equator and prime meridian; tropics and polar circles dashed as annotations.'
    },
    provenance: 'der',
    sources: [S('WGS 84 · EPSG:4326', 'https://epsg.io/4326', '公开标准')],
    defaultOn: true,
    cost: { vramMB: 0, ms: 0.7 },
    params: { zh: ['步长 15°', '采样 2.5°', '赤道 1.35px'], en: ['15° spacing', '2.5° sampling', 'Equator at 1.35px'] },
    legend: { zh: '15° 经纬网', en: '15° graticule' },
    apply(on, ctx) { ctx.overlay.setLayer('graticule', on); }
  },

  {
    id: 'L03.terminator',
    group: 'surface',
    title: { zh: '晨昏线与暮光', en: 'Terminator & twilight' },
    summary: {
      zh: '按太阳直射点实时解算：晨昏线一道，民用 / 航海 / 天文三档暮光，另标正午点。',
      en: 'Solved from the subsolar point: the terminator plus civil, nautical and astronomical twilight, and the noon marker.'
    },
    provenance: 'der',
    sources: [S('NOAA Solar Calculator', 'https://gml.noaa.gov/grad/solcalc/', '公开算法'),
              S('太阳赤纬近似（±0.5°）', 'https://gml.noaa.gov/grad/solcalc/solareqns.PDF', '公开文献')],
    defaultOn: false,
    cost: { vramMB: 0, ms: 0.5 },
    params: { zh: ['等值线 −6° / −12° / −18°', '每帧重算', '正午点光晕'], en: ['Isolines at −6° / −12° / −18°', 'Recomputed per frame', 'Noon marker'] },
    legend: { zh: '晨昏线', en: 'Terminator' },
    apply(on, ctx) { ctx.overlay.setLayer('terminator', on); }
  },

  {
    id: 'L04.atmosphere',
    group: 'surface',
    title: { zh: '大气辉光', en: 'Atmospheric limb' },
    summary: {
      zh: '球缘的瑞利散射近似：受光侧偏蓝，夜侧收暗；强度跟随主题，不随图层重置。',
      en: 'A Rayleigh-style limb: blue on the lit side, falling away at night. Strength follows the theme.'
    },
    provenance: 'der',
    sources: [S('Rayleigh 散射近似（单次散射）', 'https://en.wikipedia.org/wiki/Rayleigh_scattering', '公式引用')],
    defaultOn: true,
    cost: { vramMB: 0, ms: 0.3 },
    params: { zh: ['单次散射近似', '强度 0.46–0.85', '与云层独立'], en: ['Single-scatter approximation', 'Intensity 0.46–0.85', 'Independent of clouds'] },
    legend: null,
    apply(on, ctx) { ctx.earth.setFlags({ atmo: on }); }
  },

  {
    id: 'L05.clouds',
    group: 'surface',
    title: { zh: '云层', en: 'Cloud deck' },
    summary: {
      zh: '4K 云图，比地表慢 3.5% 自转，制造一点体积感；关掉后地表与夜灯更清楚。',
      en: 'A 4K cloud deck rotating 3.5% slower than the surface. Turning it off reveals the ground and city lights.'
    },
    provenance: 'obs',
    sources: [S('NASA Blue Marble · clouds', 'https://visibleearth.nasa.gov/collection/1484/blue-marble', '公有领域')],
    defaultOn: true,
    cost: { vramMB: 6, ms: 0.4 },
    params: { zh: ['4K 云图', '滞后自转 3.5%', '不透明度 0.74–0.90'], en: ['4K cloud map', '3.5% lag in rotation', 'Opacity 0.74–0.90'] },
    legend: null,
    apply(on, ctx) { ctx.earth.setFlags({ clouds: on }); }
  },

  {
    id: 'L06.stars',
    group: 'sky',
    title: { zh: '星表', en: 'Star catalogue' },
    summary: {
      zh: '5044 颗真实亮星（至 6 等，含 B−V 色指数）打底，程序暗星按银道聚集补密；夜空有真实的亮度与色温层次。',
      en: '5,044 real bright stars to magnitude 6, with B−V colour, plus galactic-band dim stars — real brightness and colour depth.'
    },
    provenance: 'obs',
    sources: [S('NASA/GSFC SVS 4851 Deep Star Maps 2020 · Gaia DR2', 'https://svs.gsfc.nasa.gov/4851/', '公有领域 / CC BY-SA 3.0 IGO'),
              S('暗星为程序补充 · 见 SKY_SPEC.md', 'https://github.com/2339459732-lgtm/atlas/blob/main/SKY_SPEC.md', '本仓库')],
    defaultOn: true,
    cost: { vramMB: 11, ms: 0.9 },
    params: { zh: ['Gaia DR2 银道坐标', 'B−V 直接换算色温', '暗星 6.5–9 等补密', '宣纸主题为 0'], en: ['Gaia DR2 galactic coords', 'Colour from B−V', 'Dim stars 6.5–9 mag', 'Zero on paper theme'] },
    legend: { zh: '星表 · Gaia', en: 'Stars · Gaia' },
    apply(on, ctx) { ctx.earth.setFlags({ stars: on }); }
  },


  {
    id: 'L07.milkyway',
    group: 'sky',
    title: { zh: '银河全景', en: 'Milky Way panorama' },
    summary: {
      zh: '等距圆柱银河全景，按视线方向采样；银道、尘埃带与核球来自真实巡天，不靠函数画带。',
      en: 'An equirectangular panorama sampled by view direction. The band, dust lanes and bulge are photographic.'
    },
    provenance: 'obs',
    sources: [S('ESO · S. Brunier, Milky Way panorama', 'https://www.eso.org/public/images/eso0932a/', 'CC BY 4.0'),
              S('降采样与模糊流程见 SKY_SPEC.md', 'https://github.com/2339459732-lgtm/atlas/blob/main/SKY_SPEC.md', '本仓库')],
    defaultOn: true,
    cost: { vramMB: 6, ms: 0.2 },
    params: { zh: ['8192×4096 母版', '倾角 0.33 rad', '模糊 1.5–5 px'], en: ['8192×4096 master', 'Tilt 0.33 rad', 'Blur 1.5–5 px'] },
    legend: null,
    apply(on, ctx) { ctx.earth.setFlags({ sky: on }); }
  },

  {
    id: 'L08.meteor',
    group: 'sky',
    title: { zh: '偶发流星', en: 'Occasional meteors' },
    summary: {
      zh: '同屏最多两颗，间隔 8–22 秒随机；是一次事件，不是常驻装饰。',
      en: 'At most two on screen, 8–22 seconds apart. An event, not decoration.'
    },
    provenance: 'der',
    sources: [S('程序化轨迹 · METEOR_SPEC', '', '本机生成')],
    defaultOn: true,
    cost: { vramMB: 0, ms: 0.1 },
    params: { zh: ['同屏上限 2', '间隔 8–22 s', '寿命 1.6 s'], en: ['Max 2 on screen', '8–22 s interval', '1.6 s lifetime'] },
    legend: null,
    apply(on, ctx) { ctx.earth.setFlags({ meteors: on }); }
  },

  {
    id: 'F01.landmarks',
    group: 'annotation',
    title: { zh: '地标', en: 'Places' },
    summary: {
      zh: '你落下的每一个点。可点、可悬停，与右侧目录联动；关闭后球面只剩地理。',
      en: 'Every point you dropped. Clickable, hover-linked to the index. Turn it off and only geography remains.'
    },
    provenance: 'per',
    sources: [S('ATLAS 本机数据 · 地标表', '', '私有')],
    defaultOn: true,
    cost: { vramMB: 0, ms: 0.2 },
    params: { zh: ['本机 IndexedDB', '点击球面落点', '与目录双向高亮'], en: ['Local IndexedDB', 'Click the globe to drop', 'Two-way highlight with the index'] },
    legend: { zh: '地标', en: 'Places' },
    apply(on, ctx) { ctx.markers.setEnabled(on); }
  },

  {
    id: 'F02.thread',
    group: 'annotation',
    title: { zh: '旅程线', en: 'Journey thread' },
    summary: {
      zh: '按创建时间把地标连成大圆弧，虚线不抢视线；图例给出总里程。',
      en: 'Great-circle arcs between places in the order you made them, with total distance in the legend.'
    },
    provenance: 'der',
    requires: ['F01.landmarks'],
    sources: [S('大圆插值 · 球面三角', 'https://en.wikipedia.org/wiki/Great-circle_distance', '公式引用')],
    defaultOn: false,
    cost: { vramMB: 0, ms: 0.4 },
    params: { zh: ['2° 步长', '按创建时间排序', '总里程按 6371 km 半径'], en: ['2° steps', 'Ordered by creation', 'R = 6371 km'] },
    legend: { zh: '旅程线', en: 'Journey thread' },
    apply(on, ctx) { ctx.overlay.setLayer('thread', on); }
  },

  {
    id: 'F08.nomenclature',
    group: 'annotation',
    title: { zh: '地名志', en: 'Nomenclature' },
    summary: {
      zh: '给每个地点一个稳定编号（区域·序号），圈径按片量，推近时更小的地点逐个出现。',
      en: 'A stable code per place (region·index). Ring size follows photo count; closer views reveal smaller places.'
    },
    provenance: 'per',
    requires: ['F01.landmarks'],
    sources: [S('区域划分参考 Natural Earth 110m', 'https://www.naturalearthdata.com/', '公有领域'),
              S('编号规则见 LAYER_SYSTEM.md', 'https://github.com/2339459732-lgtm/atlas/blob/main/LAYER_SYSTEM.md', '本仓库')],
    defaultOn: false,
    cost: { vramMB: 0, ms: 0.3 },
    params: { zh: ['三档：5 / 11 / 全部', '圈径 7–17 px', '标签避让'], en: ['3 tiers: 5 / 11 / all', 'Ring 7–17 px', 'Label decluttering'] },
    legend: { zh: '地名志', en: 'Nomenclature' },
    apply(on, ctx) { ctx.nomenclature.setEnabled(on); }
  }
];

export const PRESETS = [
  { id: 'default', zh: '默认', en: 'Default', ids: LAYERS.filter(l => l.defaultOn).map(l => l.id) },
  { id: 'survey', zh: '测绘', en: 'Survey', ids: ['L01.base', 'L02.graticule', 'L03.terminator', 'L04.atmosphere', 'L05.clouds', 'F01.landmarks', 'F08.nomenclature'] },
  { id: 'clean', zh: '纯净', en: 'Clean', ids: ['L01.base', 'L04.atmosphere', 'F01.landmarks'] }
];

export const byId = id => LAYERS.find(l => l.id === id) || null;

/* ── 参数与存储 ── */
const LS_KEY = 'atlas.layers.v1';

export function parseLayerParam(raw) {
  if (raw == null) return null;
  const ids = String(raw).split(',').map(s => s.trim()).filter(s => LAYER_ID_RE.test(s));
  /* 空参数视为"没指定"，回到默认；要只留基底请显式写 L01.base */
  return ids.length ? [...new Set(ids)] : null;
}

function readStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.on)) return null;
    return data.on.filter(id => LAYER_ID_RE.test(id) && byId(id));
  } catch { return null; }
}

function writeStore(ids) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, on: ids })); } catch {}
}

export function createLayerStore({ ctx, onChange, onNotice }) {
  const enabled = new Set();
  let ready = false;

  function emit(reason = 'toggle') {
    const ids = LAYERS.filter(l => enabled.has(l.id)).map(l => l.id);
    if (ready) writeStore(ids);
    onChange?.({ ids, reason, store: api });
    /* 初次载入不回写 URL：分享链接原样保留，用户一动手才归一化 */
    if (ready && reason !== 'init') syncUrl(ids);
  }

  function syncUrl(ids) {
    try {
      const url = new URL(location.href);
      const isDefault = PRESETS[0].ids.length === ids.length && PRESETS[0].ids.every(id => ids.includes(id));
      if (isDefault) url.searchParams.delete('layers');
      else url.searchParams.set('layers', ids.join(','));
      if (url.href !== location.href) history.replaceState(null, '', url.href);
    } catch {}
  }

  function notice(zh, en) { onNotice?.({ zh, en }); }

  function applyOne(id, isOn) {
    const spec = byId(id);
    if (!spec) return;
    try { spec.apply(isOn, ctx); }
    catch (err) { console.warn('[layers] apply failed', id, err); }
  }

  function enable(id, { quiet = false } = {}) {
    const spec = byId(id);
    if (!spec) return { ok: false, reason: 'unknown' };
    if (enabled.has(id)) return { ok: true };
    const auto = [];
    for (const dep of spec.requires || []) {
      if (!enabled.has(dep)) { enable(dep, { quiet: true }); auto.push(byId(dep)); }
    }
    enabled.add(id);
    applyOne(id, true);
    if (!quiet && auto.length) {
      const names = auto.map(d => d.title.zh).join('」与「');
      notice(`已一并打开「${names}」`, `Also enabled “${auto.map(d => d.title.en).join('” and “')}”`);
    }
    return { ok: true };
  }

  function disable(id, { quiet = false } = {}) {
    const spec = byId(id);
    if (!spec) return { ok: false, reason: 'unknown' };
    if (spec.locked) {
      notice(`${spec.title.zh}是基底，不能关闭`, `${spec.title.en} is the base layer and stays on`);
      return { ok: false, reason: 'locked' };
    }
    if (!enabled.has(id)) return { ok: true };
    /* 反向依赖：谁还指着它，就一起关掉，避免留下悬空图层 */
    const dependents = LAYERS.filter(l => enabled.has(l.id) && (l.requires || []).includes(id));
    enabled.delete(id);
    applyOne(id, false);
    for (const d of dependents) {
      enabled.delete(d.id);
      applyOne(d.id, false);
    }
    if (!quiet && dependents.length) {
      notice(`依赖它的「${dependents.map(d => d.title.zh).join('」「')}」也已关闭`,
             `Also disabled ${dependents.map(d => `“${d.title.en}”`).join(', ')}`);
    }
    return { ok: true, cascaded: dependents.map(d => d.id) };
  }

  function toggle(id) {
    const ok = enabled.has(id) ? disable(id) : enable(id);
    if (ok.ok) emit();
    return ok;
  }

  function setPreset(ids = []) {
    for (const spec of LAYERS) {
      const want = ids.includes(spec.id) || spec.locked;
      if (want && !enabled.has(spec.id)) { enabled.add(spec.id); applyOne(spec.id, true); }
      if (!want && enabled.has(spec.id)) { enabled.delete(spec.id); applyOne(spec.id, false); }
    }
    emit('preset');
  }

  function applyAll() {
    for (const spec of LAYERS) applyOne(spec.id, enabled.has(spec.id));
  }

  function init() {
    const fromUrl = parseLayerParam(new URLSearchParams(location.search).get('layers'));
    const stored = readStore();
    const seed = fromUrl || stored || PRESETS[0].ids;
    /* 基底永远先开 */
    for (const spec of LAYERS) if (spec.locked) enabled.add(spec.id);
    for (const id of seed) {
      const spec = byId(id);
      if (!spec) continue;
      for (const dep of spec.requires || []) enabled.add(dep);
      enabled.add(id);
    }
    ready = true;
    applyAll();
    emit('init');
  }

  const api = {
    init,
    applyAll,
    enable: id => { const r = enable(id); if (r.ok) emit(); return r; },
    disable: id => { const r = disable(id); if (r.ok) emit(); return r; },
    toggle,
    setPreset,
    reset: () => setPreset(PRESETS[0].ids),
    has: id => enabled.has(id),
    ids: () => LAYERS.filter(l => enabled.has(l.id)).map(l => l.id),
    count: () => enabled.size,
    isDefault: () => {
      const ids = api.ids();
      return PRESETS[0].ids.length === ids.length && PRESETS[0].ids.every(id => ids.includes(id));
    },
    shareUrl: () => {
      const url = new URL(location.href);
      const ids = api.ids();
      if (api.isDefault()) url.searchParams.delete('layers');
      else url.searchParams.set('layers', ids.join(','));
      return url.href;
    },
    legend: () => {
      const order = new Map(GROUPS.map((g, i) => [g.id, i]));
      return LAYERS
        .filter(l => enabled.has(l.id) && l.legend)
        .sort((a, b) => order.get(a.group) - order.get(b.group))
        .map(l => ({ id: l.id, label: l.legend }));
    },
    notice,
    _spec: byId
  };

  return api;
}
