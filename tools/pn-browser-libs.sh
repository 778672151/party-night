#!/usr/bin/env bash
# 重建真浏览器运行库（本机缺 5 个 .so 且没有 sudo —— 用 apt-get download + dpkg-deb -x 解到 /tmp）
# 用法: bash tools/pn-browser-libs.sh
set -e
ROOT=/tmp/pn-libs/root
DEB=/tmp/pn-libs/deb
if [ -e "$ROOT/usr/lib/x86_64-linux-gnu/libnspr4.so" ]; then
  echo "already present: $ROOT"; exit 0
fi
mkdir -p "$DEB" "$ROOT"
cd "$DEB"
for p in libnspr4 libnss3 libasound2t64; do
  url=$(apt-get download --print-uris "$p" 2>/dev/null | head -1 | cut -d"'" -f2)
  [ -n "$url" ] || { echo "无法解析 $p 的下载地址" >&2; exit 1; }
  curl -sSLO "$url"
done
for f in *.deb; do dpkg-deb -x "$f" "$ROOT"; done
echo "rebuilt: $ROOT"
