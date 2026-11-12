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

/* 三层的参数：div 决定密度，r/a/v 是尺寸、透明度、速度区间。
   前两层是星（kind: 'star'），后三层是近场微尘（kind: 'dust'）。
   星星几乎不动、视差极小——它们在无穷远；微尘才飘。 */
const LAYERS = [
  { kind: 'star', div: 3400,  cap: 260, r: [0.45, 1.00], a: [0.12, 0.46], v: [0.004, 0.012], par: 0.10, tint: [198, 214, 255] },
  { kind: 'star', div: 8600,  cap: 96,  r: [1.20, 1.70], a: [0.22, 0.72], v: [0.010, 0.028], par: 0.30, tint: [255, 246, 228] },
  { kind: 'dust', div: 8200,  cap: 190, r: [0.28, 0.85], a: [0.05, 0.17], v: [0.015, 0.055], par: 0.35 },
  { kind: 'dust', div: 15000, cap: 100, r: [0.55, 1.45], a: [0.09, 0.32], v: [0.035, 0.115], par: 1.00 },
  { kind: 'dust', div: 38000, cap: 30,  r: [1.00, 2.30], a: [0.16, 0.48], v: [0.070, 0.200], par: 2.30, halo: 1 }
];

const rand = (a, b) => a + Math.random() * (b - a);

export function createDust(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = 0, run = false;
  let parts = [];
  let rgb = inkRGB();
  let dark = true;
  let px = 0, py = 0, tx = 0, ty = 0;

  /* 亮色主题不画星：纸面上撒白点只会显脏 */
  function readDark() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(bg);
    if (!m) return true;
    const n = parseInt(m[1], 16);
    const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return l < 0.35;
  }

  function build() {
    const narrow = W < 760;
    const scale = narrow ? 0.55 : 1;
    parts = [];
    LAYERS.forEach((L, li) => {
      const n = Math.round(Math.min(L.cap, (W * H) / L.div) * scale);
      for (let i = 0; i < n; i++) {
        const a = rand(L.a[0], L.a[1]);
        parts.push({
          l: li,
          x: Math.random() * W,
          y: Math.random() * H,
          r: rand(L.r[0], L.r[1]),
          a,
          /* 透明度分四档：逐颗 fill 太贵，分档之后一层只要四次 fill，
             又不会把深浅拉平成一整片 */
          q: Math.min(3, Math.floor((a - L.a[0]) / (L.a[1] - L.a[0] + 1e-6) * 4)),
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
    dark = readDark();
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
      /* 亮色主题（宣纸）不画星：纸面上出现白点只会像脏，不像星空 */
      if (L.kind === 'star' && !dark) continue;

      if (animate) {
        for (const p of parts) {
          if (p.l !== li) continue;
          p.y -= p.v;
          p.x += Math.sin(t * 0.00018 * p.sway + p.ph) * 0.14;
          if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
          if (p.x < -8) p.x = W + 8;
          else if (p.x > W + 8) p.x = -8;
        }
      }

      /* 星用设备像素画 1×1，才够"点"；按 CSS 像素画会变成 2px 的灰糊 */
      if (L.kind === 'star') {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgb(${L.tint[0]},${L.tint[1]},${L.tint[2]})`;
        for (let q = 0; q < 4; q++) {
          ctx.beginPath();
          let any = false;
          for (const p of parts) {
            if (p.l !== li || p.q !== q) continue;
            const s = p.r > 1.2 ? 2 : 1;
            ctx.rect(
              Math.round((p.x + ox * p.par * 0.5) * dpr),
              Math.round((p.y + oy * p.par * 0.5) * dpr),
              s, s
            );
            any = true;
          }
          if (!any) continue;
          ctx.globalAlpha = L.a[0] + (L.a[1] - L.a[0]) * ((q + 0.5) / 4);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }

      /* 光晕单独一遍：它只有核心的 16% 亮度，混在同一条路径里会变成灰斑 */
      ctx.fillStyle = `rgb(${lum})`;
      for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q < 4; q++) {
          ctx.beginPath();
          let any = false;
          for (const p of parts) {
            if (p.l !== li || p.q !== q) continue;
            if (pass === 0 && !p.halo) continue;
            const x = p.x + ox * p.par * 0.5;
            const y = p.y + oy * p.par * 0.5;
            const rad = pass === 0 ? p.r * 3.4 : p.r;
            ctx.moveTo(x + rad, y);
            ctx.arc(x, y, rad, 0, 6.2832);
            any = true;
          }
          if (!any) continue;
          const a = L.a[0] + (L.a[1] - L.a[0]) * ((q + 0.5) / 4);
          ctx.globalAlpha = pass === 0 ? a * 0.16 : a;
          ctx.fill();
        }
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

  dark = readDark();
  resize();
  io.observe(canvas);

  return {
    resize,
    retheme() {
      rgb = inkRGB();
      dark = readDark();
      if (!run) draw(0);
    }
  };
}
