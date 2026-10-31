/*
 * 公网联机探针：不打本机，直接连线上 wss，走完 握手 → 建房 → 加入 → 开局 → 行动。
 *
 *   node tools/live-probe.js [wss://api.cloudery.cn/toy-mp]
 *
 * 与 mp-selftest 的区别：那个跑在本地进程内，这个验的是「玩家真正走的那条路」——
 * EO → openresty → Node → ClouderyApi 全链路，任何一跳配置错了都会在这里失败。
 * 无 Origin 头，因此不受 ALLOWED_ORIGINS 限制。
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'wss://api.cloudery.cn/toy-mp';
const TIMEOUT = 15000;

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`);
  if (!cond) failed++;
};

function connect(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const box = { ws, tag, msgs: [], waiters: [] };
    const timer = setTimeout(() => reject(new Error(`${tag} 连接超时（${URL}）`)), TIMEOUT);
    ws.on('open', () => { clearTimeout(timer); resolve(box); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      box.msgs.push(m);
      box.waiters = box.waiters.filter((w) => {
        if (w.type === m.type) { w.resolve(m); return false; }
        return true;
      });
    });
    box.send = (o) => ws.send(JSON.stringify(o));
    box.wait = (type, ms = 8000) => {
      const hit = box.msgs.find((m) => m.type === type);
      if (hit) return Promise.resolve(hit);
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`${tag} 等 ${type} 超时`)), ms);
        box.waiters.push({ type, resolve: (m) => { clearTimeout(t); res(m); } });
      });
    };
    box.close = () => { try { ws.close(); } catch (e) {} };
  });
}

(async () => {
  console.log(`目标：${URL}\n`);

  const A = await connect('A');
  A.send({ type: 'hello', name: 'AAA', openId: 'probe-live-A' });
  const youA = await A.wait('you');
  ok(!!youA.playerId, 'A 握手拿到玩家 id', youA.playerId);
  ok(youA.online === true, 'A 在线身份已接通 ClouderyApi（online=true 才说明 Node 持密钥调通了 API）', youA.online);

  A.send({ type: 'create' });
  const roomA = await A.wait('room');
  ok(/^[A-Z0-9]{6}$/.test(roomA.code || ''), 'A 建房拿到房间号', roomA.code);

  const B = await connect('B');
  B.send({ type: 'hello', name: 'BBB', openId: 'probe-live-B' });
  const youB = await B.wait('you');
  ok(youB.playerId !== youA.playerId, 'B 是另一个玩家', youB.playerId);

  B.send({ type: 'join', code: roomA.code });
  const roomB = await B.wait('room');
  ok(roomB.you === 1, 'B 坐在 1 号位', roomB.you);

  // 大厅列表应能看到这间房
  B.send({ type: 'lobby' });
  const lobby = await B.wait('rooms');
  const listed = (lobby.rooms || []).some((r) => r.code === roomA.code);
  ok(listed, '大厅列表里能看到这间房（走的是 API 房间目录）', (lobby.rooms || []).length);

  A.send({ type: 'start' });
  const startA = await A.wait('start');
  const startB = await B.wait('start');
  ok(!!startA.view && startA.view.mode === 'mp', 'A 收到开局视图');
  ok(!!startB.view && (startB.view.seats || []).length === 2, 'B 收到 2 人座位', (startB.view.seats || []).length);

  // 轮到谁谁开枪
  const aMyTurn = startA.view.turn === startA.you;
  const mine = aMyTurn ? A : B;
  const mySeat = aMyTurn ? startA.you : startB.you;
  const before = mine.msgs.filter((m) => m.type === 'events').length;
  mine.send({ type: 'action', action: { type: 'shoot', target: 1 - mySeat } });
  // 用开枪者的视角判断：等一条 events
  await new Promise((r) => setTimeout(r, 1500));
  const after = mine.msgs.filter((m) => m.type === 'events').length;
  ok(after > before, '开枪后收到事件推送（服务端引擎在跑）', { before, after });

  const err = mine.msgs.find((m) => m.type === 'error');
  ok(!err, '动作没有被服务端拒绝', err && err.message);

  A.close(); B.close();
  console.log(failed ? `\n${failed} 项失败` : '\n公网链路全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
