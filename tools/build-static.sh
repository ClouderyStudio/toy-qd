#!/usr/bin/env bash
# 打包纯静态资源到 dist/，供 `toy create dist` / `toy update <id> dist` 上传。
#
# 为什么需要这一步：toy CLI 是把「传进去的目录」整个打包上传的。直接在仓库根目录跑
# create 会把 backend/（含 server.js、api.js 与 node_modules）、docs/ 一起传上去 ——
# 既没必要，也会把服务端实现暴露在静态站上。这里只挑浏览器真正要的三个东西。
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist
rm -rf "$OUT"
mkdir -p "$OUT/css" "$OUT/js"

cp index.html "$OUT/"
cp css/*.css "$OUT/css/"
cp js/*.js "$OUT/js/"

# 上传前最容易漏的一步：wsUrl 空值在本地同源部署下能用，在 Toy 上一定连不上。
if grep -qE "^\s*wsUrl:\s*''" js/config.js; then
  echo "⚠️  js/config.js 的 wsUrl 还是空值：本地同源可用，传到 Toy 后会提示「联机服务器未配置」。"
fi

echo "已生成 $OUT/（$(find "$OUT" -type f | wc -l | tr -d ' ') 个文件，$(du -sh "$OUT" | cut -f1)）"
echo "发布：toy create $OUT --title \"恶魔轮盘\" --category GAME --yes"
