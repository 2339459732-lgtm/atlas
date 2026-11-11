/* ══════════════════════════════════════════════════════════════════
   earth.js — WebGL 实体地球
   昼面纹理 / 夜面灯光 / 海洋高光 / 独立云层 / 边缘大气 / 星空
   无第三方依赖。纹理：NASA Visible Earth（公有领域），经 three.js 示例分发。
   ══════════════════════════════════════════════════════════════════ */

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* 缩放范围：0.5 贴近地表，1.9 退到远轨，给足推拉空间 */
const MIN_DIST = 0.50;
const MAX_DIST = 1.90;

/* ── 极简矩阵工具（列主序） ── */
function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
  return out;
}
function lookAt(out, eye, center, up) {
  let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1; z0 /= len; z1 /= len; z2 /= len;
  let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2) || 1; x0 /= len; x1 /= len; x2 /= len;
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}
function mul(out, a, b) {
  /* 允许 out === a 或 out === b：先算到临时数组，避免边写边读 */
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    r[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    r[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    r[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    r[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  out.set(r);
  return out;
}
function rotY(out, r) {
  const c = Math.cos(r), s = Math.sin(r);
  out[0] = c; out[1] = 0; out[2] = -s; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = s; out[9] = 0; out[10] = c; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/* 经纬度 → 单位球坐标（与纹理对齐） */
function latLngToVec(lat, lng) {
  const la = lat * DEG, lo = lng * DEG;
  const c = Math.cos(la);
  return [-c * Math.cos(lo), Math.sin(la), c * Math.sin(lo)];
}

/* ── 着色器 ── */
const VS_SPHERE = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec2 vUV;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUV = aUV;
  vN = normalize((uModel * vec4(aPos, 0.0)).xyz);
  vW = (uModel * vec4(aPos, 1.0)).xyz;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FS_EARTH = `
precision highp float;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uSpec;
uniform sampler2D uNormal;
uniform sampler2D uCloudTex;
uniform vec3 uSun;
uniform vec3 uCam;
uniform vec3 uAtmo;
uniform float uAmbient;
uniform float uExposure;
uniform float uNightGain;
varying vec2 vUV;
varying vec3 vN;
varying vec3 vW;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 L = normalize(uSun);

  /* 法线贴图近似浮雕：把切线空间法线叠加到球面法线上 */
  vec3 nm = texture2D(uNormal, vUV).rgb * 2.0 - 1.0;
  N = normalize(N + vec3(nm.x, nm.y, nm.z * 0.55) * 0.34);

  float cloud = texture2D(uCloudTex, vUV).a;

  float ndl = dot(N, L);
  float day = smoothstep(-0.075, 0.17, ndl);

  vec3 dayC = pow(texture2D(uDay, vUV).rgb, vec3(2.2));
  /* 4K 源图偏艳，统一压掉约 10% 饱和，让 1K/2K/4K 三档观感一致 */
  float dLum = dot(dayC, vec3(0.299, 0.587, 0.114));
  dayC = mix(vec3(dLum), dayC, 0.9);
  /* 夜图带一点紫底色，取高次幂压掉，只留城市的灯 */
  /* ── 夜面染色 ──
     不再直接使用夜图的 RGB（那会让灯光带上一层青绿），而是只取亮度，
     再用一条暖色带重新上色：核心接近白炽，边缘偏琥珀。 */
  vec3 nightTex = texture2D(uNight, vUV).rgb;
  float nMax = max(max(nightTex.r, nightTex.g), nightTex.b);
  float lights = smoothstep(0.10, 0.66, nMax);   /* 主城区 */
  float halo = smoothstep(0.02, 0.52, nMax);     /* 周边辉光 */

  vec3 warmCore = vec3(1.00, 0.86, 0.60);
  vec3 warmEdge = vec3(0.92, 0.55, 0.24);
  vec3 lightCol = mix(warmEdge, warmCore, lights);
  /* 只让成片的水面有镜面高光，湖泊/噪点不会变成蓝点 */
  float ocean = smoothstep(0.28, 0.72, texture2D(uSpec, vUV).r);

  /* 云影：云层下方略压暗 */
  dayC *= mix(1.0, 0.82, cloud);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 900.0) * ocean * 0.22;

  vec3 lit = dayC * (uAmbient + max(ndl, 0.0) * 1.28);
  lit += vec3(1.0, 0.96, 0.88) * spec * smoothstep(0.05, 0.35, ndl);
  lit += dayC * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;

  /* 夜面 = 城市灯光 + 一层极弱的冷色地面。
     地面用海陆掩码区分明暗，否则整块大陆和海洋糊成一片。 */
  float landMask = 1.0 - ocean;
  /* 地面亮度：抬到能辨认大陆轮廓，但仍远低于灯光 */
  vec3 ground = vec3(0.019, 0.023, 0.031) * (0.34 + 0.66 * landMask);

  float term = smoothstep(0.08, -0.20, ndl);
  vec3 dark = (lightCol * (lights * 1.55 + halo * 0.20) + ground) * term * uNightGain;

  vec3 col = mix(dark, lit, day);

  /* 边缘大气 */
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.6);
  col += uAtmo * fres * (0.12 + 0.88 * day);

  col = aces(col * uExposure);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

const FS_CLOUD = `
precision highp float;
uniform sampler2D uClouds;
uniform vec3 uSun;
uniform vec3 uCam;
uniform float uOpacity;
uniform float uExposure;
varying vec2 vUV;
varying vec3 vN;
varying vec3 vW;

void main() {
  float a = texture2D(uClouds, vUV).a;
  if (a < 0.004) discard;

  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.12, 0.42, ndl);

  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  /* 夜面的云几乎不可见，否则会给整块大陆蒙一层蓝灰纱 */
  vec3 shade = mix(vec3(0.016, 0.020, 0.028), vec3(1.0), lit);
  shade += vec3(0.5, 0.62, 0.8) * rim * 0.18 * lit;
  shade *= uExposure;

  gl_FragColor = vec4(shade, a * uOpacity * (0.05 + 0.95 * lit));
}`;

const FS_ATMO = `
precision highp float;
uniform vec3 uAtmo;
uniform vec3 uCam;
uniform vec3 uSun;
uniform float uIntensity;
varying vec2 vUV;
varying vec3 vN;
varying vec3 vW;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float f = pow(1.0 - abs(dot(N, V)), 3.2);
  float sun = smoothstep(-0.45, 0.5, dot(N, normalize(uSun)));
  float a = f * uIntensity * (0.35 + 0.65 * sun);
  gl_FragColor = vec4(uAtmo * a, a);
}`;

const VS_MOTE = `
attribute vec3 aPos;
attribute float aSize;
attribute float aPhase;
uniform mat4 uMVP;
uniform float uTime;
uniform float uDpr;
varying float vA;
void main() {
  float ang = uTime * 0.018 + aPhase;
  float c = cos(ang), s = sin(ang);
  vec3 p = vec3(c * aPos.x + s * aPos.z, aPos.y + sin(uTime * 0.05 + aPhase * 3.0) * 0.12, -s * aPos.x + c * aPos.z);
  gl_Position = uMVP * vec4(p, 1.0);
  gl_PointSize = aSize * uDpr * 1.6;
  vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.45 + aPhase * 6.28));
}`;

const FS_MOTE = `
precision mediump float;
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = pow(smoothstep(0.5, 0.0, r), 2.2) * vA;
  gl_FragColor = vec4(uColor * a, a);
}`;

const VS_BG = `
attribute vec2 aP;
varying vec2 vP;
void main() {
  vP = aP * 0.5 + 0.5;
  gl_Position = vec4(aP, 0.9999, 1.0);
}`;

const FS_NEB = `
precision highp float;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uPole;      /* 银极方向（世界坐标，单位向量） */
uniform vec3 uCore;      /* 银心方向 */
uniform float uOct;      /* 噪声阶数，随画质自适应 */
varying vec2 vP;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

/* 三维值噪声：定义在方向域上，因此没有经纬接缝，也不会随视角拉伸 */
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm(vec3 p, float oct) {
  float v = 0.0;
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= oct) break;
    v += a * vnoise(p);
    s += a;
    p = p * 2.04 + 13.7;
    a *= 0.5;
  }
  return v / max(s, 0.0001);
}

void main() {
  vec2 ndc = vP * 2.0 - 1.0;
  vec3 dir = normalize(uRight * (ndc.x * uTanHalf * uAspect) + uUp * (ndc.y * uTanHalf) - uFwd);

  /* 银道分解：b 为银纬正弦，par 沿银极，perp 落在银盘内 */
  float b = dot(dir, uPole);
  vec3 par = uPole * b;
  vec3 perp = dir - par;

  float band = exp(-pow(abs(b) * 3.30, 2.0));
  band *= smoothstep(1.30, 0.20, abs(b));   /* 边缘柔和收束，不留硬边 */

  float coreAng = max(0.0, dot(dir, uCore));
  float core = pow(coreAng, 8.0);

  /* 云气：低频定轮廓 → 中频出脊 → 高频补颗粒 */
  float n1 = fbm(dir * 2.35 + 4.1, uOct);
  float n2 = fbm(dir * 6.80 + 19.3, max(uOct - 1.0, 2.0));
  float n3 = vnoise(dir * 26.0 + 41.7);

  float ridge = 1.0 - abs(n1 * 2.0 - 1.0);
  float cloud = ridge * 0.52 + n2 * 0.48;
  cloud = pow(clamp(cloud, 0.0, 1.0), 1.35);

  float dens = band * (0.28 + 1.30 * cloud) * (0.50 + 1.30 * core);
  dens += core * band * 0.60;

  /* 暗尘：沿银极压扁，形成平行于银盘的丝状遮挡 */
  vec3 dq = par * 22.0 + perp * 6.4 + 27.7;
  float dust = fbm(dq, 3.0);
  dust = smoothstep(0.40, 0.86, dust);
  dens *= 1.0 - 0.74 * dust * band;

  /* 色调：银心暖琥珀 → 外围冷蓝 */
  vec3 cool = vec3(0.30, 0.40, 0.64);
  vec3 warm = vec3(0.95, 0.70, 0.44);
  vec3 col = mix(cool, warm, clamp(core * 0.90 + cloud * 0.30, 0.0, 1.0));
  col *= dens;

  /* 未分辨星团的颗粒感，压掉大面积平滑 */
  col *= 0.84 + 0.32 * n3;

  gl_FragColor = vec4(col, 1.0);
}`;

const FS_BG = `
precision highp float;
uniform sampler2D uNeb;
uniform float uHasNeb;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uGrain;
uniform float uNebula;
uniform float uTime;
varying vec2 vP;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float meteor(vec2 uv, vec2 head, vec2 dir, float len, float width) {
  vec2 tail = head - dir * len;
  vec2 d = uv - tail;
  float t = clamp(dot(d, dir) / len, 0.0, 1.0);
  vec2 closest = tail + dir * t * len;
  float dist = length(uv - closest);
  float w = width * (1.0 - 0.85 * t);
  return smoothstep(w, 0.0, dist) * t * t;
}

void main() {
  vec2 uv = vP;
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, uv.y));

  /* 深空底色：极淡的冷调，避免死黑 */
  col += vec3(0.0045, 0.0062, 0.0115) * (0.55 + 0.45 * (1.0 - uv.y));

  /* 星云：半分辨率解析生成后双线性上采样，只贡献低频结构 */
  if (uHasNeb > 0.5) {
    col += texture2D(uNeb, uv).rgb * uNebula * 0.62;
  }

  /* 流星 */
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float period = 9.5 + fi * 6.3;
    float tt = uTime + fi * 4.7;
    float cyc = floor(tt / period);
    float ph = fract(tt / period);
    float dur = 0.16;
    float k = ph / dur;
    if (k < 1.0) {
      float r1 = hash(vec2(cyc, fi + 1.3));
      float r2 = hash(vec2(cyc + 9.1, fi + 5.7));
      vec2 start = vec2(-0.20 + r1 * 0.95, 0.62 + r2 * 0.22);
      vec2 dirv = normalize(vec2(0.90, -0.46));
      vec2 head = start + dirv * k * 0.78;
      float s = meteor(uv, head, dirv, 0.26, 0.0042);
      float fade = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.75, 1.0, k));
      col += vec3(0.90, 0.95, 1.0) * s * fade * 1.8;
      col += vec3(0.62, 0.74, 1.0) * pow(s, 0.55) * fade * 0.30;
      float headGlow = smoothstep(0.014, 0.0, length(uv - head));
      col += vec3(1.0, 0.99, 0.96) * headGlow * fade * 1.1;
    }
  }

  /* 四角压暗 */
  float dd = distance(uv, vec2(0.5)) / 0.86;
  col *= pow(clamp(1.0 - dd * dd * 0.30, 0.0, 1.0), 0.9);

  /* 有序抖动：16bit 级噪声，抹掉 8bit 输出在暗部的色带 */
  float dth = hash(uv * 2048.0) + hash(uv * 977.0 + 5.0) - 1.0;
  col += dth * max(uGrain, 0.0016);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const VS_STAR = `
attribute vec3 aDir;
attribute vec3 aCol;
attribute float aSize;
attribute float aBright;
attribute float aSeed;
attribute float aSpike;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uDpr;
uniform float uTime;
uniform float uStars;
varying float vA;
varying vec3 vC;
varying float vSpike;
void main() {
  vec3 p = (uView * vec4(aDir, 0.0)).xyz;
  vec4 clip = uProj * vec4(p, 1.0);
  gl_Position = vec4(clip.xy, 0.9999 * clip.w, clip.w);

  float px = aSize * uDpr;
  /* 亚像素星：撑到 2px 并按面积折回亮度，能量守恒，转动时不会忽明忽暗 */
  float boost = 1.0;
  if (px < 2.0) {
    boost = max(px * px, 0.04) * 0.25;
    px = 2.0;
  }
  gl_PointSize = px;

  /* 闪烁只在亮星上可见，幅度极小 */
  float tw = 0.94 + 0.06 * sin(uTime * 0.9 + aSeed * 6.283);
  vA = uStars * aBright * boost * tw * (0.55 + 0.45 * aSpike);
  vC = aCol;
  vSpike = aSpike;
}`;

const FS_STAR = `
precision mediump float;
varying float vA;
varying vec3 vC;
varying float vSpike;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  /* 点扩散函数：高斯核 + 宽晕，模拟成像系统的光学响应 */
  float core = exp(-r * r * 17.0);
  float halo = exp(-r * r * 3.6) * 0.18;
  float a = (core + halo) * vA;

  /* 亮星的十字衍射星芒 */
  if (vSpike > 0.5) {
    float sx = max(0.0, 1.0 - abs(d.x) * 34.0);
    float sy = max(0.0, 1.0 - abs(d.y) * 34.0);
    a += (sx + sy) * (1.0 - r) * 0.32 * vA;
  }

  gl_FragColor = vec4(vC * a, a);
}`;

/* ── 几何 ── */
function buildSphere(seg, rings, radius) {
  const pos = [], uv = [], idx = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    const lat = Math.PI / 2 - phi;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x <= seg; x++) {
      const u = x / seg;
      const th = u * Math.PI * 2;
      pos.push(cl * Math.cos(th) * radius, sl * radius, cl * Math.sin(th) * radius);
      /* u 翻转：纠正纹理与球面绕序不一致造成的东/西镜像 */
      uv.push(1 - u, 1 - v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

export function createEarth(canvas, opts = {}) {
  const onPick = opts.onPick || (() => {});
  const onEmpty = opts.onEmpty || (() => {});
  const onHover = opts.onHover || (() => {});
  const onReady = opts.onReady || (() => {});
  const onProject = opts.onProject || (() => {});

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' })
    || canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { onReady({ ok: false }); return null; }

  /* 显卡驱动回收上下文时不崩页面：暂停绘制，恢复后重新载入贴图 */
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    state.running = false;
    state.ready = false;
    skyFbo = null; skyTex = null; skyW = 0; skyH = 0; skyOk = false;
    console.warn('[earth] context lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[earth] context restored');
    state.running = true;
    load().catch(() => {});
  });

  const mobile = matchMedia('(max-width: 860px)').matches;
  const SEG = mobile ? 96 : 176;
  const RINGS = mobile ? 64 : 128;

  const state = {
    /* 初始视角：以中国（约 105°E）为正面，俯角 23°，略偏东 */
    yaw: 0.30, pitch: 0.40, dist: 1, distTo: 1, spin: 0.04,
    targetYaw: null, targetPitch: null,
    velYaw: 0, velPitch: 0,
    auto: true, hovered: null, ready: false,
    dpr: 1, w: 0, h: 0, baseDist: 3.6, quality: 1,
    dragging: false, moved: 0, last: null,
    sunYaw: 0, t: 0, sunGeo: null
  };

  /* ── 程序 ── */
  function compile(type, src, name) {
    const s = gl.createShader(type);
    if (!s) { console.error('[earth] createShader null, lost=', gl.isContextLost()); throw new Error('createShader ' + name); }
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error('[earth] shader fail:', name, JSON.stringify(log));
      throw new Error(name + ' ' + log);
    }
    return s;
  }
  function program(vs, fs, attrs, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, name + ':vs'));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, name + ':fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const out = { p, a: {}, u: {} };
    Object.keys(attrs).forEach(k => { out.a[k] = gl.getAttribLocation(p, k); });
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      out.u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return out;
  }

  let progEarth, progCloud, progAtmo, progBg, progNeb, progStar, progMote;

  const sphere = buildSphere(SEG, RINGS, 1);
  const cloudGeo = buildSphere(SEG, RINGS, 1.012);
  const atmoGeo = buildSphere(Math.max(48, SEG / 2), Math.max(32, RINGS / 2), 1.09);

  function buffer(data, target = gl.ARRAY_BUFFER) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }
  const buf = {
    pos: buffer(sphere.pos), uv: buffer(sphere.uv),
    idx: buffer(sphere.idx, gl.ELEMENT_ARRAY_BUFFER),
    cpos: buffer(cloudGeo.pos), cuv: buffer(cloudGeo.uv),
    cidx: buffer(cloudGeo.idx, gl.ELEMENT_ARRAY_BUFFER),
    apos: buffer(atmoGeo.pos),
    aidx: buffer(atmoGeo.idx, gl.ELEMENT_ARRAY_BUFFER),
    quad: buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
  };

  /* ── 星空 ──
     不是随机撒点：按真实天球的分布规律生成——
     银盘内星密度远高于银极，银心方向再叠一团；
     星等按幂律分布（暗星占绝大多数）；色温取自黑体的稀疏采样。 */

  const nrm = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  /* 由初始机位反推银极与银心：银道与视轴成 17°，斜穿画面；银心贴近球体边缘 */
  const GAL = (() => {
    const cp = Math.cos(0.40), sp = Math.sin(0.40);
    const e = [cp * Math.sin(0.30), sp, cp * Math.cos(0.30)];
    const fwd = nrm([-e[0], -e[1], -e[2]]);
    const rgt = nrm([fwd[1], -fwd[0], 0]);
    const upv = crs(rgt, fwd);
    const off = 0.30;                       /* 银道到视轴的角距（弧度） */
    const lean = 0.55;
    const pole = nrm([
      fwd[0] * Math.sin(off) + 0.94 * (rgt[0] * Math.cos(lean) + upv[0] * Math.sin(lean)),
      fwd[1] * Math.sin(off) + 0.94 * (rgt[1] * Math.cos(lean) + upv[1] * Math.sin(lean)),
      fwd[2] * Math.sin(off) + 0.94 * (rgt[2] * Math.cos(lean) + upv[2] * Math.sin(lean))
    ]);
    /* 银道面内离视轴最近的方向，再沿银道偏 24°，避免正对球心 */
    const near = nrm([fwd[0] - pole[0] * dot3(fwd, pole), fwd[1] - pole[1] * dot3(fwd, pole), fwd[2] - pole[2] * dot3(fwd, pole)]);
    const tang = nrm(crs(pole, near));
    const dl = 0.42;
    const core = nrm([
      near[0] * Math.cos(dl) + tang[0] * Math.sin(dl),
      near[1] * Math.cos(dl) + tang[1] * Math.sin(dl),
      near[2] * Math.cos(dl) + tang[2] * Math.sin(dl)
    ]);
    const e1 = nrm(crs(pole, [0, 1, 0]));
    const e2 = nrm(crs(pole, e1));
    const cu = nrm(crs(core, [0, 1, 0]));
    const cv = nrm(crs(core, cu));
    return { pole, core, e1, e2, cu, cv };
  })();

  const starCount = mobile ? 3400 : 9000;
  const starDir = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starBright = new Float32Array(starCount);
  const starSeed = new Float32Array(starCount);
  const starSpike = new Float32Array(starCount);

  /* 色温采样：蓝白 A/B → 正白 F/G → 浅黄 → 橙 K/M，权重照肉眼可见星的比例 */
  const TEMPS = [
    [0.63, 0.76, 1.00, 0.14],
    [0.80, 0.87, 1.00, 0.22],
    [1.00, 0.98, 0.95, 0.28],
    [1.00, 0.93, 0.80, 0.20],
    [1.00, 0.80, 0.58, 0.12],
    [1.00, 0.68, 0.46, 0.04]
  ];
  const pickColor = () => {
    let r = Math.random();
    for (const t of TEMPS) { if (r < t[3]) return [t[0], t[1], t[2]]; r -= t[3]; }
    return [1, 0.98, 0.95];
  };

  for (let i = 0; i < starCount; i++) {
    const roll = Math.random();
    let d;

    if (roll < 0.26) {
      /* 各向同性背景 */
      const z = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      d = [r * Math.cos(th), z, r * Math.sin(th)];
    } else if (roll < 0.74) {
      /* 银盘：|b| 指数衰减，星密集在 ±8° 内 */
      const b = (Math.random() < 0.5 ? 1 : -1) * Math.pow(Math.random(), 2.0) * 0.30;
      const l = Math.random() * Math.PI * 2;
      const cb = Math.cos(b), sb = Math.sin(b);
      const cl = Math.cos(l), sl = Math.sin(l);
      d = nrm([
        GAL.pole[0] * sb + (GAL.e1[0] * cl + GAL.e2[0] * sl) * cb,
        GAL.pole[1] * sb + (GAL.e1[1] * cl + GAL.e2[1] * sl) * cb,
        GAL.pole[2] * sb + (GAL.e1[2] * cl + GAL.e2[2] * sl) * cb
      ]);
    } else {
      /* 银心星云：24° 锥内的高斯团 */
      const ct = 1 - Math.random() * (1 - Math.cos(0.42));
      const th = Math.acos(Math.min(1, Math.max(-1, ct)));
      const ph = Math.random() * Math.PI * 2;
      const sp = Math.sin(th), cp2 = Math.cos(th);
      d = nrm([
        GAL.core[0] * cp2 + (GAL.cu[0] * Math.cos(ph) + GAL.cv[0] * Math.sin(ph)) * sp,
        GAL.core[1] * cp2 + (GAL.cu[1] * Math.cos(ph) + GAL.cv[1] * Math.sin(ph)) * sp,
        GAL.core[2] * cp2 + (GAL.cu[2] * Math.cos(ph) + GAL.cv[2] * Math.sin(ph)) * sp
      ]);
    }

    starDir[i * 3] = d[0];
    starDir[i * 3 + 1] = d[1];
    starDir[i * 3 + 2] = d[2];

    const c = pickColor();
    starCol[i * 3] = c[0]; starCol[i * 3 + 1] = c[1]; starCol[i * 3 + 2] = c[2];

    /* 星等：四级分布，亮星极少但很亮 */
    const q = Math.random();
    let size, bright;
    if (q < 0.0035) { size = 5.0 + Math.random() * 6.0; bright = 1.00; }
    else if (q < 0.050) { size = 2.1 + Math.random() * 2.0; bright = 0.84; }
    else if (q < 0.280) { size = 1.15 + Math.random() * 0.85; bright = 0.60; }
    else { size = 0.55 + Math.pow(Math.random(), 1.8) * 0.80; bright = 0.28 + Math.random() * 0.26; }

    starSize[i] = size;
    starBright[i] = bright;
    starSpike[i] = size > 4.4 ? 1 : 0;
    starSeed[i] = Math.random();
  }

  const starBuf = {
    dir: buffer(starDir), col: buffer(starCol), size: buffer(starSize),
    bright: buffer(starBright), seed: buffer(starSeed), spike: buffer(starSpike)
  };

  /* 缓慢移动的光点 */
  const moteCount = mobile ? 60 : 110;
  const motePos = new Float32Array(moteCount * 3);
  const moteSize = new Float32Array(moteCount);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 4.6 + Math.random() * 4.2;
    const q = Math.sqrt(1 - u * u);
    motePos[i * 3] = r * q * Math.cos(th);
    motePos[i * 3 + 1] = r * u * 0.55;
    motePos[i * 3 + 2] = r * q * Math.sin(th);
    moteSize[i] = Math.random() < 0.8 ? 0.7 + Math.random() * 1.1 : 1.8 + Math.random() * 2.2;
    motePhase[i] = Math.random();
  }
  const moteBuf = {
    pos: buffer(motePos), size: buffer(moteSize), phase: buffer(motePhase)
  };

  /* ── 纹理 ── */
  /* 文件名里已经带分辨率后缀，这里只拼目录，别再追加（否则会出现 x-1k-1k） */
  const texUrl = (name) => `assets/tex/${name}`;
  /* 两档贴图：先铺低清保证出图速度，桌面端再后台换成高清 */
  const texLow = {
    day: 'earth-day-1k.jpg',
    night: 'earth-night-1k.jpg',
    clouds: 'earth-clouds-1k.png',
    spec: 'earth-specular-1k.jpg',
    normal: 'earth-normal.jpg'
  };
  /* 画质档位：1K 极速 / 2K 标准 / 4K 精细（4K 换了 3840×1920 的白昼图） */
  const TIERS = {
    '1k': { day: 'earth-day-1k.jpg', night: 'earth-night-1k.jpg', spec: 'earth-specular-1k.jpg' },
    '2k': { day: 'earth-day.jpg', night: 'earth-night.png', spec: 'earth-specular.jpg' },
    '4k': { day: 'earth-day-4k.jpg', night: 'earth-night.png', spec: 'earth-specular.jpg' }
  };
  let tier = '2k';
  const textures = {};

  /* 1×1 占位纹理：让着色器始终有东西可采样，等真图到了再替换 */
  function blank(r, g, b, a) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('tex ' + url));
      img.src = url;
    });
  }
  function upload(img, mip) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    const an = gl.getExtension('EXT_texture_filter_anisotropic')
      || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (an) {
      const max = gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, max));
    }
    return t;
  }

  function buildPrograms() {
    progBg = program(VS_BG, FS_BG, { aP: 'aP' }, 'bg');
    progNeb = program(VS_BG, FS_NEB, { aP: 'aP' }, 'neb');
    progStar = program(VS_STAR, FS_STAR, { aDir: 'aDir', aCol: 'aCol', aSize: 'aSize', aBright: 'aBright', aSeed: 'aSeed', aSpike: 'aSpike' }, 'star');
    progEarth = program(VS_SPHERE, FS_EARTH, { aPos: 'aPos', aUV: 'aUV' }, 'earth');
    progCloud = program(VS_SPHERE, FS_CLOUD, { aPos: 'aPos', aUV: 'aUV' }, 'cloud');
    progAtmo = program(VS_SPHERE, FS_ATMO, { aPos: 'aPos', aUV: 'aUV' }, 'atmo');
    progMote = program(VS_MOTE, FS_MOTE, { aPos: 'aPos', aSize: 'aSize', aPhase: 'aPhase' }, 'mote');
  }

  /* 切档：先换白昼图（最显眼），其余并行替换；旧纹理等新的就绪才释放 */
  async function applyTier(name, onProgress) {
    const t = TIERS[name];
    if (!t) return false;
    const keys = Object.keys(t);
    let done = 0;
    const step = () => { done++; onProgress?.(done / keys.length); };

    if (t.day) {
      try {
        const img = await loadImage(texUrl(t.day));
        const next = upload(img, true);
        if (textures.day) gl.deleteTexture(textures.day);
        textures.day = next;
      } catch (e) {
        console.warn('[earth] 白昼贴图切换失败', e);
      }
      step();
    }

    await Promise.all(keys.filter(k => k !== 'day').map(async k => {
      try {
        const img = await loadImage(texUrl(t[k]));
        const next = upload(img, true);
        if (textures[k]) gl.deleteTexture(textures[k]);
        textures[k] = next;
      } catch (e) {
        console.warn('[earth] 贴图切换失败 ' + k, e);
      }
      step();
    }));

    tier = name;
    return true;
  }

  async function load(progress) {
    try {
      /* 刚拿到的上下文可能还没完成 GPU 侧初始化，先等一帧，再退避重试 */
      await new Promise(r => requestAnimationFrame(() => r()));
      let built = false;
      for (let attempt = 0; attempt < 4 && !built; attempt++) {
        try {
          buildPrograms();
          built = true;
        } catch (err) {
          if (attempt === 3) throw err;
          await new Promise(r => setTimeout(r, 140));
        }
      }

      /* 先铺占位：云层透明、法线平整、其余留黑，画面不会因为缺图而错乱 */
      textures.night = blank(0, 0, 0, 255);
      textures.clouds = blank(0, 0, 0, 0);
      textures.spec = blank(0, 0, 0, 255);
      textures.normal = blank(128, 128, 255, 255);
      textures.day = blank(16, 24, 40, 255);
      progress?.(0.06);

      /* 先用最小的一张把球体点亮（约 90 KB），交互立刻可用 */
      try {
        const img = await loadImage(texUrl(texLow.day));
        gl.deleteTexture(textures.day);
        textures.day = upload(img, true);
      } catch (e) {
        console.warn('[earth] 白昼贴图失败，用纯色顶上', e);
      }
      state.ready = true;
      onReady({ ok: true, partial: true });
      progress?.(0.35);

      /* 低清全套并行补齐 */
      const rest = ['night', 'clouds', 'spec', 'normal'];
      let done = 0;
      await Promise.all(rest.map(async k => {
        try {
          const img = await loadImage(texUrl(texLow[k]));
          if (textures[k]) gl.deleteTexture(textures[k]);
          textures[k] = upload(img, true);
        } catch (e) {
          console.warn('[earth] 跳过贴图 ' + k, e);
        }
        done++;
        progress?.(0.35 + 0.5 * (done / rest.length));
      }));

      /* 按当前档位补齐；移动端默认停在 1K 省流量 */
      if (tier !== '1k') {
        await applyTier(tier, p => progress?.(0.6 + 0.4 * p));
      }

      onReady({ ok: true });
    } catch (e) {
      console.error('[earth] load failed:', e);
      onReady({ ok: false, error: String(e) });
    }
  }

  /* ── 尺寸 ── */
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    /* 画质系数由帧率自适应决定：卡了降分辨率，稳了再升回去 */
    const dpr = Math.min(mobile ? 2 : 1.75, window.devicePixelRatio || 1) * state.quality;
    state.dpr = dpr;
    state.w = r.width; state.h = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    fit();
  }

  function fit() {
    const aspect = state.w / state.h || 1;
    const fov = 30 * DEG;
    const k = 0.74;   /* 球体留出安全边距，避免被舞台边缘裁切 */
    const needV = 1 / (k * Math.tan(fov / 2));
    const needH = 1 / (k * Math.tan(fov / 2) * aspect);
    state.baseDist = Math.max(needV, needH);
  }

  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const model = new Float32Array(16);
  const mvp = new Float32Array(16);

  function cameraEye() {
    const d = state.baseDist * state.dist;
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    return [d * cp * sy, d * sp, d * cp * cy];
  }

  function frame(now) {
    if (!state.running) return;
    const t = now * 0.001;
    const rawDt = t - (state.t || t);
    const dt = Math.min(0.05, rawDt);
    state.t = t;

    /* 每 90 帧评估一次帧率，动态调整渲染分辨率 */
    state._acc = (state._acc || 0) + rawDt;
    state._cnt = (state._cnt || 0) + 1;
    if (state._cnt >= 90) {
      const avg = state._acc / state._cnt;
      state._acc = 0; state._cnt = 0;
      if (avg > 0.033 && state.quality > 0.8) {
        state.quality = Math.max(0.8, state.quality - 0.1);
        resize();
      } else if (avg < 0.014 && state.quality < 1) {
        state.quality = Math.min(1, state.quality + 0.06);
        resize();
      }
    }

    if (state.ready) {
      /* 自转 */
      if (state.auto && !state.dragging) state.spin += dt * 0.018;   /* 约 1°/s，缓慢自西向东 */

      /* 缩放阻尼：滚轮/按钮改的是目标值，这里平滑追上去 */
      if (Math.abs(state.distTo - state.dist) > 0.0002) {
        state.dist += (state.distTo - state.dist) * Math.min(1, dt * 9);
      } else if (state.dist !== state.distTo) {
        state.dist = state.distTo;
      }

      /* 视角阻尼 */
      if (state.targetYaw != null) {
        state.yaw += (state.targetYaw - state.yaw) * Math.min(1, dt * 6);
        state.pitch += (state.targetPitch - state.pitch) * Math.min(1, dt * 6);
        if (Math.abs(state.targetYaw - state.yaw) < 0.002) {
          state.yaw = state.targetYaw; state.pitch = state.targetPitch;
          state.targetYaw = null;
        }
      } else if (!state.dragging) {
        state.yaw += state.velYaw;
        state.pitch = clamp(state.pitch + state.velPitch, -1.45, 1.45);
        state.velYaw *= 0.93;
        state.velPitch *= 0.93;
        if (Math.abs(state.velYaw) < 0.00002) state.velYaw = 0;
        if (Math.abs(state.velPitch) < 0.00002) state.velPitch = 0;
      }

      try {
        draw(t);
        state.drawFails = 0;
      } catch (err) {
        /* 单帧失败不致命，连续失败才停掉循环，避免整页卡死 */
        state.drawFails = (state.drawFails || 0) + 1;
        if (state.drawFails > 5) {
          state.running = false;
          console.error('[earth] 绘制连续失败，已停止渲染', err);
        }
      }
    }
    requestAnimationFrame(frame);
  }

  let theme = {
    spaceTop: [0.043, 0.043, 0.055],
    spaceBottom: [0.016, 0.016, 0.022],
    glow: [0.45, 0.36, 0.2],
    glowAmt: 0.20,
    grain: 0.012,
    ambient: 0.05,
    atmo: [0.22, 0.42, 0.78],
    stars: 1,
    nebula: 1,
    exposure: 1.06,
    nightGain: 1,
    cloud: 0.82,
    atmoIntensity: 0.85,
    mote: [0.85, 0.72, 0.5]
  };
  let themeState = theme;

  /* ── 星云的离屏目标 ──
     星云只有低频结构，半分辨率足够；上采样是 2 倍的双线性插值，
     对平滑场不可见，却把最贵的那部分计算量压到 1/4。 */
  let skyFbo = null, skyTex = null, skyW = 0, skyH = 0, skyOk = false;

  function ensureSkyTarget() {
    const w = Math.max(4, Math.round(canvas.width * 0.5));
    const h = Math.max(4, Math.round(canvas.height * 0.5));
    if (skyFbo && skyW === w && skyH === h) return skyOk;

    if (skyTex) { gl.deleteTexture(skyTex); skyTex = null; }
    if (skyFbo) { gl.deleteFramebuffer(skyFbo); skyFbo = null; }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    skyOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    skyTex = tex; skyFbo = fbo; skyW = w; skyH = h;
    return skyOk;
  }

  function draw(t) {
    const g = gl;
    g.viewport(0, 0, canvas.width, canvas.height);

    const eye = cameraEye();
    const aspect = state.w / state.h || 1;
    perspective(proj, 30 * DEG, aspect, 0.1, 100);
    lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    rotY(model, state.spin);
    mul(mvp, proj, view);
    mul(mvp, mvp, model);

    /* 太阳：相对相机固定，保证受光面始终朝向观众 */
    let sun;
    if (state.sunGeo) {
      /* 实时模式：太阳固定在世界坐标，直射点由真实时间算出来 */
      const p = latLngToVec(state.sunGeo.lat, state.sunGeo.lng);
      const c = Math.cos(state.spin), sn = Math.sin(state.spin);
      sun = [c * p[0] + sn * p[2], p[1], -sn * p[0] + c * p[2]];
    } else {
      /* 默认：光源跟随相机，保证转过来的那一面总是受光 */
      const sunYaw = state.yaw - 0.78;
      sun = [Math.sin(sunYaw) * 0.86, 0.36, Math.cos(sunYaw) * 0.86];
    }
    const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
    sun[0] /= sl; sun[1] /= sl; sun[2] /= sl;

    /* ── 天空：第一遍在半分辨率下解析生成星云 ── */
    const fwd = [-eye[0], -eye[1], -eye[2]];
    const fl = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
    fwd[0] /= fl; fwd[1] /= fl; fwd[2] /= fl;
    let rgt = [fwd[1], -fwd[0], 0];
    const rl = Math.hypot(rgt[0], rgt[1], rgt[2]) || 1;
    rgt = [rgt[0] / rl, rgt[1] / rl, rgt[2] / rl];
    const upv = [
      rgt[1] * fwd[2] - rgt[2] * fwd[1],
      rgt[2] * fwd[0] - rgt[0] * fwd[2],
      rgt[0] * fwd[1] - rgt[1] * fwd[0]
    ];

    g.disable(g.DEPTH_TEST);
    g.depthMask(false);

    let hasNeb = 0;
    if (themeState.nebula > 0.001 && ensureSkyTarget()) {
      g.bindFramebuffer(g.FRAMEBUFFER, skyFbo);
      g.viewport(0, 0, skyW, skyH);
      g.disable(g.BLEND);
      g.useProgram(progNeb.p);
      g.bindBuffer(g.ARRAY_BUFFER, buf.quad);
      g.enableVertexAttribArray(progNeb.a.aP);
      g.vertexAttribPointer(progNeb.a.aP, 2, g.FLOAT, false, 0, 0);
      g.uniform3fv(progNeb.u.uRight, rgt);
      g.uniform3fv(progNeb.u.uUp, upv);
      g.uniform3fv(progNeb.u.uFwd, fwd);
      g.uniform1f(progNeb.u.uTanHalf, Math.tan(15 * DEG));
      g.uniform1f(progNeb.u.uAspect, aspect);
      g.uniform3fv(progNeb.u.uPole, GAL.pole);
      g.uniform3fv(progNeb.u.uCore, GAL.core);
      /* 噪声阶数跟着画质走：4 阶最细腻，掉帧时降到 2 阶 */
      g.uniform1f(progNeb.u.uOct, state.quality >= 0.92 ? 4 : (state.quality >= 0.82 ? 3 : 2));
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.viewport(0, 0, canvas.width, canvas.height);
      hasNeb = 1;
    }

    /* ── 第二遍：全分辨率合成（底色 + 星云 + 流星 + 暗角 + 抖动） ── */
    g.disable(g.BLEND);
    g.useProgram(progBg.p);
    g.bindBuffer(g.ARRAY_BUFFER, buf.quad);
    g.enableVertexAttribArray(progBg.a.aP);
    g.vertexAttribPointer(progBg.a.aP, 2, g.FLOAT, false, 0, 0);
    bindTex(progBg.u.uNeb, skyTex || textures.night, 5);
    g.uniform1f(progBg.u.uHasNeb, hasNeb);
    g.uniform3fv(progBg.u.uTop, themeState.spaceTop);
    g.uniform3fv(progBg.u.uBottom, themeState.spaceBottom);
    g.uniform1f(progBg.u.uGrain, themeState.grain);
    g.uniform1f(progBg.u.uTime, t);
    g.uniform1f(progBg.u.uNebula, themeState.nebula == null ? 1 : themeState.nebula);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

    /* 星空 */
    if (themeState.stars > 0.001) {
      g.enable(g.BLEND);
      /* 纯加色混合：光点在物理上是叠加的光，用 SRC_ALPHA 会二次衰减 */
      g.blendFunc(g.ONE, g.ONE);
      g.useProgram(progStar.p);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.dir);
      g.enableVertexAttribArray(progStar.a.aDir);
      g.vertexAttribPointer(progStar.a.aDir, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.col);
      g.enableVertexAttribArray(progStar.a.aCol);
      g.vertexAttribPointer(progStar.a.aCol, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.size);
      g.enableVertexAttribArray(progStar.a.aSize);
      g.vertexAttribPointer(progStar.a.aSize, 1, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.bright);
      g.enableVertexAttribArray(progStar.a.aBright);
      g.vertexAttribPointer(progStar.a.aBright, 1, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.spike);
      g.enableVertexAttribArray(progStar.a.aSpike);
      g.vertexAttribPointer(progStar.a.aSpike, 1, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.seed);
      g.enableVertexAttribArray(progStar.a.aSeed);
      g.vertexAttribPointer(progStar.a.aSeed, 1, g.FLOAT, false, 0, 0);
      g.uniformMatrix4fv(progStar.u.uProj, false, proj);
      g.uniformMatrix4fv(progStar.u.uView, false, view);
      g.uniform1f(progStar.u.uDpr, state.dpr);
      g.uniform1f(progStar.u.uTime, t);
      g.uniform1f(progStar.u.uStars, themeState.stars);
      g.drawArrays(g.POINTS, 0, starCount);
    }

    /* 光点 */
    if (themeState.stars > 0.001) {
      g.useProgram(progMote.p);
      g.bindBuffer(g.ARRAY_BUFFER, moteBuf.pos);
      g.enableVertexAttribArray(progMote.a.aPos);
      g.vertexAttribPointer(progMote.a.aPos, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, moteBuf.size);
      g.enableVertexAttribArray(progMote.a.aSize);
      g.vertexAttribPointer(progMote.a.aSize, 1, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, moteBuf.phase);
      g.enableVertexAttribArray(progMote.a.aPhase);
      g.vertexAttribPointer(progMote.a.aPhase, 1, g.FLOAT, false, 0, 0);
      g.uniformMatrix4fv(progMote.u.uMVP, false, mvp);
      g.uniform1f(progMote.u.uTime, t);
      g.uniform1f(progMote.u.uDpr, state.dpr);
      g.uniform3fv(progMote.u.uColor, themeState.mote || [0.85, 0.72, 0.5]);
      g.drawArrays(g.POINTS, 0, moteCount);
    }

    /* 地球 */
    g.enable(g.DEPTH_TEST);
    g.depthMask(true);
    g.disable(g.BLEND);
    g.clear(g.DEPTH_BUFFER_BIT);

    g.useProgram(progEarth.p);
    bindSphere(progEarth, buf.pos, buf.uv);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, buf.idx);
    g.uniformMatrix4fv(progEarth.u.uMVP, false, mvp);
    g.uniformMatrix4fv(progEarth.u.uModel, false, model);
    g.uniform3fv(progEarth.u.uSun, sun);
    g.uniform3fv(progEarth.u.uCam, eye);
    g.uniform3fv(progEarth.u.uAtmo, themeState.atmo);
    g.uniform1f(progEarth.u.uAmbient, themeState.ambient);
    g.uniform1f(progEarth.u.uExposure, themeState.exposure);
    g.uniform1f(progEarth.u.uNightGain, themeState.nightGain);
    bindTex(progEarth.u.uDay, textures.day, 0);
    bindTex(progEarth.u.uNight, textures.night, 1);
    bindTex(progEarth.u.uSpec, textures.spec, 2);
    bindTex(progEarth.u.uNormal, textures.normal, 3);
    bindTex(progEarth.u.uCloudTex, textures.clouds, 4);
    g.drawElements(g.TRIANGLES, sphere.idx.length, g.UNSIGNED_SHORT, 0);

    /* 云层 */
    g.enable(g.BLEND);
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
    g.depthMask(false);
    g.useProgram(progCloud.p);
    bindSphere(progCloud, buf.cpos, buf.cuv);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, buf.cidx);
    /* 云层略有滞后自转，制造体积感 */
    const cm = new Float32Array(16);
    rotY(cm, state.spin * 1.035);
    const cmvp = new Float32Array(16);
    mul(cmvp, proj, view);
    mul(cmvp, cmvp, cm);
    g.uniformMatrix4fv(progCloud.u.uMVP, false, cmvp);
    g.uniformMatrix4fv(progCloud.u.uModel, false, cm);
    g.uniform3fv(progCloud.u.uSun, sun);
    g.uniform3fv(progCloud.u.uCam, eye);
    g.uniform1f(progCloud.u.uOpacity, themeState.cloud);
    g.uniform1f(progCloud.u.uExposure, themeState.exposure);
    bindTex(progCloud.u.uClouds, textures.clouds, 0);
    g.drawElements(g.TRIANGLES, cloudGeo.idx.length, g.UNSIGNED_SHORT, 0);

    /* 大气 */
    g.useProgram(progAtmo.p);
    bindSphereAtmo(progAtmo, buf.apos);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, buf.aidx);
    g.uniformMatrix4fv(progAtmo.u.uMVP, false, mvp);
    g.uniformMatrix4fv(progAtmo.u.uModel, false, model);
    g.uniform3fv(progAtmo.u.uCam, eye);
    g.uniform3fv(progAtmo.u.uSun, sun);
    g.uniform3fv(progAtmo.u.uAtmo, themeState.atmo);
    g.uniform1f(progAtmo.u.uIntensity, themeState.atmoIntensity);
    g.enable(g.CULL_FACE);
    g.cullFace(g.FRONT);
    g.blendFunc(g.SRC_ALPHA, g.ONE);
    g.drawElements(g.TRIANGLES, atmoGeo.idx.length, g.UNSIGNED_SHORT, 0);
    g.disable(g.CULL_FACE);
    g.disable(g.BLEND);
    g.depthMask(true);

    /* 标记投影 */
    if (onProject) {
      onProject({
        project: (lat, lng) => projectPoint(lat, lng, proj, view, model, eye),
        eye, spin: state.spin
      });
    }
  }

  function bindSphere(pr, posBuf, uvBuf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(pr.a.aPos);
    gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.enableVertexAttribArray(pr.a.aUV);
    gl.vertexAttribPointer(pr.a.aUV, 2, gl.FLOAT, false, 0, 0);
  }
  function bindSphereAtmo(pr, posBuf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(pr.a.aPos);
    gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
  }
  function bindTex(loc, tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  /* 世界坐标投影到屏幕，并判断可见性 */
  function projectPoint(lat, lng, projM, viewM, modelM, eye) {
    const p = latLngToVec(lat, lng);
    /* 模型旋转 */
    const c = Math.cos(state.spin), s = Math.sin(state.spin);
    const x = c * p[0] + s * p[2];
    const z = -s * p[0] + c * p[2];
    const y = p[1];

    /* 相机基 */
    const cam = [
      [viewM[0], viewM[4], viewM[8]],
      [viewM[1], viewM[5], viewM[9]],
      [viewM[2], viewM[6], viewM[10]]
    ];
    const viewPos = [
      cam[0][0] * x + cam[0][1] * y + cam[0][2] * z + viewM[12],
      cam[1][0] * x + cam[1][1] * y + cam[1][2] * z + viewM[13],
      cam[2][0] * x + cam[2][1] * y + cam[2][2] * z + viewM[14]
    ];
    const clip = [
      projM[0] * viewPos[0] + projM[4] * viewPos[1] + projM[8] * viewPos[2] + projM[12],
      projM[1] * viewPos[0] + projM[5] * viewPos[1] + projM[9] * viewPos[2] + projM[13],
      projM[2] * viewPos[0] + projM[6] * viewPos[1] + projM[10] * viewPos[2] + projM[14],
      projM[3] * viewPos[0] + projM[7] * viewPos[1] + projM[11] * viewPos[2] + projM[15]
    ];
    const iw = 1 / (clip[3] || 1);
    const nx = clip[0] * iw, ny = clip[1] * iw;

    /* 法线与视线夹角判断正背面 */
    const toCam = [eye[0] - x, eye[1] - y, eye[2] - z];
    const dot = x * toCam[0] + y * toCam[1] + z * toCam[2];

    return {
      x: (nx * 0.5 + 0.5) * state.w,
      y: (1 - (ny * 0.5 + 0.5)) * state.h,
      visible: dot > 0.02 && clip[3] > 0,
      depth: dot
    };
  }

  /* ── 交互 ── */
  let down = null;

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture?.(e.pointerId);
    down = { x: e.clientX, y: e.clientY };
    state.dragging = true;
    state.moved = 0;
    state.velYaw = 0; state.velPitch = 0;
    state.auto = false;
    state.targetYaw = null;
    canvas.classList.add('is-grab');
  });

  canvas.addEventListener('pointermove', e => {
    if (!state.dragging) {
      const hit = pickMarker(e.offsetX, e.offsetY);
      if (hit?.id !== state.hovered) {
        state.hovered = hit?.id || null;
        onHover(hit || null);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
      return;
    }
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = { x: e.clientX, y: e.clientY };
    state.moved += Math.abs(dx) + Math.abs(dy);
    state.yaw -= dx * 0.005;
    state.pitch = clamp(state.pitch + dy * 0.004, -1.45, 1.45);
    state.velYaw = -dx * 0.004;
    state.velPitch = dy * 0.003;
  });

  canvas.addEventListener('pointerup', e => {
    state.dragging = false;
    canvas.classList.remove('is-grab');
    if (state.moved > 6) return;
    const hit = pickMarker(e.offsetX, e.offsetY);
    if (hit) { onPick(hit); return; }
    const geo = unproject(e.offsetX, e.offsetY);
    if (geo) onEmpty(geo);
  });

  canvas.addEventListener('pointercancel', () => {
    state.dragging = false;
    canvas.classList.remove('is-grab');
  });

  /* 滚轮：只有落在地球圆面上才缩放，球体之外的留白照常滚动页面；
     缩放到达上下限后同样把滚动交还页面 */
  canvas.addEventListener('wheel', e => {
    /* 球体在屏幕上的半径随缩放变化：只有指针落在球面上才缩放，留白处让给页面滚动 */
    const r = 0.37 * Math.min(state.w, state.h) / clamp(state.distTo, 0.5, 1.9);
    const dx = e.offsetX - state.w / 2;
    const dy = e.offsetY - state.h / 2;
    if (Math.hypot(dx, dy) > r) return;
    const step = e.deltaMode === 1 ? 0.06 : 0.09;
    const next = clamp(state.distTo * (e.deltaY > 0 ? 1 + step : 1 - step), MIN_DIST, MAX_DIST);
    if (Math.abs(next - state.distTo) < 0.0005) return;
    e.preventDefault();
    state.distTo = next;
    state.auto = false;
  }, { passive: false });

  let markers = [];
  function pickMarker(px, py) {
    for (const m of markers) {
      const d = Math.hypot(m._x - px, m._y - py);
      if (d < 18 && m._visible) return m;
    }
    return null;
  }

  function unproject(px, py) {
    const eye = cameraEye();
    const f = [-eye[0], -eye[1], -eye[2]];
    const fl = Math.hypot(...f); f[0] /= fl; f[1] /= fl; f[2] /= fl;
    const up = [0, 1, 0];
    const r = [
      f[1] * up[2] - f[2] * up[1],
      f[2] * up[0] - f[0] * up[2],
      f[0] * up[1] - f[1] * up[0]
    ];
    const rl = Math.hypot(...r); r[0] /= rl; r[1] /= rl; r[2] /= rl;
    const u = [
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0]
    ];
    const aspect = state.w / state.h;
    const th = Math.tan(15 * DEG);
    const nx = (px / state.w) * 2 - 1;
    const ny = 1 - (py / state.h) * 2;
    const dir = [
      f[0] + r[0] * nx * th * aspect + u[0] * ny * th,
      f[1] + r[1] * nx * th * aspect + u[1] * ny * th,
      f[2] + r[2] * nx * th * aspect + u[2] * ny * th
    ];
    const dl = Math.hypot(...dir); dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;

    const b = dir[0] * eye[0] + dir[1] * eye[1] + dir[2] * eye[2];
    const c = eye[0] * eye[0] + eye[1] * eye[1] + eye[2] * eye[2] - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const p = [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t];

    /* 转到模型空间 */
    const c2 = Math.cos(-state.spin), s2 = Math.sin(-state.spin);
    const mx = c2 * p[0] + s2 * p[2];
    const mz = -s2 * p[0] + c2 * p[2];
    const lat = Math.asin(clamp(p[1], -1, 1)) / DEG;
    const lng = Math.atan2(mz, -mx) / DEG;
    return { lat, lng };
  }

  /* ── 对外 ── */
  const api = {
    load,
    resize,
    start() {
      if (state.running) return;
      state.running = true;
      resize();
      requestAnimationFrame(frame);
    },
    stop() { state.running = false; },
    setTheme(t) { themeState = { ...theme, ...t }; },
    setMarkers(list) { markers = list; },
    updateMarkerPositions(list) {
      markers = list;
    },
    setHovered(id) { state.hovered = id; },
    focus(lat, lng) {
      const p = latLngToVec(lat, lng);
      const c = Math.cos(state.spin), s = Math.sin(state.spin);
      const x = c * p[0] + s * p[2];
      const z = -s * p[0] + c * p[2];
      const y = p[1];
      const wantYaw = Math.atan2(x, z);
      let d = wantYaw - state.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      state.targetYaw = state.yaw + d;
      state.targetPitch = clamp(Math.asin(y) * 0.85, -0.9, 0.9);
      state.auto = false;
      state.velYaw = 0; state.velPitch = 0;
    },
    reset() {
      state.targetYaw = 0.30;
      state.targetPitch = 0.40;
      state.dist = 1; state.distTo = 1;
      state.spin = 0.04;
      state.auto = true;
    },
    homeView() {
      state.yaw = 0.30;
      state.pitch = 0.40;
      state.spin = 0.04;
      state.dist = 1; state.distTo = 1;
      state.velYaw = 0; state.velPitch = 0;
      state.targetYaw = null; state.targetPitch = null;
      dirty = true;
    },
    setAuto(v) { state.auto = v; },
    /* 实时太阳：传直射点的经纬度（世界坐标），传 null 回到跟随相机的默认光 */
    /* 画质档位：'1k' | '2k' | '4k' */
    async setResolution(name) { return applyTier(name); },
    getResolution: () => tier,
    initTier(name) { if (TIERS[name]) tier = name; },
    setSunGeo(lat, lng) { state.sunGeo = (lat == null || lng == null) ? null : { lat, lng }; },
    clearSunGeo() { state.sunGeo = null; },
    zoomBy(f) {
      state.distTo = clamp(state.distTo * f, MIN_DIST, MAX_DIST);
      state.dist = state.distTo;
      state.auto = false;
      return state.distTo;
    },
    getZoom: () => state.distTo,
    /* 验收用：读取当前视角，不参与渲染 */
    _debug: () => ({ yaw: state.yaw, pitch: state.pitch, dist: state.dist, spin: state.spin, q: state.quality }),
    isReady: () => state.ready,
    _project: (lat, lng) => {
      const eye = cameraEye();
      const aspect = state.w / state.h || 1;
      const p = new Float32Array(16), v = new Float32Array(16), m = new Float32Array(16);
      perspective(p, 30 * DEG, aspect, 0.1, 100);
      lookAt(v, eye, [0, 0, 0], [0, 1, 0]);
      rotY(m, state.spin);
      return projectPoint(lat, lng, p, v, m, eye);
    }
  };

  return api;
}

export { latLngToVec };
