/* ══════════════════════════════════════════════════════════════════
   globe.js — 正交投影地球。没有依赖，没有 WebGL。
   海岸线来自 Natural Earth 110m（land.js），经纬网与海岸线都按
   可见半球裁切；点空白处可反解出经纬度，用来落一个新地标。
   ══════════════════════════════════════════════════════════════════ */

import { LAND } from './land.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* 反解正交投影：屏幕点 → 经纬度 */
function unproject(px, py, cx, cy, R, lon0, lat0) {
  const x = (px - cx) / R;
  const y = -(py - cy) / R;
  const rho = Math.hypot(x, y);
  if (rho > 1) return null;
  if (rho < 1e-6) return { lat: lat0, lng: lon0 };
  const c = Math.asin(rho);
  const sinC = Math.sin(c), cosC = Math.cos(c);
  const phi0 = lat0 * D2R, lam0 = lon0 * D2R;
  const lat = Math.asin(cosC * Math.sin(phi0) + (y * sinC * Math.cos(phi0)) / rho);
  const lng = lam0 + Math.atan2(x * sinC, rho * cosC * Math.cos(phi0) - y * sinC * Math.sin(phi0));
  let lon = lng * R2D;
  lon = ((lon + 540) % 360) - 180;
  return { lat: lat * R2D, lng: lon };
}

export function createGlobe(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const onPick = opts.onPick || (() => {});
  const onEmpty = opts.onEmpty || (() => {});
  const onHover = opts.onHover || (() => {});

  const globe = {
    lon0: 20, lat0: 22, zoom: 1,
    going: false, hovered: null, lit: null,
    home: { lon: 20, lat: 22, zoom: 1 },
    auto: true
  };

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0;
  let items = [];
  let raf = 0, run = false, dirty = true;
  let vel = { lon: 0, lat: 0 };
  let drag = null;
  let tZoom = 1;
  let pointer = { x: -999, y: -999 };
  let stars = [];

  /* ── 主题色 ── */
  function pal() {
    const light = document.documentElement.dataset.theme === 'light';
    return light ? {
      sea: '#EFEDE6',
      sea2: '#E4E1D8',
      land: 'rgba(20,19,15,.055)',
      coast: 'rgba(20,19,15,.30)',
      grid: 'rgba(20,19,15,.10)',
      rim: 'rgba(20,19,15,.20)',
      halo: 'rgba(20,19,15,.05)',
      star: 'rgba(20,19,15,.16)',
      label: 'rgba(20,19,15,.9)',
      pinRing: 'rgba(255,255,255,.94)',
      pulse: 0.10
    } : {
      sea: '#0C0C10',
      sea2: '#08080A',
      land: 'rgba(244,241,233,.055)',
      coast: 'rgba(244,241,233,.30)',
      grid: 'rgba(244,241,233,.11)',
      rim: 'rgba(244,241,233,.18)',
      halo: 'rgba(201,169,106,.10)',
      star: 'rgba(244,241,233,.22)',
      label: 'rgba(244,241,233,.94)',
      pinRing: 'rgba(255,255,255,.72)',
      pulse: 0.075
    };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    recompute();
    seedStars();
    dirty = true;
  }

  function recompute() {
    const compact = W < 760;
    cx = compact ? W * 0.5 : W * 0.42;
    cy = H * 0.52;
    R = Math.min(W * (compact ? 0.42 : 0.30), H * 0.40) * globe.zoom;
    dirty = true;
  }

  function seedStars() {
    stars = [];
    const n = Math.round((W * H) / 14000);
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.1 + 0.25,
        a: Math.random() * 0.5 + 0.12,
        t: Math.random() * 6.28
      });
    }
  }

  /* ── 投影 ── */
  function project(lat, lng) {
    const phi = lat * D2R, lam = (lng - globe.lon0) * D2R;
    const phi0 = globe.lat0 * D2R;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const cosPhi0 = Math.cos(phi0), sinPhi0 = Math.sin(phi0);
    const cosLam = Math.cos(lam);
    const z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosLam;
    let x = cosPhi * Math.sin(lam);
    let y = cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosLam;
    /* 背面点贴到圆周上，海岸线不会在边缘凭空断开 */
    if (z < 0) {
      const len = Math.hypot(x, y) || 1;
      x = (x / len) * 0.999;
      y = (y / len) * 0.999;
    }
    return { x: cx + R * x, y: cy - R * y, z };
  }

  /* ── 绘制 ── */
  function drawStars(p, t) {
    for (const s of stars) {
      const tw = 0.6 + 0.4 * Math.sin(t * 0.0007 + s.t);
      ctx.globalAlpha = s.a * tw * 0.55;
      ctx.fillStyle = p.star;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSphere(p) {
    /* 外层光晕 */
    const halo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.22);
    halo.addColorStop(0, p.halo);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 6.2832); ctx.fill();

    /* 球体 */
    const g = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.4, R * 0.12, cx, cy, R);
    g.addColorStop(0, p.sea);
    g.addColorStop(1, p.sea2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  }

  function drawGrid(p) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.grid;
    ctx.beginPath();

    for (let lon = -180; lon < 180; lon += 30) {
      let pen = false;
      for (let lat = -90; lat <= 90; lat += 3) {
        const q = project(lat, lon);
        if (q.z > -0.001) {
          if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
        } else pen = false;
      }
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      let pen = false;
      for (let lon = -180; lon <= 180; lon += 3) {
        const q = project(lat, lon);
        if (q.z > -0.001) {
          if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
        } else pen = false;
      }
    }
    ctx.stroke();

    /* 赤道稍亮 */
    ctx.strokeStyle = p.rim;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    let pen = false;
    for (let lon = -180; lon <= 180; lon += 2) {
      const q = project(0, lon);
      if (q.z > -0.001) { if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; } }
      else pen = false;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function landPath(p) {
    const path = new Path2D();
    for (const ring of LAND) {
      let started = false;
      for (let i = 0; i < ring.length; i += 2) {
        const q = project(ring[i + 1], ring[i]);
        if (!started) { path.moveTo(q.x, q.y); started = true; }
        else path.lineTo(q.x, q.y);
      }
      path.closePath();
    }
    ctx.fillStyle = p.land;
    ctx.fill(path);
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.coast;
    ctx.stroke(path);
  }

  function drawArcs(p) {
    const pts = items.filter(it => it.lat != null && it.lng != null);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = p.coast;
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const steps = 26;
      let began = false;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const k = s / steps;
        const lat = a.lat + (b.lat - a.lat) * k;
        let dl = b.lng - a.lng;
        if (dl > 180) dl -= 360;
        if (dl < -180) dl += 360;
        const lng = a.lng + dl * k;
        const lift = 1 + Math.sin(k * Math.PI) * Math.min(0.16, Math.abs(dl) / 360 * 0.6);
        const phi = lat * D2R, lam = (lng - globe.lon0) * D2R;
        const phi0 = globe.lat0 * D2R;
        const z = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam);
        if (z > 0.02) {
          const q = project(lat, lng);
          const dx = q.x - cx, dy = q.y - cy;
          const px = cx + dx * lift, py = cy + dy * lift;
          if (!began) { ctx.moveTo(px, py); began = true; } else ctx.lineTo(px, py);
        } else began = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPins(p, t) {
    for (const it of items) {
      if (it.lat == null || it.lng == null) continue;
      const q = project(it.lat, it.lng);
      if (q.z <= 0.02) { it._x = null; continue; }
      it._x = q.x; it._y = q.y;

      const lit = globe.hovered === it.id || globe.lit === it.id;
      const r = lit ? 6.2 : 4.2;
      const acc = it.accent || '#C9A96A';

      /* 中心脉冲 */
      const pulse = (Math.sin(t * 0.0022 + (it.lat + it.lng)) + 1) / 2;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r + 9 + pulse * 5, 0, 6.2832);
      ctx.fillStyle = acc;
      ctx.globalAlpha = p.pulse * (0.55 + pulse * 0.75);
      ctx.fill();

      /* 外环 */
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, 6.2832);
      ctx.fillStyle = acc;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = p.pinRing;
      ctx.stroke();

      if (lit) {
        ctx.globalAlpha = 1;
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.fillStyle = p.label;
        ctx.textAlign = 'left';
        const label = it.name + (it.count ? '  ' + it.count : '');
        ctx.fillText(label, q.x + r + 8, q.y + 3.5);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawRim(p) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.rim;
    ctx.stroke();

    /* 边缘高光，做出球体体积 */
    const g = ctx.createLinearGradient(cx - R, cy - R, cx + R * 0.6, cy + R);
    g.addColorStop(0, 'rgba(255,255,255,.05)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.22)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }

  function frame(t) {
    if (!run) return;

    /* 惯性 */
    if (!drag && (Math.abs(vel.lon) > 0.001 || Math.abs(vel.lat) > 0.001)) {
      globe.lon0 += vel.lon;
      globe.lat0 = clamp(globe.lat0 + vel.lat, -82, 82);
      vel.lon *= 0.955;
      vel.lat *= 0.955;
      dirty = true;
    } else if (!drag && globe.auto) {
      globe.lon0 += 0.035;
      if (Math.abs(globe.lon0) > 3600) globe.lon0 %= 360;
      dirty = true;
    }

    if (Math.abs(globe.zoom - tZoom) > 0.0005) {
      globe.zoom += (tZoom - globe.zoom) * 0.12;
      recompute();
      dirty = true;
    }

    if (dirty) {
      const p = pal();
      ctx.clearRect(0, 0, W, H);
      drawStars(p, t);
      drawSphere(p);
      drawGrid(p);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
      landPath(p);
      drawArcs(p);
      ctx.restore();
      drawPins(p, t);
      drawRim(p);
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }

  /* ── 命中检测 ── */
  function hitPin(x, y) {
    let best = null, bestD = 16;
    for (const it of items) {
      if (it._x == null) continue;
      const d = Math.hypot(it._x - x, it._y - y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  /* ── 事件 ── */
  let downAt = 0, downPos = { x: 0, y: 0 }, moved = 0;

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture?.(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    vel = { lon: 0, lat: 0 };
    moved = 0;
    downAt = performance.now();
    downPos = { x: e.offsetX, y: e.offsetY };
    canvas.classList.add('is-drag');
    globe.auto = false;
  });

  canvas.addEventListener('pointermove', e => {
    pointer = { x: e.offsetX, y: e.offsetY };
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.32 / (globe.zoom || 1);
      globe.lon0 -= dx * k;
      globe.lat0 = clamp(globe.lat0 + dy * k, -82, 82);
      vel = { lon: -dx * k * 0.7, lat: dy * k * 0.7 };
      dirty = true;
      return;
    }
    const hit = hitPin(pointer.x, pointer.y);
    const id = hit ? hit.id : null;
    if (id !== globe.hovered) {
      globe.hovered = id;
      canvas.style.cursor = id ? 'pointer' : 'grab';
      onHover(hit);
      dirty = true;
    }
  });

  canvas.addEventListener('pointerup', e => {
    canvas.classList.remove('is-drag');
    const wasDrag = moved > 8;
    drag = null;
    if (wasDrag) return;
    const hit = hitPin(e.offsetX, e.offsetY);
    if (hit) { onPick(hit); return; }
    const geo = unproject(e.offsetX, e.offsetY, cx, cy, R, globe.lon0, globe.lat0);
    if (geo) onEmpty(geo);
  });

  canvas.addEventListener('pointercancel', () => {
    drag = null;
    canvas.classList.remove('is-drag');
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    tZoom = clamp(tZoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.82, 2.4);
    globe.auto = false;
  }, { passive: false });

  /* ── 对外 ── */
  globe.setItems = list => {
    items = list.map(l => ({ ...l }));
    dirty = true;
  };
  globe.setLit = id => { globe.lit = id; dirty = true; };
  globe.focusLandmark = lm => {
    if (lm.lat == null || lm.lng == null) return;
    globe.auto = false;
    vel = { lon: 0, lat: 0 };
    const targetLon = lm.lng;
    const tick = () => {
      const rem = targetLon - globe.lon0;
      const dd = ((rem + 540) % 360) - 180;
      if (Math.abs(dd) < 0.4) { globe.lon0 = targetLon; dirty = true; return; }
      globe.lon0 += dd * 0.16;
      globe.lat0 += (clamp(lm.lat, -70, 70) - globe.lat0) * 0.16;
      dirty = true;
      requestAnimationFrame(tick);
    };
    tick();
  };
  globe.reset = () => { tZoom = 1; globe.home = { lon: 20, lat: 22 }; globe.auto = true; globe.lon0 = 20; globe.lat0 = 22; dirty = true; };
  globe.start = () => { if (run) return; run = true; resize(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
  globe.stop = () => { run = false; cancelAnimationFrame(raf); };
  globe.resize = resize;
  globe.refresh = () => { dirty = true; };

  return globe;
}
