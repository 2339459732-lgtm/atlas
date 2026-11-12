/* ══════════════════════════════════════════════════════════════════
   earth-overlay.js — 球面上的二维测绘层

   为什么不用 WebGL 画：
     经纬网、晨昏线、旅程线都是"线"，用 2D canvas 描边比再写三套
     着色器便宜得多，也能直接拿到 CSS 像素坐标与地球的投影对齐。
     地球每帧通过 onProject 把 project() 交出来，这里在同一帧里描线，
     不会出现"球转了、线慢半拍"的错位。

   约定：
     · project(lat, lng) → { x, y, visible, depth }，x/y 是 CSS 像素
     · 所有线都按可见半球裁切：不可见的点断开路径，不在球背面连弦
     · 只画被图层打开的层；全关时整块画布清空，开销为零
   ══════════════════════════════════════════════════════════════════ */

const DEG = Math.PI / 180;
const R_EARTH = 6371;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ── 静态几何：只算一次 ── */
function meridian(lng, step = 2.5) {
  const out = [];
  for (let lat = -90; lat <= 90.0001; lat += step) out.push([lat, lng]);
  return out;
}
function parallel(lat, step = 2.5) {
  const out = [];
  for (let lng = -180; lng <= 180.0001; lng += step) out.push([lat, lng]);
  return out;
}

const GRID = {
  meridians: [],
  parallels: [],
  special: []
};
for (let lng = -180; lng < 180; lng += 15) GRID.meridians.push(meridian(lng));
for (let lat = -75; lat <= 75; lat += 15) {
  if (lat !== 0) GRID.parallels.push(parallel(lat));
}
GRID.parallels.push(parallel(0));
/* 五条有名字的纬线：南北回归线、南北极圈 */
for (const lat of [23.44, -23.44, 66.56, -66.56]) GRID.special.push(parallel(lat, 2));

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vecToGeo(v) {
  const p = norm(v);
  return [Math.asin(clamp(p[1], -1, 1)) / DEG, Math.atan2(p[2], -p[0]) / DEG];
}

/* 两个单位向量之间的大圆插值 */
function slerp(a, b, t) {
  const d = clamp(dot(a, b), -1, 1);
  const o = Math.acos(d);
  if (o < 1e-5) return norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  const s = Math.sin(o);
  const k1 = Math.sin((1 - t) * o) / s;
  const k2 = Math.sin(t * o) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}
function toVec(lat, lng) {
  const la = lat * DEG, lo = lng * DEG, c = Math.cos(la);
  return [-c * Math.cos(lo), Math.sin(la), c * Math.sin(lo)];
}

export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const on = new Set();
  let project = null;
  let spin = 0;
  let sun = null;
  let places = [];
  let thread = { legs: [], km: 0 };

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);

  function pal() {
    const light = document.documentElement.dataset.theme === 'ivory';
    return light ? {
      grid: 'rgba(20,19,15,.13)',
      gridStrong: 'rgba(20,19,15,.32)',
      special: 'rgba(20,19,15,.17)',
      term: 'rgba(58,92,132,.62)',
      twi: 'rgba(58,92,132,.26)',
      twi2: 'rgba(58,92,132,.13)',
      thread: 'rgba(120,90,40,.50)',
      sun: 'rgba(146,104,38,.95)',
      sunHalo: 'rgba(146,104,38,.22)'
    } : {
      grid: 'rgba(201,169,106,.14)',
      gridStrong: 'rgba(201,169,106,.34)',
      special: 'rgba(201,169,106,.20)',
      term: 'rgba(143,185,220,.62)',
      twi: 'rgba(143,185,220,.26)',
      twi2: 'rgba(143,185,220,.12)',
      thread: 'rgba(201,169,106,.46)',
      sun: 'rgba(255,238,200,.95)',
      sunHalo: 'rgba(255,224,168,.22)'
    };
  }

  /* 一条线：按可见性断开 */
  function strokeGeo(pts, color, width = 1, dash = null) {
    if (!project) return;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length; i++) {
      const q = project(pts[i][0], pts[i][1]);
      if (!q || !q.visible) { pen = false; continue; }
      if (pen) ctx.lineTo(q.x, q.y);
      else { ctx.moveTo(q.x, q.y); pen = true; }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawGraticule(p) {
    ctx.lineCap = 'round';
    for (const line of GRID.meridians) strokeGeo(line, p.grid, 1);
    for (const line of GRID.parallels) strokeGeo(line, p.grid, 1);
    /* 回归线与极圈：虚线，读作"注记"而不是"网格" */
    for (const line of GRID.special) strokeGeo(line, p.special, 1, [3, 6]);
    /* 赤道：本初子午线，稍亮 */
    strokeGeo(parallel(0, 2), p.gridStrong, 1.35);
    strokeGeo(meridian(0), p.gridStrong, 1.35);
  }

  /* 世界坐标的太阳 → 模型坐标（地球自转后仍然钉在同一个地理点） */
  function sunModel() {
    if (!sun) return null;
    const c = Math.cos(spin), s = Math.sin(spin);
    return norm([c * sun[0] - s * sun[2], sun[1], s * sun[0] + c * sun[2]]);
  }

  function drawTerminator(p) {
    const s = sunModel();
    if (!s) return;
    const ref = Math.abs(s[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(s, ref));
    const v = norm(cross(s, u));

    /* 太阳高度角 e 的等值线：sin(e)·s + cos(e)·(cosθ·u + sinθ·v)
       e=0 是晨昏线，-6/-12/-18 是民用/航海/天文三档暮光 */
    const ring = (e, n = 180) => {
      const se = Math.sin(e * DEG), ce = Math.cos(e * DEG);
      const out = [];
      for (let i = 0; i <= n; i++) {
        const th = (i / n) * Math.PI * 2;
        const pt = [
          se * s[0] + ce * (Math.cos(th) * u[0] + Math.sin(th) * v[0]),
          se * s[1] + ce * (Math.cos(th) * u[1] + Math.sin(th) * v[1]),
          se * s[2] + ce * (Math.cos(th) * u[2] + Math.sin(th) * v[2])
        ];
        out.push(vecToGeo(pt));
      }
      return out;
    };

    strokeGeo(ring(-18), p.twi2, 1, [1.5, 7]);
    strokeGeo(ring(-12), p.twi, 1, [2.5, 5]);
    strokeGeo(ring(-6), p.twi, 1);
    strokeGeo(ring(0), p.term, 1.45);

    /* 直射点：一个小太阳，标出"此刻正午在哪里" */
    const g = vecToGeo(s);
    const q = project(g[0], g[1]);
    if (q && q.visible) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = p.sunHalo;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = p.sun;
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(q.x + Math.cos(a) * 4.2, q.y + Math.sin(a) * 4.2);
        ctx.lineTo(q.x + Math.cos(a) * 7.2, q.y + Math.sin(a) * 7.2);
        ctx.strokeStyle = p.sunHalo;
        ctx.stroke();
      }
    }
  }

  function drawThread(p) {
    if (!places.length || thread.legs.length === 0) return;
    for (const leg of thread.legs) {
      ctx.setLineDash([3, 6]);
      strokeGeo(leg, p.thread, 1, [3, 6]);
    }
  }

  function setPlaces(list) {
    places = (list || []).filter(l => l.lat != null && l.lng != null);
    const sorted = [...places].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const legs = [];
    let km = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = toVec(sorted[i].lat, sorted[i].lng);
      const b = toVec(sorted[i + 1].lat, sorted[i + 1].lng);
      const d = clamp(dot(a, b), -1, 1);
      km += Math.acos(d) * R_EARTH;
      const steps = Math.max(8, Math.ceil(Math.acos(d) / (2 * DEG)));
      const pts = [];
      for (let s = 0; s <= steps; s++) pts.push(vecToGeo(slerp(a, b, s / steps)));
      legs.push(pts);
    }
    thread = { legs, km: Math.round(km) };
  }

  function setLayer(name, isOn) {
    if (isOn) on.add(name); else on.delete(name);
  }

  function draw(payload) {
    if (!ctx || !W || !H) return;
    project = payload.project;
    spin = payload.spin || 0;
    sun = payload.sun || null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (on.size === 0) return;
    const p = pal();
    ctx.save();
    if (on.has('thread')) drawThread(p);
    if (on.has('graticule')) drawGraticule(p);
    if (on.has('terminator')) drawTerminator(p);
    ctx.restore();
  }

  return {
    resize,
    draw,
    setLayer,
    setPlaces,
    isOn: name => on.has(name),
    stats: () => ({ km: thread.km, legs: thread.legs.length, places: places.length }),
    /* 验收用：当前打开的叠加层 */
    _active: () => [...on]
  };
}
