/* ══════════════════════════════════════════════════════════════════
   skyfield.js — 星点星空

   这一版**没有银河带**。
   上一版用参数化银盘 + 尘埃带去"画"银河，在宽画幅下会摊成几条
   平滑的白色光带——那是装饰，不是天文。没有真实巡天数据支撑时，
   任何近似都会在某个视角露出破绽，所以整段移除。

   现在只有两件事：
     1. 极暗的天空底色（主题给的上下渐变 + 轻微暗角 + 颗粒）
     2. 球面上均匀分布、按星等分配尺寸与亮度的星点

   星表是确定性的：坐标、尺寸、亮度、色温都由固定种子生成，
   可枚举、可复现；不含银河密度场，也没有十字星芒。
   ══════════════════════════════════════════════════════════════════ */


/* ── 星点 ──────────────────────────────────────────────────────────
   点扩散函数：锐核 + 很淡的晕。没有星芒、没有光晕环——
   肉眼看到的星就是一个点，亮星也只是更大更亮一点。 */
export const VS_STAR = `
attribute vec3 aDir;
attribute vec4 aPack;      /* x 尺寸  y 亮度  z 色温索引  w 随机种子 */
uniform mat4 uProj;
uniform mat4 uView;
uniform float uDpr;
uniform float uTime;
uniform float uStars;
/* 与银河全景同参数的银道倾角/自转：星点与银道保持真实相对姿态 */
uniform float uSkyTilt;
uniform float uSkySpin;
varying float vA;
varying vec3 vC;
varying float vGlow;

/* B−V → 黑体温度（Ballesteros 2012）→ RGB（Tanner Helland 拟合） */
vec3 bvToRgb(float bv) {
  float t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
  vec3 c;
  if (t <= 6600.0) {
    float g = (99.4708 * log(t / 100.0) - 161.1196) / 255.0;
    float b = (138.5177 * log(t / 100.0) - 305.0448) / 255.0;
    c = vec3(1.0, clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0));
  } else {
    c = vec3(
      clamp(329.6987 * pow(t / 100.0 - 60.0, -0.1332) / 255.0, 0.0, 1.0),
      clamp(288.1222 * pow(t / 100.0 - 60.0, -0.0755) / 255.0, 0.0, 1.0),
      1.0
    );
  }
  return c;
}

void main() {
  /* 星表方向与银河采样同一套倾斜/自转 */
  float ct = cos(uSkyTilt), st = sin(uSkyTilt);
  vec3 d = vec3(aDir.x, aDir.y * ct - aDir.z * st, aDir.y * st + aDir.z * ct);
  float cs = cos(uSkySpin), ss = sin(uSkySpin);
  d = vec3(d.x * cs + d.z * ss, d.y, -d.x * ss + d.z * cs);

  vec3 p = (uView * vec4(d, 0.0)).xyz;
  vec4 clip = uProj * vec4(p, 1.0);
  gl_Position = vec4(clip.xy, 0.9999 * clip.w, clip.w);

  float seed = fract(aPack.w);
  float px = aPack.x * uDpr;

  /* 亚像素星：撑到 2px 并按面积折算亮度，能量守恒。
     不做这一步，缓慢自转时整片星会「沙沙闪」。 */
  float boost = 1.0;
  if (px < 2.0) {
    /* 亚像素星的能量摊到 2×2 上，按面积折算；
       0.06 的下限避免最暗的一批彻底消失 */
    boost = max(px * px, 0.06) * 0.35;
    px = 2.0;
  }
  gl_PointSize = px;

  /* 闪烁只给亮星，幅度极小（大气 scintillation，不是装饰） */
  float tw = 0.96 + 0.04 * sin(uTime * 0.85 + seed * 6.283);
  vA = uStars * aPack.y * boost * tw;
  vC = bvToRgb(aPack.z);
  /* 亮星（约 2 等以内）带一圈更宽的辉光，与暗星的紧凑光斑拉开层次 */
  vGlow = smoothstep(0.42, 0.6, aPack.y);
}`;

export const FS_STAR = `
precision mediump float;
varying float vA;
varying vec3 vC;
varying float vGlow;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  /* 高斯核 + 12% 的宽晕；2 等以内的亮星再叠一圈更宽的辉光。
     晕再大就会在暗底上摊成灰斑，所以辉光只给最亮的一批 */
  float core = exp(-r * r * 18.0);
  float halo = exp(-r * r * 3.8) * 0.12;
  float wide = exp(-r * r * 1.1) * 0.16 * vGlow;
  float a = (core + halo + wide) * vA;

  gl_FragColor = vec4(vC * a, a);
}`;

/* ── 星座连线 ──────────────────────────────────────────────────────
   顶点是单位方向（银道坐标），只有颜色与整体透明度两个 uniform。
   方向在相机背后的顶点被钳到近平面之外，线段自然在屏幕边缘裁切。 */
export const VS_LINE = `
attribute vec3 aDir;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uAlpha;
uniform float uSkyTilt;
uniform float uSkySpin;
varying float vA;
void main() {
  float ct = cos(uSkyTilt), st = sin(uSkyTilt);
  vec3 d = vec3(aDir.x, aDir.y * ct - aDir.z * st, aDir.y * st + aDir.z * ct);
  float cs = cos(uSkySpin), ss = sin(uSkySpin);
  d = vec3(d.x * cs + d.z * ss, d.y, -d.x * ss + d.z * cs);
  vec3 p = (uView * vec4(d, 0.0)).xyz;
  vA = uAlpha;
  /* 顶点在相机背后（或几乎平行视线）：丢出裁剪区。
     线段另一端照常投影，线条在屏幕边缘被干净地截断，
     不会出现跨越整个画面的长弦。 */
  if (p.z > -0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 clip = uProj * vec4(p, 1.0);
  gl_Position = vec4(clip.xy, 0.9998 * clip.w, clip.w);
}`;

export const FS_LINE = `
precision mediump float;
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA);
}`;

/* ── 天空底色 ──────────────────────────────────────────────────────
   只有上下渐变、暗角与颗粒。没有任何方向性结构，
   所以无论怎么转、怎么缩放，都不会出现"光带"。 */
export const VS_QUAD = `
attribute vec2 aP;
varying vec2 vP;
void main() {
  vP = aP * 0.5 + 0.5;
  gl_Position = vec4(aP, 0.9999, 1.0);
}`;

export const FS_SKY = `
precision highp float;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uGrain;

/* 银河：真实巡天全景（等距圆柱投影），按视线方向采样。
   天空不再是"画"出来的渐变，而是一张有真实尘埃带与核球的照片。 */
uniform sampler2D uSky;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform float uSkyGain;
uniform float uSkyTilt;
uniform float uSkySpin;
uniform float uSkyBias;
uniform float uSkyDust;
uniform float uSkyWarm;

varying vec2 vP;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}
float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
/* 3D 值噪声：锚定天球方向——随相机旋转稳定、经线处无接缝 */
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i), n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0)), n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0)), n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0)), n111 = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

vec2 dirToSky(vec3 d) {
  /* 先倾斜银道面，再转经度，让银河以自然的角度穿过画面，
     而不是永远水平地横在正中间 */
  float ct = cos(uSkyTilt), st = sin(uSkyTilt);
  d = vec3(d.x, d.y * ct - d.z * st, d.y * st + d.z * ct);
  float cs = cos(uSkySpin), ss = sin(uSkySpin);
  d = vec3(d.x * cs + d.z * ss, d.y, -d.x * ss + d.z * cs);

  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
}

void main() {
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, vP.y));

  if (uSkyGain > 0.001) {
    vec2 ndc = vP * 2.0 - 1.0;
    vec3 dir = normalize(uRight * (ndc.x * uTanHalf * uAspect)
                       + uUp * (ndc.y * uTanHalf)
                       + uFwd);
    /* 用高 mip 采样：全景图里的星点在这个视场下会被放成一片灰斑，
       把高频抹掉、只留下银道与尘埃带结构，清晰度交给星表去补。 */
    vec3 sky = texture2D(uSky, dirToSky(dir), uSkyBias).rgb;

    /* 压一下高光：银心再亮也不能变成一条白带 */
    sky = sky / (1.0 + sky * 1.35);
    /* 提一点尘埃带的对比，同时把底噪压掉，避免整片发灰 */
    sky = max(sky - 0.006, 0.0);
    /* 全景本身偏蓝紫；往中性拉 45%，再补一点暖，接近肉眼/长曝光的银道 */
    float luma = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    sky = mix(vec3(luma), sky, 0.55);

    /* 尘埃与星云质感：两组值噪声锚定天球方向（240/64 周），
       只在银道亮处浮现——暗空保持干净，不引入可见噪点 */
    float dust = vnoise3(dir * 240.0) * 0.62 + vnoise3(dir * 64.0) * 0.38;
    float band = clamp(luma * 4.0, 0.0, 1.0);
    sky += sky * (dust - 0.5) * uSkyDust * band;

    /* 暖调：银道偏暖、核球偏金，与冷色天顶拉开纵深 */
    sky *= mix(vec3(1.0), vec3(1.10, 1.02, 0.92), uSkyWarm * band);
    col += sky * uSkyGain;
  }

  /* 很轻的暗角：镜头感，而不是把四角压死 */
  float dd = distance(vP, vec2(0.5)) / 0.82;
  col *= pow(clamp(1.0 - dd * dd * 0.24, 0.0, 1.0), 0.9);

  /* 抖动颗粒：暗处重、亮处轻，专打 8bit 渐变在暗空里的色带 */
  float lcol = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += (hash(vP * 2048.0) - 0.5) * uGrain * (1.5 - 1.2 * clamp(lcol, 0.0, 1.0));
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/* ── 流星 ──────────────────────────────────────────────────────────
   轨迹是一条二次贝塞尔曲线；每颗粒子带一个 trail 参数 s。
   头部 s=0，尾巴 s=1。位置、尺寸、亮度全部由 s 决定。 */
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
   星表
   球面均匀采样（阿基米德螺旋的球面版本），
   再按星等分布决定尺寸与亮度。没有银河密度场。
   ══════════════════════════════════════════════════════════════════ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @returns {{ dir: Float32Array, pack: Float32Array, count: number }}
 *   dir  —— 每颗星的世界方向（单位向量）
 *   pack —— (尺寸, 亮度, 色温索引, 种子)
 */
export function catalog({ count, seed = 20261112 }) {
  const rnd = mulberry32(seed);
  const dir = new Float32Array(count * 3);
  const pack = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    /* 球面均匀：z 均匀，经度均匀 */
    const z = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const x = r * Math.cos(phi);
    const y = z;
    const zz = r * Math.sin(phi);

    dir[i * 3] = x;
    dir[i * 3 + 1] = y;
    dir[i * 3 + 2] = zz;

    /* 星等：四级幂律。亮星只占 0.15%，但尺寸与亮度都远高于暗星 */
    const m = rnd();
    let size, bright;
    if (m < 0.0015) { size = 4.2 + rnd() * 3.4; bright = 1.00; }
    else if (m < 0.0300) { size = 1.9 + rnd() * 1.7; bright = 0.86; }
    else if (m < 0.2200) { size = 1.05 + rnd() * 0.70; bright = 0.66; }
    else { size = 0.70 + Math.pow(rnd(), 1.9) * 0.70; bright = 0.40 + rnd() * 0.28; }

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
  }

  return { dir, pack, count };
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
