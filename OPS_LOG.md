# 运行状态检查与优化 · 2026-11-12

> 机器：Windows / 24 逻辑核。检查时间 12:03–12:20。
> 结论先说：系统本身健康（无进程吃满 CPU，有无响应窗口 1 个），
> 真正的浪费是调试过程留下的三个孤儿静态服务器；已清理。
> 同时完成移动端修正与云同步接入（后者需要发布到应用域名才生效，见文末）。

---

## 一、进程检查与清理

### 判定依据

| 判定 | 阈值 / 方法 |
| --- | --- |
| CPU 异常 | 3 秒双采样，`ΔTotalProcessorTime / 3000ms / 24 核`，取 > 5% |
| 内存异常 | `WorkingSet64` > 500 MB |
| 僵尸 / 假死 | 有窗口但 `Responding = false`；或进程名对不上任何在用的程序 |
| 冗余 | 端口在监听但无人使用、目录已不存在、由本次会话遗留 |

### 实测（采样时刻）

| 进程 | CPU | 内存 | 判定 |
| --- | --- | --- | --- |
| WorkBuddy（IDE 本体） | 2.6% | 1187 MB | 在用，保留 |
| sandbox-center | 1.2% | 21 MB | 在用，保留 |
| 360se ×3 | ≤1.0% | 273/275/307 MB | 你的浏览器，保留 |
| Rainmeter / hxperformance / Nexus | ≤0.2% | 9–28 MB | 桌面组件，保留 |
| python :8765 | 0% | 24 MB | **本次调试遗留，清理** |
| python :8123 | 0% | 17 MB | **上一轮遗留，清理** |
| python :8899 | 0% | 15 MB | **上一轮遗留且已无响应，清理** |
| SystemSettings | 0% | 4.5 MB | **窗口无响应，清理** |
| uvicorn server.main:app | — | 235 MB | 你自己的服务，保留 |

### 已执行

```
killed 12568 python 24.0MB — 本会话遗留的静态服务器 :8765
killed 47168 python 17.3MB — 历史遗留的静态服务器 :8123
killed 9416  python 14.6MB — 历史遗留的静态服务器 :8899（已无响应）
killed 17056 SystemSettings 4.5MB — 窗口无响应
```

复核：8765 / 8123 / 8899 三个端口均已关闭，无残留。

### 取舍说明（不动那些"看起来占资源"的进程）

- **WorkBuddy 1.1 GB**：这是当前会话的宿主进程，杀掉等于中断任务。
  它的内存主要是 WebGL/编辑器的常驻缓存，CPU 空闲时接近 0，不属于"资源占用过高"。
- **360se 三个进程共 ~850 MB**：浏览器按站点隔离进程是 Chromium 系的设计，
  合并反而更慢；且标签页是你的工作现场，不做处理。
- **uvicorn 235 MB**：正在跑你自己的 Python 服务，属于业务进程。
- **没有做"降配"改动**：唯一值得调的是浏览器标签数，但那是使用习惯，不是配置问题；
  强行改注册表/优先级会带来不确定副作用，收益也小。

---

## 二、问题修复与验证

| # | 现象 | 修复 | 验证 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 账号弹窗里的云同步条在 368px 宽下被挤成三行，按钮压住文字并溢出 | 由「点-文字-按钮」三列改为两列网格 + 按钮独占一行 | 375/390/1280 三档截图 | 通过 |
| 2 | 手机端相册标题「京都」钻到吸顶栏底下，与「相册」重叠 | 640px 以下把 `.album__head` 的 `padding-top` 提到 76px（> 栏高 56px） | 390×844 截图 | 通过 |
| 3 | 手机端相册顶栏「在地球上查看 / 编辑 / 删除」挤成一排小字，触控高度仅 28px | 640px 以下收窄间距、隐藏面包屑、按钮 `min-height: 36px` | 同上，三项操作完整可读 | 通过 |
| 4 | 未绑定云服务的域名上，云同步条给出一个点不通的按钮 | 按 hostname 判定可用性，未绑定直接隐藏整块 | GitHub Pages 与 localhost 分别截图 | 通过 |
| 5 | 页面在移动端出现横向溢出？ | 实测 `document.scrollWidth === innerWidth (390)` | 无溢出 | 通过 |

---

## 三、移动端优化

| 项 | 调整前 | 调整后 |
| --- | --- | --- |
| 相册顶栏高度 | 62px，四项挤在 390px 内 | 56px，间距收窄，面包屑隐藏，三项操作完整显示 |
| 顶栏按钮触控高度 | 28px | 36px（`min-height`），接近可点范围 |
| 相册标题与顶栏 | 重叠（padding 30px < 栏高） | 分离（76px 留白） |
| 手记输入 | 标题 1.45rem、按钮 7px 内边距 | 标题 1.05rem、按钮 9×16px，长按不误触 |
| 余味标签 | padding 5×11 | 7×12，拇指可点 |
| 云同步条 | 三列挤压 | 两列 + 整行按钮 |

未改动：首屏大标题与留白（这是刻意的"天空"区域）、空卡片竖排书名（`writing-mode: vertical-rl` 是设计语言）。

---

## 四、作品数据持久化（云同步）

### 架构

- **身份**：WorkBuddy 账号 OAuth（`signInWithOAuth({provider:'workbuddy'})`）。
  选它而不是邮箱/短信，是因为后两者依赖平台侧开通 Provider，当前环境没有可用的管理入口。
- **数据**：`atlas_albums`（地标 + 手记，`payload JSONB`）、`atlas_photos`（元数据 + 缩略图 + 对象存储路径）。
  两张表都开了 RLS，策略 `owner_id = auth.uid()`，前端从不发送 `owner_id`。
- **文件**：照片原图上传到 `users/<uid>/photos/<id>.jpg`，路径由 SDK 的 `userPath()` 生成。
- **可用域**：数据面按 Origin 精确匹配，只有发布到 `atlas-gallery.app.workbuddy.host` 才生效。

### 保存触发时机

| 时机 | 行为 |
| --- | --- |
| 新建/编辑地标、写手记 | `saveLandmarks()` 后 1.4s 防抖推送 |
| 上传照片 | 先落 IndexedDB，再排队上传原图（每批 6 张，失败重试 3 次） |
| 删除照片 / 删除相册 | 立即删除云端行（对象存储里的文件保留，避免误删） |
| 登录成功 / 切换账号 | 先拉取云端全量，合并后再按需推送 |

### 同步范围

- 相册：名称、英文名、坐标、日期、简介、手记（标题/正文/余味/时间）、主题色、封面、加密码哈希。
- 照片：名称、尺寸、拍摄时间、缩略图（随行一起走，换设备首屏即可看到）、原图路径。
- 不迁移：本机账号体系（PBKDF2 密码）、主题偏好、语言偏好 —— 这些是设备级设置。

### 未登录时

完全走原来的本地路径：`localStorage` + `IndexedDB`，不发起任何网络请求，功能不减。
本地账号（账号+密码）继续可用，只是"只在这台机器"。

### 验证状态

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 表结构与 RLS | `db_list_tables` → 两表 RLSOn=true | 通过 |
| SDK 初始化 | 页面加载无报错，`window.WorkBuddyCloud` 存在 | 通过 |
| 无会话时的降级 | `getSession()` 返回 null，页面正常 | 通过 |
| OAuth 往返 + 跨设备拉取 | **需要真人在已发布域名上完成一次授权** | 未验证 |

---

## 五、遗留

1. **发布才能用**：GitHub Pages 的域名不在云服务的 Origin 白名单里，
   云同步要在 `atlas-gallery.app.workbuddy.host` 上才生效。这一步会覆盖现有分享链接，
   需要你确认后再执行。
2. **邮箱/短信登录**：当前没有可用的 Provider 配置入口，若要"邮箱+密码"而不是 WorkBuddy 账号，
   需要在平台侧先开通。
3. **对象存储清理**：删除照片只删数据库行，原图仍在 `users/<uid>/photos/` 下，
   后续可加一个「清理未引用文件」的维护动作。
4. **冲突策略**：同 id 以云端为准；两台设备离线各自编辑同一条会以后写者覆盖先写者，
   目前没有做字段级合并。

---

# 六、数据链条梳理与架构收口 · 2026-11-12 下午

> 目标：让「表单 / 照片 → 本机 → 云端 → 备份」四条路径共用一套契约，
> 并给删除、离线、换设备、换账号这些真实场景一个可解释的结果。
> 完整说明见 **`DATA_ARCHITECTURE.md`**；这里只记问题与结论。

## 6.1 梳理时发现并修掉的断路

| # | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| 1 | 注册时勾了「迁移本机作品」，相册搬过去了，照片却全空 | `migrateGuestData` 只搬 localStorage；照片在按账号分库的 IndexedDB 里 | 新增 `migrateGuestPhotos()`，复制访客库到新账号库；`probeGuestData()` 把照片也算作访客作品 |
| 2 | 删掉的相册过一会儿又回来了（换设备/重登后） | 删除是物理删/内存过滤，没有"删除记录" | 墓碑 + `deleted` 列；删除优先于任何存活副本；墓碑保留 45 天 |
| 3 | 离线改的相册，一登录就被云端旧版覆盖 | 拉取逻辑是"云端为准" | `rev → at → 本地优先` 的合并；本地更新的条目留在本地并回头推上去 |
| 4 | 同步进行中保存的改动不会上传 | `schedulePush` 在 `pulling` 时直接 return，丢掉这次调用 | 改为 `queued` 标记，本轮结束后补排；脏标记持久化，刷新不丢 |
| 5 | 导入一份旧备份，出现统计里有、界面里没有的"幽灵照片" | 导入不校验归属/类型 | 逐条过 `albumIssues` / `photoIssues`；孤儿跳过并计数；导入即恢复（清墓碑） |
| 6 | 两个标签页同时开着，后保存的会把前一个的改动盖掉 | 各写各的 localStorage | `BroadcastChannel` + `storage` 双通道，180ms 防抖重读；正在编辑的表单不打断 |
| 7 | 换本机账号后，云同步把上一个账号的数据拉进新分区 | 云身份与本机分区没有绑定 | `atlas.cloud.scope.v1`：换账号即暂停，需显式"在此账号下启用" |
| 8 | 照片排序按上传时间，一次旅行里不同日子的片子被打乱；换设备后 EXIF 丢失 | EXIF 的 `DateTimeOriginal` 只格式化成 `YYYY.MM`，没进 `t`；`exif` 没上云 | `readExif` 增加 `ts`；入库优先用它；`atlas_photos.exif` 列随行同步 |
| 9 | 本地数据损坏时整页空白 | `JSON.parse` 抛错直接冒泡 | 返回 `{corrupted:true}`；页面继续，体检标 `store_corrupt`，toast 提示 |

## 6.2 新增的两层

- `assets/js/model.js` — 数据契约：字段、上限、默认值、id 规则、`rev/at` 合并、行 ↔ 记录映射。
  纯函数，不碰 DOM / 存储；四条写入路径共用。
- `assets/js/store.js` — 持久化适配：信封 `{v:5,at,items}`（旧裸数组自动升级）、
  IndexedDB v4（每账号独立库）、墓碑、脏标记、跨标签广播、体检。

边界：`main.js` 之外不碰 IndexedDB；`cloud.js` 不判断谁新谁旧；合并只在 `model.pickNewer` 一处。

## 6.3 云端结构变更

```sql
ALTER TABLE atlas_albums ADD COLUMN rev BIGINT NOT NULL DEFAULT 0,
                          ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE atlas_photos ADD COLUMN rev BIGINT NOT NULL DEFAULT 0,
                          ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false,
                          ADD COLUMN exif JSONB;
```

已核对：两表 `relrowsecurity = true`，策略 `owner_id = auth.uid()` 均存在。

## 6.4 验证

| 层 | 方式 | 结果 |
| --- | --- | --- |
| 契约 | `tmp/model.test.mjs`，13 项（含删除优先、往返不丢字段） | 13/13 通过 |
| 本机链路 | Playwright：上传 / 删除 / 刷新 / 旧格式迁移 / 损坏 JSON | 通过；删除后 IDB 归零、墓碑留存、刷新不复活 |
| 多标签 | 两个 page 同 context，A 写手记，B 300ms 内同步 | 通过 |
| 注册迁移 | 3 地标 + 1 照片，迁移后 `health.issues = []` | 通过 |
| 同步引擎 | 内存云客户端：首推 / 本地编辑 / 远端编辑 / 远端删除 / 复活攻击 | 全部通过；复活被挡且云端被推回 `deleted:true` |
| 作用域 | 换本机账号后云同步暂停，点启用后绑定新分区 | 通过 |
| 真实 OAuth | 需发布到 `*.workbuddy.host` 并人工授权 | **未验证** |

## 6.5 遗留与收口（当日晚补）

1. 真实 OAuth 往返与跨设备拉取仍未做真人验证（域名未发布）——**仍遗留**。
2. ~~冲突以整条记录合并~~ → 相册已改为字段级合并（`mt` 时钟），照片仍整条合并。
3. ~~删除照片不清理对象存储~~ → 墓碑推送成功后 `storage.remove()` 删除原图。
4. ~~墓碑 45 天~~ → 保留 180 天；切回标签页超过 30s 会先拉一次，降低旧副本复活窗口。
5. `site` 标题/导语仍是设备级设置——**保留**，它属于"这台机器怎么展示"，不是作品。
6. 新增「整理数据」：删除坏记录与孤儿照片、清理失效封面，入口在保险库面板。
7. 云端点/密钥/默认主题/同步上限集中到 `assets/js/config.js`。

---

# 七、星空：移除银河带 · 2026-11-12 晚

**决定：移除，不做近似。**

- 删掉 `skyfield.js` 的银道几何、银盘高斯剖面、`LANES` 尘埃带、星表密度场；
- `FS_SKY` 只保留上下渐变 + 暗角 + 颗粒，不再有任何方向性结构；
- 主题删掉 `spaceCool / spaceWarm / nebula`；底色压到 5–8/255；
- 星表改为球面均匀采样，保留四级星等与六档色温；**星芒一并移除**；
- 删除 `sky-preview.html`、`SKY_RENDERER.md`，重写 `SKY_SPEC.md`。

验证：桌面 1440×900、移动 390×844、宣纸主题分别截图；斜向白色光带全部消失；
1:1 裁切下星点为大小/亮度不一的锐点，背景无可见色带；无控制台错误。


---

# 八、账号与跨设备同步 · 2026-11-12 晚

## 8.1 账号功能补齐

| 功能 | 实现 |
| --- | --- |
| 注册 | 用户名 NFKC 归一化、保留名、3–24 字；密码规则；PBKDF2 21 万轮；生成 20 位恢复码（只显示一次） |
| 登录 | 统一错误不泄露账号存在；失败节流 5/8/12 次 → 30s/5min/15min；老账号迭代轮数自动升级 |
| 修改密码 | 账号面板「修改密码」：当前密码 + 新密码 + 确认；拒绝与旧密码相同；成功后刷新会话 |
| 找回/重置 | 登录页「忘记密码？」→ 账号 + 恢复码 + 新密码；重设后恢复码轮换并再次只显示一次 |
| 恢复码 | 账号面板可凭当前密码生成新码；旧码立即作废；早期账号无码时明确提示 |
| 删除账号 | 需输入账号名 + 密码；只删本机分区，云端保留；清理会话与云作用域 |
| 会话 | 30 天，启动滑动续期；过期即退出；标签页每分钟 + 切回页面检查，防止以过期身份写数据 |

## 8.2 同步完善

- **站点设置** 入云：新增 `atlas_settings`（owner_id 主键 / payload / rev / updated_at），RLS 已核对；
  本地 `site` 带 rev/at，单文档 LWW，换设备自动恢复标题/导语。
- **云账号绑定**：本机账号记录 `cloudId`；换设备登录同一 WorkBuddy 身份时自动恢复作用域，
  不再要求点「在此账号下启用」；不同身份仍然暂停，避免串数据。
- **手动同步**：云状态条新增「立即同步 / 重试同步」，强制先拉后推并重置退避计数。
- **新设备示例册让位**：云端有真实数据时，本机刚灌的、未动过的三本示例册自动移除。
- 同步范围、触发时机、冲突与重试详见 `ACCOUNT_SYNC.md`。

## 8.3 验证

| 项 | 结果 |
| --- | --- |
| 注册 → 恢复码 → 重载登录 | 通过 |
| 改密（错误旧密码 / 成功）→ 旧密码失效 | 通过 |
| 恢复码重置 → 新码轮换 → 自动登录 | 通过 |
| 删除账号（名字校验 / 会话清理） | 通过 |
| 连续 5 次失败 → 30s 锁定 | 通过 |
| 会话过期 → 访客，数据仍在命名空间 | 通过（并修复 touchSession 复活过期会话） |
| 新设备云端恢复（1 册 + 1 照片 + 站点导语） | 通过，示例册让位 |
| 站点设置推送 / 拉取 | 通过（rev1 上云，rev9 落地） |
| 云账号自动绑定 | 通过（cloudId 写入、scope 自动切换） |
| 同步/墓碑/复活 | 沿用上一轮 fake-cloud 用例，全通过 |

## 8.4 仍遗留

1. ~~云同步必须发布到 `*.workbuddy.host`~~ → 已发布：
   `https://atlas-gallery.app.workbuddy.host/?sharecode=C7DL4AWHLA`。
   GitHub Pages 仍是纯本地模式；跨设备请用应用域名。
   真实 OAuth 往返仍需真人在该域名完成一次授权（代码与域名已就绪）。
2. 本机账号不可跨设备（密码不参与同步），跨设备身份只有 WorkBuddy OAuth。
3. 无邮箱/短信找回；恢复码是本机账号的唯一找回手段，丢失且忘密则本机账号不可恢复。
4. 无服务端会话吊销；改密不会踢掉其他设备（也没有跨设备本机会话）。

---

# 九、稳定性诊断与音频/移动端深化 · 2026-11-12 夜

> 完整问题清单（含严重度、影响范围、验证数据）见 **`STABILITY_AUDIT.md`**。
> 这一节只记"改了什么、为什么"。

## 9.1 三处会在真实使用中失效的问题

| 问题 | 触发条件 | 修复 |
| --- | --- | --- |
| 照片全量驻留内存 | 照片多起来就会（500 张 ≈ 2 GB 解码位图） | 启动只读元数据；原图在 大图/导出/上传 时单张取 |
| 云端拉取不分页 | 记录超过 1000 条（PostgREST 默认单页上限） | `range()` 每页 500，按 `local_id` 排序 |
| 请求无超时 | 弱网、代理、挂起的连接 | 每个请求 `guard()` 25–60 s，超时后复位并退避重试 |

## 9.2 其余修复

- `putPhoto()` 先读后写，避免元数据更新把原图写空。
- 普通 upsert 不再携带 `deleted:false`，避免覆盖另一台设备的墓碑。
- 编辑中跳过拉取，关窗后补一次（避免表单提交落到被替换的旧对象）。
- 上传失败计数落库，刷新后不再无限重试同一张。
- 缩略图 1280→640 px / q0.82→0.72（同步体积约 1/4）。
- 保险库体检合并成 260 ms 一次，大相册编辑不再发涩。
- 首次点击音量键不再"反而静音"（自动播放被挂起时先 resume）。
- 移动端：顶栏 6→5 个控件（主题并入「更多」）、统一 40 px 无边框图标、
  字号上调一档、全站 safe-area、弹窗可滚、输入框 16 px（防 iOS 缩放）、
  `overscroll-behavior-y: contain`（拖地球不触发下拉刷新）。

## 9.3 音频

- 钢琴改为 **4 组模态合成**：每组独立波表 + 独立衰减 + 泛音拉伸失谐；
  击弦点 1/7 处的凹陷取代旧版的 7/9 次泛音加强；加双层击弦噪声与制音器；
  同音重击先压掉上一个 voice。
- 配器：引子更轻、第 23 小节后两拍留白 + 定音鼓滚奏、第 24 小节大锣 + 低音簇 + 下潜、
  第 26–31 小节进铜管、高潮旋律加低八度与大提琴层。
- 总线：压缩阈值 −20→−16、比例 2.6→2.2（拉开动态），末级加限幅（防尖顶）。

## 9.4 验证

- 契约 17/17；同步 fake-cloud 全通过（含分页、墓碑、复活防护、设置同步）。
- 页面：上传 → 编辑 → 手记 → 大图 → 刷新 → 大图 → 导出，0 报错；
  `rev 3`、`mt = [name,note,memoir]`、`health.ok`。
- 音频：引子峰值 0.886 / 高潮 0.946，削顶 0；RMS 0.151→0.385；单音高次分音衰减明显更快。
- 移动端：390×844 无横向溢出，导航 5×40 px，主题可从菜单切换（noir→ivory）。

## 9.5 说明

整轮离线渲染在单个 `OfflineAudioContext` 里超过约 90 秒会卡住（与采样率无关），
所以音频校验用分段渲染（0–23 / 24–39 / 36–43）。这是测试工具的限制，
页面实时只排 2.8 秒，不受影响。


---

# 十、账号入口统一与音乐重写 · 2026-11-12 深夜

## 10.1 账号

- 文案改为「账号与作品只保存在本机浏览器，密码经 PBKDF2（21 万轮）派生后存储，明文不落盘。
  换设备请用保险库里的加密备份迁移。」
- 界面标题改为「ATLAS 账号」，注册按钮「注册 ATLAS 账号」。
- **云同步入口默认关闭**（`config.features.cloudSync = false`），界面不再出现第三方登录；
  `renderCloud` 直接隐藏，`schedulePush` / `syncNow` 在建网前就返回，不会产生后台请求。
  引擎、三张表与合并逻辑保留，改一个开关即可恢复。

## 10.2 音乐

- 重写为《ORBIT》：76 BPM、40 小节、A 小调、每和弦两小节（Am9–Fmaj7–Cmaj7–Gsus4）。
- 全曲只有一条 8 拍动机，用碎片 / 原型 / 高八度 / 倒影 / 增值 / 尾巴六种形态。
- 取消十六分固定音型（"杂乱"的主因）；改为五个频段层各司其职。
- 第 22 小节撤掉所有铺底，第 23 小节只留滚奏与一个音，第 24 小节砸下来（实测 0.020 → 0.290，23 dB）。
- 空间：6.2 s 混响 + 52 ms 预延迟、返回 180 Hz 高通 / 5.2 kHz 低通、次低音呼吸、气声、高频微光。

## 10.3 验证

- 分段渲染：0–23 峰值 0.518、24–39 峰值 0.865，削顶 0；引子 RMS 0.117 → 顶点 0.31。
- 循环点 39→0：前后 250 ms RMS 0.050 / 0.036，无静音小节。
- 钢琴单音：基频 −21 dB / 0.82 s，8 次分音 −24 dB，高次仍更快。
- 账号面板：标题「ATLAS 账号」、按钮「注册 ATLAS 账号」、无第三方登录、无控制台报错。

---

# 十一、标志升级、银河接入与缩放漂移修复 · 2026-11-12 深夜

## 11.1 标志 v2

- 几何：球 r=20.5 / A 顶点 (32,13) / 横杆 y=32.4 / 星 r=3.2 / 轨道 26.4×8 @ −17°。
- 关键决定：**A 是球体的骨架**——顶点是极点，两腿被球体裁切，横杆是赤道；
  球顶留 16° 缺口，极星嵌进去。删掉装饰，只留结构。
- 新增 `--brand` 变量：品牌金不跟随界面主色（远山主题的主色是蓝，不能让标志变蓝）。
- 文件：`mark-gold` / `mark` / `mark-paper` / `mark-mono` / `mark-small` / `favicon`，
  规范页 `brand.html`，文档 `BRAND.md`。
- 修：favicon 里「祖先 transform + clipPath」组合会导致 A 被整段裁掉，改为不做裁切、
  腿端点直接落在圆上；小尺寸另出 `mark-small`（去轨道、加粗、星改圆点）。

## 11.2 银河

- 换成真实巡天全景（8192×4096，与地球贴图同源），三档 10 / 31 / 93 KB。
- **生成时两遍处理**：先缩到目标尺寸，再做 1.5–5 px 高斯模糊。
  只缩不糊会把星点放成灰斑（第一版就是这个问题）；只糊不缩则细节全丢。
- 着色器按视线方向做等距圆柱采样，`uSkyTilt = 0.42`、`uSkySpin = 0` 让银道
  从默认机位中间偏上穿过；高光压缩 + 去底噪 + 向中性拉 45%（原图偏蓝紫）。
- 宣纸主题 `uSkyGain = 0`；星点层不变，锐度由星表负责。

## 11.3 缩放漂移

- 现象：滚轮缩放时右侧面板上下位移。
- 成因：`wheel` 只在"缩放值真的改变"时 `preventDefault`。到达 MIN/MAX 后函数直接 return，
  滚轮事件冒泡到页面 → 页面滚动 → 整块面板跟着上移。指针移出球体时同理。
- 修复：指针落在球面上时**一律** `preventDefault`，到极限只给 0.42 s 的亮度提示；
  指针在球外才把滚轮让给页面。
- 验证：连续 20 次滚轮到极限，`scrollY` 不变（1989 → 1989），面板 `top` 不变（0 → 0），
  画布出现 `is-limit` 类；指针移到球外再滚，页面正常滚动。

## 12 图层体系（Solar Atlas 拆解 → ATLAS）

参考：`solar-system-atlas.pages.dev/solar/?layers=L03.dsn,F08.nomenclature`。
把 2.5 MB 单包与 284 KB 样式反解后，拿到的是五件事：注册表字段、ID 语法、
`?layers=` 解析、面板几何、命名分层。ATLAS 照搬结构，不照搬内容。

### 12.1 拆解结论

- 参考站是单视图 SPA：`#root` + 一个 CSS + 一个 JS；全屏画布，UI 悬浮。
- 图层注册项统一为 `{id,title,summary,group,confidence,sources,scaleModes,budget,render,load,legend}`；
  内置 8 层，分 communication / dynamics / surface / heliophysics。
- ID 语法 `/^[A-Z]\d{2}\.[a-z0-9-]+$/`；`layers` 逗号分隔、trim、正则过滤、去重。
- 面板：右 20 / 上 84 / 下 168 / 宽 384 / 圆角 20 / 模糊 22；分区 10px 等宽 0.2em；
  激活行 2px 竖条 + 10% 渐变。
- 置信度四档 OBS / MODEL / HYPO / STORY；`F08` 的 1100 个 IAU 地名按缩放分级露出，
  圈=真实范围，点开就地介绍。

### 12.2 落地

- 新增 `layers.js`（注册表 + 状态机）、`layer-panel.js`（面板）、
  `earth-overlay.js`（经纬网/晨昏线/旅程线）、`nomenclature.js`（地名志）。
- 11 层：`L01.base` … `L08.meteor`、`F01.landmarks`、`F02.thread`、`F08.nomenclature`。
  4 组按阅读顺序：注记 → 地表 → 深空 → 基底；3 个预设：默认 / 测绘 / 纯净。
- 来源分三类：观测（影像/EXIF）、推算（公式生成）、私有（本机数据）。
- 依赖：开 `F08` 自动补 `F01`；关 `F01` 级联关 `F02`/`F08`；基底锁死。
- URL 与 `atlas.layers.v1` 由同一次 `emit()` 写入；默认状态自动清掉 `layers` 参数。
- 面板四层密度：组 → 行（开关/编号/来源）→ 一行摘要 → 展开（参数/来源/许可/预算/单独显示）；
  组头可跳转，列表可滚动，底部图例只列"有单位/数量"的层。

### 12.3 球面实现

- 复用 `earth.onProject` 交出的 `project(lat,lng)`，与标记同一帧、同一可见性判定；
  背面的线断开，不连弦。
- 经纬网 15°、采样 2.5°；赤道/本初子午线 1.35px；回归线与极圈虚线。
- 晨昏线用太阳高度角等值线：`sin(e)·s + cos(e)·(cosθ·u + sinθ·v)`，
  e=0 为晨昏线，−6/−12/−18 为三档暮光；另标正午点。
- 旅程线按创建时间做球面 slerp（2° 步长），虚线；`stats()` 给总里程。
- 地名志：区域编号 `EAS·03` / 完整 `F08.EAS.03`；圈径 `7+√n×2.6`（7–17px）；
  三档 5/11/全部（阈值 1.30 / 0.86）；标签按权重避让，靠右自动翻左；
  点开卡片显示坐标/片量/最近年份；悬停即停自转。

### 12.4 停靠取景

- `earth.setReserve(336)`：`fit()` 按 `w - reserve` 算机位，投影矩阵 `m[8] = reserve/w`
  把光轴左移半栏；`unproject()` 加回偏移，点击仍准。
- 面板收起 `reserve=0`，球回中心；≤1080px 改底部抽屉，抽屉高度受球区高度约束，
  并让开固定导航（`calc(100% - var(--nav-h) - 20px)`）。
- 修：移动端 HUD 原本 `top:12px` 被固定导航盖住（含新图层按钮），
  改为 `calc(var(--nav-h) + 8px)`；无 WebGL 时面板与按钮一起隐藏。

### 12.5 验收

- 默认 8/11，URL 干净；`?layers=L02.graticule,XX.foo,L99.nope` 只开 L01+L02；
  `?layers=F08.nomenclature` 自动补 F01；关 F01 级联关 F02/F08；刷新恢复；分享去噪。
- `reserve=336` 时球心 x≈306，面板左缘 592，球右缘 573，不重叠；控制台 0 error。
- 文档：`LAYER_SYSTEM.md`（拆解 + 契约 + 扩展 + 验收）。

## 13 背景细节：从程序星空到真实天球

参考站背景拆解：NASA/GSFC SVS 4851「Deep Star Maps 2020」64k EXR →
1024px 瓦片金字塔（16×8 / 32×16 / 64×32，按视场选级）+ tone 曲线
（black .003 / white .25 / gamma .38）+ 目录（5044 亮星 [ra,dec,mag,B−V]、
88 星座线、11 featured 天体、observations 用户观测）。
其"深空探索"模式还有 J2000 读出、星等 LOD（起手 6.2 等）、
图层 [连线/描绘/名称/深空天体/照片] 与搜索。

### 13.1 落地（只搬数据，不搬瓦片）

- `ref/sky-catalog.json` → `ref/build-skycat.py` → `assets/data/skycat.js`
  （145KB，生成文件）：5044 亮星 + 88 星座 743 线段。
- 坐标：J2000 赤道 → 银道，Hipparcos 旋转矩阵；脚本内置 5 颗恒星校验
  （天狼/织女/北极星/大角/南门二），误差 <0.1°。
- 色温：B−V → 黑体温度（Ballesteros）→ RGB（Tanner Helland），着色器内换算；
  aPack.z 由"6 档色温索引"改为直接传 B−V。
- 星等映射：`size = 1 + (3.2 − mag)×0.85`，`bright = 10^(−0.4 mag / 2.4)`，
  指数压到 1/2.4（屏幕吃不下 5 个星等的全动态范围）。
- 暗星 6.5–9 等仍程序生成补密；目录异步 import，失败回退纯程序星表，
  晚到时原地换缓冲。
- 新增图层 `F05.constellations`（88 星座连线，1486 顶点，独立线着色器，
  淡蓝 13% 透明度；顶点在相机背后时整段干净截断）。
- **对齐**：星点/星座线/银河共用银道坐标系，且与银河同参做 tilt(0.33)/spin(0)
  变换——猎户座会出现在银道带应有的位置。

### 13.2 验收

- `skyCatReady=true`、starN=230000（含 5044 真实亮星）、figureN=1486。
- 星座线开关像素 diff：4178 px 全在球盘外，线色 [64.6, 65.7, 71.7] 偏蓝 ✓。
- 亮星色温：蓝/白/橙并存（真实 B−V 分布）；天狼星银道坐标
  (227.23°, −8.89°) 与刊布值一致。
- 控制台 0 error；`?layers=F05.constellations` 可分享。

## 14 账号与作品云端同步（ATLAS 云账号）

需求：账号与作品上云、首登拉取、离线上传与冲突策略、多设备一致、
登录态/令牌刷新/配置异常降级、新建地标识别与坐标标注。

### 14.1 云端结构（已存在，核对通过）

- `atlas_albums` / `atlas_photos`：`owner_id DEFAULT auth.uid()`、
  `UNIQUE(owner_id, local_id)`、`payload` JSONB、rev、deleted 墓碑；
- `atlas_settings`：`owner_id` 主键单行文档（站点设置 + 账号资料 profile）；
- 三表 RLS 开启，owner-only 策略（ALL, USING/WITH CHECK = auth.uid()），
  授权覆盖 authenticated + anon。
- 端点 `atlas-gallery.app.workbuddy.host` 与站点同域：发布到应用域名
  时 Origin 精确匹配，云登录可用；GitHub Pages 降级为纯本地。

### 14.2 认证

- 邮箱验证码注册/登录（ATLAS 云账号品牌）：sendOtp → 保存挑战 →
  verifyOtp（提交只消费已保存的挑战，不重发）→ getSession 读会话。
- 会话由 SDK 持久化，getSession 近过期自动刷新；同步遇 401/凭据类
  错误先 refreshSession 一次，仍无会话则登出并提示。
- 配置异常四档降级：域名未绑定（Origin 校验）/ SDK 加载失败 /
  断网 / 同步失败，全部显式提示 + 本机可用，不静默。

### 14.3 同步引擎

- 首登：onCloudChange → 绑定分区 → syncNow('auth') → 先拉后推；
  拉取分页 500 行/页；合并 rev → at → 字段级 mt；原图按需（ensureBlob
  远端回退）；同步结果 toast 汇总（取回/合并计数）。
- 离线上传：脏标记 + 墓碑 pushedAt；编辑后防抖 1.2s、切回标签页、
  断网重连、手动同步多路触发；每轮 ≤6 张原图；指数退避 2s→60s×6。
- 推送行统一带 updated_at（LWW 时间基准）。冲突策略 = 行级
  rev→at→本地 + 相册字段级 mt 合并，合并结果自动回推，无需手选。

### 14.4 地标识别与坐标标注

- `ref/build-gazetteer.py` → `assets/data/gazetteer.js`（GeoNames
  cities5000，人口≥5 万 11985 城，5803 带中文名，618KB 懒加载）。
- 中文名提取：别名 CJK 候选（双字优先、去行政后缀）+ 130 条策展覆盖 +
  中文国名表；检索：全等 > 前缀 > 包含，同档人口降序。
- 对话框：输入即联想（↑↓/Enter/Esc）；选中回填中英名+坐标+国家；
  提交/失焦先查本地库再回落 Wikipedia+OSM。
- 「点选地球」拾取模式：对话框让位、十字光标、点击球面回填返回；
  Esc 取消回表单（preventDefault + 下一帧重开，规避 Esc 默认取消
  刚打开的模态框的陷阱）。

### 14.5 验收（桩 SDK 六组用例全过）

登录/首登拉取/昵称上云 ✓ · 冲突 LWW（云 rev9 胜本地 rev1）✓
· 断网重试恢复 ✓ · SDK 缺失降级 ✓ · 联想+点选往返+坐标入库 ✓
· 375px 面板无溢出 ✓。真实邮件验证码链路待用户在应用域名实测。

## 15 太阳系图集整合（Atlas of Space · Apache-2.0）

### 15.1 可行性

- 上游 gordonhart/atlasof.space：Apache-2.0、纯静态 SPA（Vite+React+
  Three.js）、主题全 CSS 变量驱动（--sx-accent 等）、图层状态走 ?layers=。
- 结论：自托管 + 同源 iframe 是最优解（隔离 + 可注入样式/DOM + 状态常驻）。

### 15.2 落地

- vendor：ref/vendor-solar.sh（content-type 白名单 + 15MB/文件上限）
  镜像外壳（solar/）+ 行星 2k/4k/8k + 太阳 AIA 九波段 + 土星环 +
  卫星纹理（含 hd）+ 星表/银河 8k/88 星座描绘图（按 catalog art 字段
  的真实文件名，缩写名是坑）+ 地球模块数据 + 字体；合计约 230MB。
- 集成（main.js initSolarIntegration）：头部「地球|太阳系」分段切换 +
  移动端菜单入口；enterSolar 首次进入才建 iframe（懒加载），
  「HTML load ≠ 挂载完成」→ 轮询 #root 子节点再收加载层；
  exitSolar 只隐藏不销毁（状态保持）；进入停地球（stop）与音乐、
  返回恢复；?mode=solar 深链接 + ?solar-layers= 透传；sessionStorage 记忆。
- 品牌：同源注入样式表（html:root + !important 映射 --sx-accent/--node/
  --accent-yellow/--sx-cool → 品牌金 #C9A96A；挂 body 末尾压过其 <link>）；
  父页面悬浮条：返回按钮（让开其 40px 顶栏）+「ATLAS × Atlas of Space」署名。
- 性能/缓存：_headers 新增 /fonts immutable、/solar/assets 7d、
  纹理目录 14d；首屏零额外请求。
- 许可：solar/LICENSE（Apache-2.0 全文）+ solar/ATTRIBUTION.md（素材署名）。

### 15.3 验收

- 切换往返：地球 running false→true、iframe 同实例、挂载 canvas 正常、
  --sx-accent 计算值 #C9A96A、加载层按时收起 ✓
- 深链接 ?mode=solar&solar-layers=… 直达且透传 ✓；390px 菜单入口 ✓
- 子路径部署适配：字符串改写被运行时 "/"+path 拼接击穿 → 改为基础路径
  补丁（base-path-shim 内联外壳，Image.src/fetch/XHR 归一化到站点根，
  根部署恒等）；JS 仅修 Worker 入口（document.baseURI）。
- 大小写坑：Ara.webp/Leo.webp → 小写（Windows 不敏感、GH Pages Linux 敏感）。
- 深空数据补齐：分层星点 l0+96 分片（4MB）、88 星座描绘图。
- 线上验收：挂载 canvas ✓、--sx-accent=#C9A96A ✓、0 错误；
  剩余 404/503 仅三处且属预期：/api/orbits（上游后端依赖）、
  /sky/tiles 与 /sky/dso-img 的 manifest（Tier-2 未镜像，见 SOLAR_INTEGRATION.md）。

## 16 配置与架构收口：运行时缓冲、缓存与错误策略（v2.6.0）

### 16.1 配置集中

- `config.js` 新增 `APP.runtime`：layerRailWidth / urlCacheCap / blobMemBudgetBytes(96MB) /
  syncDebounceMs / toastMs / errToastThrottleMs / errRingSize；版本 → 2.6.0。
- main.js 硬编码（LAYER_RAIL、URL_CAP、toast 3200、schedulePush 1200）全部改为读配置。

### 16.2 Blob 内存预算（新增）

- 问题：ensureBlob 把原图留在 photo.blob，导出/上传全本相册后 Blob 堆积不释放。
- 方案：blobLRU（按最近用到记账）+ blobBytes 累计 + 96MB 预算；超限按 LRU
  releaseBlob（dropURL 联动撤销 objectURL + 置空 blob）；正在大图展示的记入
  hotBlobs 跳过释放（showPhoto 加/删）。
- 释放时机：trimBlobs() 在相册关闭与备份导出后主动调用；上传完成立即 releaseBlob。
- 观测句柄 `atlasMem()`：blobBytes / 预算 / LRU 数 / URL 池 / hot / pending。

### 16.3 错误处理

- 全局 error / unhandledrejection：原为 console.warn → 升级为环形缓冲（12 条，
  `atlasErrors()`）+ 节流 toast（同信息 5s 一次）；良性网络错误（failed to fetch
  等，各模块自会提示）不打扰；暴露 `window.atlasErrors`。
- WebGL 上下文丢失：earth.js 新增 onContext 回调 → 主页面显示「渲染被系统挂起，
  正在恢复…」加载层；恢复后重载贴图自动收起（此前只有 console.warn）。
- IndexedDB 读取失败：boot 里从静默吞掉改为 reportError（日志 + 一次性提示）。
- 缩略图 onerror：移除 img + shot.is-missing 占位（∅），读屏「原图不可用」，
  不留浏览器碎图标。

### 16.4 体验与完成度

- 跳转链接（skip-link，聚焦才可见）；性能标记 atlas:boot-start / first-paint /
  earth-ready + `atlasPerf()`；toast 时长入配置。
- 安全头：X-Frame-Options SAMEORIGIN + Permissions-Policy（geolocation/mic/camera/payment 全关）。

### 16.5 验收

- polish 四例：性能标记齐全、atlasErrors/atlasMem 就绪、唯一错误 toast+环形缓冲、
  良性错误静默、上下文丢失 UI 出现且 running=false、跳转链接与 aria-live ✓
- 回归：cloud 六用例、solar 三用例全 PASS；375px 无横向溢出、0 页面错误。

## 17 太阳系场景性能专项（v2.6.1）

### 17.1 图集内部机制（反解确认）

- 自带质量调节器：60fps 目标（Vee=1000/60）、1000ms 采样窗、帧时间 >20.8ms
  连续 2 窗降档、<13.3ms 连续 5 窗升档、冷却 1800ms；`?quality=auto|low|…`
  参数可直接定档；阶梯 ULTRA→HIGH→MEDIUM→LOW→SAFE（预设叠加数 0/1/4/8/全）。
- 默认起点：桌面 ULTRA、移动 HIGH——桌面前几秒过冲是卡顿来源之一。

### 17.2 落地

- 宿主按设备算层级（low/med/high），传 `?quality=auto&atlasq=<tier>`；
  shim 扩展：DPR 覆盖（1.25/1.5/2）+ 纹理 URL 降级映射（太阳科学波段除外）；
  渲染器两处 antialias 打补丁（low 关 MSAA）；宿主 URL ?atlasq= 可手动固定。
- 转场：0.45s 交叉淡入淡出；预热 = 悬停切换钮即拉 iframe（display:none 挂起
  其 rAF，只花内存不花 GPU；≤3GB 内存不预热）。
- 修两个 bug：① 退出淡出期间 solarActive 陈旧 → 再次进入被挡（改以 DOM 状态
  为准）；② iframe loading="lazy" 使预热完全不加载（移除）。淡入起点改强制
  回流（双 rAF 在重载下可能几百毫秒不补帧）。
- 观测：atlasSolarTiming() / atlasSolarPerf(n)（rAF 采样 + __atlasQuality 自测），
  退出时控制台自动留快照。
- 新增补丁脚本 ref/patch-solar-perf.py（幂等）；补拉 moon_normal-4k.png（10.7MB，
  med/low 档月球法线的降级目标）。

### 17.3 验收（SwiftShader 软件渲染压测，绝对值为下限）

- 预热后进入 7ms（基准无此机制，冷进入 3000ms）；再次进入 6ms。
- 静止帧时间 306→226ms（−26%）、拖动 244→200ms（−18%）、缩放 252→203ms（−19%）、
  p95 383→254ms（−34%）、JS 堆 73.2→67.9MB（−7%）。
- solar 三例回归 PASS；转场隔离测试通过（0→1 推进正常）。
- 真机（GPU）预期各档接近 60fps；low 档收益在弱 GPU/核显最显著。

## 18 图集品牌化：署名、首页与面板（v2.6.2）

- ref/patch-solar-brand.py：在 bundle「原始转义空间」做定向替换
  （先踩了整文件解码的坑：字符串内 \u0022 等被解码成真实引号破坏语法，
  改为按转义约定生成匹配串直接替换）。
- 作者面板 → Lee / AtlasL / 微信 lzx_O7（点击复制，clipboard+execCommand
  双回退，「已复制 ✓」反馈）/ GitHub；声明融入 ATLAS 私人图册语境；
  原双作者署名全清。
- 首页 → AtlasL 图谱（en: AtlasL · SOLAR ATLAS）；左下角声明与创作者
  展示 CSS 隐藏；副标题/版本行品牌化。
- 宿主：iframe allow=clipboard-write、title 改 AtlasL 图谱、外壳 meta 同步、
  debug=1 只读句柄常开（供体检）。
- 注入 CSS：creatorpanel 品牌金描边/圆角、sp-panel 描边收拢——只调色排版。
- 验收：面板内容/描边/圆角命中；复制反馈命中；旧署名 0 残留；回归 9 例全过。

## 19 地球背景专项：真实星空与 4K 银河（v2.6.3）

### 19.1 银河贴图重建（ref/build-sky.py）

- 旧 4K 91KB → 从 8192×4096 ESO 母版 Lanczos 重建：4K 1.4MB / 2K 115KB / 1K 39KB。
- 处理链：Lanczos → 高斯（1K 1.2 / 2K 2.2 / 4K 0.8）→ UnsharpMask 大半径低强度
  （threshold=2，只找回尘埃带边缘，不放大噪点）→ JPEG 4:4:4（防色度渗出）。

### 19.2 着色器（FS_SKY）

- 尘埃/星云质感：两组 3D 值噪声（240/64 周）锚定天球方向（无接缝），
  band=luma×4 掩码只在银道亮处浮现；暖调 mix((1.10,1.02,0.92), warm×band)。
- 抖动改自适应：暗处 1.5×、亮处 0.3×——专打暗空 8bit 色带。
- 亮星辉光（FS_STAR vGlow）：<2 等叠更宽光晕，与暗星拉开层次。

### 19.3 星点分布（buildStars 暗星）

- 银道聚集：62% 落 |银纬|≤18°；星等幂律 mag=6.5+2.5u²；B−V 偏斜 0.35–1.45。
- 星座连线 F05 从注册表删除（渲染代码保留休眠）；旧 URL 参数被注册表过滤。

### 19.4 配置

- APP.runtime.sky：tilt/spin/gain/dust/warm 五个参数，earth.js 读配置，
  主题表只覆盖 gain。

### 19.5 验收

- 面板无 F05；图例「星表 · GAIA」；0 报错。
- 截图数值分析（2160×1350 @1.5dpr）：银道带区 std 80 vs 远空 std 6.7；
  星色蓝 10% / 白 70% / 橙 20%；远空角无灰斑。
- 回归：cloud 六例 + solar 三例 + polish 四例全 PASS。
