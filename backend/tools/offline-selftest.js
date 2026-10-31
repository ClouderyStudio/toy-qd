/* 降级模式验证：API 未配置时，房间号玩法与本地令牌重连必须照旧可用 */
const WebSocket = require('ws');
const WS_URL = process.argv[2] || 'ws://127.0.0.1:8081';

function wait(ws, type, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等不到 ' + type)), ms || 5000);
    const handler = (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type !== type) return;
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

  send(a, { type: 'hello', name: '假甲' });
  const ya = await wait(a, 'you');
  send(b, { type: 'hello', name: '假乙' });
  const yb = await wait(b, 'you');
  console.log('本地身份（online=false 表示未接 API）:', ya.online === false, '| 玩家 id =', ya.playerId);

  send(a, { type: 'create' });
  const room = await wait(a, 'room');
  send(b, { type: 'join', code: room.code });
  await wait(b, 'room');

  send(a, { type: 'start' });
  const startA = await wait(a, 'start');
  console.log('开局成功:', startA.view.seats.length === 2, '| 座位:', startA.view.seats.map((s) => s.name).join('/'));

  // 快速匹配降级：用第三人（不在房间里）验证，b 已经在房里了
  const c = new WebSocket(WS_URL);
  await open(c);
  send(c, { type: 'hello', name: '假丙' });
  await wait(c, 'you');
  send(c, { type: 'match' });
  const match = await wait(c, 'match');
  console.log('快速匹配降级提示:', match.status === 'unavailable', '|', match.message);
  c.close();

  b.close();
  const b2 = new WebSocket(WS_URL);
  await open(b2);
  send(b2, { type: 'hello', name: '假乙', token: yb.token });
  const y2 = await wait(b2, 'you');
  const resumed = await wait(b2, 'resume');
  console.log('本地令牌重连:', y2.playerId === yb.playerId, '| 座位 =', resumed.you, '| 有视图 =', !!resumed.view);

  a.close();
  b2.close();
  process.exit(0);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
