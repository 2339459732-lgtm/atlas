/* ══════════════════════════════════════════════════════════════════
   skyfield.js — 点阵星空

   与上一版的根本区别：这里没有噪声。
   银河带由「确定性的星表 + 参数化的暗带」构成，
   每一颗光点的坐标、尺寸、亮度、色温、星芒都是可枚举、可复现的。

   导出三部分：
     SHADERS  —— 天空底色 / 星点 / 流星 的 GLSL 源码
     frame    —— 由机位反推银极、银心、银道基向量
     catalog  —— 按密度场逐点生成星表（种子固定，结果可复现）
   ══════════════════════════════════════════════════════════════════ */

/* ── 暗带（银河尘埃带）─────────────────────────────────────────────
   每一条都是可读的参数，不是随机噪声：
     b0  银纬中心（弧度）        amp 沿银道摆动的幅度
     k   摆动频率                ph  相位
     w   半宽（弧度）            d   遮挡强度 0–1                       */
export const LANES = [
  { b0: 0.003, amp: 0.018, k: 4.6, ph: 0.60, w: 0.0135, d: 0.80 },  /* 主暗带：宽而浅，读作区域而非线条 */
  { b0: -0.030, amp: 0.016, k: 6.2, ph: 2.40, w: 0.0092, d: 0.62 },
  { b0: 0.030, amp: 0.014, k: 5.4, ph: 4.10, w: 0.0078, d: 0.54 }
];

/* 色温配色：蓝白 → 正白 → 暖白 → 橙。索引即 aPack.z */
export const PALETTE = [
  [0.62, 0.76, 1.00],   /* 0 O/B 蓝白 */
  [0.78, 0.87, 1.00],   /* 1 A 白蓝   */
  [0.96, 0.97, 1.00],   /* 2 F 正白   */
  [1.00, 0.97, 0.90],   /* 3 G 暖白   */
  [1.00, 0.90, 0.72],   /* 4 K 浅橙   */
  [1.00, 0.78, 0.58]    /* 5 M 橙     */
];

/* 银河带在画面中的目标位置（0–1，y 自顶向下） */
export const LAYOUT = {
  bandY: 0.165,   /* 站内：亮脊从球体上缘升起，不被球体遮住 */
  coreX: 0.52,    /* 银心横向位置，与参考图一致 */
  width: 0.046     /* 亮脊半宽（弧度） */
};

/* ── 星点 ──────────────────────────────────────────────────────────
   点扩散函数：锐核 + 宽晕 + 十字星芒。全部在片元里解析求值，
   任何缩放下都是分辨率无关的锐点。 */
export const VS_STAR = `
attribute vec3 aDir;
attribute vec4 aPack;      /* x 尺寸  y 亮度  z 色温索引  w 随机种子 */
uniform mat4 uProj;
uniform mat4 uView;
uniform float uDpr;
uniform float uTime;
uniform float uStars;
varying float vA;
varying vec3 vC;
varying float vSpike;

vec3 palette(float i) {
  if (i < 0.5) return vec3(0.62, 0.76, 1.00);
  if (i < 1.5) return vec3(0.78, 0.87, 1.00);
  if (i < 2.5) return vec3(0.96, 0.97, 1.00);
  if (i < 3.5) return vec3(1.00, 0.97, 0.90);
  if (i < 4.5) return vec3(1.00, 0.90, 0.72);
  return vec3(1.00, 0.78, 0.58);
}

void main() {
  vec3 p = (uView * vec4(aDir, 0.0)).xyz;
  vec4 clip = uProj * vec4(p, 1.0);
  gl_Position = vec4(clip.xy, 0.9999 * clip.w, clip.w);

  float seed = fract(aPack.w);
  float px = aPack.x * uDpr;

  /* 亚像素星：撑到 2px 并按面积折算亮度，能量守恒。
     不做这一步，缓慢自转时整片星会「沙沙闪」。 */
  float boost = 1.0;
  if (px < 2.0) {
    boost = max(px * px, 0.04) * 0.25;
    px = 2.0;
  }
  gl_PointSize = px;

  /* 闪烁只给亮星，幅度极小 */
  float tw = 0.96 + 0.04 * sin(uTime * 0.85 + seed * 6.283);
  vA = uStars * aPack.y * boost * tw;
  vC = palette(aPack.z);
  vSpike = aPack.x > 4.4 ? 1.0 : 0.0;
}`;

export const FS_STAR = `
precision mediump float;
varying float vA;
varying vec3 vC;
varying float vSpike;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  /* 点扩散函数：高斯核 + 宽晕 */
  float core = exp(-r * r * 18.0);
  float halo = exp(-r * r * 3.4) * 0.16;
  float a = (core + halo) * vA;

  /* 亮星十字星芒：从中心向外线性衰减 */
  if (vSpike > 0.5) {
    float sx = max(0.0, 1.0 - abs(d.x) * 32.0);
    float sy = max(0.0, 1.0 - abs(d.y) * 32.0);
    a += (sx + sy) * (1.0 - r) * 0.30 * vA;
  }

  gl_FragColor = vec4(vC * a, a);
}`;

/* ── 天空底色 ──────────────────────────────────────────────────────
   没有任何噪声：底色 + 银道辉光 + 参数化暗带 + 暗角 + 抖动。
   辉光是干净的连续场，结构全部来自星点密度与暗带。 */
export const VS_QUAD = `
attribute vec2 aP;
varying vec2 vP;
void main() {
  vP = aP * 0.5 + 0.5;
  gl_Position = vec4(aP, 0.9999, 1.0);
}`;

export const FS_SKY = `
precision highp float;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uPole;
uniform vec3 uCore;
uniform vec3 uE1;
uniform vec3 uE2;
uniform vec3 uCool;
uniform vec3 uWarm;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uGlow;
uniform float uGrain;
uniform vec4 uLane[6];     /* b0, amp, k, ph */
uniform vec2 uLaneW[6];    /* 半宽, 强度  */
uniform float uLaneN;
varying vec2 vP;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

void main() {
  vec2 ndc = vP * 2.0 - 1.0;
  vec3 dir = normalize(uRight * (ndc.x * uTanHalf * uAspect) + uUp * (ndc.y * uTanHalf) + uFwd);

  float b = dot(dir, uPole);
  float l = atan(dot(dir, uE2), dot(dir, uE1));
  float core = pow(max(dot(dir, uCore), 0.0), 22.0);

  /* 沿银道的亮度包络：两端渐隐，中间最亮 */
  float env = 0.26 + 0.74 * exp(-pow(abs(l) / 1.62, 3.0));
  float spine = exp(-pow(abs(b) / 0.046, 2.0));
  float halo = exp(-pow(abs(b) / 0.115, 2.0));

  float clump = 0.64 + 0.26 * sin(3.1 * l + 9.0 * b)
                     + 0.17 * sin(6.9 * l - 15.0 * b + 1.7)
                     + 0.11 * sin(13.0 * l + 26.0 * b + 3.1);
  clump = max(0.18, clump);

  /* 银经包络的峰值与银心重合，两者的增益会叠乘，所以整体再压一个系数 */
  float d = (0.100 + 0.88 * spine + 0.26 * halo) * env * clump * (1.0 + 0.50 * core) * 0.56;

  /* 暗带：中心线沿银经起伏，宽度内实心、边缘在 0.45–1.0 之间收住，
     强度再沿银经呼吸一次，避免出现几条等宽的直线。 */
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uLaneN) break;
    float k = uLane[i].z;
    float bc = uLane[i].x + uLane[i].y * sin(k * (l - uLane[i].w));
    float t = abs(b - bc) / uLaneW[i].x;
    float core = smoothstep(1.0, 0.55, t);
    /* 沿银经的「呼吸」会归零，于是每条暗带自然断成数段——
       真实的尘埃带是断续的，而不是一条通到底的缎带。 */
    float g = sin(k * 0.63 * l + uLane[i].w * 1.7) * 0.5 + 0.5;
    float breathe = pow(g, 2.1) * 1.25;
    d *= 1.0 - uLaneW[i].y * breathe * core;
  }

  vec3 col = mix(uCool, uWarm, clamp(core * 0.70 + spine * 0.22, 0.0, 1.0)) * d * uGlow;
  col += mix(uBottom, uTop, smoothstep(0.0, 1.0, vP.y));

  float dd = distance(vP, vec2(0.5)) / 0.82;
  col *= pow(clamp(1.0 - dd * dd * 0.28, 0.0, 1.0), 0.9);

  col += (hash(vP * 2048.0) - 0.5) * uGrain;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/* ── 流星 ──────────────────────────────────────────────────────────
   轨迹是一条二次贝塞尔曲线；每颗粒子带一个 trail 参数 s。
   头部 s=0，尾巴 s=1。位置、尺寸、亮度全部由 s 决定，
   所以「头 → 尾」的形态过渡、亮度衰减是连续的，不是色块。 */
export const VS_METEOR = `
attribute vec3 aM;           /* x trail 参数  y 横向偏移  z 种子 */
uniform vec2 uP0;
uniform vec2 uC;
uniform vec2 uP1;
uniform float uHeadT;
uniform float uTrail;
uniform float uDpr;
uniform float uAlpha;
uniform float uAspect;
uniform float uSizeMul;
uniform float uAlphaMul;
varying float vA;
varying float vS;
varying float vSeed;

vec2 bez(vec2 a, vec2 c, vec2 b, float t) {
  float m = 1.0 - t;
  return m * m * a + 2.0 * m * t * c + t * t * b;
}
vec2 bezD(vec2 a, vec2 c, vec2 b, float t) {
  return 2.0 * (1.0 - t) * (c - a) + 2.0 * t * (b - c);
}

void main() {
  float t = uHeadT - aM.x * uTrail;

  if (t < -0.02 || t > 1.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vA = 0.0; vS = 1.0; vSeed = aM.z;
    return;
  }

  float tc = clamp(t, 0.0, 1.0);
  vec2 p = bez(uP0, uC, uP1, tc);
  vec2 tg = bezD(uP0, uC, uP1, tc);
  vec2 nm = normalize(vec2(-tg.y, tg.x) + vec2(0.0001));

  /* 粒子横向散开：越靠尾部越松，像烧蚀出来的碎屑。
     x 方向除以宽高比，保证散开在像素上是各向同性的。 */
  vec2 off = nm * aM.y * (0.0016 + 0.0105 * aM.x);
  off.x /= uAspect;
  gl_Position = vec4((p.x + off.x) * 2.0 - 1.0, 1.0 - (p.y + off.y) * 2.0, 0.9998, 1.0);

  /* 头部大而亮，尾部细而暗；四次方让衰减更接近真实的烧蚀 */
  float fade = pow(1.0 - aM.x, 2.4);
  gl_PointSize = max(0.9, mix(3.2, 0.7, pow(aM.x, 0.55)) * uDpr * uSizeMul);
  vA = uAlpha * uAlphaMul * fade * (0.42 + 0.58 * fract(aM.z * 9.71));
  vS = aM.x;
  vSeed = aM.z;
}`;

export const FS_METEOR = `
precision mediump float;
varying float vA;
varying float vS;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  /* 头部是白炽核，尾部偏冷；色温沿长度过渡 */
  vec3 hot = vec3(1.00, 0.99, 0.96);
  vec3 cold = vec3(0.72, 0.84, 1.00);
  vec3 c = mix(hot, cold, pow(vS, 0.7)) * vec3(1.0, 1.0 - 0.06 * vS, 1.0 - 0.16 * vS);

  float core = exp(-r * r * 16.0);
  float a = core * vA;
  gl_FragColor = vec4(c * a, a);
}`;

/* ══════════════════════════════════════════════════════════════════
   机位 → 银道坐标系
   给定相机基向量与「银道亮脊应落在画面的哪个高度」，
   反推出银极方向，使银道在屏幕上呈水平。
   ══════════════════════════════════════════════════════════════════ */
const nrm = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function cameraBasis(yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const e = [cp * Math.sin(yaw), sp, cp * Math.cos(yaw)];
  const fwd = nrm([-e[0], -e[1], -e[2]]);
  const right = nrm([fwd[1], -fwd[0], 0]);
  const up = crs(right, fwd);
  return { fwd, right, up };
}

export function frame({ yaw, pitch, bandY, coreX, aspect, tanHalf }) {
  const B = cameraBasis(yaw, pitch);
  const { fwd, right, up } = B;

  /* 亮脊在屏幕上的落点 → 该方向的单位向量 */
  const ndcY = 1 - 2 * bandY;
  const nearDir = nrm([
    fwd[0] + up[0] * (ndcY * tanHalf) * 1.0,
    fwd[1] + up[1] * (ndcY * tanHalf) * 1.0,
    fwd[2] + up[2] * (ndcY * tanHalf) * 1.0
  ]);

  /* 银极：同时垂直于「屏幕右方向」与「亮脊方向」→ 银道在屏上呈水平 */
  const pole = nrm(crs(right, nearDir));

  /* 银心：画面 (coreX, bandY) 处，再投影回银道面 */
  const ndcX = 2 * coreX - 1;
  const cd = [
    fwd[0] + right[0] * (ndcX * tanHalf * aspect) + up[0] * (ndcY * tanHalf),
    fwd[1] + right[1] * (ndcX * tanHalf * aspect) + up[1] * (ndcY * tanHalf),
    fwd[2] + right[2] * (ndcX * tanHalf * aspect) + up[2] * (ndcY * tanHalf)
  ];
  const core = nrm([0, 1, 2].map(i => cd[i] - pole[i] * dot3(cd, pole)));

  /* 银经零点对准银心：亮度包络 exp(-(l/L)³) 才会在 coreX 处达到峰值，
     否则最亮的一段会漂到画面边缘。 */
  const e1 = core;
  const e2 = nrm(crs(pole, e1));

  return { fwd, right, up, pole, core, e1, e2 };
}

/* ══════════════════════════════════════════════════════════════════
   星表
   密度场与天空着色器里的完全同构，因此光点分布与辉光严丝合缝。
   采用拒绝采样：先在球面上取均匀方向，再按密度接收。
   ══════════════════════════════════════════════════════════════════ */

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 银盘剖面：底色 + 窄亮脊 + 宽晕，三者相加后乘 cos(b) 得每单位立体角的密度 */
const BASE = 0.100;
const SPINE_A = 0.88, SPINE_W = 0.046;
const HALO_A = 0.26, HALO_W = 0.115;
const LONG_W = 1.62;
const CORE_BOOST = 1.15;
const PROFILE_MAX = BASE + SPINE_A + HALO_A;   /* b = 0 处 */

function profileOf(sb) {
  const t1 = sb / SPINE_W, t2 = sb / HALO_W;
  return (BASE + SPINE_A * Math.exp(-(t1 * t1)) + HALO_A * Math.exp(-(t2 * t2)));
}

/**
 * @returns {{ dir: Float32Array, pack: Float32Array, count: number }}
 *   dir  —— 每颗星的世界方向（单位向量）
 *   pack —— (尺寸, 亮度, 色温索引, 种子)
 *
 * 采样在「银纬 / 银经」角度空间里做，而不是在球面上做拒绝采样：
 * 前者每次尝试只要几次乘法和两个 exp，二十万颗星约 60ms；
 * 后者要反复采样整球，同样的数量级要 1.5s 以上。
 */
export function catalog({ count, pole, core, e1, e2, seed = 20261112 }) {
  const rnd = mulberry32(seed);

  const dir = new Float32Array(count * 3);
  const pack = new Float32Array(count * 4);

  /* 银道面内的正交基：任取一个与银极不平行的方向即可 */
  const ax = Math.abs(pole[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [
    pole[1] * ax[2] - pole[2] * ax[1],
    pole[2] * ax[0] - pole[0] * ax[2],
    pole[0] * ax[1] - pole[1] * ax[0]
  ];
  let n = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / n, u[1] / n, u[2] / n];
  const v = [
    pole[1] * u[2] - pole[2] * u[1],
    pole[2] * u[0] - pole[0] * u[2],
    pole[0] * u[1] - pole[1] * u[0]
  ];

  let i = 0, guard = 0, cap = count * 40;
  while (i < count && guard < cap) {
    guard++;

    /* 银纬：按剖面拒绝采样。cos(beta) 让每单位立体角的密度正确 */
    let beta = 0, sb = 0, ok = false;
    for (let k = 0; k < 24; k++) {
      beta = (rnd() * 2 - 1) * 1.5;
      sb = Math.abs(Math.sin(beta));
      if (rnd() * PROFILE_MAX <= profileOf(sb) * Math.cos(beta)) { ok = true; break; }
    }
    if (!ok) continue;

    /* 银经：均匀取样，再按亮度包络与暗带遮挡筛选 */
    const l = (rnd() * 2 - 1) * Math.PI;
    const al = Math.abs(l) / LONG_W;
    const env = 0.26 + 0.74 * Math.exp(-(al * al * al));
    if (rnd() > env) continue;

    /* 谐波团块：三组正弦叠加，确定性、可参数化，用来打破完美对称 */
    const bb0 = Math.sign(beta) * sb;
    let clump = 0.64 + 0.26 * Math.sin(3.1 * l + 9.0 * bb0)
                     + 0.17 * Math.sin(6.9 * l - 15.0 * bb0 + 1.7)
                     + 0.11 * Math.sin(13.0 * l + 26.0 * bb0 + 3.1);
    clump = Math.max(0.18, clump);
    if (rnd() > clump) continue;

    let keep = 1;
    const bb = Math.sign(beta) * sb;
    for (let q = 0; q < LANES.length; q++) {
      const L = LANES[q];
      const bc = L.b0 + L.amp * Math.sin(L.k * (l - L.ph));
      const t = Math.abs(bb - bc) / L.w;
      const core = 1 - smoothstep(0.55, 1.0, t);
      const g = Math.sin(L.k * 0.63 * l + L.ph * 1.7) * 0.5 + 0.5;
      const breathe = Math.pow(g, 2.1) * 1.25;
      keep *= 1 - L.d * breathe * core;
    }
    if (rnd() > keep) continue;

    const cb = Math.cos(beta), sbb = Math.sin(beta);
    const cl = Math.cos(l), sl = Math.sin(l);
    dir[i * 3] = pole[0] * sbb + (u[0] * cl + v[0] * sl) * cb;
    dir[i * 3 + 1] = pole[1] * sbb + (u[1] * cl + v[1] * sl) * cb;
    dir[i * 3 + 2] = pole[2] * sbb + (u[2] * cl + v[2] * sl) * cb;

    const x = dir[i * 3], y = dir[i * 3 + 1], z = dir[i * 3 + 2];
    const c0 = Math.max(0, x * core[0] + y * core[1] + z * core[2]);
    const coreF = Math.pow(c0, 8);

    /* 星等：四级幂律。亮星只占 0.2%，但体积与亮度都远高于暗星 */
    const m = rnd();
    let size, bright;
    if (m < 0.0020) { size = 5.2 + rnd() * 6.0; bright = 1.00; }
    else if (m < 0.0380) { size = 2.0 + rnd() * 2.1; bright = 0.86; }
    else if (m < 0.2400) { size = 1.15 + rnd() * 0.85; bright = 0.62; }
    else { size = 0.66 + Math.pow(rnd(), 1.9) * 0.80; bright = 0.30 + rnd() * 0.26; }

    /* 银心附近整体更亮：密度靠采样，亮度靠这一步 */
    bright *= 1 + 0.45 * coreF;

    /* 色温：绝大部分是白/暖白，蓝白与橙是少数 */
    const cq = rnd();
    let ci;
    if (cq < 0.06) ci = 0;
    else if (cq < 0.22) ci = 1;
    else if (cq < 0.56) ci = 2;
    else if (cq < 0.80) ci = 3;
    else if (cq < 0.94) ci = 4;
    else ci = 5;

    pack[i * 4] = size;
    pack[i * 4 + 1] = bright;
    pack[i * 4 + 2] = ci;
    pack[i * 4 + 3] = rnd();
    i++;
  }

  return { dir, pack, count: i };
}

/* ── 流星参数：单颗流星的完整生命曲线 ────────────────────────────── */
export const METEOR_SPEC = {
  particles: 220,        /* 每颗流星的粒子数 */
  glowParticles: 10,     /* 头部光晕粒子数 */
  life: 1.15,            /* 从出现到消失（秒） */
  trail: 0.34,           /* 拖尾占整条曲线的比例 */
  interval: [7, 15],     /* 间隔区间（秒） */
  /* 三条候选轨迹，起点→控制点→终点，均在 0–1 的屏幕坐标内 */
  paths: [
    { p0: [0.06, 0.10], c: [0.46, 0.26], p1: [0.86, 0.60] },
    { p0: [0.92, 0.06], c: [0.62, 0.30], p1: [0.24, 0.72] },
    { p0: [0.14, 0.66], c: [0.50, 0.70], p1: [0.90, 0.14] }
  ]
};
