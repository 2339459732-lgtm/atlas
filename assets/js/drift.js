/* ══════════════════════════════════════════════════════════════════
   drift.js — 开篇的微尘。慢，稀，跟着指针有一点点视差。
   只是背景质感，不抢标题。prefers-reduced-motion 下画一帧就停。
   ══════════════════════════════════════════════════════════════════ */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function inkRGB() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return [244, 241, 233];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createDust(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = 0, run = false;
  let parts = [];
  let rgb = inkRGB();
  let px = 0, py = 0, tx = 0, ty = 0;

  function build() {
    const n = Math.round(Math.min(140, (W * H) / 12000));
    parts = [];
    for (let i = 0; i < n; i++) {
      const z = Math.random();           /* 深度：越大越亮越快 */
      parts.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z,
        r: 0.35 + z * 1.25,
        vx: (Math.random() - 0.5) * 0.09,
        vy: -0.05 - z * 0.16,
        a: 0.06 + z * 0.34,
        t: Math.random() * 6.28
      });
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (reduced()) draw(0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const ox = (tx - px) * 0.02;
    const oy = (ty - py) * 0.02;
    for (const p of parts) {
      if (!reduced()) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -6) { p.y = H + 6; p.x = Math.random() * W; }
        if (p.x < -6) p.x = W + 6;
        if (p.x > W + 6) p.x = -6;
      }
      const tw = 0.72 + 0.28 * Math.sin(t * 0.0006 + p.t);
      ctx.globalAlpha = p.a * tw;
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.beginPath();
      ctx.arc(p.x + ox * p.z * 10, p.y + oy * p.z * 10, p.r, 0, 6.2832);
      ctx.fill();
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
