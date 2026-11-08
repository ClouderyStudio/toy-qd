#!/bin/bash
# 04:00 自动部署（服务器本地定时，不依赖任何外部会话）
#
# 安装（在服务器上执行一次）：
#   cp deploy-at-4am.sh /www/toy-mp/backend/deploy/
#   echo '0 4 9 11 * /bin/bash /www/toy-mp/backend/deploy/deploy-at-4am.sh >> /var/log/toy-deploy.log 2>&1' | crontab -
#
# 取消：
#   crontab -l | grep -v deploy-at-4am | crontab -
#
# 为什么不用 systemd timer：crontab 一行就能装/卸，排查也直接（/var/log/toy-deploy.log）。

set -uo pipefail

APP=/www/toy-mp
PKG_URL="${DEPLOY_PKG_URL:-}"
LOG_TAG="[auto-deploy]"

say() { echo "$(date '+%F %T') $LOG_TAG $*"; }

say "===== 开始自动部署 ====="

# 1. 拉取最新的后端包（由开发机提前上传到固定位置）
SRC="/www/toy-mp/.deploy-incoming/backend"
if [ ! -d "$SRC" ]; then
  say "找不到待部署包：$SRC —— 跳过本次部署"
  exit 0
fi

# 2. 校验关键文件存在，避免部署半个包
for f in server.js rooms.js store.js notice.js; do
  if [ ! -f "$SRC/$f" ]; then
    say "包不完整，缺少 $f —— 中止"
    exit 1
  fi
done
say "包校验通过"

# 3. 调部署脚本（内含预检 / 备份 / 同步 / 重启 / 验证 / 自动回滚）
bash "$APP/backend/deploy/deploy-toy-mp.sh" "$SRC" 2>&1
RC=$?

if [ $RC -eq 0 ]; then
  say "部署成功"
  # 成功后把待部署包归档，避免重复部署
  mv "$SRC" "$APP/.deploy-incoming/backend.done.$(date +%Y%m%d-%H%M%S)" 2>/dev/null
else
  say "部署失败（rc=$RC），已尝试回滚，请查看上面的日志"
fi

say "===== 结束 ====="
exit $RC
