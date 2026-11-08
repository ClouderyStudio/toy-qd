/* 维护公告：服务端读文件下发，客户端展示
 *
 * 为什么用文件而不是环境变量：
 *   改环境变量要重启进程，而重启会清空所有房间和对局 —— 公告恰恰最常用于
 *   "等会儿要维护" 这种需要提前通知、又不该打断当前对局的场景。
 *   写个文件即时生效，玩家正在打的那局不受影响。
 *
 * 文件位置：<TOY_DATA_DIR>/notice.json（默认 backend/data/notice.json）
 * 文件不存在 = 没有公告。
 *
 * 格式：
 *   {
 *     "text": "今晚 23:00 停机维护，约 30 分钟",
 *     "level": "info",            // info | warn | down
 *     "at": "2026-11-09T23:00:00+08:00",   // 可选：维护开始时间（ISO）
 *     "until": "2026-11-09T23:30:00+08:00",// 可选：预计结束时间
 *     "block": false              // true = 不允许开新局（维护中）
 *   }
 *
 * level 语义：
 *   info —— 普通通知，玩家照常游戏
 *   warn —— 即将维护，客户端醒目提示但仍然可以玩
 *   down —— 维护进行中，客户端阻止开新局，已在局内的照常打完
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.TOY_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'notice.json');
const MAX_TEXT = 200;

let cache = { mtime: 0, notice: null };

/* 读取当前公告。文件变了才重新解析，正常情况下一局只 stat 一次，开销可以忽略。 */
function current() {
  let st;
  try { st = fs.statSync(FILE); } catch (e) {
    cache = { mtime: 0, notice: null };
    return null;
  }
  if (st.mtimeMs === cache.mtime) return cache.notice;

  let notice = null;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    notice = normalize(raw);
  } catch (e) {
    // 文件坏了当作没有公告，但记一笔，便于运维发现写错了
    console.warn('[notice] notice.json 解析失败，已忽略：', e.message);
    notice = null;
  }
  cache = { mtime: st.mtimeMs, notice };
  return notice;
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return null;
  const level = ['info', 'warn', 'down'].indexOf(raw.level) >= 0 ? raw.level : 'info';
  const out = { text, level };
  if (raw.at) out.at = String(raw.at);
  if (raw.until) out.until = String(raw.until);
  // block：维护中禁止开新局。没显式写时，"down" 默认就是禁止
  out.block = raw.block !== undefined ? !!raw.block : level === 'down';
  return out;
}

/* 当前是否允许开新局（心跳用）。没有公告 = 允许。 */
function allowsNewGame() {
  const n = current();
  return !(n && n.block);
}

module.exports = { current, allowsNewGame, FILE };
