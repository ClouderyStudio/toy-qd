#!/usr/bin/env bash
# 打包纯静态资源到 dist/，供 `toy create dist` / `toy update <id> dist` 上传。
#
# 为什么需要这一步：toy CLI 是把「传进去的目录」整个打包上传的。直接在仓库根目录跑
# create 会把 backend/（含 server.js、api.js 与 node_modules）、docs/ 一起传上去 ——
# 既没必要，也会把服务端实现暴露在静态站上。这里只挑浏览器真正要的三个东西。
#
# 联机地址：用 BR_WS_URL 环境变量注入，免得每次手改 config.js 又忘了改回来。
#   BR_WS_URL=wss://api.cloudery.cn/toy-mp bash tools/build-static.sh
# 不传时保持源码里的 config.js 原样（本地同源部署照旧能连）。
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist
rm -rf "$OUT"
mkdir -p "$OUT/css" "$OUT/js"

cp index.html "$OUT/"
cp css/*.css "$OUT/css/"
cp js/*.js "$OUT/js/"

WS_URL="${BR_WS_URL:-}"
if [ -n "$WS_URL" ]; then
  case "$WS_URL" in
    wss://*) ;;
    *) echo "❌ BR_WS_URL 必须以 wss:// 开头：Toy 页面是 HTTPS，ws:// 会被按混合内容拦掉" >&2; exit 1 ;;
  esac
  # 用 node 改而不是 sed：地址里带 & 或 / 时 sed 会当替换语法炸掉。
  BR_FILE="$OUT/js/config.js" BR_WS_URL="$WS_URL" node -e '
    const fs = require("fs");
    const file = process.env.BR_FILE;
    const url = process.env.BR_WS_URL;
    const src = fs.readFileSync(file, "utf8");
    if (!/wsUrl:\s*\x27\x27/.test(src)) {
      console.error("config.js 里没找到空的 wsUrl: \x27\x27 —— 是不是已经被改过了？");
      process.exit(1);
    }
    fs.writeFileSync(file, src.replace(/wsUrl:\s*\x27\x27/, "wsUrl: \x27" + url + "\x27"));
  '
  echo "联机地址已注入：$WS_URL"
elif grep -qE "^\s*wsUrl:\s*''" js/config.js; then
  echo "⚠️  wsUrl 仍是空值：本地同源可用，传到 Toy 后会隐藏「多人联机」入口。"
  echo "    要上线联机请带上 BR_WS_URL=wss://你的域名/路径 再跑。"
fi

echo "已生成 $OUT/（$(find "$OUT" -type f | wc -l | tr -d ' ') 个文件，$(du -sh "$OUT" | cut -f1)）"
echo "发布：toy update 50149917199360 $OUT --icon assets/icon.png --poster assets/icon.png --yes"
