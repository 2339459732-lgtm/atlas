# SOLAR_INTEGRATION.md — 太阳系图集整合方案（Atlas of Space → ATLAS）

把开源太阳系图集 **Atlas of Space**（Apache-2.0，作者 Gordon Hart，
`github.com/gordonhart/atlasof.space`）作为子应用整合进 ATLAS，
实现「地球图册 ⇄ 太阳系图集」的统一体验。本文档记录可行性评估、
整合范围、模块划分与实现要点，是后续迭代的基准。

## 一、可行性评估（基于现有技术栈）

| 维度 | 结论 |
| --- | --- |
| 许可证 | **Apache-2.0**：允许自托管、再分发与品牌化适配（保留许可声明，见 `solar/LICENSE` + `solar/ATTRIBUTION.md`） |
| 形态 | 纯静态 SPA（Vite + React + Three.js）：`solar/index.html` + `assets/solar.{js,css}` + 资源目录，无需任何服务端 |
| 部署 | 静态资源可直接放进本仓库，GitHub Pages / 应用域名均可用；与 ATLAS 根路径无冲突（图集占用 `/solar/`、`/planets/`、`/moons/`、`/sky/`、`/data/`、`/fonts/`） |
| 可配置性 | 主题全部由 CSS 变量驱动（`--sx-accent` 等）；图层状态由 URL 参数 `?layers=` 表达；**同源 iframe** 下可注入样式表与 DOM |
| 状态保持 | iframe 一旦创建就不销毁，切回地球只是隐藏——相机、图层、时间全部原样保留 |
| 体积 | 核心资源约 230MB（纹理为主），懒加载后对首屏零影响 |
| 已知边界 | ① `/api/orbits` 依赖上游 Go 后端，静态部署下 404（与参考站行为一致，应用自行降级）；② 深空模式的高清瓦片金字塔（2688 片）与 625 张深空天体图未镜像（见第三节 Tier-2） |

**为什么选同源 iframe 而非另两案**：
- 直接 iframe 参考站（跨域）：无法统一视觉、无法植入品牌、受第三方可用性约束；
- 重写进自己的渲染引擎：工程量大、与现有 globe 引擎职责重叠；
- **自托管 + 同源 iframe**：完整隔离（互不干扰的 UI/内存/故障域）+ 完整控制（主题映射、品牌、懒加载、状态、缓存），是"无缝融合"与"可落地"的最优平衡。

## 二、整合范围与模块划分

### 模块 1：子应用自托管（vendor）
- `solar/`（外壳 + 2.6MB 主包 + `live-orbits.js` + LICENSE + ATTRIBUTION）
- `planets/`（行星 2k/4k/8k 纹理、太阳 AIA 九波段、土星环、科学图层）
- `moons/`（13 颗卫星基础纹理 + 高清特写）、`sky/`（星表、银河、88 星座描绘图）
- `data/`（星历、小行星带、地球模块）、`fonts/`（Inter 300/400 + IBM Plex Mono）
- 可复现：`ref/vendor-solar.sh`（镜像脚本，15MB/文件上限，`content-type` 白名单）

### 模块 2：视图路由与导航（ATLAS 侧）
- 头部新增「地球 | 太阳系」分段切换（桌面），移动端进「更多」菜单
- URL 状态：`?mode=solar` 深链接直达；`?solar-layers=` 透传给子应用
  （图层参数沿用图集自身的 `?layers=` 语法，如 `L03.dsn,F08.nomenclature`）
- 会话记忆：`sessionStorage['atlas.mode.v1']`，刷新回到上次所在视图
- 切换时：地球 `stop()` / 音乐暂停；返回时 `start()` / 恢复——进入图集
  即停掉 globe 渲染循环（省 GPU），iframe 保持存活（状态保持）

### 模块 3：视觉统一与品牌植入
- **主题映射**（同源注入）：`--sx-accent` → 品牌金 `#C9A96A`、
  `--sx-accent-soft` / `--node` / `--accent-yellow` / `--sx-cool` 同步；
  `!important` + 注入到 body 末尾，压过图集自带样式表
- **悬浮品牌条**：返回地球按钮（图集 40px 顶栏下方，不遮它的菜单）
  + 「ATLAS × Atlas of Space」署名胶囊；进入图集时收起站点头部，
  只留悬浮条——两个世界共用同一套品牌语言
- 字号/间距：图集自带字体栈（AtlasSans/Inter + PlexMono）与 ATLAS
  的 Archivo/等宽体系气质一致，不强行替换

### 模块 4：性能与缓存
- **懒加载**：子应用 2.6MB 主包与纹理只在首次进入图集视图时请求；
  ATLAS 首屏零额外开销
- **加载态**：HTML load 只是开始，轮询 `#root` 挂载完成才收起加载层
  （最长 15s 兜底），避免"白屏误判"
- **缓存策略**（`_headers`）：字体 `immutable`；`solar/assets/*` 7 天；
  纹理目录 14 天（CDN/浏览器二次访问近乎零等待）
- **资源争用**：进入图集即停地球渲染与背景音乐，避免双 WebGL 场景
  与双音源同跑

### 模块 5：星空探索的扩展（Tier-2 预留）
- 已落地：88 星座描绘图、真实星表、银河 8k、深空天体目录与介绍
  （`sky/dso*.json`）
- 预留（未镜像，按需接入）：深空模式高清瓦片金字塔（`sky/tiles/`，
  1024px×2688 片，按视场增量拉取）；625 张 DSO 照片（`sky/dso-img/`）；
  小行星图片（`/images/objects/`）
- 与 ATLAS 自身深空层的关系：globe 的 `L06/L07/F05` 保持独立；
  图集的深空模式由子应用原生提供，两者通过导航切换互不干扰

## 三、实现要点（落地清单）

1. **iframe 生命周期**：`enterSolar()` 首次调用才写入 `src`；此后
   `hidden` 切换。绝不 `remove()`——状态即数据。
2. **深链接解析**：`currentMode()` 顺序：URL `mode` 参数 > sessionStorage > 默认地球。
3. **品牌注入时机**：iframe `load` 后轮询挂载；注入失败静默降级（try/catch），
   不影响子应用本身。
4. **移动端**：`#modes` 隐藏，菜单项承接入口；品牌胶囊隐藏，只留返回按钮。
5. **安全**：`referrerpolicy="strict-origin-when-cross-origin"`、
   `allow="fullscreen"`；子应用与本域同源，无跨域注入面。
6. **更新子应用**：重新运行 `ref/vendor-solar.sh` 并覆盖目录即可；
   纹理文件名稳定（内容寻址由上游维护），缓存策略 14 天与更新节奏匹配。

## 四、路径适配（重要实现要点）

图集构建产物用**根绝对路径**引用资源（且运行时以 `"/"+相对路径` 拼出绝对
路径）。根路径部署（应用域名）没问题；GitHub Pages 是子路径部署
（`host/atlas/`），根绝对路径全部 404。字符串改写（`/sky/` → `../sky/`）
被运行时的 `"/"+path` 拼接击穿，最终方案是**基础路径补丁**：

- `solar/base-path-shim.js` 内联进 `solar/index.html`（先于应用脚本执行）：
  子路径部署时把 `Image.src` / `fetch` / `XHR` 的根绝对请求归一化到站点根；
  根部署时 `root === origin + "/"`，恒等变换、零影响；
- `solar/index.html` 应用资源改相对路径（`assets/…`）；
- `solar.css` 字体改 `url(../../fonts/…)`；
- `solar.js` 仅修 Worker 入口（`new URL(…, document.baseURI)`），
  资源前缀保持原样交给 shim；
- 全流程封装在 `ref/patch-solar-paths.py`（vendor 后执行，幂等）。

另有两处文件名大小写坑（Windows 本地不敏感、线上 Linux 敏感）：
`Ara.webp → ara.webp`、`Leo.webp → leo.webp`。

## 五、验收记录（2026-11-13）

- 切换：进入图集 → 地球 `running:false`、音乐暂停；返回 → 恢复、iframe
  同一实例（状态保持）✓
- 挂载（本地 + GitHub Pages 线上）：iframe 内 `#root` 有内容、`canvas`
  存在、加载层准时收起、0 页面错误 ✓
- 品牌：子文档 `--sx-accent` 计算值 = `#C9A96A` ✓；悬浮条含品牌标与署名 ✓
- 深链接：`?mode=solar&solar-layers=L03.dsn,F08.nomenclature` 直达并透传 ✓
- 移动端：390px 下 modes 隐藏、菜单入口可用、无横向溢出 ✓
- 深空模式数据补齐：分层星点二进制（l0 + 96 分片）、88+ 星座描绘图 ✓
- 线上剩余 404/503 仅三处且属预期：`/api/orbits`（上游后端依赖，与参考站
  一致）、`/sky/tiles/` 与 `/sky/dso-img/` 清单（Tier-2 未镜像）
