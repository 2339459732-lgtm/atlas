/* ══════════════════════════════════════════════════════════════════
   config.js — 全局配置（唯一入口）

   这里只放"可调参数"，不放逻辑：
     · 云服务端点与密钥（换环境只改这里）
     · 默认主题 / 功能开关
     · 存储与同步的上限（照片尺寸、每轮上传数、重试、墓碑保留期）

   数据结构的版本不在这里：它是契约的一部分，放在 model.js 的 SCHEMA。
   ══════════════════════════════════════════════════════════════════ */

export const APP = {
  version: '2.5.0',

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
    music: true
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
  }
};

export const CLOUD_CFG = {
  endpoint: APP.cloud.endpoint,
  oauthRelayBaseUrl: APP.cloud.oauthRelayBaseUrl,
  publishableKey: APP.cloud.publishableKey
};
