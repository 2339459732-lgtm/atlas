#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch-solar-perf.py — 太阳系图集性能补丁（vendor 后执行，幂等）

在 vendor（ref/vendor-solar.sh）与路径补丁（ref/patch-solar-paths.py）
之后执行，把性能开关打进 vendored 产物：

1. solar/assets/solar.js
   - 两处渲染器 `antialias:!0` → `antialias:window.__atlasQ!=="low"`：
     低档（atlasq=low，宿主按设备算）关闭 MSAA，弱 GPU / 软件渲染收益最大；
     中高档保持原状。

2. solar/index.html
   - 把 solar/base-path-shim.js 的最新内容重新内联进 <head>：
     shim 负责读 atlasq、压 DPR 上限、按层级降级纹理 URL、子路径归一化。

宿主侧无需打包：ATLAS 的 main.js 负责算层级并把
`?quality=auto&atlasq=<tier>` 传给 iframe。

运行：python ref/patch-solar-perf.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch_bundle():
    p = os.path.join(ROOT, 'solar', 'assets', 'solar.js')
    s = io.open(p, encoding='utf-8').read()
    old, new = 'antialias:!0', 'antialias:window.__atlasQ!=="low"'
    if new in s:
        print('bundle: already patched')
        return
    n = s.count(old)
    assert n == 2, f'expected 2 antialias sites, found {n} — upstream bundle changed, inspect manually'
    s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print(f'bundle: patched {n} antialias sites')


def reinline_shim():
    shim = io.open(os.path.join(ROOT, 'solar', 'base-path-shim.js'), encoding='utf-8').read()
    p = os.path.join(ROOT, 'solar', 'index.html')
    html = io.open(p, encoding='utf-8').read()
    i = html.index('<script>')
    j = html.index('</script>', i) + len('</script>')
    html = html[:i] + '<script>' + shim + '</script>' + html[j:]
    io.open(p, 'w', encoding='utf-8').write(html)
    print('shell: shim re-inlined (%d bytes html)' % len(html))


if __name__ == '__main__':
    patch_bundle()
    reinline_shim()
    print('perf patch done')
