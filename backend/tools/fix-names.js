#!/usr/bin/env node
/* 一次性数据修复：把服务器战绩里的昵称从"截断到 6 字"恢复成完整名。
 *
 * 背景：v1.1.3 之前 rooms.js 的 cleanName 会把昵称截成 6 个字，
 * stats.json 里存的因此都是半截名字。代码已改，但**已存的旧数据不会自动变**。
 *
 * 这个脚本从 results.ndjson（每次对局的原始记录）里读回完整名字回填 stats.json：
 *   - 只处理"名字长度正好等于历史截断长度(6)"的条目，避免误改正常名字
 *   - 找不到更长的记录时保持原样
 *   - 先备份，再原子替换
 *
 * 跑法（在服务器上，先停服务）：
 *   node backend/tools/fix-names.js --dry-run    # 只看会改什么
 *   node backend/tools/fix-names.js              # 真正写回
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.TOY_DATA_DIR || path.join(__dirname, '..', 'data');
const STATS = path.join(DIR, 'stats.json');
const RESULTS = path.join(DIR, 'results.ndjson');

const OLD_LIMIT = 6;      // 历史截断长度
const DRY = process.argv.includes('--dry-run');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function readNdjson(p) {
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of txt.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (e) { /* 跳过坏行 */ }
  }
  return out;
}

if (!fs.existsSync(STATS)) {
  console.log('没有 stats.json，无需修复：', STATS);
  process.exit(0);
}

const stats = readJson(STATS, { players: {} });
const results = readNdjson(RESULTS);

/* 从历史记录里建 playerId -> 见过的最长名字。
 * 老版本写入的也是截断名，所以这里能恢复到的上限就是当时存进去的长度，
 * 但只要有比 6 字更长的记录（例如单机自报走的是 24 字上限），就能补回来。 */
const longest = new Map();
function consider(playerId, name) {
  if (!playerId || !name) return;
  const cur = longest.get(playerId);
  if (!cur || Array.from(name).length > Array.from(cur).length) longest.set(playerId, name);
}

for (const r of results) {
  if (r.kind === 'mp' && Array.isArray(r.players)) {
    for (const pl of r.players) consider(pl.playerId, pl.name);
  } else if (r.kind === 'claimed') {
    consider(r.playerId, r.name);
  }
}

let changed = 0;
for (const [playerId, s] of Object.entries(stats.players || {})) {
  const cur = s.name || '';
  if (Array.from(cur).length !== OLD_LIMIT) continue;     // 只处理疑似被截断的
  const better = longest.get(playerId) || longest.get(Number(playerId));
  if (!better) continue;
  if (Array.from(better).length <= OLD_LIMIT) continue;
  if (!better.startsWith(cur)) continue;                  // 前缀对不上就不改，防误伤
  console.log(`  ${cur}  ->  ${better}`);
  s.name = better;
  changed++;
}

if (!changed) {
  console.log('没有需要修复的昵称。');
  process.exit(0);
}

if (DRY) {
  console.log(`\n[dry-run] 将修复 ${changed} 条，未写入。去掉 --dry-run 生效。`);
  process.exit(0);
}

// 备份后原子替换
const backup = STATS + '.bak-' + Date.now();
fs.copyFileSync(STATS, backup);
fs.writeFileSync(STATS + '.tmp', JSON.stringify(stats));
fs.renameSync(STATS + '.tmp', STATS);
console.log(`\n已修复 ${changed} 条，原文件备份至 ${path.basename(backup)}`);
