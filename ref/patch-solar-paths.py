#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch-solar-paths.py — 把太阳系图集镜像的绝对资源路径改写为相对路径

背景：Atlas of Space 的构建产物用根绝对路径（/solar/...、/sky/... 等）。
在 GitHub Pages 这类「子路径部署」（host/atlas/）下，根绝对路径会 404。
改成相对路径（../sky/...、assets/...）后，无论部署在根还是子路径都成立。

规则（只动字符串字面量，不碰代码）：
  1. solar/index.html：/solar/assets/* → assets/*
  2. solar/assets/solar.css：url(/fonts/...) → url(../fonts/...)
  3. solar/assets/solar.js：
     · Worker 入口：new URL("/solar/assets/live-orbits.js", location.origin)
       → new URL("assets/live-orbits.js", document.baseURI)
     · 资源前缀 {sky,planets,moons,data,audio,fonts,images}：
       "/X/ → "../X/、`/X/ → `../X/（模板串）、"X/ → "../X/、`X/ → `../X/
运行：python ref/patch-solar-paths.py（vendor 后执行，可重复运行）
"""
import io, re, sys

ROOT = 'solar'
PREFIXES = ['sky', 'planets', 'moons', 'data', 'audio', 'fonts', 'images']


def patch_index(path):
    s = io.open(path, encoding='utf-8').read()
    s = s.replace('/solar/assets/solar.css', 'assets/solar.css')
    s = s.replace('/solar/assets/solar.js', 'assets/solar.js')
    io.open(path, 'w', encoding='utf-8').write(s)


def patch_css(path):
    s = io.open(path, encoding='utf-8').read()
    s = s.replace('url(/fonts/', 'url(../../fonts/')
    io.open(path, 'w', encoding='utf-8').write(s)


def patch_js(path):
    s = io.open(path, encoding='utf-8').read()

    # Worker 入口（全文件唯一的 location.origin 调用点）
    s = s.replace(
        'new URL("/solar/assets/live-orbits.js",location.origin)',
        'new URL("assets/live-orbits.js",document.baseURI)'
    )

    for p in PREFIXES:
        s = s.replace('"/%s/' % p, '"../%s/' % p)     # 双引号绝对
        s = s.replace('`/%s/' % p, '`../%s/' % p)     # 模板串绝对
        s = s.replace('"%s/' % p, '"../%s/' % p)      # 双引号相对（如 texture:"planets/x.jpg"）
        s = s.replace('`%s/' % p, '`../%s/' % p)      # 模板串相对（如 `planets/${t}-4k.jpg`）

    io.open(path, 'w', encoding='utf-8').write(s)


def verify(path):
    s = io.open(path, encoding='utf-8').read()
    leftover = []
    for pat in ['"/solar/', '"/sky/', '"/planets/', '"/moons/', '"/data/',
                '"/audio/', '"/fonts/', '"/images/', '`/sky/', '`/planets/',
                '`/moons/', '`/data/', '`/audio/', '`/fonts/', '`/images/',
                'url(/fonts/']:
        if pat in s:
            leftover.append(pat)
    return leftover


if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else ROOT
    patch_index(base + '/index.html')
    patch_css(base + '/assets/solar.css')
    patch_js(base + '/assets/solar.js')
    bad = verify(base + '/assets/solar.js')
    print('leftover:', bad if bad else 'none')
