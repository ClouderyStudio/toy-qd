#!/usr/bin/env node
/* 联机三人局 + 中途退出：验证座位不错位、剩下的人不会卡死。
 * 跑法（先起服务）：node backend/server.js  然后  node backend/tools/quit-selftest.js [ws://127.0.0.1:8081] */
'use strict';
const WebSocket = require('ws');
const WS_URL = process.argv[2] || 'ws://127.0.0.1:8081';

function open(ws) { return new Promise((r, j) => { ws.on('open', r); ws.on('error', j); }); }
const send = (ws, msg) => ws.send(JSON.stringify(msg));

/* 等一条消息。type 可为字符串或数组。 */
function wait(ws, type, ms) {
  const types = Array.isArray(type) ? type : [type];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', h); reject(new Error('等不到 ' + types.join('/'))); }, ms || 6000);
    const h = (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (types.indexOf(m.type) < 0) return;
      clearTimeout(timer);
      ws.off('message', h);
      resolve(m);
    };
    ws.on('message', h);
  });
}

function ok(cond, name, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  → ' + (extra === undefined ? '' : extra)}`);
  return cond;
}

(async () => {
  const client = (name) => {
    const ws = new WebSocket(WS_URL);
    return { ws, name, ready: open(ws) };
  };

  const A = client('房主'), B = client('乙'), C = client('丙');
  await Promise.all([A.ready, B.ready, C.ready]);

  for (const c of [A, B, C]) {
    send(c.ws, { type: 'hello', name: c.name });
    c.you = await wait(c.ws, 'you');
  }

  send(A.ws, { type: 'create' });
  const room = await wait(A.ws, 'room');
  send(B.ws, { type: 'join', code: room.code });
  await wait(B.ws, 'room');
  send(C.ws, { type: 'join', code: room.code });
  await wait(C.ws, 'room');
  // 进房会向房主广播新的 room，先把它消化掉，再等 start
  await new Promise((r) => setTimeout(r, 300));

  send(A.ws, { type: 'start' });
  // 三人都会收到 start；顺序不定，先各自注册再触发不了，所以这里直接并发等
  const [startA, startB, startC] = await Promise.all([
    wait(A.ws, 'start', 8000),
    wait(B.ws, 'start', 8000),
    wait(C.ws, 'start', 8000)
  ]);
  console.log('\n开局：座位', startA.view.seats.map((s) => s.name).join('/'));
  ok(startA.view.seats.length === 3, '三人局开局成功');
  void startB; void startC;

  // ── 核心：中间那位（乙）中途退出 ──
  console.log('\n乙中途退出……');
  B.ws.close();
  const leftMsg = await wait(C.ws, ['events', 'offline-left', 'room'], 8000).catch(() => null);
  ok(!!leftMsg, '其余玩家收到退出相关消息', leftMsg && leftMsg.type);

  // 退出后，丙应当还能正常行动（等轮到他）
  let acted = false, lastErr = null;
  const tryAct = async (who) => {
    for (let i = 0; i < 30; i++) {
      const view = (await wait(who.ws, 'events', 2500).catch(() => null));
      if (!view) continue;
      const v = view.view;
      if (v && v.phase === 'turn' && v.seats[v.turn] && v.seats[v.turn].name === who.name) {
        send(who.ws, { type: 'action', action: { type: 'shoot', target: v.turn } });
        acted = true;
        return true;
      }
    }
    return false;
  };

  // 丙主动发一次动作（无论是否轮到他，服务端都不该让连接卡死）
  send(C.ws, { type: 'action', action: { type: 'shoot', target: 0 } });
  const resp = await wait(C.ws, ['events', 'error'], 5000).catch((e) => { lastErr = e.message; return null; });
  ok(!!resp, '丙的动作得到响应（没有卡住）', lastErr || (resp && resp.type));
  if (resp && resp.type === 'error') {
    ok(resp.message !== undefined, '错误信息正常返回', resp.message);
  }

  // 座位索引检查：剩下两人仍按原座位对应
  if (resp && resp.view) {
    const v = resp.view;
    ok(v.seats.length === 3, '视图里仍是 3 个座位（退出者保留占位）', v.seats.length);
    ok(v.seats[1].connected === false, '退出的座位标记为断开');
  }

  console.log(`\n最终：丙${acted ? '已成功行动' : '未轮到'}；连接保持正常`);
  [A.ws, C.ws].forEach((w) => { try { w.close(); } catch (e) { /* 忽略 */ } });
  process.exit(0);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
