#!/bin/bash
# vendor-solar.sh — 从参考站镜像 Atlas of Space 构建（Apache-2.0）到本仓库
set -u
BASE="https://solar-system-atlas.pages.dev"
ROOT="/d/2026-11-11-14-36-27/repo"
MAX=15728640   # 15MB 上限
TOTAL=0; SKIPPED=0; FAILED=0

fetch() {  # $1 = 路径（以 / 开头，相对站点根）
  local rel="${1#/}"
  local out="$ROOT/$rel"
  [ -f "$out" ] && { echo "skip-exists $rel"; return; }
  mkdir -p "$(dirname "$out")"
  local ct size code
  read -r code ct size < <(curl -sL --max-time 120 -o "$out.tmp" -w "%{http_code} %{content_type} %{size_download}" "$BASE$1")
  if [ "$code" != "200" ]; then rm -f "$out.tmp"; FAILED=$((FAILED+1)); echo "FAIL($code) $rel"; return; fi
  case "$ct" in
    image/*|application/json|application/octet-stream|text/css|application/javascript|text/javascript|application/x-javascript) ;;
    *) rm -f "$out.tmp"; echo "NOT-ASSET($ct) $rel"; return;;
  esac
  if [ "$size" -gt "$MAX" ]; then rm -f "$out.tmp"; SKIPPED=$((SKIPPED+1)); echo "TOO-BIG($size) $rel"; return; fi
  mv "$out.tmp" "$out"
  TOTAL=$((TOTAL+size))
  echo "ok($size) $rel"
}

# ── 应用外壳 ──
fetch /solar/index.html
fetch /solar/assets/solar.css
fetch /solar/assets/solar.js
fetch /solar/assets/live-orbits.js
fetch /solar/LICENSE

# ── 天空数据（瓦片与 8k/12k 银河不在核心集内） ──
for f in catalog dso dso-intro star-intro observations; do fetch /sky/$f.json; done
fetch /sky/stars/bright-names.json
fetch /sky/stars/index.json
fetch /sky/milky-way.jpg

# ── 地球/数据 ──
for f in earth-catalog earth-live earth-live-meta; do fetch /data/$f.json; done
fetch /data/features/mars.json
fetch /data/features/mercury.json
fetch /data/features/moon.json
fetch /data/smallbodies/belt.bin
fetch /audio/music/album.json

# ── 行星纹理（2k/4k） ──
for t in mercury venus earth mars jupiter saturn uranus neptune pluto ceres haumea makemake eris moon; do
  fetch /planets/$t-2k.jpg
  fetch /planets/$t-4k.jpg
done
for f in earth_daymap-2k earth_daymap-4k earth_nightmap-2k earth_nightmap-4k earth_clouds-2k earth_clouds-4k earth_clouds_nasa-2k jupiter_ch4 jupiter_opal jupiter_uv neptune_nir; do
  fetch /planets/$f.jpg
done

# ── 太阳 AIA 波段 ──
for t in 0094 0131 0171 0193 0211 0304 0335 1600 1700; do
  fetch /planets/sun_aia$t-4k.jpg
  fetch /planets/sun_lut-$t.png
done

# ── 卫星纹理（hd 超过预算则跳过，回落低清） ──
for m in callisto charon dione enceladus europa ganymede io mimas phoebe rhea tethys titan triton; do
  fetch /moons/$m.jpg
  fetch /moons/${m}_hd-8k.jpg
done

echo "═══ TOTAL=$TOTAL SKIPPED=$SKIPPED FAILED=$FAILED ═══"
