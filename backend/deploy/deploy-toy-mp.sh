#!/usr/bin/env bash
# 恶魔轮盘后端部署脚本（在目标机 180.97.215.247 上执行）
#
# 设计成"原子 + 可回滚"：
#   1. 先把新后端解到临时目录，做语法检查；检查不过就中止，线上不受影响
#   2. 备份现有 backend/（含 data 不动）到 .deploy-backup/<时间戳>/
#   3. 用 rsync 同步后端代码，保留 node_modules 与 .env
#   4. 重启 systemd 单元，等端口起来
#   5. 失败自动回滚到备份
#
# 用法：
#   bash deploy-toy-mp.sh <新后端目录>        # 部署
#   bash deploy-toy-mp.sh --rollback          # 回滚到最近一次备份
set -uo pipefail

APP=/www/toy-mp
SRC="${1:-}"
UNIT=toy-mp
PORT=8091
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_ROOT="$APP/.deploy-backup"

say() { echo "[deploy] $*"; }
die() { echo "[deploy][ERROR] $*" >&2; exit 1; }

# ── 回滚 ──────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  LAST=$(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -1)
  [ -n "$LAST" ] || die "没有可回滚的备份"
  say "回滚到 $LAST"
  rsync -a --delete --exclude node_modules --exclude .env "$LAST/backend/" "$APP/backend/" || die "rsync 失败"
  systemctl restart "$UNIT" || die "重启失败"
  sleep 3
  systemctl is-active --quiet "$UNIT" && say "回滚完成，服务已恢复" || die "回滚后服务未起来"
  exit 0
fi

[ -n "$SRC" ] || die "用法：bash deploy-toy-mp.sh <新后端目录> 或 --rollback"
[ -d "$SRC" ] || die "目录不存在：$SRC"

# ── 1. 预检：语法 + 依赖 ──────────────────────────────────────────────
say "预检新代码……"
for f in "$SRC"/*.js; do
  [ -e "$f" ] || continue
  node --check "$f" >/dev/null 2>&1 || die "语法错误：$f"
done
say "语法检查通过"

# notice.js 是新增模块，确认它存在（公告功能依赖）
[ -f "$SRC/notice.js" ] || say "警告：没有 notice.js，公告功能将不可用"

# ── 2. 备份 ───────────────────────────────────────────────────────────
mkdir -p "$BACKUP_ROOT"
BK="$BACKUP_ROOT/$STAMP"
mkdir -p "$BK"
say "备份现有后端到 $BK"
rsync -a --exclude node_modules "$APP/backend/" "$BK/backend/" || die "备份失败"
# 只保留最近 5 次
ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | head -n -5 | xargs -r rm -rf

# ── 3. 同步 ───────────────────────────────────────────────────────────
say "同步后端代码……"
# --checksum 不能省：rsync 默认只比"大小 + mtime"，而 git archive 解出来的文件
# mtime 是打包时刻，很容易和线上文件撞成同一秒；文件大小又常常相同，
# 结果就是静默跳过同步 —— 演练时踩到过，表现为"部署完还是旧代码"。
# 保护线上专属文件：.env（密钥）与 node_modules（依赖）
rsync -a --delete --checksum \
  --exclude node_modules --exclude .env --exclude data \
  "$SRC/" "$APP/backend/" || { say "同步失败，回滚"; bash "$0" --rollback; exit 1; }

# 同步后强制比对一次，确认关键文件真的换掉了
if [ -f "$SRC/notice.js" ] && ! cmp -s "$SRC/notice.js" "$APP/backend/notice.js"; then
  say "notice.js 未同步成功，回滚"
  bash "$0" --rollback
  exit 1
fi
say "已同步 $(ls -1 "$SRC"/*.js 2>/dev/null | wc -l) 个 js 文件"

# 属主必须是 toy:toy，否则服务以 toy 身份跑时读不到
chown -R toy:toy "$APP/backend" 2>/dev/null || say "警告：chown 失败（非 root？）"
chmod 600 "$APP/backend/.env" 2>/dev/null || true

# ── 4. 重启 ───────────────────────────────────────────────────────────
say "重启 $UNIT……"
systemctl restart "$UNIT" || { say "重启失败，回滚"; bash "$0" --rollback; exit 1; }
sleep 3

# ── 5. 验证 ───────────────────────────────────────────────────────────
if systemctl is-active --quiet "$UNIT"; then
  say "服务已启动"
else
  say "服务未起来，回滚"
  journalctl -u "$UNIT" -n 30 --no-pager
  bash "$0" --rollback
  exit 1
fi

LISTEN=$(ss -lntp 2>/dev/null | grep -c "127.0.0.1:$PORT") || true
if [ "$LISTEN" -ge 1 ]; then
  say "端口 $PORT 已监听"
else
  say "端口 $PORT 未监听！"
  journalctl -u "$UNIT" -n 30 --no-pager
  exit 1
fi

say "部署完成。备份在 $BK"
say "如需回滚：bash $0 --rollback"
