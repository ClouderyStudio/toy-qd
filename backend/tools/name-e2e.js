#!/usr/bin/env node
/* 长昵称端到端：联机打一局后，服务器战绩榜上的名字应当完整。
 * 跑法：node backend/tools/name-e2e.js [ws://127.0.0.1:8084] */
'use strict';
const WebSocket = require('ws');
const http = require('http');

const BASE = (process.argv[2] || 'ws://127.0.0.1:8084').replace(/^ws/, 'http');
const WS = BASE.replace(/^http/, 'ws');

function open(ws) { return new Promise((r, j) => { ws.on('open', r); ws.on('error', j); }); }
const send = (ws, m) => ws.send(JSON.stringify(m));

function wait(ws, type, ms) {
  const types = Array.isArray(type) ? type : [type];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('等不到 ' + types.join('/'))); }, ms || 8000);
    const h = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (types.indexOf(m.type) < 0) return;
      clearTimeout(t); ws.off('message', h); resolve(m);
    };
    ws.on('message', h);
  });
}

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const LONG_A = '这是一个很长的昵称甲';
const LONG_B = '第二位的长名字乙';

function ok(cond, name, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  → ' + (extra === undefined ? '' : extra)}`);
  return cond;
}

(async () => {
  const a = new WebSocket(WS), b = new WebSocket(WS);
  await Promise.all([open(a), open(b)]);

  send(a, { type: 'hello', name: LONG_A });
  await wait(a, 'you');
  send(b, { type: 'hello', name: LONG_B });
  await wait(b, 'you');

  send(a, { type: 'create' });
  const room = await wait(a, 'room');
  send(b, { type: 'join', code: room.code });
  await wait(b, 'room');
  await new Promise((r) => setTimeout(r, 300));

  send(a, { type: 'start' });
  const [sa, sb] = await Promise.all([wait(a, 'start'), wait(b, 'start')]);
  ok(sa.view.seats.length === 2, '两人局开局');

  // 视图里的名字应当没被截断
  const seatNames = sa.view.seats.map((s) => s.name);
  ok(seatNames[0] === LONG_A, '视图里房主名字完整', seatNames[0]);
  ok(seatNames[1] === LONG_B, '视图里对手名字完整', seatNames[1]);

  // 打完这局：让双方互相打到结束
  const act = (ws, view) => {
    if (!view || view.phase !== 'turn') return false;
    send(ws, { type: 'action', action: { type: 'shoot', target: view.turn === 0 ? 1 : 0 } });
    return true;
  };
  act(a, sa.view);

  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    const msg = await wait(a, ['events', 'notice'], 4000).catch(() => null);
    if (!msg) continue;
    if (msg.view && msg.view.phase === 'over') { done = true; break; }
    if (msg.view) act(a, msg.view);
    const msgB = await wait(b, ['events'], 2000).catch(() => null);
    if (msgB && msgB.view) {
      if (msgB.view.phase === 'over') { done = true; break; }
      act(b, msgB.view);
    }
  }

  // 直接查服务器战绩榜
  const stats = await getJSON('/api/stats');
  const names = (stats.players || []).map((p) => p.name);
  ok(names.indexOf(LONG_A) >= 0, '服务器战绩里出现完整昵称甲', names.join(' | '));
  ok(names.indexOf(LONG_B) >= 0, '服务器战绩里出现完整昵称乙', names.join(' | '));
  const anyTruncated = names.some((n) => n && Array.from(n).length === 6 && (LONG_A.startsWith(n) || LONG_B.startsWith(n)));
  ok(!anyTruncated, '没有出现被截成 6 字的名字', names.join(' | '));

  [a, b].forEach((w) => { try { w.close(); } catch (e) { /* 忽略 */ } });
  process.exit(0);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
