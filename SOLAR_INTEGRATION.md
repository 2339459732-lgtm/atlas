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

## 五之补、性能专项（v2.6.1）

### 目标与指标

- 目标帧率 60fps（帧时间 16.7ms）；可接受波动：帧时间 ≤20.8ms（+25%），
  掉帧（帧时间 >25ms）占比 ≤5%；转场进入 ≤200ms（预热命中）/ ≤3s（冷启动）。
- 图集内置自适应调节器（1000ms 采样窗、60fps 目标、连续 2 窗超预算降档、
  连续 5 窗低于 13.3ms 升档、1800ms 冷却）——我们不改它，而是给它更好的
  起点与更轻的输入。

### 层级策略（宿主算，shim 执行）

| 层级 | 触发条件 | 纹理 | DPR | MSAA | 自适应 |
| --- | --- | --- | --- | --- | --- |
| low | 核数≤4 / 内存≤4GB / 省流量 / 2G 网络 | 4K→2K、8K→4K/2K、卫星 hd→基础、月球 16K→2K | 1.25 | 关 | quality=auto 继续兜底 |
| med | 核数≤6 / 内存≤6GB / 窄屏 | 8K→4K、月球 16K→8K | 1.5 | 开 | 同上 |
| high | 其余 | 原样 | 2 | 开 | 同上 |

- 太阳科学波段（sun_aia/sun_lut）只有 4K 版，不做跨级映射（避免 404）；
- 宿主 URL `?atlasq=low|med|high` 可手动固定（验收/手动降级入口）；
- 纹理降级在 shim 的 Image.src/fetch/XHR 三通道生效，与子路径归一化共用一条 fix 链；
- 渲染器两处 `antialias:!0` 打补丁为 `window.__atlasQ!=="low"`（ref/patch-solar-perf.py，幂等）。

### 转场与预热

- 进入/退出改为 0.45s 交叉淡入淡出（visibility 延迟跟随），prefers-reduced-motion 即时；
- **预热**：桌面悬停「太阳系」切换钮即拉起 iframe（display:none 下浏览器挂起其 rAF，
  只花内存不花 GPU）；低内存（≤3GB）不预热；
- 修复两个状态 bug：退出淡出期间的陈旧 solarActive 挡住再次进入（改以 DOM 状态为准）；
  iframe 的 loading="lazy" 使预热完全不生效（移除）；
- 淡入起点用强制回流代替双 rAF——重载下 rAF 可能几百毫秒才补一帧。

### 观测与验收数据（SwiftShader 软件渲染压测，绝对值为下限）

基准 = ea1840c（未优化），opt-low = atlasq=low。同一脚本、同一环境：

| 指标 | 基准 | 优化（low） | 变化 |
| --- | --- | --- | --- |
| 冷进入 → 加载层收起 | 3000 ms | 2911 ms | ≈（本地源，瓶颈在挂载） |
| **悬停预热后进入** | —（无此机制） | **7 ms** | −99.8% |
| 再次进入（状态保留） | 即时 | 6 ms | 即时 |
| 静止帧时间（均值） | 306 ms | 226 ms | **−26%** |
| 拖动帧时间 | 244 ms | 200 ms | **−18%** |
| 缩放帧时间 | 252 ms | 203 ms | **−19%** |
| 帧时间 p95（静止） | 383 ms | 254 ms | −34% |
| iframe JS 堆 | 73.2 MB | 67.9 MB | −7% |

真机预期：SwiftShader 是纯 CPU 光栅化，GPU 机型上各档绝对值接近 60fps；
low 档的降幅（像素量、AA、纹理带宽）在弱 GPU/核显上最显著。
观测句柄：`atlasSolarTiming()`（进入耗时/是否预热命中）、
`atlasSolarPerf(n)`（iframe 内 rAF 采样：fps/帧时间/p95/掉帧比/抖动 + 应用自测
`__atlasQuality`）；退出图集时控制台自动留一帧快照。

## 五之补二、品牌化专项（v2.6.2）

### 目标

图集子应用完全并入 ATLAS 品牌：作者署名、首页文案、面板质感全部换成
ATLAS 自己的内容与设计语言——不照抄原站任何署名与文案（上游 Apache-2.0
许可与素材署名保留在 `solar/LICENSE` / `solar/ATTRIBUTION.md`，UI 层不出现）。

### 落地（ref/patch-solar-brand.py，幂等，在转义空间做定向替换）

- **作者面板**（设置 → 关于作者）：
  - 主创 Lee / AtlasL；声明改为「个人创作的天文可视化作品，收录于 ATLAS
    私人图册」；页脚 © 2026 Lee · ATLAS 图谱；
  - 链接：微信 lzx_O7（点击复制，Async Clipboard + execCommand 双回退，
    复制后显示「已复制 ✓」）、GitHub 在线图册；
  - 原双作者（氕氘氚/ESSELANO + Quincy）全部移除。
- **首页**：标题「AtlasL 图谱」（en: AtlasL · SOLAR ATLAS）；副标题
  「一份私人坐标图谱」（en: A PRIVATE CARTOGRAPHY BY LEE）；版本行
  「ATLAS 图谱 · 2026」；左下角原站声明与创作者展示由注入 CSS 隐藏。
- **面板质感**（注入 CSS）：作者面板品牌金描边/圆角/字距；主图层面板
  （.sp-panel）描边向品牌金收拢——只调色与排版，不改布局与内容。
- **宿主**：iframe `title`/悬浮署名改「AtlasL 图谱」；`allow` 增加
  `clipboard-write`；外壳 <title>/<description> 同步；iframe 常驻加
  `debug=1` 只读句柄（供 atlasSolarPerf 体检）。

### 验收

- 面板实测：ABOUT · ATLAS 图谱 / Lee / ATLAS 图谱 / 声明文案 / 微信
  lzx_O7 / GitHub / © 2026 Lee · ATLAS 图谱 / 品牌金描边 rgba(201,169,106,.32)
  / 14px 圆角，全部命中 ✓
- 微信点击复制：反馈「已复制 ✓」✓（测试环境走 execCommand 回退；
  真机 https + 用户手势走 Async Clipboard）
- 旧署名清零：ESSELANO/Quincy/xiaohongshu/b23.tv 在 bundle 中 0 残留 ✓
- 回归：cloud 六例 + solar 三例全 PASS；0 页面错误。

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
