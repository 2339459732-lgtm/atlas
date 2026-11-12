# ATLAS 数据架构与链路说明

> 2026-11-12 · 对应数据契约版本 `SCHEMA = 5`、IndexedDB 版本 `4`
> 一句话结论：**所有写入都必须经过 `model.js` 的契约与 `store.js` 的落盘；云端只是同一份数据的远端副本，不拥有"谁该赢"的判断权。**

---

## 0. 一页速览

| 数据域 | 载体 | 真相源 | 是否跨设备 |
| --- | --- | --- | --- |
| 地标 / 相册 / 手记 | localStorage `atlas.landmarks.v4`（信封 `{v:5,at,items}`） | 本机 + 云端合并 | 是 |
| 照片原图与元数据 | IndexedDB `atlas-plates`（每账号独立库） | 本机 Blob + 云端行 | 是（按需下载原图） |
| 本机账号 | localStorage `atlas.accounts.v1` + `atlas.session.v1` | 本机 | 否（设备级） |
| 云同步作用域 | localStorage `atlas.cloud.scope.v1` | 本机 | 否（绑定当前本机账号） |
| 主题 / 语言 / 画质 / 音乐 | localStorage | 本机 | 否（设备偏好） |
| 加密备份 | 用户手中的 `.atlas` 文件 | 文件本身 | 手动迁移 |
| 地球标记 / 轮播 / 统计 | 内存派生 | 由上面两库实时计算 | 不适用 |

---

## 1. 模块职责边界

```
config.js    全局配置：云端点/密钥、默认主题、功能开关、同步与保留期上限。只放参数，不放逻辑。
model.js     数据契约：字段、上限、默认值、id 规则、合并规则。纯函数，不碰 I/O / DOM。
store.js     本机持久化：信封版本、IndexedDB、墓碑、脏标记、跨标签广播、体检。唯一碰 localStorage/IDB 的模块。
cloud.js     云端传输：OAuth、两张表、对象存储。只负责"送上去/拉下来"，不含业务判断。
accounts.js  身份与命名空间：PBKDF2 本机账号、key()/dbName() 分区、访客数据迁移。
vault.js     备份密码学：gzip + AES-GCM，导入导出。
main.js      编排与视图：唯一修改 state 的地方；调用上面四层，渲染 DOM / 地球 / 统计。
earth.js     渲染：球体、着色器、相机、拾取。不读写任何持久化数据。
drift.js     首屏微尘；audio.js 配乐；i18n.js 文案；exif.js / geo.js 外部数据适配。
```

依赖方向是单向的：

```
main ──> store ──> model
  │        │
  ├──────> cloud          （cloud 不 import store / main）
  ├──────> accounts
  ├──────> vault
  └──────> earth / drift / audio / i18n / exif / geo
```

**硬规则**：`main.js` 之外不许直接调用 `indexedDB`，也不许自己拼 `atlas.*` 键；`cloud.js` 不许判断"本地更新还是云端更新"。

---

## 2. 数据流

### 2.1 写入（新建 / 编辑 / 手记 / 上传照片）

```
表单 / 拖拽 / 编辑器
   │  原始值（可能是 NaN、超长文本、非法颜色）
   ▼
model.normalizeAlbum / normalizePhoto      ← 唯一校验点
   │  合法记录（默认值、截断、id 生成、坐标解析）
   ▼
store.saveAlbums / putPhoto                ← 唯一落盘点
   │  内容有变 → rev+1、at=now；写失败 → 返回 {ok:false,error}
   ├─> localStorage 信封 / IndexedDB
   ├─> dirty 标记（待上云）
   └─> BroadcastChannel('atlas-store') → 其他标签页重读
   ▼
main 重新渲染（墙 / 标记 / 统计 / 手记）
```

### 2.2 启动读取

```
boot()
 ├─ loadAlbums()       信封优先；裸数组自动升级为 v5；坏 JSON → {corrupted:true}
 ├─ allPhotos()        逐条过契约；坏记录丢弃并计数
 ├─ probeGuestData()   地标 + 照片都算"访客作品"
 ├─ 派生视图          renderWall / buildMarkers / syncStats
 └─ atlasData.health() 控制台体检（不阻塞）
```

### 2.3 云同步（先拉后推）

```
schedulePush（编辑后 1.2s 防抖）
   ▼
syncNow
   ├─ 未登录 / 域名未绑定 / 作用域不符 / 离线 → 直接返回
   ├─ syncPull（首次或强制）
   │    ├─ pullAll() → 行 → model.albumFromRow / photoFromRow
   │    ├─ mergeCollections(本地 + 本地墓碑, 云端)
   │    ├─ 云端墓碑 → 本地删数据 + 落本地墓碑（pushed=true）
   │    ├─ 云端"活着"但本地墓碑 → 挡住 + 墓碑重新排队（pushed=false）
   │    └─ 落盘（bump=false，保留合并后的 rev）
   └─ syncPush
        ├─ 相册：有 dirty 或未推送墓碑 → 全量行 upsert
        ├─ 原图：每轮 ≤6 张，失败 3 次跳过
        └─ 照片元数据：只推 dirty / 无 remote 的 + 墓碑
```

失败按 2s / 4s / 8s … 最多 60s、最多 6 次退避；之后由下一次编辑、`online`、切回标签页或重新登录触发。

### 2.4 备份与恢复

```
导出：state.site + albums + photos(blob→base64) → JSON → gzip → AES-GCM
导入：解密 → 逐条过契约 → 相册合并（导入方 rev 抬到最高）→ 照片校验归属
     → 清掉被恢复条目的墓碑（明确的"恢复"意图）→ 排队推送
```

### 2.5 账号切换与迁移

```
注册本机账号
 ├─ migrateGuestData()    搬 localStorage 键（含墓碑元数据）
 └─ migrateGuestPhotos()  复制访客 IndexedDB → 新账号库（不是移动）
登录 / 退出 → location.reload() → 命名空间切换 → 重新读库
云同步作用域 ≠ 当前本机账号 → 暂停，等用户点"在此账号下启用"
```

---

## 3. 数据契约

### 3.1 相册 `album`

| 字段 | 类型 | 约束 / 默认 |
| --- | --- | --- |
| `id` | string | `^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`；缺失则生成 `lm-…` |
| `name` | string | ≤60，去控制字符；空则"未命名" |
| `nameEn` | string | ≤80 |
| `coord` | string | ≤40；缺失时由 `lat/lng` 反写 |
| `date` | string | ≤40，自由文本 |
| `note` | string | ≤600，多行，连续空行压成一行 |
| `memoir` | object? | `{t≤60, b≤900, m:0-3|null, at}`；t/b 都空 → null |
| `accent` | string | `#rrggbb`，非法回落到主题金 |
| `coverId` | string? | 必须是合法 id，否则 null |
| `lat/lng` | number? | 纬度 ±90、经度 ±180，否则回落到 `coord` 解析 |
| `keyHash` | string | 64 位 SHA-256 hex，否则空（相册不加密） |
| `createdAt` | number | 毫秒；0 表示未知 |
| `mt` | object | 字段修改时间表 `{name,note,memoir,coverId,geo,…}`，字段级合并用 |
| `rev` | number | 修改代数，合并第一关键字 |
| `at` | number | 最后修改时间，合并第二关键字 |
| `deleted` | boolean | 墓碑标记 |

### 3.2 照片 `photo`

| 字段 | 类型 | 约束 / 默认 |
| --- | --- | --- |
| `id` | string | 同上；缺失生成 `ph-…` |
| `landmarkId` | string | 必须存在；兼容旧 `chapterId` |
| `name` | string | ≤60 |
| `w/h` | number | 1–12000；非正数回落 4:3 |
| `t` | number | 拍摄时间（优先 EXIF），非法/未来 → 当前时间 |
| `thumb` | string | 必须 `data:image/…` 且 ≤600 KB，否则丢弃 |
| `remote` | string? | 必须匹配 `users/<uid>/photos/<id>.jpg`，否则 null |
| `exif` | object? | 白名单 `camera/f/ss/iso/fl/date/ts` |
| `rev/at/deleted` | | 同上 |

### 3.3 id 与时间

- 新 id 一律带前缀与随机段：`lm-<base36 time>-<rand>`、`ph-…`。
- 所有时间都是毫秒整数；0 表示未知，不参与"更新更晚"的判断。
- `rev` 由 `store.saveAlbums` 在内容变化时自增，调用方不需要手写。

---

## 4. 校验与失败处理

| 数据来源 | 校验点 | 失败时的行为 | 用户可见 |
| --- | --- | --- | --- |
| 表单 | `normalizeAlbum` + 提交前名称非空 | 保留旧值 / 提示 | 表单错误文案 |
| 照片入库 | `normalizePhoto` + 尺寸/类型/大小上限 | 单张跳过，其余继续 | "已添加 N 张（跳过 M 张）" |
| localStorage | `loadAlbums` JSON 解析 + 逐条 normalize | 坏 JSON → 空列表 + `corrupted`；坏条目丢弃计数 | toast + 体检"1 项异常" |
| IndexedDB | `allPhotos` 逐条 normalize | 坏记录不进入内存（原记录保留在库里） | 控制台警告 |
| 云端行 | `albumFromRow` / `photoFromRow` | 缺 id / 非法类型 → 丢弃 | 无感（下次拉取重试） |
| 备份文件 | `albumIssues` / `photoIssues` + 归属检查 | 整条跳过；可修字段修掉并计数 | "恢复 N 处 · 修正 M 项 · 跳过 K 条" |
| 删除 | id 合法性 | 非法 id 不落墓碑 | 无 |

---

## 5. 一致性机制

1. **单写者**：只有 `store.js` 写本机数据；`main.js` 只改内存后调用它。
2. **版本合并**：`rev` 大者赢 → `at` 晚者赢 → 平局保留本地（`model.pickNewer`）。
3. **删除优先**：墓碑与存活记录冲突时，墓碑赢——离线设备推旧副本不会让相册复活。
4. **墓碑保留 180 天**：推送成功只标记 `pushedAt`，不删除记录；否则本地会失去"这被删过"的记忆。到期由 `pruneTombstones()` 清理（`config.limits.tombstoneDays`）。
5. **先拉后推**：首次进入或换设备时先合并再上传，避免用空本地覆盖云端。
6. **脏标记持久化**：`atlas.meta.v1` 记录哪些相册/照片还没上云，刷新页面不丢。
7. **跨标签页**：`BroadcastChannel` + `storage` 双通道；别的标签写入后本页 180ms 防抖重读。
8. **作用域绑定**：云同步只对"启用时的本机账号"生效；换本机账号后暂停，必须显式点"在此账号下启用"，避免把 A 的云端数据灌进 B 的分区。
9. **导入即恢复**：备份导入把 rev 抬到两者之上，并清掉对应墓碑。

10. **字段级合并（相册）**：`landmark.mt` 记录每个字段最后一次被改的时间。合并时先按整条记录选基准，再逐字段取 `mt` 更晚的一侧——A 改名字、B 写手记，两边都能留下；经纬度作为一个整体（`geo`）替换，不会出现半新半旧。照片仍是整条记录合并（照片元数据基本不可变）。
11. **前台拉取**：切回标签页或断网重连时，距上次拉取超过 30s 就先拉一次，另一台设备的删除/改名不用等刷新页面。

**已知取舍**：字段级合并只覆盖相册的文本/坐标/封面等元数据；同一字段被两台设备同时修改时仍是"后写者赢"（`mt` 精确到毫秒，平局用内容哈希决定）。

---

## 6. 异常处理

| 异常 | 检测 | 处理 |
| --- | --- | --- |
| localStorage 写满 | `setItem` 抛 `QuotaExceededError` | 返回 `{ok:false}`；toast"先导出备份再删几张"；不静默丢数据 |
| meta 写满 | 同上 | 先丢 7 天前的墓碑再重试一次 |
| IndexedDB 被其他标签阻塞 | `onblocked` | 控制台警告；当前页继续用旧连接 |
| IndexedDB 打开失败 | `onerror` | 清空连接缓存，下次重试；照片列表降级为空 |
| 本地 JSON 损坏 | `JSON.parse` 失败 | 返回 `{corrupted:true}`，页面不白屏，体检报 `store_corrupt` |
| 离线 | `navigator.onLine === false` | 同步直接返回；`online` 事件补推 |
| OAuth 失败 / 过期 | `pullAll` 抛错 | 指数退避；状态条显示失败原因；不阻塞本地编辑 |
| 原图上传失败 | `uploadPhotoBlob` 抛错 | 单张 `upFail+1`，累计 3 次跳过，不阻塞其他照片 |
| 云端行找不到所属相册 | `albumIds` 检查 | 跳过，不生成"幽灵卡片" |
| 删除相册 | — | 先删照片库（按索引游标），再删相册，最后落墓碑 |
| 未知异常 | `error` / `unhandledrejection` | 只记日志，单模块出错不拖垮整页 |

---

## 7. 关键对接点与依赖

### 7.1 云端表

| 表 | 关键列 | 约定 |
| --- | --- | --- |
| `atlas_albums` | `owner_id`(默认 `auth.uid()`)、`local_id`、`payload JSONB`、`rev`、`deleted`、`updated_at` | 唯一键 `(owner_id, local_id)`；RLS `owner_id = auth.uid()` |
| `atlas_photos` | `owner_id`、`local_id`、`album_local_id`、`name`、`w/h`、`taken_at`、`thumb`、`remote_path`、`exif JSONB`、`rev`、`deleted` | 同上 |

- 前端**从不发送** `owner_id`，由列默认值 + RLS 决定归属。
- 墓碑行保留 `payload/name` 为空也能成立；拉取端只看 `deleted/rev`。

### 7.2 对象存储

- 路径：`users/<uid>/photos/<photoId>.jpg`（由 `client.storage.userPath()` 生成，前端不拼串）。
- 上传 `upsert:true`，重复上传幂等。
- 墓碑推送成功后调用 `storage.remove([path])` 清掉原图；失败只留下一个孤儿文件，不影响数据一致性，下次整理可再清。

### 7.3 身份与域名

- OAuth：`signInWithOAuth({provider:'workbuddy'})`，回调参数在启动时解析并立即从 URL 抹掉。
- 数据面按 Origin 精确匹配：`*.workbuddy.host` 与本地调试可用；GitHub Pages 上只保留本地功能，云同步条自动隐藏。
- 作用域键：`atlas.cloud.scope.v1` = `guest` 或本机账号 id。

### 7.4 前端加载顺序

```
<script src="…workbuddy-cloud-sdk…"></script>   ← 必须同步、在 module 之前
<script type="module" src="assets/js/main.js"></script>
```

SDK 缺失 / 被拦截 → `reason='sdk-missing'`，云同步条隐藏，其余功能不受影响。

---

## 8. 验证方式与结果

### 8.1 契约单元测试（17 项，全通过）

```bash
cd tmp && node model.test.mjs
```

覆盖：坐标解析、垃圾输入兜底、超长截断、手记空值、照片坏尺寸/坏缩略图/坏远端路径、`chapterId` 兼容、孤儿诊断、rev 合并、墓碑优先、删除优先、往返不丢字段、字段级合并（名字+手记、经纬度成对）、内容比较。

### 8.2 浏览器集成（Playwright，全通过）

| 场景 | 断言 |
| --- | --- |
| 上传照片 | IndexedDB 记录含 blob、`rev=1`、字段符合契约 |
| 删除相册 | localStorage 无该册、`meta.tomb` 有墓碑、IDB 归零、刷新不复活 |
| 旧格式迁移 | 裸数组 → `{v:5,items}`，卡片数不变 |
| 损坏数据 | 页面不白屏，体检报 `store_corrupt`，toast 提示 |
| 跨标签页 | A 写手记，B 300ms 内出现同样内容 |
| 注册迁移 | 3 地标 + 1 照片完整搬到新账号，`health.issues=[]` |
| 作用域切换 | 换本机账号后云同步暂停；点启用后绑定新分区 |
| 整理数据 | 注入 2 条孤儿/坏记录 → `repair()` 移除 2、保留 1，`health.issues=[]` |

### 8.3 同步引擎（内存云客户端，全通过）

| 场景 | 结果 |
| --- | --- |
| 首次同步 | 3 相册 + 1 照片上传，photo 行带 `remote_path` |
| 本地编辑 | 云端 `rev` 1→2，名称同步 |
| 云端更新 | 拉取后本地出现"香港（远端）" |
| 云端删除 | 本地卡片 3→2 |
| 复活攻击（远端 rev 9 + 更晚时间） | 本地保持 2 张；云端被推回 `deleted:true` |

### 8.4 手动检查清单

```js
await atlasData.health()    // {ok, issues, stats}
atlasData.pending()         // 未上云的相册/照片/墓碑
atlasData.meta()            // 同步水位与墓碑
atlasData.reload()          // 从存储重读，验证持久化
atlasData.pull()            // 强制"先拉后推"
```

保险库面板的「数据」一格显示体检结果：`正常` / `N 项提示` / `N 项异常`。

### 8.5 尚未验证

- **真实 OAuth 往返与跨设备拉取**：需要发布到 `atlas-gallery.app.workbuddy.host` 并由真人在浏览器完成一次授权。
- 大体量（500+ 照片）下的首次同步耗时与配额：逻辑上分批，但未做压力测试。

---

## 9. 扩展与维护

**加一个字段**（例如照片"地点"）：
1. `model.js` 加上限与 normalize；
2. `photoToRow` / `photoFromRow` 加映射；
3. 云端 `ALTER TABLE … ADD COLUMN`；
4. 补一条往返单测。

**换后端**：只实现 `cloud.js` 的 8 个函数（pull/push/upload/download/delete/session），`store/main` 不改。

**改存储结构**：抬 `SCHEMA` 与信封 `v`，在 `loadAlbums` 里写迁移分支；IndexedDB 抬 `DB_VERSION` 并在 `onupgradeneeded` 里补索引。

**排查数据问题**：先 `atlasData.health()`，再看 `meta()` 的墓碑与 pending，最后看云端两表的 `rev/deleted`。

---

## 10. 已知边界

1. `site`（站点标题/导语）仍是设备级设置，不参与云同步；这是有意的：它属于"这台机器怎么展示"，不是作品。
2. 字段级合并只覆盖相册元数据；同一字段的并发修改仍是后写者赢；照片按整条记录合并。
3. 墓碑 180 天后清理；超过这个窗口的离线设备仍可能推回旧副本（概率极低）。
4. IndexedDB 中"无法识别"的旧记录不会自动删除；需要用户点「整理数据」或调用 `atlasData.repair()`。
5. 云同步依赖 `*.workbuddy.host` 域；GitHub Pages 上仅本地能力。
6. 真实 OAuth 往返与跨设备拉取尚未做真人验证（域名未发布）。
