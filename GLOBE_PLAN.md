# 地球模型 · 实现方案与关键改动

> 目标：轮廓与真实地理一致、地标零延迟同步、按缩放分级呈现、可独立部署并跨设备密钥访问。

## 0. 已定位的问题与已做改动

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| 轮廓「不像真实地理」 | 底图用的是带大气与云的 Blue Marble，海岸线被雾霾覆盖；另有 0.42 强度的法线扰动把地形推成隆起 | 换成无云 2048 底图（已换，`assets/tex/earth-day.jpg`）；法线扰动降到 0.18；云影压暗从 26% 降到 18% |
| 担心经纬度错位 | — | 用「赤道/本初子午线」标定：零点落在画面正中，北纬 45° 正上方，东经 90° 恰在临界线（隐藏）→ 映射一致，无偏移 |
| 放大后糊 | 2048 纹理覆盖整个半球，屏幕像素约为纹理的 1.5 倍 | 分级纹理（见 §3），先加 4096 档；同时保持各向异性过滤 |

验证脚本：`ref/calib.mjs`（标定点）、`ref/v9.mjs`（整页截图）、`ref/flow.mjs`（功能回归）。

## 1. 实现范围

**本期做**：底图与法线修正、地标实时同步、缩放分级（纹理/标记两档）、部署包与密钥访问设计、LOGO 重做。
**不做**：真实地形高程（DEM）、矢量国界图层、服务端账号体系。前者需要 30 MB 级数据，后两者与「私人相册」定位冲突。

## 2. 地标实时同步机制

**数据结构**（`localStorage` + 内存 `state.landmarks`）：

```js
{
  id, name, coord, lat, lng, date, note, accent, coverId, keyHash, createdAt, updatedAt
}
```

**同步链路**：表单提交 → `saveLandmarks()` → `buildMarkers()` → `earth.setMarkers(list)` → 下一帧 `project(lat,lng)` 更新 DOM 标记。

现状是「整表重建」，50 个地标以内耗时 <2 ms，肉眼无感；超过 200 个时需要改成差量：

```js
// 目标实现：按 id 复用 DOM，只改变化项
earth.patchMarkers([{ id, lat, lng, name, count, removed? }])
// 内部：id → element 的 Map；新增建节点、删除移除、变更只更新 transform 与文本
```

**必须同时刷新的三处**：地球标记、墙面卡片、概览轮播。三者都挂在 `renderWall()` 之后统一触发，避免只更新一处造成「地球有、墙没有」。

## 3. 精度分级策略（LOD）

| 层级 | 触发 | 日面纹理 | 云层 | 法线 | 标记 |
| --- | --- | --- | --- | --- | --- |
| L0 概览（默认） | `dist ≥ 1.0` | 2048 | 1024 | 2048 | 圆点 + 名称 |
| L1 拉近 | `dist < 0.95` | 4096（懒加载） | 2048 | 2048 | 圆点 + 名称 + 坐标/张数 |
| L2 贴近 | `dist < 0.85` | 8192（可选，桌面且显存充足） | 4096 | 4096 | 仅当前视锥内标记，聚合重叠 |

**加载与切换**：
- 纹理按需加载，`new Image()` → `createImageBitmap` → `texImage2D`，加载完成前继续用低档，完成后一帧内替换，**不闪白**。
- 切换用「已解码缓存」：`Map<tier, WebGLTexture>`，同一档只上传一次。
- 移动端最高 L1；`navigator.deviceMemory < 4` 时锁 L0。
- 8192 纹理显存约 134 MB，仅在 `deviceMemory ≥ 8 && DPR ≥ 1.5` 且用户主动放大时加载，否则跳过。

**消除模糊的另外三件事**（比堆分辨率更有效）：
1. 画布 DPR 上限 1.75（移动 2），避免 CSS 拉伸；
2. `EXT_texture_filter_anisotropic` 开到 8×；
3. 相机贴近时把 fov 从 30° 收到 24°，球体占屏更大，同样的纹理更「实」。

**状态与缓存**：`tier` 存在内存，切换档位时 `requestIdleCallback` 预取下一档；`sessionStorage` 只记录用户上次的缩放档，不缓存纹理。

## 4. 部署方式（开源、可独立运行）

```
atlas/
├─ public/            # 现有静态站点（index.html + assets）
├─ server/
│  ├─ index.mjs       # 零依赖 Node HTTP：静态托管 + /api 同步
│  └─ store/          # 数据目录（gitignore）
├─ Dockerfile
└─ docker-compose.yml
```

- **静态托管**：`server/index.mjs` 用 `fs.createReadStream` 直接服务 `public/`，`Content-Encoding` 交给 nginx 或内置 gzip；缓存策略：`assets/tex/*` 一年不可变，`index.html` no-cache。
- **一键运行**：`docker compose up -d` → `http://<server>:8787`；公网再加一层 Caddy/Nginx 反代与 HTTPS（Web Crypto 要求安全上下文）。
- **数据**：`server/store/<albumId>.bin` 只存**密文**；服务端不知道口令，也不存明文照片。
- **跨设备**：A 设备导出 `.atlas` 或调用 `PUT /api/albums/:id` 上传密文；B 设备打开同一链接，输入册集私钥 → 客户端拉密文、本地解密 → 与本地 IndexedDB 合并。**本机关机不影响**，因为数据在服务器磁盘上。

## 5. 密钥访问控制

分两层，互不推导：

1. **访问令牌（服务端）**：`Authorization: Bearer <token>`，token 由册集私钥经 HKDF 派生，服务端只存 `sha256(token)`。没有 token 只能拿到密文，无法解密。
2. **内容密钥（客户端）**：`PBKDF2(私钥, salt, 180k)` → `AES-GCM` 解密照片与文案。服务端永远看不到明文。

```
浏览器 ── PUT /api/albums/:id (ciphertext, token) ──▶ 服务器
浏览器 ◀── GET /api/albums/:id (ciphertext) ───────── 服务器
```

**权限粒度**：每本册集一个 `albumId` + 一把私钥；`token` 只对该 id 有效。分享时给出 `链接#key=...`（片段不进服务端日志），撤销只需删除服务端文件。

**边界**：前端私钥仍是「访问控制」而非「对抗攻击」；真正的机密性来自 AES-GCM，服务器被拖库也只泄露密文。

## 6. 模块划分与性能

| 模块 | 职责 | 关键约束 |
| --- | --- | --- |
| `earth.js` | 几何/着色器/相机/拾取/LOD | 不碰 DOM 与业务数据 |
| `main.js` | 状态、渲染编排、事件 | 只在提交后触发一次全量刷新 |
| `geo.js` | 地名→坐标、文案 | 纯函数，可离线测试 |
| `vault.js` | 加解密、备份 | 不依赖 UI |
| `server/index.mjs` | 静态 + 密文同步 | 零依赖、无状态 |

**性能手段**：离屏停帧；`ResizeObserver` 防抖 180 ms；纹理分档 + 各向异性；标记用 `transform` 合成层（不触发重排）；照片上传在 Canvas 内降到 2400 px；备份用 `CompressionStream` 先压缩再加密。

## 7. 上线验证标准（可执行）

1. **地理对齐**：赤道零点居画面中心 ±2 px；北纬 45° 位于正上方；东经 90° 在临界线外。`ref/calib.mjs` 自动输出坐标。
2. **同步延迟**：提交后到标记出现在球面 <100 ms（同一帧内），不出现「球转了标记没动」。
3. **清晰度**：在 1440×900、DPR 1.5 下放大到 L1，球面文字/海岸线无肉眼可见的马赛克；缩放到 L0 时帧率 ≥55 fps。
4. **降级**：禁用 WebGL 时提示而非白屏；断网时创建地标仍可用（坐标手填）。
5. **跨设备**：A 机导出 → B 机导入，地标数、照片数、封面完全一致；错误私钥解密失败且无部分写入。
6. **部署**：`docker compose up` 后 3 分钟内可访问；HTTPS 下备份可用；重启容器数据不丢。

## 8. LOGO 重做说明

原标识是「圆 + 两条弧 + 横线 + 圆点」，信息量低、缩小后糊成一团。

新标识（`assets/img/favicon.svg`，站内为 currentColor 版本）：
- **双环**：外环 1.5 px 定形，内环 0.7 px / 30% 透明，暗示球体厚度；
- **子午线 A**：两条弧构成 A，同时是经线，端点圆头，保留手绘感；
- **纬线弧**：横向改为微弧，避免「A 的横杠」过于直白；
- **罗盘针**：顶端菱形取代圆点，指向北方，是唯一实心块，16 px 下仍可辨。

尺寸适配：16 px 只保留外环 + A + 针；32 px 起显示内环与纬线弧。颜色随 `currentColor`，三套主题各自成立；favicon 用深底 + 黄铜，避免浅色标签页里消失。
