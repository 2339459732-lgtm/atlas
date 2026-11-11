/* ══════════════════════════════════════════════════════════════════
   drift.js — 开篇的微尘。

   分远 / 中 / 近三层：层越近，颗粒越大、越亮、飘得越快、视差越明显。
   这样镜头有纵深，而不是一层均匀的噪点。
   性能：粒子数按面积推导并有上限；dpr 封顶 1.75；离开视口即停；
   prefers-reduced-motion 下只画一帧。
   ══════════════════════════════════════════════════════════════════ */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function inkRGB() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return [244, 241, 233];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* 三层的参数：div 决定密度，r/a/v 是尺寸、透明度、速度区间 */
const LAYERS = [
  { div: 8200,  cap: 240, r: [0.28, 0.85], a: [0.05, 0.17], v: [0.015, 0.055], par: 0.35, halo: 0 },
  { div: 15000, cap: 130, r: [0.55, 1.45], a: [0.09, 0.32], v: [0.035, 0.115], par: 1.00, halo: 0 },
  { div: 38000, cap: 38,  r: [1.00, 2.30], a: [0.16, 0.48], v: [0.070, 0.200], par: 2.30, halo: 1 }
];

const rand = (a, b) => a + Math.random() * (b - a);

export function createDust(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = 0, run = false;
  let parts = [];
  let rgb = inkRGB();
  let px = 0, py = 0, tx = 0, ty = 0;

  function build() {
    const narrow = W < 760;
    const scale = narrow ? 0.55 : 1;
    parts = [];
    LAYERS.forEach((L, li) => {
      const n = Math.round(Math.min(L.cap, (W * H) / L.div) * scale);
      for (let i = 0; i < n; i++) {
        const r = rand(L.r[0], L.r[1]);
        parts.push({
          l: li,
          x: Math.random() * W,
          y: Math.random() * H,
          r,
          a: rand(L.a[0], L.a[1]),
          v: rand(L.v[0], L.v[1]),
          par: L.par,
          halo: L.halo,
          ph: Math.random() * 6.283,
          sway: rand(0.4, 1.6)
        });
      }
    });
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(1.75, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (reduced()) draw(0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const ox = (tx - px) * 26;
    const oy = (ty - py) * 18;
    const lum = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    const animate = !reduced();

    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li];
      /* 同一层只设一次颜色，减少状态切换 */
      ctx.fillStyle = `rgb(${lum})`;

      for (const p of parts) {
        if (p.l !== li) continue;

        if (animate) {
          p.y -= p.v;
          p.x += Math.sin(t * 0.00018 * p.sway + p.ph) * 0.14;
          if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
          if (p.x < -8) p.x = W + 8;
          else if (p.x > W + 8) p.x = -8;
        }

        const tw = 0.72 + 0.28 * Math.sin(t * 0.00055 + p.ph);
        const x = p.x + ox * p.par * 0.5;
        const y = p.y + oy * p.par * 0.5;

        /* 近景的几颗带一圈很淡的光晕，像真的浮在镜头前 */
        if (p.halo) {
          ctx.globalAlpha = p.a * tw * 0.16;
          ctx.beginPath();
          ctx.arc(x, y, p.r * 3.4, 0, 6.2832);
          ctx.fill();
        }

        ctx.globalAlpha = p.a * tw;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    if (!run) return;
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  addEventListener('pointermove', e => {
    tx = e.clientX / innerWidth - 0.5;
    ty = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  const io = new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !reduced()) {
      if (!run) { run = true; raf = requestAnimationFrame(loop); }
    } else {
      run = false; cancelAnimationFrame(raf);
      if (reduced()) draw(0);
    }
  }, { threshold: 0.02 });

  resize();
  io.observe(canvas);

  return {
    resize,
    retheme() { rgb = inkRGB(); if (!run) draw(0); }
  };
}
