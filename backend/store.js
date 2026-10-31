// ── 权威数据：每局结束 / 开发者操作都在服务器留痕 ─────────────────────────
// results.ndjson —— 对局流水（mp 由服务端引擎判定，最可信；claimed 为单机自报）
// audit.ndjson  —— 开发者面板操作审计（存档修改、排行榜提交）
// stats.json    —— 按 playerId 聚合的战绩（/api/stats 输出）
// 目录可由 TOY_DATA_DIR 指定；写失败只降级不影响对局。

const fs = require('fs');
const path = require('path');

const DIR = process.env.TOY_DATA_DIR || path.join(__dirname, 'data');
const RESULTS = path.join(DIR, 'results.ndjson');
const AUDIT = path.join(DIR, 'audit.ndjson');
const STATS = path.join(DIR, 'stats.json');

function append(file, obj) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch (e) { /* 日志失败不影响游戏 */ }
}

function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS, 'utf8')); } catch (e) { return { players: {} }; }
}

function saveStats(stats) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(STATS + '.tmp', JSON.stringify(stats));
    fs.renameSync(STATS + '.tmp', STATS);   // 原子替换，避免写一半被读到
  } catch (e) { /* 忽略 */ }
}

// 多人对局结束：服务端引擎算出的 result，权威记录
function recordResult(room, result) {
  const at = new Date().toISOString();
  const players = room.players.map((p, i) => ({
    playerId: p.playerId || null,
    name: p.name,
    seat: i,
    money: result && result.money ? result.money[i] : null,
    winner: result ? result.winner === i : false,
    connected: !!p.ws
  }));
  append(RESULTS, { at, kind: 'mp', code: room.code, winner: result ? result.winner : null, players });
  const stats = loadStats();
  for (const pl of players) {
    const key = pl.playerId || 'anon:' + pl.name;
    const s = stats.players[key] || (stats.players[key] = { name: pl.name, games: 0, wins: 0, bestMoney: 0, lastSeen: null });
    s.name = pl.name;
    s.games++;
    if (pl.winner) s.wins++;
    if (typeof pl.money === 'number' && pl.money > s.bestMoney) s.bestMoney = pl.money;
    s.lastSeen = at;
  }
  saveStats(stats);
}

// 单机结算自报（客户端 HTTP 上报，无法验证，只作 reference）
function recordClaimed(name, playerId, mode, cash) {
  const at = new Date().toISOString();
  cash = Math.max(-1e9, Math.min(1e9, Math.round(Number(cash) || 0)));
  append(RESULTS, { at, kind: 'claimed', mode, cash, playerId: playerId || null, name: String(name || '').slice(0, 24) });
  const stats = loadStats();
  const key = playerId || 'anon:' + (name || '');
  const s = stats.players[key] || (stats.players[key] = { name, games: 0, wins: 0, bestMoney: 0, lastSeen: null });
  s.name = name;
  s.games++;
  if (mode === 'story' && cash > (s.bestStory || 0)) s.bestStory = cash;
  if (mode === 'don' && cash > (s.bestDon || 0)) s.bestDon = cash;
  s.lastSeen = at;
  saveStats(stats);
}

// 开发者操作审计（ws.devAuth 已过密码门禁才会走到这）
function recordAudit(player, kind, detail) {
  append(AUDIT, {
    at: new Date().toISOString(),
    playerId: player ? player.id : null,
    name: player ? player.nickname : null,
    kind: String(kind || '').slice(0, 24),
    detail: typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)
  });
}

// /api/stats：聚合榜（按胜场、再按最高金钱排）
function topPlayers(limit) {
  const stats = loadStats();
  return Object.entries(stats.players)
    .map(([playerId, s]) => ({ playerId, name: s.name, games: s.games, wins: s.wins, bestMoney: s.bestMoney || 0, bestStory: s.bestStory || 0, bestDon: s.bestDon || 0, lastSeen: s.lastSeen }))
    .sort((a, b) => b.wins - a.wins || b.bestMoney - a.bestMoney)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

module.exports = { recordResult, recordClaimed, recordAudit, topPlayers, DIR };
