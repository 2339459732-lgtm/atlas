/* ══════════════════════════════════════════════════════════════════
   earth.js — WebGL 实体地球
   昼面纹理 / 夜面灯光 / 海洋高光 / 独立云层 / 边缘大气 / 星空
   无第三方依赖。纹理：NASA Visible Earth（公有领域），经 three.js 示例分发。
   ══════════════════════════════════════════════════════════════════ */

import {
  VS_QUAD, FS_SKY, VS_STAR, FS_STAR, VS_METEOR, FS_METEOR, VS_LINE, FS_LINE,
  METEOR_SPEC
} from './skyfield.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* 缩放范围：0.5 贴近地表，1.9 退到远轨，给足推拉空间 */
const MIN_DIST = 0.50;
const MAX_DIST = 1.90;

/* 默认光源的世界方向：由旧公式在初始机位（yaw 0.30）处的取值归一化而来，
   所以第一眼的明暗关系不变，但之后不再随镜头转动。 */
const SUN_DIR = [-0.426, 0.386, 0.818];

/* ── 极简矩阵工具（列主序） ── */
function perspective(out, fovy, aspect, near, far, shift = 0) {
  const f = 1 / Math.tan(fovy / 2);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  /* shift 是 NDC 横移：z_clip 参与 x_clip，等价于把镜头的光轴平移，
     球与它上面的注记一起移，不用改画布尺寸。 */
  out[8] = shift; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
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
uniform float uSharp;
uniform vec2 uDayTexel;
varying vec2 vUV;
varying vec3 vN;
varying vec3 vW;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/* 云图是"白云黑底"的灰度图，取亮度当密度。
   底噪（海洋/陆地在 JPEG 里残留的暗调）统一压在 0.085 以下，
   再用一条陡一点的曲线把云edge收紧——比直接当 alpha 用要干净得多。 */
float cloudAt(vec2 uv) {
  float l = texture2D(uCloudTex, uv).r;
  return smoothstep(0.042, 0.62, l);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 L = normalize(uSun);

  /* 法线贴图近似浮雕：把切线空间法线叠加到球面法线上 */
  vec3 nm = texture2D(uNormal, vUV).rgb * 2.0 - 1.0;
  N = normalize(N + vec3(nm.x, nm.y, nm.z * 0.55) * 0.34);

  /* 云影：按太阳方向把云层采样点挪一点，影子才会落在云团的背光侧。
     偏移量约等于 1.3° 的经度差，对应 5~6 km 的云底高度。 */
  vec3 east = cross(vec3(0.0, 1.0, 0.0), N);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(N, east);
  vec2 sunStep = vec2(dot(L, east), -dot(L, north)) * 0.0036;

  float cloud = cloudAt(vUV);
  float cloudShadow = cloudAt(vUV + sunStep);

  float ndl = dot(N, L);
  float day = smoothstep(-0.075, 0.17, ndl);

  /* 昼面轻度反锐化：4 次邻域采样，偏移半个纹素。
     4K 图上这能把海岸线和山脊拉回来，代价可以按设备关掉（uSharp=0）。 */
  vec2 texel = uDayTexel;
  vec3 c0 = texture2D(uDay, vUV).rgb;
  vec3 dayC;
  if (uSharp > 0.001) {
    vec3 blur4 = texture2D(uDay, vUV + vec2(texel.x, 0.0)).rgb
               + texture2D(uDay, vUV - vec2(texel.x, 0.0)).rgb
               + texture2D(uDay, vUV + vec2(0.0, texel.y)).rgb
               + texture2D(uDay, vUV - vec2(0.0, texel.y)).rgb;
    dayC = pow(clamp(c0 + (c0 * 4.0 - blur4) * uSharp, 0.0, 1.0), vec3(2.2));
  } else {
    dayC = pow(c0, vec3(2.2));
  }
  /* 4K 源图偏艳，统一压掉约 10% 饱和，让 1K/2K/4K 三档观感一致 */
  float dLum = dot(dayC, vec3(0.299, 0.587, 0.114));
  dayC = mix(vec3(dLum), dayC, 0.9);
  /* ── 夜面 ──
     NASA Black Marble 是 sRGB 编码的图。旧写法把它的 RGB 当线性值直接用，
     末端 1/2.2 伽马会把 0.05 的陆地抬成 0.26 —— 整块大陆糊成一层褐色雾，
     海面和陆地也分不开。这里先解码回线性域，再按真实城市灯的光谱重新配光：
     海面趋近纯黑，陆地只剩极暗的蓝灰，灯芯是钠灯的琥珀、密集区偏白。 */
  vec3 rawN = texture2D(uNight, vUV).rgb;
  vec3 linN = pow(rawN, vec3(2.2));
  float nMax = max(max(rawN.r, rawN.g), rawN.b);

  /* 只让成片的水面有镜面高光，湖泊/噪点不会变成蓝点 */
  float ocean = smoothstep(0.28, 0.72, texture2D(uSpec, vUV).r);
  float landMask = 1.0 - ocean;

  /* 灯芯：这张图的"黑"并不是 0。陆地与海面的底噪集中在 0.075~0.13
     （传感器暗电流 + JPEG 暗部），灯光从 0.16 才开始起跳。
     阈值必须整体抬到暗场之上，否则整块大陆会被当成灯点亮成一片土黄。 */
  float core  = smoothstep(0.150, 0.560, nMax);   /* 城区灯芯 */
  float skirt = smoothstep(0.120, 0.235, nMax);   /* 郊区、路灯带 */

  vec3 sodium = vec3(1.00, 0.56, 0.21);   /* 高压钠灯 */
  vec3 metal  = vec3(1.00, 0.94, 0.82);   /* 白光 LED / 汞灯 */
  vec3 lamp = mix(sodium, metal, smoothstep(0.34, 0.80, nMax));

  /* mip 级采样做一次近乎免费的空间扩散，模拟大气对灯光的前向散射：
     ISS 实拍里灯团外围那圈淡淡的光晕就是它。先减掉暗场，空地上才不会起雾。 */
  vec3 blurN = texture2D(uNight, vUV, 3.6).rgb;
  float bloom = max(max(max(blurN.r, blurN.g), blurN.b) - 0.128, 0.0);

  /* 云影：用偏移采样，影子落在云团的背光侧；厚云压得更深（0.78），
     薄云几乎不压——旧版一律压 18%，看起来像整颗球蒙了层灰。 */
  dayC *= mix(1.0, 0.78, cloudShadow * 0.92);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 900.0) * ocean * 0.22;

  vec3 lit = dayC * (uAmbient + max(ndl, 0.0) * 1.28);
  lit += vec3(1.0, 0.96, 0.88) * spec * smoothstep(0.05, 0.35, ndl);
  lit += dayC * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;

  /* 夜面 = 夜图自身的陆地微光 + 城市灯 + 大气散射出的柔光。
     不再单独叠一层褐色"地面光"——那层光是旧版整片大陆像蒙了土的主要原因。 */
  vec3 nightCol = linN * 1.05;
  nightCol += lamp * pow(core, 1.25) * 2.10;
  nightCol += lamp * pow(skirt, 2.00) * 0.42;
  nightCol += lamp * pow(bloom, 0.78) * 0.85;

  /* 海面在夜面接近纯黑，只留一丝近岸水体反光，避免大陆看起来像贴片 */
  nightCol += vec3(0.0014, 0.0028, 0.0062) * (1.0 - landMask) * landMask * 4.0;
  nightCol += vec3(0.0009, 0.0016, 0.0032) * (1.0 - landMask);

  /* 晨昏线的暖色带：太阳刚沉下去时高层大气还亮着（瑞利散射的红端）。
     宽度只给 4° 左右——真实地影边缘非常窄，给宽了就变成一圈土黄色包边。 */
  float twilight = exp(-pow(ndl / 0.042, 2.0));
  /* 亮度按"离太阳还有多远"衰减，再用一点沿经度的起伏打散，
     免得放大之后变成一条干净的褐色斜带 */
  float twVar = 0.72 + 0.28 * sin(vUV.x * 44.0 + ndl * 40.0);
  nightCol += vec3(1.00, 0.46, 0.20) * twilight * 0.009 * twVar;

  /* 灯只在太阳真正落下之后才亮：用比 day 更窄的窗口，白昼半球不会残留灰纱 */
  float night = 1.0 - smoothstep(-0.10, 0.045, ndl);
  /* 厚云会挡掉下面的城市灯：夜面同样要吃到云，否则云和灯像两张贴纸 */
  nightCol *= mix(1.0, 0.42, cloud);
  vec3 dark = nightCol * night * uNightGain;

  vec3 col = mix(dark, lit, day);

  /* 边缘大气：昼侧是明亮的蓝色壳，夜侧只剩一圈极淡的气辉（实拍里始终存在） */
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.6);
  col += uAtmo * fres * (0.10 + 0.90 * day);
  col += vec3(0.10, 0.22, 0.42) * fres * (1.0 - day) * 0.14;

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
  /* 与球面着色器同一条曲线：灰度图取亮度当密度，先压掉暗场底噪 */
  float a = smoothstep(0.042, 0.62, texture2D(uClouds, vUV).r);
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
  float f = pow(1.0 - abs(dot(N, V)), 2.7);
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
  const onContext = opts.onContext || (() => {});

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' })
    || canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { onReady({ ok: false }); return null; }

  /* 显卡驱动回收上下文时不崩页面：暂停绘制，恢复后重新载入贴图 */
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    state.running = false;
    state.ready = false;
    console.warn('[earth] context lost');
    onContext(true);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[earth] context restored');
    state.running = true;
    onContext(false);
    load().catch(() => {});
  });

  const mobile = matchMedia('(max-width: 860px)').matches;
  /* 低端判定：核数少、内存小、或开了省流量——这类设备上 4K 贴图只会拖慢首屏，
     直接停在 2K，并跳过最占体积的 4K 云层。 */
  const conn = navigator.connection || {};
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4
    || (navigator.deviceMemory || 8) <= 4
    || !!conn.saveData
    || /(^|-)2g$/.test(conn.effectiveType || '');
  const skipClouds = lowEnd;
  const maxDpr = mobile ? 2 : (lowEnd ? 1.5 : 2);
  /* 反锐化强度：桌面给 0.22，移动端和低端设备关掉，省两次采样 */
  const sharpen = (mobile || lowEnd) ? 0 : 0.22;
  const SEG = mobile ? 96 : 176;
  const RINGS = mobile ? 64 : 128;

  const state = {
    /* 初始视角：以中国（约 105°E）为正面，俯角 23°，略偏东 */
    yaw: 0.30, pitch: 0.40, dist: 1, distTo: 1, spin: 0.04,
    targetYaw: null, targetPitch: null,
    velYaw: 0, velPitch: 0,
    auto: true, hovered: null, ready: false,
    dpr: 1, w: 0, h: 0, baseDist: 3.6, quality: 1, reserve: 0,
    dragging: false, moved: 0, last: null,
    sunYaw: 0, t: 0, sunGeo: null,
    meteors: [], nextMeteor: 4.5, meteorIdx: 0,
    /* 图层开关：只控制"画不画"，不改主题参数。
       主题决定"长什么样"，图层决定"这一层在不在"——两者正交，切主题不会把图层重置。 */
    flags: { clouds: true, atmo: true, stars: true, sky: true, meteors: true, constellations: false }
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

  let progEarth, progCloud, progAtmo, progBg, progStar, progMeteor, progMote, progLine;

  const sphere = buildSphere(SEG, RINGS, 1);
  const cloudGeo = buildSphere(SEG, RINGS, 1.012);
  const atmoGeo = buildSphere(Math.max(48, SEG / 2), Math.max(32, RINGS / 2), 1.025);

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
     星表由 skyfield.js 按密度场逐点生成：位置、尺寸、亮度、色温、种子
     全部记录在缓冲区里，可枚举、可复现（种子固定），不是随机撒点。 */

  const starCount = mobile ? 68000 : (lowEnd ? 140000 : 230000);

  /* 星表：真实亮星（Gaia）打底，程序暗星补"密"；星座线共用同一银道坐标系 */
  let starBuf = null;
  let figureBuf = null;
  let figureN = 0;
  let meteorBuf = null;
  let starN = 0;
  let skyReady = false;

  /* 真实星空目录：异步加载（145KB 源码），失败回退纯程序星表。
     亮星 5044 颗来自 NASA/GSFC SVS 4851 · Gaia DR2（银道坐标、星等、B−V）。 */
  let skyCat = null;
  let skyCatPending = null;
  function ensureSkyCatalog() {
    if (skyCatPending) return;
    skyCatPending = import('../data/skycat.js')
      .then(m => {
        skyCat = m;
        /* 星表晚于首帧就绪：直接换掉缓冲，下一帧就是真实星空 */
        if (skyReady && starBuf) { starBuf = buildStars(starCount); figureBuf = buildFigures(); }
      })
      .catch(err => { console.warn('[earth] 真实星表不可用，已回退程序星表', err && err.message); });
  }

  /* 小 PRNG：暗星确定性，与真实亮星不抢戏 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 银道坐标 → 世界方向：与银河全景采样同一套约定
     （lon = atan(d.x, d.z)，lat = asin(d.y)） */
  const galDir = (l, b, out, i) => {
    const la = l * DEG, ba = b * DEG, cb = Math.cos(ba);
    out[i] = cb * Math.sin(la);
    out[i + 1] = Math.sin(ba);
    out[i + 2] = cb * Math.cos(la);
  };

  /* 星等 → 屏幕尺寸/亮度。对数太陡，屏幕吃不下 5 个星等的动态范围，
     所以把指数压到 1/2.4；0.05 的下限让最暗的星仍可辨认 */
  const magSize = mag => clamp(1.0 + (3.2 - mag) * 0.85, 0.6, 6.0);
  const magBright = mag => clamp(Math.pow(10, -0.4 * mag / 2.4), 0.05, 1.0);

  function buildStars(count) {
    const dir = new Float32Array(count * 3);
    const pack = new Float32Array(count * 4);
    let i = 0;

    if (skyCat && skyCat.SKY_STARS) {
      const stars = skyCat.SKY_STARS;
      for (let k = 0; k < stars.length && i < count; k++) {
        const st = stars[k];
        galDir(st[0], st[1], dir, i * 3);
        pack[i * 4] = magSize(st[2]);
        pack[i * 4 + 1] = magBright(st[2]);
        pack[i * 4 + 2] = st[3];                        /* B−V，着色器直接换色温 */
        pack[i * 4 + 3] = (k + 1) * 0.6180339887 % 1;   /* 确定性闪烁种子 */
        i++;
      }
    }

    /* 暗星（6.5–9 等）：均匀球面，只提供"密" */
    const rnd = mulberry32(20261112);
    while (i < count) {
      const z = rnd() * 2 - 1;
      const phi = rnd() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      dir[i * 3] = r * Math.cos(phi);
      dir[i * 3 + 1] = z;
      dir[i * 3 + 2] = r * Math.sin(phi);
      const mag = 6.5 + rnd() * 2.5;
      pack[i * 4] = 0.5 + rnd() * 0.5;
      /* 与真实亮星同一条星等曲线，再压一半：暗星接在 6.5 等的
         亮度下限之下，不会出现"6.5 等的程序星比 6 等的真星还亮"的跳变 */
      pack[i * 4 + 1] = magBright(mag) * 0.45;
      pack[i * 4 + 2] = 0.25 + rnd() * 1.4;
      pack[i * 4 + 3] = rnd();
      i++;
    }
    return { dir, pack, count: i };
  }

  /* 星座连线：88 星座的多段折线展开成线段顶点（LINES） */
  function buildFigures() {
    const figs = skyCat?.SKY_FIGURES;
    if (!figs?.length) return null;
    let pairs = 0;
    for (const f of figs) for (const seg of f.lines) pairs += Math.max(0, seg.length - 1);
    if (!pairs) return null;
    const arr = new Float32Array(pairs * 6);
    let i = 0;
    for (const f of figs) {
      for (const seg of f.lines) {
        for (let k = 0; k + 1 < seg.length; k++) {
          galDir(seg[k][0], seg[k][1], arr, i * 6);
          galDir(seg[k + 1][0], seg[k + 1][1], arr, i * 6 + 3);
          i++;
        }
      }
    }
    figureN = pairs * 2;
    return buffer(arr);
  }

  function buildSky() {
    const cat = buildStars(starCount);
    starBuf = { dir: buffer(cat.dir), pack: buffer(cat.pack) };
    figureBuf = buildFigures();
    meteorBuf = buffer(meteorParts);
    starN = cat.count;
    skyReady = true;
  }

  ensureSkyCatalog();

  /* ── 流星：一条二次贝塞尔轨迹 + 一组带 trail 参数的粒子 ── */
  const meteorParts = (() => {
    const n = METEOR_SPEC.particles;
    const a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      a[k * 3] = k / (n - 1);                    /* trail 参数 0=头 1=尾 */
      a[k * 3 + 1] = (Math.random() * 2 - 1);    /* 横向散开 */
      a[k * 3 + 2] = Math.random();              /* 种子 */
    }
    return a;
  })();

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
    clouds: 'earth-clouds-1k.jpg',
    spec: 'earth-specular-1k.jpg',
    normal: 'earth-normal.jpg',
    sky: 'sky-milky-1k.jpg'
  };
  /* 画质档位：1K 极速 / 2K 标准 / 4K 精细（4K 换了 3840×1920 的白昼图）
     夜面统一来自 NASA Black Marble 8192×4096 母版，按档位降到 1024 / 2048 / 4096；
     云层来自 8192×4096 的白天云图，同样三档。 */
  const TIERS = {
    '1k': { day: 'earth-day-1k.jpg', night: 'earth-night-1k.jpg', spec: 'earth-specular-1k.jpg', clouds: 'earth-clouds-1k.jpg', sky: 'sky-milky-1k.jpg' },
    '2k': { day: 'earth-day.jpg', night: 'earth-night-2k.jpg', spec: 'earth-specular.jpg', clouds: 'earth-clouds-2k.jpg', sky: 'sky-milky-2k.jpg' },
    '4k': { day: 'earth-day-4k.jpg', night: 'earth-night-4k.jpg', spec: 'earth-specular.jpg', clouds: 'earth-clouds-4k.jpg', sky: 'sky-milky-4k.jpg' }
  };
  let tier = '2k';
  const textures = {};
  /* 昼贴图的纹素尺寸，反锐化用；随每次换图更新 */
  let dayTexel = [1 / 2048, 1 / 1024];

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
    progBg = program(VS_QUAD, FS_SKY, { aP: 'aP' }, 'sky');
    progStar = program(VS_STAR, FS_STAR, { aDir: 'aDir', aPack: 'aPack' }, 'star');
    progMeteor = program(VS_METEOR, FS_METEOR, { aM: 'aM' }, 'meteor');
    progLine = program(VS_LINE, FS_LINE, { aDir: 'aDir' }, 'constellation');
    progEarth = program(VS_SPHERE, FS_EARTH, { aPos: 'aPos', aUV: 'aUV' }, 'earth');
    progCloud = program(VS_SPHERE, FS_CLOUD, { aPos: 'aPos', aUV: 'aUV' }, 'cloud');
    progAtmo = program(VS_SPHERE, FS_ATMO, { aPos: 'aPos', aUV: 'aUV' }, 'atmo');
    progMote = program(VS_MOTE, FS_MOTE, { aPos: 'aPos', aSize: 'aSize', aPhase: 'aPhase' }, 'mote');
  }

  /* 切档：先换白昼图（最显眼），夜面/高光并行，云层最后补。
     用一个 token 防连点：旧请求回来时若已不是当前档，直接丢弃——
     否则它会把新档刚装上的纹理删掉，画面直接变黑。 */
  let tierToken = 0;
  async function applyTier(name, onProgress) {
    const t = TIERS[name];
    if (!t) return false;
    const token = ++tierToken;
    const keys = Object.keys(t);
    let done = 0;
    const step = () => { done++; onProgress?.(done / keys.length); };

    if (t.day) {
      try {
        const img = await loadImage(texUrl(t.day));
        if (token !== tierToken) return false;
        const next = upload(img, true);
        if (textures.day) gl.deleteTexture(textures.day);
        textures.day = next;
        dayTexel = [1 / Math.max(1, img.width), 1 / Math.max(1, img.height)];
      } catch (e) {
        console.warn('[earth] 白昼贴图切换失败', e);
      }
      step();
    }

    /* 云层单独排在最后：它体积最大，等球面已经清晰了再补 */
    const rest = keys.filter(k => k !== 'day' && k !== 'clouds');
    await Promise.all(rest.map(async k => {
      try {
        const img = await loadImage(texUrl(t[k]));
        if (token !== tierToken) return;
        const next = upload(img, true);
        if (textures[k]) gl.deleteTexture(textures[k]);
        textures[k] = next;
      } catch (e) {
        console.warn('[earth] 贴图切换失败 ' + k, e);
      }
      step();
    }));

    /* 云层最大（4K 档 1.4 MB），一律放到浏览器空闲时再补：
       球面在 day/night/spec 到齐时就已经清晰，云层晚半秒没人看得出来，
       但首屏少下 1.4 MB。 */
    if (t.clouds && !skipClouds) upgradeClouds(t.clouds, token);
    step();

    if (token === tierToken) tier = name;
    return true;
  }

  /* 空闲时替换云层；token 变了就作废，避免把新档的云删掉 */
  function upgradeClouds(file, token) {
    const run = async () => {
      if (token !== tierToken) return;
      try {
        const img = await loadImage(texUrl(file));
        if (token !== tierToken) return;
        const next = upload(img, true);
        if (textures.clouds) gl.deleteTexture(textures.clouds);
        textures.clouds = next;
      } catch (e) {
        console.warn('[earth] 云层切换失败', e);
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 900);
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
      textures.sky = blank(0, 0, 0, 255);
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
        dayTexel = [1 / Math.max(1, img.width), 1 / Math.max(1, img.height)];
      } catch (e) {
        console.warn('[earth] 白昼贴图失败，用纯色顶上', e);
      }
      state.ready = true;
      onReady({ ok: true, partial: true });
      progress?.(0.35);

      /* 低清全套并行补齐 */
      const rest = ['sky', 'night', 'clouds', 'spec', 'normal'];
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
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1) * state.quality;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    /* 尺寸没变就不重设，canvas.width 赋值会清空整张画布 */
    if (w === canvas.width && h === canvas.height && state.w === r.width && state.h === r.height) {
      state.dpr = dpr;
      return;
    }
    state.dpr = dpr;
    state.w = r.width; state.h = r.height;
    canvas.width = w;
    canvas.height = h;
    fit();
  }

  /* 兜底：布局晚于 start() 时（首屏懒加载、字体回流、容器动画），
     画布会一直停在 300×150 的默认尺寸，整块区域一片黑。
     用 ResizeObserver 盯住 CSS 盒子，尺寸一变就重新分配绘制缓冲。 */
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }

  function fit() {
    const fov = 30 * DEG;
    /* 宽屏留出天空才显尺度；窄屏受宽度限制，球太小反而留下大片空场 */
    const k = (state.w / state.h) < 1.05 ? 0.80 : 0.56;
    const needV = 1 / (k * Math.tan(fov / 2));
    /* 右侧停靠面板时，球只占"剩余宽度"：先按可用宽度算一个下限，
       再把光轴左移半个停靠宽度，球不会被面板压住。 */
    const availW = Math.max(180, state.w - state.reserve);
    const needW = state.h / (0.90 * Math.tan(fov / 2) * availW);
    state.baseDist = Math.max(needV, needW);
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

    /* ── 流星调度 ──
       按区间随机生成，最多同时两颗；每颗走完后从列表里摘掉。 */
    state.meteors = state.meteors.filter(m => t - m.born < METEOR_SPEC.life);
    if (!state.flags.meteors && state.meteors.length) state.meteors.length = 0;
    if (state.flags.meteors && state.ready && t > state.nextMeteor && state.meteors.length < 2) {
      const spec = METEOR_SPEC.paths[state.meteorIdx % METEOR_SPEC.paths.length];
      state.meteorIdx++;
      state.meteors.push({ born: t, p0: spec.p0, c: spec.c, p1: spec.p1 });
      const span = METEOR_SPEC.interval;
      state.nextMeteor = t + span[0] + Math.random() * (span[1] - span[0]);
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
    exposure: 1.06,
    nightGain: 1,
    cloud: 0.82,
    atmoIntensity: 0.85,
    mote: [0.85, 0.72, 0.5]
  };
  let themeState = theme;

  function draw(t) {
    const g = gl;
    g.viewport(0, 0, canvas.width, canvas.height);

    const eye = cameraEye();
    const aspect = state.w / state.h || 1;
    perspective(proj, 30 * DEG, aspect, 0.1, 100, state.w ? state.reserve / state.w : 0);
    lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    rotY(model, state.spin);
    mul(mvp, proj, view);
    mul(mvp, mvp, model);

    /* 太阳：固定在世界坐标里的一束平行光。
       旧实现用 `state.yaw` 推导太阳方位（sunYaw = yaw - 0.78），等于让太阳跟着镜头转：
       拖拽时受光面永远停在屏幕同一侧 —— 结果是永远看不到夜面，
       海面高光也钉在屏幕上，看起来像"有个光点跟着鼠标跑"。
       现在光源不随镜头动，转动的是地球本身，明暗界线会自然扫过球面。 */
    let sun;
    if (state.sunGeo) {
      /* 实时模式：太阳固定在世界坐标，直射点由真实时间算出来 */
      const p = latLngToVec(state.sunGeo.lat, state.sunGeo.lng);
      const c = Math.cos(state.spin), sn = Math.sin(state.spin);
      sun = [c * p[0] + sn * p[2], p[1], -sn * p[0] + c * p[2]];
    } else {
      /* 默认方位沿用初始机位下的观感（yaw 0.30 时与原公式等价），
         之后不再随 yaw 变化 */
      sun = [SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]];
    }
    const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
    sun[0] /= sl; sun[1] /= sl; sun[2] /= sl;

    /* ── 天空：一次绘制，无噪声、无离屏缓冲 ── */
    if (!skyReady && state.w > 0) buildSky();

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
    g.disable(g.BLEND);

    g.useProgram(progBg.p);
    g.bindBuffer(g.ARRAY_BUFFER, buf.quad);
    g.enableVertexAttribArray(progBg.a.aP);
    g.vertexAttribPointer(progBg.a.aP, 2, g.FLOAT, false, 0, 0);
    /* 银河：真实巡天全景。基向量用"地平不滚转"的那一组，
       否则俯仰时银河会跟着画面一起歪。 */
    const sr = [-fwd[2], 0, fwd[0]];
    const srl = Math.hypot(sr[0], sr[1], sr[2]) || 1;
    sr[0] /= srl; sr[1] /= srl; sr[2] /= srl;
    const su = [
      sr[1] * fwd[2] - sr[2] * fwd[1],
      sr[2] * fwd[0] - sr[0] * fwd[2],
      sr[0] * fwd[1] - sr[1] * fwd[0]
    ];

    const skyGain = (themeState.sky == null ? 5.1 : themeState.sky)
      * (themeState.stars > 0.01 ? 1 : 0)
      * (state.flags.sky ? 1 : 0);
    g.uniform3fv(progBg.u.uTop, themeState.spaceTop);
    g.uniform3fv(progBg.u.uBottom, themeState.spaceBottom);
    g.uniform1f(progBg.u.uGrain, themeState.grain);
    g.uniform3fv(progBg.u.uRight, sr);
    g.uniform3fv(progBg.u.uUp, su);
    g.uniform3fv(progBg.u.uFwd, fwd);
    g.uniform1f(progBg.u.uTanHalf, Math.tan(15 * DEG));
    g.uniform1f(progBg.u.uAspect, aspect);
    g.uniform1f(progBg.u.uSkyGain, skyGain);
    g.uniform1f(progBg.u.uSkyTilt, 0.33);
    g.uniform1f(progBg.u.uSkySpin, 0.0);
    g.uniform1f(progBg.u.uSkyBias, 0.0);
    g.activeTexture(g.TEXTURE0 + 3);
    g.bindTexture(g.TEXTURE_2D, textures.sky || null);
    g.uniform1i(progBg.u.uSky, 3);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

    /* ── 星座连线：88 星座，只画真实目录就绪后的线段 ── */
    if (figureBuf && state.flags.constellations && themeState.stars > 0.001) {
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
      g.useProgram(progLine.p);
      g.bindBuffer(g.ARRAY_BUFFER, figureBuf);
      g.enableVertexAttribArray(progLine.a.aDir);
      g.vertexAttribPointer(progLine.a.aDir, 3, g.FLOAT, false, 0, 0);
      g.uniformMatrix4fv(progLine.u.uProj, false, proj);
      g.uniformMatrix4fv(progLine.u.uView, false, view);
      const light = document.documentElement.dataset.theme === 'ivory';
      g.uniform3fv(progLine.u.uColor, light ? [0.16, 0.20, 0.30] : [0.62, 0.72, 0.92]);
      g.uniform1f(progLine.u.uAlpha, light ? 0.20 : 0.13);
      g.uniform1f(progLine.u.uSkyTilt, 0.33);
      g.uniform1f(progLine.u.uSkySpin, 0.0);
      g.drawArrays(g.LINES, 0, figureN);
    }

    /* ── 星点：整张星表一次画完 ── */
    if (starBuf && themeState.stars > 0.001 && state.flags.stars) {
      g.enable(g.BLEND);
      /* 纯加色：光点在物理上就是叠加的光 */
      g.blendFunc(g.ONE, g.ONE);
      g.useProgram(progStar.p);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.dir);
      g.enableVertexAttribArray(progStar.a.aDir);
      g.vertexAttribPointer(progStar.a.aDir, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, starBuf.pack);
      g.enableVertexAttribArray(progStar.a.aPack);
      g.vertexAttribPointer(progStar.a.aPack, 4, g.FLOAT, false, 0, 0);
      g.uniformMatrix4fv(progStar.u.uProj, false, proj);
      g.uniformMatrix4fv(progStar.u.uView, false, view);
      g.uniform1f(progStar.u.uDpr, state.dpr);
      g.uniform1f(progStar.u.uTime, t);
      g.uniform1f(progStar.u.uStars, themeState.stars * (state.flags.stars ? 1 : 0));
      g.uniform1f(progStar.u.uSkyTilt, 0.33);
      g.uniform1f(progStar.u.uSkySpin, 0.0);
      g.drawArrays(g.POINTS, 0, starN);
    }

    /* ── 流星 ── */
    if (starBuf && themeState.stars > 0.5 && state.meteors.length) {
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE);
      g.useProgram(progMeteor.p);
      g.bindBuffer(g.ARRAY_BUFFER, meteorBuf);
      g.enableVertexAttribArray(progMeteor.a.aM);
      g.vertexAttribPointer(progMeteor.a.aM, 3, g.FLOAT, false, 0, 0);
      g.uniform1f(progMeteor.u.uDpr, state.dpr);
      g.uniform1f(progMeteor.u.uAspect, aspect);
      g.uniform1f(progMeteor.u.uTrail, METEOR_SPEC.trail);

      for (const m of state.meteors) {
        const life = METEOR_SPEC.life;
        const k = (t - m.born) / life;
        if (k < 0 || k > 1) continue;

        /* 头部沿曲线推进：前段快、末段收，像真实流星被大气减速 */
        const headT = 1 - Math.pow(1 - Math.min(1, k * 1.06), 2.4);
        const grow = Math.min(1, k / 0.20);
        const alpha = Math.min(1, k / 0.05) * (1 - Math.max(0, (k - 0.52) / 0.48));

        g.uniform2f(progMeteor.u.uP0, m.p0[0], m.p0[1]);
        g.uniform2f(progMeteor.u.uC, m.c[0], m.c[1]);
        g.uniform2f(progMeteor.u.uP1, m.p1[0], m.p1[1]);
        g.uniform1f(progMeteor.u.uHeadT, headT);
        g.uniform1f(progMeteor.u.uTrail, Math.max(0.02, METEOR_SPEC.trail * grow));
        g.uniform1f(progMeteor.u.uAlpha, alpha);

        /* 拖尾粒子 */
        g.uniform1f(progMeteor.u.uSizeMul, 1);
        g.uniform1f(progMeteor.u.uAlphaMul, 1);
        g.drawArrays(g.POINTS, 0, METEOR_SPEC.particles);

        /* 头部光晕：同一套粒子，取前几颗放大、压暗 */
        g.uniform1f(progMeteor.u.uSizeMul, 5.2);
        g.uniform1f(progMeteor.u.uAlphaMul, 0.10);
        g.drawArrays(g.POINTS, 0, 4);
        g.uniform1f(progMeteor.u.uSizeMul, 1);
        g.uniform1f(progMeteor.u.uAlphaMul, 1);
      }
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
    /* 1K 档一个纹素就是 0.35°，反锐化会变成一圈光晕，直接关掉 */
    g.uniform1f(progEarth.u.uSharp, tier === '1k' ? 0 : sharpen);
    g.uniform2f(progEarth.u.uDayTexel, dayTexel[0], dayTexel[1]);
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
    g.uniform1f(progCloud.u.uOpacity, themeState.cloud * (state.flags.clouds ? 1 : 0));
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
    g.uniform1f(progAtmo.u.uIntensity, themeState.atmoIntensity * (state.flags.atmo ? 1 : 0));
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
        eye, spin: state.spin, sun: [sun[0], sun[1], sun[2]]
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
  /* 触到缩放极限时给一个很轻的反馈，代替"页面突然滚走" */
  let limitTimer = 0;
  function zoomLimit() {
    canvas.classList.remove('is-limit');
    void canvas.offsetWidth;
    canvas.classList.add('is-limit');
    clearTimeout(limitTimer);
    limitTimer = setTimeout(() => canvas.classList.remove('is-limit'), 420);
  }

  canvas.addEventListener('wheel', e => {
    /* 球体在屏幕上的半径随缩放变化：只有指针落在球面上才接管滚轮，留白处让给页面滚动 */
    const r = 0.37 * Math.min(state.w, state.h) / clamp(state.distTo, 0.5, 1.9);
    const dx = e.offsetX - state.w / 2;
    const dy = e.offsetY - state.h / 2;
    if (Math.hypot(dx, dy) > r) return;

    /* 指针在球上一律拦下：到达极限时如果放行，滚轮会立刻变成页面滚动，
       整块面板就会"上下位移"——这正是之前缩放时面板漂移的原因。 */
    e.preventDefault();
    const step = e.ctrlKey ? 0.05 : (e.deltaMode === 1 ? 0.06 : 0.09);
    const next = clamp(state.distTo * (e.deltaY > 0 ? 1 + step : 1 - step), MIN_DIST, MAX_DIST);
    if (Math.abs(next - state.distTo) < 0.0005) {
      if (Math.abs(e.deltaY) > 0.5) zoomLimit();
      return;
    }
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
    /* 反解光轴横移：投影时 NDC 整体左移 reserve/w，这里加回去 */
    const nx = (px / state.w) * 2 - 1 + (state.w ? state.reserve / state.w : 0);
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
    /* 右侧停靠宽度（CSS 像素）：0 = 居中。改完立刻重算机位。 */
    setReserve(px) {
      const cap = state.w ? state.w * 0.62 : 1e9;
      const v = Math.max(0, Math.min(cap, px || 0));
      if (Math.abs(v - state.reserve) < 0.5) return;
      state.reserve = v;
      fit();
    },
    getReserve: () => state.reserve,
    /* 渲染层开关：云 / 大气 / 星点 / 银河 / 流星。返回生效后的完整开关。 */
    setFlags(patch) {
      if (patch) Object.assign(state.flags, patch);
      return { ...state.flags };
    },
    getFlags: () => ({ ...state.flags }),
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
    /* 设备能力：页面据此决定默认档位、是否把 4K 按钮置灰 */
    caps: () => ({ mobile, lowEnd, maxDpr, clouds: !skipClouds }),
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
    _debug: () => ({ yaw: state.yaw, pitch: state.pitch, dist: state.dist, spin: state.spin, q: state.quality, baseDist: state.baseDist, reserve: state.reserve, w: state.w, h: state.h, running: state.running, starN, figureN, skyCatReady: !!skyCat, skyReady }),
    isReady: () => state.ready,
    _project: (lat, lng) => {
      const eye = cameraEye();
      const aspect = state.w / state.h || 1;
      const p = new Float32Array(16), v = new Float32Array(16), m = new Float32Array(16);
      perspective(p, 30 * DEG, aspect, 0.1, 100, state.w ? state.reserve / state.w : 0);
      lookAt(v, eye, [0, 0, 0], [0, 1, 0]);
      rotY(m, state.spin);
      return projectPoint(lat, lng, p, v, m, eye);
    }
  };

  return api;
}

export { latLngToVec };
