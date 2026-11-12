"""ref/build-skycat.py — 真实星空目录生成器

输入：ref/sky-catalog.json
      （亮星目录 5044 颗至 6.0 等 + 88 星座连线，
       数据源 NASA/GSFC SVS 4851 Deep Star Maps 2020 · Gaia DR2
       ESA/Gaia/DPAC，公有领域 / CC BY-SA 3.0 IGO）
输出：assets/data/skycat.js

两步转换：
  1. 赤道坐标（RA/Dec，J2000）→ 银道坐标（l/b），
     与 sky-milky 全景（ESO Brunier，银道等距圆柱）共用一套天球；
  2. 压成紧凑字符串（运行时一次 split/parse，几毫秒），
     比 JSON 数组省约 40% 体积。

运行：python ref/build-skycat.py
"""
import json, math

D2R = math.pi / 180.0
R2D = 180.0 / math.pi

# J2000 赤道 → 银道 旋转矩阵（Hipparcos Vol.1 §1.5.3）
# l = atan2(r2, r1)，b = asin(r3)；行向量作用于 [cosδcosα, cosδsinα, sinδ]
_GAL = [
    [-0.0548755604, -0.8734370902, -0.4838350155],
    [ 0.4941094279, -0.4448296300,  0.7469822445],
    [-0.8676661490, -0.1980763734,  0.4559837762],
]

def to_galactic(ra_deg, dec_deg):
    a = ra_deg * D2R
    d = dec_deg * D2R
    x = math.cos(d) * math.cos(a)
    y = math.cos(d) * math.sin(a)
    z = math.sin(d)
    r1 = _GAL[0][0] * x + _GAL[0][1] * y + _GAL[0][2] * z
    r2 = _GAL[1][0] * x + _GAL[1][1] * y + _GAL[1][2] * z
    r3 = _GAL[2][0] * x + _GAL[2][1] * y + _GAL[2][2] * z
    l = math.atan2(r2, r1) * R2D % 360.0
    b = math.asin(max(-1.0, min(1.0, r3))) * R2D
    return l, b

# 已知恒星校验（误差 <0.1°）
_SANITY = [
    ("Sirius", 101.2872, -16.7161, (227.23, -8.89)),
    ("Vega", 279.2347, 38.7837, (67.45, 19.24)),
    ("Polaris", 37.9546, 89.2641, (123.21, 26.46)),
    ("Arcturus", 213.9153, 19.1824, (15.06, 69.11)),
    ("a Cen", 219.9021, -60.8340, (315.73, -0.68)),
]
for _n, _ra, _dec, (_l0, _b0) in _SANITY:
    _l, _b = to_galactic(_ra, _dec)
    assert abs(_l - _l0) < 0.3 and abs(_b - _b0) < 0.3, (_n, _l, _b)

def f3(v):
    return f"{v:.3f}"

def f2(v):
    return f"{v:.2f}"

def main():
    d = json.load(open("ref/sky-catalog.json", encoding="utf-8"))

    # ── 星表：按星等升序（最亮在前），只留 6.5 等以内 ──
    stars = [s for s in d["stars"] if s[2] <= 6.5]
    stars.sort(key=lambda s: s[2])
    star_parts = []
    for ra, dec, mag, bv in stars:
        l, b = to_galactic(ra, dec)
        star_parts.append(f"{f3(l)},{f3(b)},{f2(mag)},{f2(bv)}")
    stars_str = ";".join(star_parts)

    # ── 星座连线：多段折线，顶点按天球坐标（转银道） ──
    fig_parts = []
    for f in d["figures"]:
        l0, b0 = to_galactic(f["coord"][0], f["coord"][1])
        segs = []
        for line in f["lines"]:
            pts = []
            for (ra, dec) in line:
                l, b = to_galactic(ra, dec)
                pts.append(f"{f3(l)},{f3(b)}")
            segs.append("|".join(pts))
        # 层级分隔：星座间「;」、字段与段间「|」、段内点与段间「~」，
        # 三层各自独立，解析时不会把段边界吃掉
        fig_parts.append(f"{f['id']}|{f['name']}|{f['en']}|{f3(l0)},{f3(b0)}|{'~'.join(segs)}")
    figs_str = ";".join(fig_parts)

    out = f"""/* ══════════════════════════════════════════════════════════════════
   skycat.js — 真实星空目录（生成文件，勿手改）

   数据源：NASA/GSFC SVS 4851「Deep Star Maps 2020」亮星目录，
   星表基于 ESA Gaia DR2（ESA/Gaia/DPAC，CC BY-SA 3.0 IGO）；
   星座连线与名称整理自公开目录。
   坐标已换算为银道坐标（l/b，度），与 sky-milky 全景同一坐标系。

   生成：python ref/build-skycat.py  ← 源数据 ref/sky-catalog.json
   星数：{len(stars)}（星等 −1.44 … {f2(max(s[2] for s in stars))}）
   星座：{len(d['figures'])} 个
   ══════════════════════════════════════════════════════════════════ */

/* 紧凑星表：每颗星 "l,b,mag,bv;"（度 / 度 / 星等 / 色指数 B−V） */
const _S = "{stars_str}";

/* 紧凑星座：每星座 "id|名称|英文|标签点l,b|段以~分隔(段内点l,b以|分隔)" */
const _F = "{figs_str}";

export const SKY_STARS = _S.split(";").map(t => {{
  const p = t.split(",");
  return [+p[0], +p[1], +p[2], +p[3]];
}});

export const SKY_FIGURES = _F.split(";").map(t => {{
  /* 前 4 个 | 是元数据，之后整段是折线（段内也用 | 分隔，不能再整串 split） */
  const head = t.split("|").slice(0, 4);
  const rest = t.slice(head.join("|").length + 1);
  const [l0, b0] = head[3].split(",").map(Number);
  const lines = rest ? rest.split("~").map(seg =>
    seg.split("|").map(pt => {{
      const [x, y] = pt.split(",").map(Number);
      return [x, y];
    }})
  ) : [];
  return {{ id: head[0], name: head[1], en: head[2], l: l0, b: b0, lines }};
}});
"""

    with open("assets/data/skycat.js", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    import os
    print("stars:", len(stars), "figures:", len(d["figures"]))
    print("skycat.js:", os.path.getsize("assets/data/skycat.js"), "bytes")

if __name__ == "__main__":
    main()
