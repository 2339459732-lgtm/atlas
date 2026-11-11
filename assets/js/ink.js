/* ══════════════════════════════════════════════════════════
   ink.js — 四通道加网制版引擎（WebGL1，无依赖）
   一张照片 → C/M/Y/K 四张灰阶版 → 各自加网 → 减色叠印
   ══════════════════════════════════════════════════════════ */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = (aPos + 1.0) * 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#extension GL_OES_standard_derivatives : enable
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform sampler2D uTex;
uniform vec2  uRes;
uniform vec2  uPtr;
uniform vec2  uParallax;
uniform float uTime;
uniform float uOffsetPx;
uniform float uDensity;
uniform vec3  uPaper;
uniform vec3  uInkC;
uniform vec3  uInkM;
uniform vec3  uInkY;
uniform vec3  uInkK;
uniform vec4  uAng;
uniform float uCell;
uniform int   uScreen;
uniform float uHasTex;
uniform float uSeed;
uniform float uReveal;
uniform float uAspect;
uniform float uCoverage;

mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.3;
    a *= 0.5;
  }
  return s;
}

/* 无照片时的印版样张：四色实地 / 网点圆 / 灰阶梯 / 斜线组
   这不是一张假装的照片，而是印坊台面上真实会有的那张校版纸 */
vec3 proofSheet(vec2 uv){
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, 1.0 - uv.y);
  float sy = p.y;

  float topBand = 0.150;
  float botBand = 0.840;

  /* 顶部：四色实地条 */
  if (sy < topBand) {
    float b = floor(clamp(uv.x, 0.0, 0.9995) * 4.0);
    vec3 ink = (b < 0.5) ? uInkC : (b < 1.5) ? uInkM : (b < 2.5) ? uInkY : uInkK;
    return ink;
  }

  /* 底部：十级灰阶梯 */
  if (sy > botBand) {
    float b = floor(clamp(uv.x, 0.0, 0.9995) * 10.0) / 9.0;
    float v = 1.0 - b * 0.965;
    return vec3(v * 0.982);
  }

  /* 中间：一个用于读网点形状的圆 */
  float midY = (topBand + botBand) * 0.5;
  float R = min(asp * 0.155, (botBand - topBand) * 0.40);
  vec2 q = vec2(p.x - asp * 0.335, sy - midY);
  float d = length(q) / R;
  if (d < 1.0) {
    return vec3(mix(0.035, 0.955, smoothstep(0.0, 1.0, d)));
  }

  /* 左侧：套准靶 —— 印刷机对版用的十字与圆环 */
  vec2 q2 = vec2(p.x - asp * 0.105, sy - midY);
  float dd = length(q2);
  float ring = 1.0 - smoothstep(0.0022, 0.0050, abs(dd - 0.088));
  float barV = (1.0 - smoothstep(0.0022, 0.0050, abs(q2.x))) * step(abs(q2.y), 0.125);
  float barH = (1.0 - smoothstep(0.0022, 0.0050, abs(q2.y))) * step(abs(q2.x), 0.125);
  float mark = max(max(ring, barV), barH);
  if (mark > 0.02) {
    return vec3(mix(0.978, 0.045, mark));
  }

  /* 右侧：三组不同角度的斜线（看莫尔纹） */
  float lx = uv.x;
  if (lx > 0.575 && lx < 0.945) {
    float seg = floor((lx - 0.575) / 0.1233);
    float ang = (seg < 0.5) ? 0.0 : (seg < 1.5) ? 0.785 : 1.571;
    float rot = p.x * cos(ang) + p.y * sin(ang);
    float v = fract(rot * 46.0);
    return vec3(mix(0.055, 0.955, step(0.5, v)));
  }

  return vec3(0.982);
}
vec2 coverUv(vec2 uv, float canvasAspect, float imgAspect){
  vec2 st = uv - 0.5;
  if (canvasAspect > imgAspect) st.y *= imgAspect / canvasAspect;
  else st.x *= canvasAspect / imgAspect;
  return st + 0.5;
}

/* 单位网点覆盖：v=墨量 0..1，返回该像素的墨覆盖 0..1 */
float plate(vec2 p, float ang, float v){
  vec2 q = rot(ang) * p;
  vec2 g = q / uCell;
  float d;
  if (uScreen == 0) {
    vec2 f = abs(fract(g) - 0.5) * 2.0;
    /* 归一化到"覆盖面积 = 墨量"：圆面积 πr² = v，r 以格心为单位 */
    d = length(f) * 0.8862;
  } else if (uScreen == 1) {
    d = abs(fract(g.x) - 0.5) * 2.0;
  } else {
    vec2 f = abs(fract(g) - 0.5) * 2.0;
    d = min(f.x, f.y);
  }
  float R = sqrt(clamp(v, 0.0, 1.0));
  float aa = max(fwidth(d) * 0.85, 0.012);
  return 1.0 - smoothstep(R - aa, R + aa, d);
}

void main(){
  vec2 uv = vUv;

  /* 指针带来的轻微纸面位移 */
  vec2 puv = uv + uPtr * vec2(0.006, 0.004) + uParallax;

  vec3 src;
  if (uHasTex > 0.5) {
    src = texture2D(uTex, coverUv(puv, uRes.x / uRes.y, uAspect)).rgb;
    src = clamp((pow(src, vec3(0.96)) - 0.5) * 1.14 + 0.5, 0.0, 1.0);
  } else {
    src = proofSheet(puv);
  }

  /* 减色分版：K 取三通道最小值，其余三色扣掉 K */
  float c0 = 1.0 - src.r;
  float m0 = 1.0 - src.g;
  float y0 = 1.0 - src.b;
  /* 轻底色去除：只抽走八成黑，暗部仍留着三色，才是印刷的"四色黑" */
  float k = min(c0, min(m0, y0)) * 0.82;
  float c = clamp(c0 - k, 0.0, 1.0);
  float m = clamp(m0 - k, 0.0, 1.0);
  float y = clamp(y0 - k, 0.0, 1.0);

  /* 套印偏移：每张版沿自己的进纸方向漂移，指针推动它 */
  vec2 push = uPtr * 0.85;
  vec2 px = vec2(1.0 / uRes.x, 1.0 / uRes.y);
  vec2 offC = (vec2( 0.94,  0.17) + push * 1.00) * uOffsetPx * px;
  vec2 offM = (vec2(-0.71,  0.56) + push * 0.70) * uOffsetPx * px;
  vec2 offY = (vec2( 0.29, -0.88) + push * 0.48) * uOffsetPx * px;
  vec2 offK = (vec2(-0.26, -0.31) + push * 0.34) * uOffsetPx * px;

  /* 逐版显影（制版序列） */
  float rvC = clamp(uReveal - 0.0, 0.0, 1.0);
  float rvM = clamp(uReveal - 1.0, 0.0, 1.0);
  float rvY = clamp(uReveal - 2.0, 0.0, 1.0);
  float rvK = clamp(uReveal - 3.0, 0.0, 1.0);
  offC *= (1.0 - rvC) * 3.0 + 0.02;
  offM *= (1.0 - rvM) * 3.0 + 0.02;
  offY *= (1.0 - rvY) * 3.0 + 0.02;
  offK *= (1.0 - rvK) * 3.0 + 0.02;
  float aC = smoothstep(0.0, 0.28, rvC);
  float aM = smoothstep(0.0, 0.28, rvM);
  float aY = smoothstep(0.0, 0.28, rvY);
  float aK = smoothstep(0.0, 0.28, rvK);

  vec2 pC = (uv + offC) * uRes;
  vec2 pM = (uv + offM) * uRes;
  vec2 pY = (uv + offY) * uRes;
  vec2 pK = (uv + offK) * uRes;

  float covC = plate(pC, uAng.x, c) * aC;
  float covM = plate(pM, uAng.y, m) * aM;
  float covY = plate(pY, uAng.z, y) * aY;
  float covK = plate(pK, uAng.w, k) * aK;

  /* 纸：基色 + 细纹 + 墨膜不匀 */
  float grain = vnoise(uv * uRes / 2.6) * 0.5 + vnoise(uv * uRes / 1.7) * 0.5;
  vec3 paper = uPaper * (0.975 + 0.045 * grain);
  float mottle = 0.93 + 0.14 * vnoise(uv * vec2(uAspect, 1.0) * 26.0 + 41.0);
  covC *= mottle; covM *= mottle; covY *= mottle; covK *= mottle;

  /* 减色叠印：油墨是滤片 */
  float dens = uDensity * uCoverage;
  vec3 col = paper;
  vec3 nC = clamp(uInkC / max(paper, vec3(0.02)), 0.0, 1.0);
  vec3 nM = clamp(uInkM / max(paper, vec3(0.02)), 0.0, 1.0);
  vec3 nY = clamp(uInkY / max(paper, vec3(0.02)), 0.0, 1.0);
  vec3 nK = clamp(uInkK / max(paper, vec3(0.02)), 0.0, 1.0);

  col *= mix(vec3(1.0), nY, clamp(covY * dens * 1.06, 0.0, 1.0));
  col *= mix(vec3(1.0), nM, clamp(covM * dens * 1.06, 0.0, 1.0));
  col *= mix(vec3(1.0), nC, clamp(covC * dens * 1.06, 0.0, 1.0));
  col *= mix(vec3(1.0), nK, clamp(covK * dens * 1.16, 0.0, 1.0));

  /* 纸边极轻的吸光，别让四角发灰 */
  vec2 vg = (uv - 0.5) * vec2(uAspect, 1.0);
  col *= 1.0 - 0.055 * dot(vg, vg);

  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'shader compile failed');
  }
  return s;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

let PAPER = hexToRgb('#F5F3EC');

export function createPress(canvas) {
  const opts = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  };
  const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);

  if (!gl) return { ok: false, reason: 'no-webgl' };

  // 加网边缘的导数（fwidth）需要这个扩展，没有就退化为固定阈值
  gl.getExtension('OES_standard_derivatives');

  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  } catch (err) {
    return { ok: false, reason: 'shader', error: String(err) };
  }

  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ['uTex','uRes','uPtr','uParallax','uTime','uOffsetPx','uDensity','uPaper',
   'uInkC','uInkM','uInkY','uInkK','uAng','uCell','uScreen','uHasTex','uSeed',
   'uReveal','uAspect','uCoverage'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

  let tex = null;
  let texW = 0, texH = 0;
  let hasTex = false;
  let seed = 0.37;

  const state = {
    density: 0.86,
    cell: 5.6,
    offsetPx: 7.3,
    screen: 0,
    angles: [45, 75, 15, 0],
    reveal: 4
  };
  let inks = {
    c: hexToRgb('#1341E0'),
    m: hexToRgb('#E8402A'),
    y: hexToRgb('#F2C300'),
    k: hexToRgb('#12120E')
  };

  let ptrX = 0, ptrY = 0, tgtX = 0, tgtY = 0;
  let parX = 0;
  let time = 0;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  let dirty = true;
  let raf = 0;
  let visible = true;
  let live = true; // 印样模式下让雾缓慢流动

  function resize() {
    const d = dpr();
    const w = Math.max(1, Math.round(canvas.clientWidth * d));
    const h = Math.max(1, Math.round(canvas.clientHeight * d));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      dirty = true;
    }
  }

  function draw() {
    if (!gl || gl.isContextLost()) return;
    resize();
    const w = canvas.width, h = canvas.height;

    gl.uniform2f(U.uRes, w, h);
    gl.uniform2f(U.uPtr, ptrX, ptrY);
    gl.uniform2f(U.uParallax, parX, 0);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uOffsetPx, state.offsetPx * (w / 1400));
    gl.uniform1f(U.uDensity, state.density);
    gl.uniform3fv(U.uPaper, PAPER);
    gl.uniform3fv(U.uInkC, inks.c);
    gl.uniform3fv(U.uInkM, inks.m);
    gl.uniform3fv(U.uInkY, inks.y);
    gl.uniform3fv(U.uInkK, inks.k);
    gl.uniform4f(U.uAng,
      state.angles[0] * Math.PI / 180,
      state.angles[1] * Math.PI / 180,
      state.angles[2] * Math.PI / 180,
      state.angles[3] * Math.PI / 180);
    const cellScale = Math.max(0.62, Math.min(1.4, canvas.clientWidth / 640));
    gl.uniform1f(U.uCell, state.cell * cellScale * Math.min(dpr(), 2));
    gl.uniform1i(U.uScreen, state.screen);
    gl.uniform1f(U.uHasTex, hasTex ? 1 : 0);
    gl.uniform1f(U.uSeed, seed);
    gl.uniform1f(U.uReveal, state.reveal);
    gl.uniform1f(U.uAspect, texW && texH ? texW / texH : (w / Math.max(1, h)));
    gl.uniform1f(U.uCoverage, 1.0);

    if (tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.uTex, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = false;
  }

  function frame() {
    if (!gl || gl.isContextLost()) { raf = 0; return; }

    let animating = false;

    // 指针缓动 → 套印漂移有惯性，不是硬跟随
    const dx = tgtX - ptrX, dy = tgtY - ptrY;
    if (Math.abs(dx) > 0.0006 || Math.abs(dy) > 0.0006) {
      ptrX += dx * 0.085;
      ptrY += dy * 0.085;
      dirty = true;
      animating = true;
    }

    if (live && !hasTex && visible) {
      time += 0.016;
      dirty = true;
      animating = true;
    }

    if (visible && dirty) draw();

    raf = animating ? requestAnimationFrame(frame) : 0;
  }

  function kick() {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function setImage(source, w, h) {
    if (tex) gl.deleteTexture(tex);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    texW = w; texH = h;
    hasTex = true;
    kick();
  }

  function clearImage() {
    if (tex) { gl.deleteTexture(tex); tex = null; }
    hasTex = false;
    kick();
  }

  function setAtelier(a) {
    inks = {
      c: hexToRgb(a.inkC), m: hexToRgb(a.inkM),
      y: hexToRgb(a.inkY), k: hexToRgb(a.inkK)
    };
    state.angles = a.angles.slice();
    seed = a.seed;
    kick();
  }

  function setParams(p) {
    if (p.density != null) state.density = p.density;
    if (p.cell != null) state.cell = p.cell;
    if (p.offsetPx != null) state.offsetPx = p.offsetPx;
    if (p.screen != null) state.screen = p.screen;
    if (p.reveal != null) state.reveal = p.reveal;
    kick();
  }

  function pointer(nx, ny) {
    tgtX = Math.max(-1, Math.min(1, nx));
    tgtY = Math.max(-1, Math.min(1, ny));
    kick();
  }

  function parallax(v) { parX = v; kick(); }

  function setVisible(v) {
    visible = v;
    if (v) kick();
  }

  function snapshot(maxW = 320) {
    resize();
    draw();
    const ratio = canvas.height / canvas.width;
    const w = Math.min(maxW, canvas.width);
    const h = Math.max(1, Math.round(w * ratio));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    return out.toDataURL('image/jpeg', 0.82);
  }

  function setPaper(hex) {
    PAPER = hexToRgb(hex);
    kick();
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (tex) { gl.deleteTexture(tex); tex = null; }
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
  }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (raf) cancelAnimationFrame(raf); raf = 0; });

  resize();
  kick();

  return {
    ok: true,
    gl,
    setImage, clearImage, setAtelier, setParams, pointer, parallax, setPaper,
    setVisible, snapshot, destroy,
    get hasImage() { return hasTex; },
    get aspect() { return texW && texH ? texW / texH : 1.6; }
  };
}

/* 无 WebGL 时的降级：用 Canvas2D 做一次性的四色加网静态图 */
export function createFallbackPress(canvas) {
  const ctx = canvas.getContext('2d');
  let img = null;
  let atelier = null;

  function draw() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * d));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * d));
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#E7E5DE';
    ctx.fillRect(0, 0, w, h);
    if (!img) return;

    const ar = img.width / img.height;
    const car = w / h;
    let dw = w, dh = h;
    if (car > ar) { dh = h; dw = h * ar; } else { dw = w; dh = w / ar; }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
    // 网点叠加让降级版仍然"像印刷"
    const cell = 6 * d;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const a = 0.05 + 0.05 * Math.random();
        ctx.fillStyle = `rgba(18,18,14,${a})`;
        ctx.fillRect(x, y, cell * 0.42, cell * 0.42);
      }
    }
  }

  return {
    ok: false,
    reason: 'fallback',
    setImage(src, w, h) { img = src; draw(); },
    clearImage() { img = null; draw(); },
    setAtelier(a) { atelier = a; draw(); },
    setParams() {},
    pointer() {},
    parallax() {},
    setVisible() {},
    snapshot() {
      const out = document.createElement('canvas');
      const s = Math.min(320, canvas.width) / canvas.width;
      out.width = Math.round(canvas.width * s);
      out.height = Math.round(canvas.height * s);
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.8);
    },
    destroy() {},
    get hasImage() { return !!img; }
  };
}
