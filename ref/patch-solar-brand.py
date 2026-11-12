#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch-solar-brand.py — ATLAS 品牌化补丁（vendor + 路径/性能补丁之后执行，幂等）

把图集子应用里的署名、首页文案与作者面板替换为 ATLAS 品牌内容：
- 作者面板（ABOUT）：Lee / AtlasL，微信 lzx_O7（点击复制），GitHub 在线图册；
- 首页标题：AtlasL 图谱（中文）/ AtlasL · SOLAR ATLAS（英文），副标题与
  版本行融入 ATLAS「私人图册」语境；
- 首页左下角创作者展示由主站注入的 CSS 隐藏（本脚本只负责文案层）。

实现要点：bundle 里的非 ASCII 全部以 \\uXXXX / \\xHH 转义形式存在，
直接在「原始转义空间」做定向替换——把替换串按同样规则转义后写入，
绝不整文件解码（会把字符串内的 \\u0022 等解码成真实引号而破坏语法）。

运行：python ref/patch-solar-brand.py
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'solar', 'assets', 'solar.js')


def esc(ch):
    """与 bundle 的转义约定一致：ASCII 原样，0x80-0xFF → \\xHH（大写），
    其余 → \\uXXXX（大写 hex，bundle 惯例）。"""
    cp = ord(ch)
    if cp <= 0x7F:
        return ch
    if cp <= 0xFF:
        return '\\x%02X' % cp
    return '\\u%04X' % cp


def jsq(s):
    """把自然文本转成 bundle 内的转义形式（供替换串写入用）。"""
    return ''.join(esc(c) for c in s)


def apply():
    raw = io.open(P, encoding='utf-8').read()

    def rep(needle_plain, repl_plain, label):
        nonlocal raw
        needle = jsq(needle_plain)
        n = raw.count(needle)
        assert n == 1, f'[{label}] needle count={n}, expected 1'
        raw = raw.replace(needle, jsq(repl_plain))
        print(f'  {label}: ok')

    # 1) 作者数据块（ASCII 锚点切片替换）
    i0 = raw.find('Yg={')
    i1 = raw.find(';function aoe')
    assert i0 != -1 and i1 > i0, 'Yg/aoe anchors not found'
    new_block = (
        'Yg={name:"Lee",alias:"AtlasL",firstRelease:"ATLAS 图谱",'
        'links:[{id:"wechat",label:"微信",handle:"lzx_O7",'
        'url:"https://weixin.qq.com/",note:"联系作者"},'
        '{id:"github",label:"GitHub",handle:"ATLAS 图册",'
        'url:"https://2339459732-lgtm.github.io/atlas/",note:"在线图册"}]},'
        'xF={name:"ATLAS 图谱",'
        'links:[{id:"github",label:"GitHub",handle:"ATLAS 图册",'
        'url:"https://2339459732-lgtm.github.io/atlas/",note:"在线图册"}]}'
    )
    raw = raw[:i0] + jsq(new_block) + raw[i1:]
    print('  Yg/xF data: replaced')

    # 2) 作者面板
    rep('ABOUT \xB7 关于作者', 'ABOUT \xB7 ATLAS 图谱', 'panel-head')
    rep(
        '本站为个人创作的天文科普可视化作品（',
        '本站为个人创作的天文可视化作品，收录于 ATLAS 私人图册（',
        'panel-note'
    )
    rep('\xB7 All rights reserved', '\xB7 ATLAS 图谱', 'panel-foot')

    # 3) 微信链接点击复制（Yg.links 的锚点，rel:"noreferrer" 版）
    rep(
        'rel:"noreferrer",children:[(0,Za.jsx)("b",{children:n.label}),'
        '(0,Za.jsx)("span",{children:n.handle}),'
        '(0,Za.jsx)("em",{children:n.note})]})},n.id))',
        'rel:"noreferrer",onClick:n.id==="wechat"?function(c){c.preventDefault();'
        'var el=c.currentTarget,fallback=function(){try{'
        'var t=document.createElement("textarea");t.value="lzx_O7";'
        't.style.cssText="position:fixed;opacity:0;pointer-events:none";'
        'document.body.appendChild(t);t.select();document.execCommand("copy");'
        'document.body.removeChild(t)}catch(e){}},done=function(){'
        'if(el){var b=el.querySelector("em");if(b)b.textContent="已复制 ✓"}};'
        'try{if(navigator.clipboard&&navigator.clipboard.writeText){'
        'navigator.clipboard.writeText("lzx_O7").then(done)'
        '.catch(function(){fallback();done()})}else{fallback();done()}}'
        'catch(_){fallback();done()}}:void 0,children:[(0,Za.jsx)("b",{children:n.label}),'
        '(0,Za.jsx)("span",{children:n.handle}),'
        '(0,Za.jsx)("em",{children:n.note})]})},n.id))',
        'wechat-copy'
    )

    # 4) 首页文案
    rep('"brand.title":"太阳系图谱"', '"brand.title":"AtlasL 图谱"', 'zh-title')
    rep('"brand.title":"SOLAR ATLAS"', '"brand.title":"AtlasL \xB7 SOLAR ATLAS"', 'en-title')
    rep('"brand.sub2":"一份坐标图谱"', '"brand.sub2":"一份私人坐标图谱"', 'zh-sub2')
    rep('"brand.sub2":"IN THE SOLAR SYSTEM"', '"brand.sub2":"A PRIVATE CARTOGRAPHY BY LEE"', 'en-sub2')
    rep('"intro.edition":"2026 年 10 月版"', '"intro.edition":"ATLAS 图谱 \xB7 2026"', 'zh-edition')
    rep('"intro.edition":"EDITION 2026.10"', '"intro.edition":"ATLAS EDITION \xB7 2026"', 'en-edition')
    rep(
        'v=n?"太阳系图谱":"Solar Atlas"',
        'v=n?"AtlasL 图谱":"AtlasL \xB7 Solar Atlas"',
        'hero-fallback'
    )

    io.open(P, 'w', encoding='utf-8').write(raw)
    print(f'written {len(raw)} bytes')


def main():
    raw = io.open(P, encoding='utf-8').read()
    if 'name:"Lee"' in raw and 'lzx_O7' in raw:
        print('already patched (Lee/lzx_O7 found) — skip')
        return
    apply()
    print('brand patch done')


if __name__ == '__main__':
    main()
