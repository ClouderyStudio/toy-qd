#!/usr/bin/env bash
# 联机后端服务器安装脚本（在目标服务器上以 root 运行）
#
# 前提：backend/ 的文件已经放到 $APP_DIR（scp 或 git），本脚本负责系统层的事：
# 装 Node、建运行用户、写 systemd、启动、打印反代提示。
#
#   bash install.sh [APP_DIR]        默认 /www/toy-mp/backend
#
# 幂等：重复执行只会更新 unit 并重启服务，不会覆盖已有的 .env。
set -euo pipefail

APP_DIR="${1:-/www/toy-mp/backend}"
RUN_USER=toy
UNIT=/etc/systemd/system/toy-mp.service

[ "$(id -u)" = 0 ] || { echo "需要 root 运行" >&2; exit 1; }
[ -f "$APP_DIR/server.js" ] || { echo "找不到 $APP_DIR/server.js，先把 backend/ 传上来" >&2; exit 1; }

echo "== 1/5 Node =="
if command -v node >/dev/null 2>&1; then
  echo "已装：$(node -v)"
else
  # Debian/Ubuntu 自带源里的 nodejs 版本够用（≥18 即可，不依赖新语法）。
  apt-get update -qq
  apt-get install -y -qq nodejs npm
  echo "已装：$(node -v)"
fi
NODE_BIN="$(command -v node)"

echo "== 2/5 运行用户 =="
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
echo "用户 $RUN_USER 就绪"

echo "== 3/5 依赖与环境 =="
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "⚠️  已生成 $APP_DIR/.env —— 现在必须填 TOY_SERVER_KEY 再继续，否则大厅与快速匹配会降级"
else
  echo ".env 已存在，保持不动（$(grep -c . .env) 行）"
fi
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

echo "== 4/5 systemd =="
# 从模板生成，替换掉写死的路径与 node 位置（不同发行版 node 可能在 /usr/local/bin）
sed -e "s#WorkingDirectory=/www/toy-mp/backend#WorkingDirectory=$APP_DIR#" \
    -e "s#EnvironmentFile=/www/toy-mp/backend/.env#EnvironmentFile=$APP_DIR/.env#" \
    -e "s#ExecStart=/usr/bin/node server.js#ExecStart=$NODE_BIN server.js#" \
    "$APP_DIR/deploy/toy-mp.service" > "$UNIT"
systemctl daemon-reload
systemctl enable toy-mp >/dev/null 2>&1 || true
systemctl restart toy-mp

echo "== 5/5 自检 =="
for i in $(seq 1 15); do
  sleep 1
  if curl -fsS -o /dev/null -m 2 http://127.0.0.1:8080/ 2>/dev/null; then
    echo "✅ 本机 8080 已响应"
    break
  fi
  [ "$i" = 15 ] && { echo "❌ 15 秒内没起来，看日志：" >&2; journalctl -u toy-mp -n 40 --no-pager >&2; exit 1; }
done
systemctl is-active --quiet toy-mp && echo "✅ toy-mp active"
journalctl -u toy-mp -n 6 --no-pager | sed 's/^/   /'

cat <<EOF

下一步（OpenResty 反代，二选一）：
  已在 1Panel 建站 → 网站设置 → 配置文件，把 deploy/openresty-toy-mp.conf 里的
  location /toy-mp { ... } 贴进 api.cloudery.cn 的 server 块，然后重载 OpenResty。

  自建 Nginx → 直接 include 那个文件里对应的片段。

重载后从公网验握手（期望 101）：
  curl -si -m 8 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \\
       -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \\
       https://api.cloudery.cn/toy-mp | head -3
EOF
