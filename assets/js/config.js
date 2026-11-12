/* ══════════════════════════════════════════════════════════════════
   config.js — 全局配置（唯一入口）

   这里只放"可调参数"，不放逻辑：
     · 云服务端点与密钥（换环境只改这里）
     · 默认主题 / 功能开关
     · 存储与同步的上限（照片尺寸、每轮上传数、重试、墓碑保留期）

   数据结构的版本不在这里：它是契约的一部分，放在 model.js 的 SCHEMA。
   ══════════════════════════════════════════════════════════════════ */

export const APP = {
  version: '2.6.0',

  /* 云服务：WorkBuddy Cloud（纯静态站点，没有服务端下发配置） */
  cloud: {
    endpoint: 'https://atlas-gallery.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_l0wwPqEszeiVMFjenfHdwT_WtB8XdT5HZ94wVcwIpck7NGYW4CTI04P',
    /* 数据面只在这些域下可用；localhost 用于本地调试 */
    hosts: ['workbuddy.host'],
    allowLocalhost: true
  },

  defaults: {
    theme: 'noir',
    lang: 'zh'
  },

  features: {
    /* 入口门禁：关闭时 initGate 直接隐藏，代码路径保留 */
    gate: false,
    music: true,
    /* 跨设备云同步：ATLAS 云账号（邮箱验证码）为作品与账号信息提供
       云端存储；本机账号与离线模式保留为降级路径。 */
    cloudSync: true
  },

  limits: {
    photoMaxPx: 2400,
    photoMaxBytes: 40 * 1024 * 1024,

    /* 同步 */
    syncPhotosPerRound: 6,
    syncRetryMax: 6,
    syncRetryBaseMs: 2000,
    syncRetryMaxMs: 60000,
    pullFreshMs: 30 * 1000,        /* 切回标签页超过 30s 就先拉一次 */

    /* 墓碑保留期：覆盖"离线几个月的旧设备"这种极端情况 */
    tombstoneDays: 180,

    /* 数据体检里认为"照片该有原图"的阈值，用于提示而非删除 */
    quotaWarnRatio: 0.9
  },

  /* 运行时缓冲与缓存：内存预算、对象 URL 池、节流窗口。
     都是"可调参数"——调优不用改业务代码，改这里即可。 */
  runtime: {
    /* 图层面板停靠宽度（CSS px）：面板 316 + 右距 18 + 缝 2 */
    layerRailWidth: 336,

    /* 照片 blob URL 池上限：超出的先撤销，正在显示的图由浏览器兜底 */
    urlCacheCap: 80,

    /* 照片 Blob 内存预算（字节）：打开过的大图留在内存里，超出预算
       按 LRU 释放（释放会撤销其 objectURL、置空 photo.blob，下次再看
       再从 IndexedDB/云端按需取回）。 */
    blobMemBudgetBytes: 96 * 1024 * 1024,

    /* 编辑后延迟推送的防抖窗口 */
    syncDebounceMs: 1200,

    /* toast 停留时长 */
    toastMs: 3200,

    /* 全局错误 toast 节流：同一错误信息在此窗口内只提示一次 */
    errToastThrottleMs: 5000,

    /* 错误环形缓冲条数（控制台 atlasErrors() 可读） */
    errRingSize: 12,

    /* 星空/银河渲染参数（earth.js 读取；主题表只覆盖 gain） */
    sky: {
      tilt: 0.33,       /* 银道面倾角（弧度）：银河穿过画面的角度 */
      spin: 0,          /* 银道经度旋转（弧度） */
      gain: 5.1,        /* 银河亮度倍率（宣纸主题覆盖为 0） */
      dust: 0.22,       /* 尘埃/星云纹理强度（0 关闭，锚定天球方向） */
      warm: 0.35        /* 银道暖调强度（0–1，核球偏金） */
    }
  }
};

export const CLOUD_CFG = {
  endpoint: APP.cloud.endpoint,
  oauthRelayBaseUrl: APP.cloud.oauthRelayBaseUrl,
  publishableKey: APP.cloud.publishableKey
};
