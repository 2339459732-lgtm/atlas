#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch-solar-paths.py — 太阳系图集镜像的路径适配（vendor 后执行，可重复）

背景：Atlas of Space 构建产物用「根绝对路径」引用资源（/sky/…、/planets/…，
运行时还会以 "/"+相对路径 拼出绝对路径）。应用域名是根路径部署，没问题；
GitHub Pages 是子路径部署（host/atlas/），根绝对路径会 404。

策略（比字符串改写更稳，兼容两种部署）：
  1. solar/index.html
     · 应用资源改相对路径：assets/solar.css、assets/solar.js
     · 内联 solar/base-path-shim.js：子路径部署时把 Image.src / fetch / XHR
       的根绝对请求归一化到站点根；根部署时恒等变换、零影响
  2. solar/assets/solar.css：url(/fonts/…) → url(../../fonts/…)
  3. solar/assets/solar.js：
     只修 Worker 入口（new URL("/solar/assets/live-orbits.js", location.origin)
     → new URL("assets/live-orbits.js", document.baseURI)），资源前缀不再改写，
     交给 shim 归一化

运行：python ref/patch-solar-paths.py [solar目录]
"""
import io, sys

ROOT = 'solar'


def patch_index(path):
    shim = io.open(path + '/base-path-shim.js', encoding='utf-8').read().strip()
    html = '''<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>太阳系图谱 · Solar Atlas</title>
    <meta
      name="description"
      content="一张可交互的太阳系人类造物图谱：滚轮与拖拽漫游，点击任一航天器推进镜头，进入它的任务档案。"
    />
    <script>%s</script>
  </head>
  <body>
    <div id="root"></div>
    <link rel="stylesheet" href="assets/solar.css"/><script type="module" src="assets/solar.js"></script>
  </body>
</html>
''' % shim
    io.open(path + '/index.html', 'w', encoding='utf-8').write(html)


def patch_css(path):
    p = path + '/assets/solar.css'
    s = io.open(p, encoding='utf-8').read()
    s = s.replace('url(/fonts/', 'url(../../fonts/')
    io.open(p, 'w', encoding='utf-8').write(s)


def patch_js(path):
    p = path + '/assets/solar.js'
    s = io.open(p, encoding='utf-8').read()
    s = s.replace(
        'new URL("/solar/assets/live-orbits.js",location.origin)',
        'new URL("assets/live-orbits.js",document.baseURI)'
    )
    io.open(p, 'w', encoding='utf-8').write(s)


if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else ROOT
    patch_index(base)
    patch_css(base)
    patch_js(base)
    print('patched', base)
