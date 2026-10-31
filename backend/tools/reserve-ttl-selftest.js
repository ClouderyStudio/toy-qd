/* 座位保留超时验证：大厅里掉线 20 秒后座位应被回收
 * 所有等待都在发消息之前挂好 —— 广播是立即推送的，晚挂一步就漏掉。
 */
const WebSocket = require('ws');
const WS_URL = process.argv[2] || 'ws://127.0.0.1:8080';

function wait(ws, pred, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等不到消息')), ms || 8000);
    const handler = (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!pred(m)) return;
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(m);
    };
    ws.on('message', handler);
  });
}

const open = (ws) => new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
const send = (ws, msg) => ws.send(JSON.stringify(msg));

(async () => {
  const a = new WebSocket(WS_URL);
  const b = new WebSocket(WS_URL);
  await Promise.all([open(a), open(b)]);

  let p = wait(a, (m) => m.type === 'you');
  send(a, { type: 'hello', name: '留甲' });
  await p;

  p = wait(b, (m) => m.type === 'you');
  send(b, { type: 'hello', name: '留乙' });
  await p;

  p = wait(a, (m) => m.type === 'room');
  send(a, { type: 'create' });
  const room = await p;
  console.log('房间已建:', room.code);

  const bothSeen = wait(a, (m) => m.type === 'room' && m.players.length === 2);
  p = wait(b, (m) => m.type === 'room');
  send(b, { type: 'join', code: room.code });
  await p;
  await bothSeen;
  console.log('两人在房: 人数 = 2');

  const offlineSeen = wait(a, (m) => m.type === 'room' && m.offline && m.offline[1] === true, 6000);
  b.close();
  const offline = await offlineSeen;
  console.log('掉线即刻: offline =', JSON.stringify(offline.offline), '| 人数 =', offline.players.length);

  const freed = await wait(a, (m) => m.type === 'room' && m.players.length === 1, 30000);
  console.log('超时后座位回收: 人数 =', freed.players.length, '| 玩家 =', freed.players.join('/'));

  a.close();
  process.exit(0);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
