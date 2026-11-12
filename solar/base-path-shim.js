/* ══════════════════════════════════════════════════════════════════
   ATLAS 集成补丁（内联于子应用外壳，先于应用脚本执行）

   两件事，任何部署下都生效：

   1. 画质层级（atlasq）：
      - 读 URL 的 atlasq=low|med|high，写入 window.__atlasQ，
        应用渲染器据此关闭低档抗锯齿；
      - 按层级压低 window.devicePixelRatio 读取值（几何量不变，
        像素量随层级下降）；
      - 按层级把纹理 URL 降级：低档 4K→2K、8K→4K/2K，
        16K 月球瓦片退回 8K/2K，太阳科学波段不做跨级映射（仓库只有 4K）。

   2. 根绝对路径归一化：图集构建产物用「根绝对路径」引用资源
     （/sky/…、/planets/…，运行时还会用 "/"+相对路径 拼绝对路径）。
     根部署（应用域名）恒等；子路径部署（GitHub Pages /atlas/）下
     改写为站点根。只拦三类通道：<img> src（WebGL 纹理）、fetch、XHR。
     外部 https URL 一律不动。

   注：不做 fetch 级去重——Response 只能消费一次，共享 Promise 会让
   第二个调用方读到空 body；同 URL 的在途请求由浏览器 HTTP 缓存层
   自行合并（request coalescing），收益一样且安全。
   ══════════════════════════════════════════════════════════════════ */
(function () {
  try {
    var qs = new URLSearchParams(window.location.search);
    var tier = (qs.get('atlasq') || 'high').toLowerCase();
    if (tier !== 'low' && tier !== 'med') tier = 'high';
    window.__atlasQ = tier;

    /* ── 1a. DPR 上限：像素量下降是最直接的 GPU 减压 ── */
    var cap = tier === 'low' ? 1.25 : tier === 'med' ? 1.5 : 2;
    var real = window.devicePixelRatio;
    if (real > cap) {
      try {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          get: function () { return cap; }
        });
        window.__atlasRealDPR = real;
      } catch (e) { /* 只读环境：放弃覆盖 */ }
    }

    /* ── 1b. 纹理降级映射（先具体后通用，顺序即优先级） ── */
    var RULES = [];
    if (tier === 'low') {
      RULES = [
        ['moon_wac-16k.avif', 'moon-2k.jpg'],
        ['moon_normal-8k.avif', 'moon_normal-4k.png'],
        ['moon-8k.jpg', 'moon-2k.jpg'],
        ['saturn-ring-8k.png', 'saturn-ring-2k.png'],
        ['milky-way-12k.jpg', 'milky-way-8k.jpg'],
        ['_hd-8k.jpg', '_hd-4k.jpg'],
        ['_hd-4k.jpg', '.jpg'],          /* 卫星超清 → 基础贴图 */
        ['-8k.jpg', '-4k.jpg'],
        /* 太阳科学波段只有 4K 版，不做 -4k→-2k 的通用降级（会 404） */
        ['mercury_topo-4k.jpg', 'mercury-2k.jpg'],
        ['moon_lola-4k.jpg', 'moon-2k.jpg'],
        ['moon_clementine-4k.jpg', 'moon-2k.jpg'],
        ['mars_mola-4k.jpg', 'mars-2k.jpg']
      ];
    } else if (tier === 'med') {
      RULES = [
        ['moon_wac-16k.avif', 'moon-8k.jpg'],
        ['moon_normal-8k.avif', 'moon_normal-4k.png'],
        ['saturn-ring-8k.png', 'saturn-ring-2k.png'],
        ['milky-way-12k.jpg', 'milky-way-8k.jpg'],
        ['_hd-8k.jpg', '_hd-4k.jpg'],
        ['-8k.jpg', '-4k.jpg']
      ];
    }
    function tierFix(u) {
      if (typeof u !== 'string' || !u || RULES.length === 0) return u;
      for (var i = 0; i < RULES.length; i++) {
        if (u.indexOf(RULES[i][0]) !== -1) {
          return u.replace(RULES[i][0], RULES[i][1]);
        }
      }
      return u;
    }

    /* ── 2. 路径归一化 + 纹理降级（统一走 fix 链） ── */
    var base = document.baseURI;                       /* …/solar/index.html */
    var dir = base.slice(0, base.lastIndexOf('/'));     /* …/solar */
    var root = dir.slice(0, dir.lastIndexOf('/') + 1);  /* …/（站点根，含尾斜杠） */
    var a = document.createElement('a');
    a.href = root;
    var hostRoot = a.protocol + '//' + a.host + '/';
    var subpath = root !== hostRoot;

    function fix(u) {
      if (typeof u !== 'string' || !u) return u;
      u = tierFix(u);
      if (subpath && u.charAt(0) === '/' && u.charAt(1) !== '/') return root + u.slice(1);
      return u;
    }

    var imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (imgDesc && imgDesc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        get: imgDesc.get,
        set: function (v) { imgDesc.set.call(this, fix(v)); }
      });
    }
    var _fetch = window.fetch;
    if (_fetch) {
      window.fetch = function (input, init) {
        if (typeof input === 'string') input = fix(input);
        else if (input && typeof input.url === 'string') {
          input = new Request(fix(input.url), input);
        }
        return _fetch.call(this, input, init);
      };
    }
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { _open.call(this, m, fix(u)); };
  } catch (e) { /* 静默：最坏回到无补丁行为 */ }
})();
