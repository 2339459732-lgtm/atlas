#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-sky.py — 银河全景三档重建（从 8K 母版）

输入：sky/milky-way-8k.jpg（8192×4096，等距圆柱，银道居中；
      ESO 银河巡天全景，经由参考站处理，随图集 vendor 进入仓库）
输出：assets/tex/sky-milky-1k/2k/4k.jpg

处理链（针对两处质感问题）：
1. 星点灰斑 —— 母版带着几十万颗星，直接缩会混叠成灰斑。
   方案：Lanczos 缩到目标尺寸（星点压进 1px）→ 轻高斯把残留
   1px 亮点抹平。银道/尘埃带是几十像素宽的结构，不受影响。
2. 暗部噪点与色度渗出 —— 保存时用 4:4:4 色度（subsampling=1）
   并加极轻的 UnsharpMask（大半径、低强度）把尘埃带边缘找回来，
   不放大噪声（threshold 挡住平坦暗区）。

星点的"锐"由星表层负责（5044 真实亮星 + 程序暗星），全景只管"带"。

运行：python ref/build-sky.py
"""
import os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'sky', 'milky-way-8k.jpg')
OUT = os.path.join(ROOT, 'assets', 'tex')

# (目标宽, 文件名, 高斯σ, unsharp半径, unsharp强度, jpeg质量)
TIERS = [
    (4096, 'sky-milky-4k.jpg', 0.8, 8, 55, 80),
    (2048, 'sky-milky-2k.jpg', 2.2, 6, 40, 85),
    (1024, 'sky-milky-1k.jpg', 1.2, 5, 30, 82),
]


def main():
    im = Image.open(MASTER).convert('RGB')
    w, h = im.size
    assert (w, h) == (8192, 4096), f'unexpected master {im.size}'
    for tw, name, sigma, ur, up, q in TIERS:
        th = tw // 2
        t = im.resize((tw, th), Image.Resampling.LANCZOS)
        t = t.filter(ImageFilter.GaussianBlur(sigma))
        t = t.filter(ImageFilter.UnsharpMask(radius=ur, percent=up, threshold=2))
        out = os.path.join(OUT, name)
        t.save(out, 'JPEG', quality=q, optimize=True, subsampling=1)
        print(f'{name}: {tw}×{th} {os.path.getsize(out)//1024} KB')
    print('done')


if __name__ == '__main__':
    main()
