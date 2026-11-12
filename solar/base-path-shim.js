/* ══════════════════════════════════════════════════════════════════
   ATLAS 集成补丁（内联于子应用外壳，先于应用脚本执行）

   图集构建产物用「根绝对路径」引用资源（/sky/…、/planets/…，
   运行时还会用 "/"+相对路径 拼出绝对路径）。在根路径部署
   （应用域名）下没有问题；在子路径部署（GitHub Pages /atlas/）下
   会 404。本补丁把这类请求归一化到站点根：

     根部署：root === origin + "/"，恒等变换，零影响；
     子路径部署：/planets/x → <root>planets/x（<root> = /atlas/）。

   只拦三类通道：<img> src（WebGL 纹理）、fetch（JSON/二进制）、
   XHR。外部 https URL 一律不动。
   ══════════════════════════════════════════════════════════════════ */
(function () {
  try {
    var base = document.baseURI;                       /* …/solar/index.html */
    var dir = base.slice(0, base.lastIndexOf('/'));     /* …/solar */
    var root = dir.slice(0, dir.lastIndexOf('/') + 1);  /* …/（站点根，含尾斜杠） */
    var a = document.createElement('a');
    a.href = root;
    var hostRoot = a.protocol + '//' + a.host + '/';
    if (root === hostRoot) return;                      /* 根部署：无需修补 */

    function fix(u) {
      if (typeof u !== 'string' || !u) return u;
      if (u.charAt(0) === '/' && u.charAt(1) !== '/') return root + u.slice(1);
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