# 运行稳定性与数据对接诊断 · 2026-11-12

> 范围：数据入口（表单 / 上传）→ 本机持久化（localStorage / IndexedDB）→ 云同步（三张表 + 对象存储）→ 导出备份，以及音乐与移动端。
> 结论先说：**数据链没有断点，但有三处会在"数据量变大"或"网络变慢"时失效**（照片全量驻留内存、云端拉取不分页、请求无超时）。
> 这三处都已修掉并给出可复现的验证；其余是体验与边界问题，逐项列在下面。

---

## 一、链路与接口盘点

```
① 入口
   表单（新建/编辑地标）      main.js  openDialog → submit
   手记（标题/正文/余味）      main.js  memoir form
   照片（选择/拖放/粘贴）      main.js  addPhotos
        │
        ▼
② 契约  model.js（纯函数，无 I/O）
   normalizeAlbum / normalizePhoto   字段、上限、默认值、id 规则
   albumIssues / photoIssues         逐条诊断（孤儿、坏尺寸、坏类型）
   albumToRow / photoToRow           记录 → 云端行（省略空值列）
   mergeAlbums / mergeCollections    字段级 / 整条合并
        │
        ▼
③ 本机  store.js（唯一碰 localStorage 与 IndexedDB 的模块）
   loadAlbums / saveAlbums           信封 {v,at,items}；自动 rev+1、mt 时钟
   allPhotos / getPhotoBlob / putPhoto   元数据与二进制分开取
   tombstone / markTombstonesPushed  删除留痕，180 天
   markDirty / pending               未上云的改动，刷新不丢
   onExternalChange                  BroadcastChannel + storage 双通道
   health                            体检：孤儿、坏尺寸、无原图、配额、损坏
        │
        ▼
④ 云端  cloud.js（只传输，不判断谁赢）
   fetchAll(atlas_albums / atlas_photos)   分页 500 行
   pullSettings / pushSettings              atlas_settings 单文档
   uploadPhotoBlob / downloadPhotoBlob / removePhotoBlob
   guard(…)                                 每个请求 25~60s 超时
        │
        ▼
⑤ 呈现
   renderWall / renderAlbumGrid（分批）/ renderMemoir / renderOverview
   Earth.setMarkers → 每帧 project(lat,lng) → DOM 标记
```

**关键对接点**

| 对接点 | 约定 | 违约后果 |
| --- | --- | --- |
| `(owner_id, local_id)` 唯一键 | 三条写入路径共用同一个 id | 重复条目 / 覆盖别人的行 |
| 存储路径 `users/<uid>/photos/<id>.jpg` | 由 SDK `userPath()` 生成 | 换账号读不到原图 |
| `rev` / `deleted` | 客户端维护 rev；删除只写墓碑 | 旧设备推回已删条目 |
| `thumb` 与 `blob` 分离 | 网格只读 thumb，原图按需 | 内存爆、同步体积大 |
| i18n `cloud.*` / `vault.*` | 运行时状态文字由 renderCloud 重画 | 切语言后状态被重置 |

---

## 二、问题清单

严重度定义：**P0** 会在真实使用中丢数据或让功能整体失效；**P1** 在特定场景下出错或明显变慢；**P2** 体验与边界。

| # | 问题 | 成因 | 严重度 | 影响范围 | 处理 |
| --- | --- | --- | --- | --- | --- |
| 1 | 相册越大越容易崩（移动端尤甚） | `allPhotos()` 把每条记录的 `blob` 一起返回，网格又对每张 `createObjectURL`；一张 1280×800 解码后约 4 MB，500 张 ≈ 2 GB | **P0** | 整个相册页；照片多到一定程度必然复现 | 启动只读元数据（`hasBlob` 标记），原图在**大图 / 导出 / 上传**时单张取 |
| 2 | 新设备只同步到一部分照片 | `pullAll()` 无分页；PostgREST 默认单次最多 1000 行，第 1001 条起永远拉不到 | **P0** | 跨设备同步；照片或相册超过 1000 条 | `range()` 分页，每页 500，按 `local_id` 排序保证分页稳定 |
| 3 | 一次网络挂起后，同步永久停摆 | 没有任何超时；`syncNow` 的 `running` 只能靠 `finally` 复位，请求不返回就永远是 true | **P0** | 所有云功能；弱网/代理环境下必现 | 每个请求包一层 `guard()`：普通 25s、上传 60s、下载 45s |
| 4 | 保存元数据会把原图写没 | 元数据模式下调 `putPhoto()` 时 `rec.blob` 为 undefined，整条 put 覆盖掉库里的 blob | **P1** | 换设备下载原图后、或任何一次 `dbPut(ph)` | 事务内先 `get` 再 `put`，把原图接回去 |
| 5 | 删掉的相册在另一台设备上复活 | 普通 upsert 的 `deleted:false` 会覆盖另一台设备写的墓碑 | **P1** | 多设备删除；离线设备回推时 | `albumToRow/photoToRow` 只在真为墓碑时写 `deleted`，其余省略（冲突更新保留原值） |
| 6 | 编辑到一半，表单提交丢失 | `syncPull` 会整体替换 `state.landmarks`，而弹窗持有的是替换前的对象 | **P1** | 打开编辑弹窗时恰好触发同步 | 编辑中跳过拉取；弹窗关闭后补一次 |
| 7 | 同一张照片反复上传失败、每次刷新重来 | 失败计数 `upFail` 只存在内存里 | **P1** | 弱网 / 大图 | 失败时落库 |
| 8 | 同步体积与内存翻倍 | 缩略图 1280 px / q0.82，单张 200 KB+，而网格最大只显示 330 px | **P1** | 跨设备首屏、IndexedDB 体积 | 640 px / q0.72（约 1/4 体积），大图仍用原图 |
| 9 | 大相册里编辑发涩 | 每次落盘都跑一遍 `health()`（O(n) + `storage.estimate`） | **P1** | 数百张照片时的每次保存 | 260 ms 合并成一次 |
| 10 | 点一次音量键反而没声音 | 自动播放被拦时 `started=true` 但 `ctx.state='suspended'`，`toggle()` 先判 `started` → 走了 `stop()` | **P1** | 所有首次访问（浏览器自动播放策略） | 顺序改为：静音 → 挂起 → 播放中 |
| 11 | 手机顶栏挤、主题按钮没地方放 | 6 个控件挤在 390 px；隐藏主题后又没有入口 | **P1** | ≤560 px 全部页面 | 收到 5 个控件，主题并入「更多」菜单，点一次切一档 |
| 12 | 手机小字吃力、弹窗被裁 | `--fs-micro` 8.5 px；弹窗固定宽度且不滚；无 safe-area | **P2** | 移动端 | 字号上调一档、弹窗 `max-height + overflow`、刘海与手势条留白 |
| 13 | 打开相册就批量下载全部原图 | 网格渲染时 `queueBlob(p)` 对每张排队 | **P2** | 移动流量、首屏 | 移除批量预取，只在大图/导出/上传时取 |

---

## 三、逐项改动

### 1. 照片：元数据与二进制分开（P0）

`store.js`

```js
export async function allPhotos({ blobs = false } = {}) {
  // …
  p.hasBlob = row.blob instanceof Blob;
  p.blob = blobs && p.hasBlob ? row.blob : null;
}

export async function getPhotoBlob(id) { /* 单张读，找不到返回 null */ }
```

`putPhoto()` 改为事务内「先读后写」，没带 blob 时保留库里的原图。
`main.js` 新增 `ensureBlob(photo)`：本地读 → 云端下 → 落库，三级回退；`showPhoto()` 先把缩略图铺上，原图就绪再替换。

**取舍**：网格永远显示缩略图（640 px 在 2× 屏上仍然锐），大图打开时最多等一次 IDB 读（本地 ~10 ms）。换来的是一条硬上限：内存不再随照片数线性增长。

### 2. 云端分页（P0）

```js
const PAGE = 500;
async function fetchAll(table, cols) {
  for (let from = 0; from < 200000; from += PAGE) {
    const { data, error } = await guard(
      client.database.from(table).select(cols)
        .order('local_id', { ascending: true })
        .range(from, from + PAGE - 1), table);
    if (error) throw error;
    out.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
}
```

**为什么按 `local_id` 排序**：`taken_at` 会重复，同一时间戳的行在翻页时可能重复或漏掉；`local_id` 唯一且稳定。

### 3. 请求超时（P0）

`cloud.js` 的 `guard(promise, label, ms)` 用 `Promise.race` 加计时器，8 个出入口全部包上。
超时后 `syncNow` 走正常的错误分支：指数退避重试，`running` 复位，界面显示「重试同步」。

### 4. 不再覆盖墓碑（P1）

```js
// 只在确实是墓碑时写
if (a.deleted === true) row.deleted = true;
if (p.deleted === true) row.deleted = true;
// 缩略图 / EXIF / 原图路径同理：空值不写，冲突更新时保留原值
if (p.remote) row.remote_path = p.remote;
if (p.thumb) row.thumb = p.thumb;
if (p.exif) row.exif = p.exif;
```

### 5. 编辑与同步互斥（P1）

```js
function isEditing() {
  const dlg = document.getElementById('dlg');
  if (dlg && dlg.open) return true;
  const form = $('#memoir-form');
  return !!(form && !form.hidden);
}
// syncNow：canPull = !isEditing()；关窗后 schedulePush(400) 补一次
```

### 6. 移动端（P1/P2）

| 项 | 调整前 | 调整后 |
| --- | --- | --- |
| 顶栏控件 | 6 个（搜索/声音/语言/主题/账号/更多），390 px 下几乎贴边 | 5 个，主题并入「更多」菜单（显示当前主题名，点一次切一档） |
| 图标样式 | 搜索/语言/声音带方框，账号是圆形，混排 | 统一 40×40 无边框圆形，触控区达标 |
| 微字 | 8.5 px（约 2.7 mm 高） | 9.5 px，其余字阶同步上调一档 |
| 安全区 | 无处理 | 顶栏、相册栏、弹窗、提示条全部加 `env(safe-area-inset-*)` |
| 弹窗 | 固定宽度，内容多时按钮被挤出屏幕 | `calc(100vw - 28px)` + `max-height: 88svh` + 内部滚动 |
| 输入框 | 13.5 px，iOS 会自动放大页面 | `max(16px, var(--fs-base))` |
| 地球控件 | 缩放键 30 px，底部贴边 | 40 px，底部让出手势条；HUD 可换行 |
| 下拉刷新 | 拖地球时容易误触发 | `overscroll-behavior-y: contain` |

---

## 四、验证

### 数据链

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 契约 | `tmp/model.test.mjs`（17 项） | **17/17 通过** |
| 同步引擎 | `tmp/test-sync.js` 内存云：首推 / 本地编辑 / 远端编辑 / 远端删除 / 复活攻击 / 设置同步 | 通过；删除后 `cards 3 → 2`，云端行 `deleted:true`；设置 rev1 上云、rev9 落地 |
| 分页 | 假云实现 `range()`，按 `local_id` 排序切片 | 通过（`fetchAll` 走完 500/页循环） |
| 元数据模式 | 上传后重新加载：`allPhotos()` 返回 `hasBlob:true, blob:false, thumb 10 KB` | 通过 |
| 原图按需 | 打开大图 → `lb-img.naturalWidth = 1400`（原图宽度） | 通过 |
| 刷新后原图 | 重新加载页面再开大图，仍为 1400 | 通过（`putPhoto` 未写空 blob） |
| 导出 | 有原图的相册导出 `.atlas`，57 KB，提示「备份已生成」 | 通过 |
| 编辑链路 | 改名 + 写手记 → `rev 3`，`mt = [name, note, memoir]`，`health.ok` | 通过 |
| 页面错误 | 全流程 0 个 `pageerror` / 0 个 console error | 通过 |

### 音乐

| 项 | 指标 | 结果 |
| --- | --- | --- |
| 单音分音衰减（C4） | 基频 0.0197 → 0.00284（0.9 s）→ 0.0008（2.4 s）；3 次分音 0.0162 → 0.0005；8 次 0.00283 → 0.00017 | 高次分音明显更快衰减，符合钢琴 |
| 峰值 / 削顶 | 引子段 0.886 / 0；高潮段 0.946 / 0 | 无限幅削波 |
| 动态范围 | 第 0 小节 RMS 0.151 → 高潮 0.385（约 8.1 dB） | 段落对比成立 |
| 亮度变化 | 过零率 339（引子）→ 520（高潮） | 高潮更亮 |
| 空小节 | 全部段落 `silent = []` | 无断音 |
| 循环点 | 第 39→0 小节前后 250 ms RMS 0.118 / 0.045，无静音 | 有"呼吸"但不断层 |
| 首次点击 | 自动播放被拦（无 autoplay 参数）时：初始 `pending` → 点击后 `on`，`isPlaying=true` | 通过（修复前是 `off`） |

> 说明：整轮离线渲染在 Chromium 的单个 `OfflineAudioContext` 里超过约 90 秒会卡住（与采样率无关），所以用 **分段渲染** 验证：0–23、24–39、36–43（跨循环点）。这是测试工具的限制，不是音频本身的问题——页面实时只排 2.8 秒。

### 移动端

| 项 | 结果 |
| --- | --- |
| 390×844 无横向溢出 | `scrollWidth === innerWidth === 390` |
| 顶栏 | 5 个控件，每个 40×40，间距 42 px，无贴边 |
| 主题切换 | 「更多」→ 切换主题：`noir → ivory`，菜单内显示当前名 |
| 相册顶栏 | 返回 + 三个操作完整可读，触控 38 px |
| 账号弹窗 | 完整落在视口内，可滚动，关闭键可达 |
| 地球区 | HUD 与缩放键都不压球体、不出屏 |

---

## 五、遗留

1. **真实 OAuth 往返**仍需在应用域名上由真人完成一次授权（代码与域名已就绪）。
2. 对象存储里的孤儿文件只在墓碑推送成功时清理；极端情况下（推送失败且再不联网）会留一个文件。
3. 分页上限写死 20 万行；超过这个量级需要改成游标分页。
4. 网格仍会把已渲染行的 `<img>` 留在 DOM 里（依赖 `content-visibility` 让浏览器回收），上千张时建议改成窗口化列表。
5. 音频的"震撼"目前靠配器与动态，没有做总线降噪/抖动；若后续接真实采样，这套合成器可以直接退居兜底。
