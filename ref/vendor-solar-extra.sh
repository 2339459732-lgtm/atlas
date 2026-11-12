#!/bin/bash
set -u
BASE="https://solar-system-atlas.pages.dev"
ROOT="/d/2026-11-11-14-36-27/repo"
MAX=31457280
fetch() {
  local rel="${1#/}"
  local out="$ROOT/$rel"
  [ -f "$out" ] && { echo "exists $rel"; return; }
  mkdir -p "$(dirname "$out")"
  read -r code ct size < <(curl -sL --max-time 180 -o "$out.tmp" -w "%{http_code} %{content_type} %{size_download}" "$BASE$1")
  if [ "$code" != "200" ]; then rm -f "$out.tmp"; echo "FAIL($code) $rel"; return; fi
  case "$ct" in
    image/*|application/json|application/octet-stream) ;;
    *) rm -f "$out.tmp"; echo "NOT-ASSET($ct) $rel"; return;;
  esac
  if [ "$size" -gt "$MAX" ]; then rm -f "$out.tmp"; echo "TOO-BIG($size) $rel"; return; fi
  mv "$out.tmp" "$out"; echo "ok($size) $rel"
}
fetch /planets/venus_atmosphere-2k.jpg
fetch /planets/venus_atmosphere-4k.jpg
fetch /planets/pluto_nh-2k.jpg
fetch /planets/pluto_nh-4k.jpg
fetch /planets/sun_sss-4k.jpg
fetch /planets/moon-8k.jpg
fetch /planets/mars-8k.jpg
fetch /planets/mercury-8k.jpg
fetch /planets/saturn-ring-2k.png
fetch /planets/saturn-ring-8k.png
fetch /moons/mimas_hd-4k.jpg
echo done
