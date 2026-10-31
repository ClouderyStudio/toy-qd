/* 联机自测：用真实 WebSocket 客户端跑几条关键路径（不进仓库运行时路径，纯验证脚本）
 *
 *   node tools/mp-selftest.js [ws://127.0.0.1:8080]
 *
 * 覆盖：
 *  1. 房间号：创建 / 加入 / 开局 / 行动
 *  2. 断线重连：对局中掉线 → 座位保留 → 带令牌回来 → 回到原座位并补发视图
 *  3. 快速匹配：两人入池 → 配对 → 建房 → 双方进同一房间
 *  4. 大厅列表：能看到等待中的房间
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://127.0.0.1:8080';
const TIMEOUT = 6000;

let failed = 0;
function ok(name) { console.log(`  ✓ ${name}`); }
function bad(name, extra) { failed++; console.log(`  ✗ ${name}${extra ? '：' + extra : ''}`); }
function assert(cond, name, extra) { cond ? ok(name) : bad(name, extra); }

class Client {
  constructor(label) {
    this.label = label;
    this.ws = null;
    this.inbox = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
        const idx = this.waiters.findIndex((w) => w.match(msg));
        if (idx >= 0) {
          const w = this.waiters.splice(idx, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
          return;
        }
        this.inbox.push(msg);
      });
    });
  }

  /* 等一条满足条件的消息：先看积压，再挂等待 */
  wait(match, what) {
    const idx = this.inbox.findIndex(match);
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label} 等不到 ${what || '消息'}`)), TIMEOUT);
      this.waiters.push({ match, resolve, timer });
    });
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }

  async hello(name, openId, token) {
    this.send({ type: 'hello', name, openId, token });
    return this.wait((m) => m.type === 'you', 'you');
  }

  close() { if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); } }
}

const uniq = () => Math.random().toString(36).slice(2, 10);

async function scenarioRoomAndReconnect() {
  console.log('\n[1] 房间号：创建 / 加入 / 开局 / 行动');
  const a = new Client('A');
  const b = new Client('B');
  await a.connect();
  await b.connect();

  const youA = await a.hello('阿甲', 'openid-a-' + uniq());
  const youB = await b.hello('阿乙', 'openid-b-' + uniq());
  assert(youA.playerId > 0, 'A 拿到玩家 id', JSON.stringify(youA));
  assert(!!youA.token, 'A 拿到令牌');
  assert(youA.playerId !== youB.playerId, '两个 openId 是两个玩家');

  a.send({ type: 'create' });
  const roomA = await a.wait((m) => m.type === 'room', 'room');
  assert(/^[A-Z0-9]{6}$/.test(roomA.code), '房间号格式正确', roomA.code);

  b.send({ type: 'join', code: roomA.code });
  const roomB = await b.wait((m) => m.type === 'room', 'room');
  assert(roomB.code === roomA.code && roomB.you === 1, 'B 进房坐在 1 号位', JSON.stringify(roomB));

  const roomA2 = await a.wait((m) => m.type === 'room' && m.players.length === 2, '两人房间');
  assert(roomA2.players.length === 2, '房主收到 2 人房间信息');

  a.send({ type: 'start' });
  const startA = await a.wait((m) => m.type === 'start', 'start');
  const startB = await b.wait((m) => m.type === 'start', 'start');
  assert(startA.view.seats.length === 2 && startB.view.seats.length === 2, '双方都收到开局视图');
  assert(startA.view.mode === 'mp', '对局模式为 mp');

  // 轮到谁就由谁开枪（实弹空弹都行，只要事件回来就说明权威引擎在跑）
  const turnSeat = startB.view.turn;
  const shooter = turnSeat === 0 ? a : b;
  const other = turnSeat === 0 ? b : a;
  shooter.send({ type: 'action', action: { type: 'shoot', target: turnSeat === 0 ? 1 : 0 } });
  const ev = await other.wait((m) => m.type === 'events' && m.events && m.events.length, 'events');
  assert(ev.events.length > 0, `行动产生事件（${ev.events.map((e) => e.t).join(',')}）`);

  console.log('\n[2] 断线重连：保留座位 + 回到原座位');
  const bToken = youB.token;
  const bSeat = roomB.you;
  b.close();

  const afterDrop = await a.wait((m) => m.type === 'room' && m.offline && m.offline[1] === true, '掉线标记');
  assert(afterDrop.offline[bSeat] === true, '房主看到 B 掉线但座位还在');

  const b2 = new Client('B2');
  await b2.connect();
  const resumed = await b2.hello('阿乙', null, bToken);
  assert(resumed.playerId === youB.playerId, '重连后还是同一个玩家');

  const resumeView = await b2.wait((m) => m.type === 'resume', 'resume');
  assert(resumeView.you === bSeat, '回到原座位', `${resumeView.you} vs ${bSeat}`);
  assert(resumeView.view.seats.length === 2, '补发了对局视图');
  assert(resumeView.view.turn !== undefined, '视图包含回合信息');

  const backOnline = await a.wait((m) => m.type === 'room' && (!m.offline || m.offline[bSeat] === false), '恢复在线');
  assert(!backOnline.offline[bSeat], '房主看到 B 恢复在线');

  a.close(); b2.close();
  return { code: roomA.code };
}

async function scenarioMatch() {
  console.log('\n[3] 快速匹配：两人入池 → 配对 → 同一房间');
  const e = new Client('E');
  const f = new Client('F');
  await e.connect();
  await f.connect();
  const youE = await e.hello('匹配甲', 'openid-e-' + uniq());
  const youF = await f.hello('匹配乙', 'openid-f-' + uniq());
  if (!youE.playerId || !youF.playerId) { bad('快速匹配前置：身份握手失败'); return; }

  e.send({ type: 'match' });
  const queued = await e.wait((m) => m.type === 'match', 'match');
  assert(queued.status === 'queued', 'E 进入等待池', JSON.stringify(queued));

  f.send({ type: 'match' });
  const fMatch = await f.wait((m) => m.type === 'match' && m.status === 'matched', 'matched');
  assert(!!fMatch.code, 'F 收到配对房间号', JSON.stringify(fMatch));

  // E 是轮询得知的（服务端每 1.5 秒问一次 API）
  const eMatch = await e.wait((m) => m.type === 'match' && m.status === 'matched', 'matched');
  assert(eMatch.code === fMatch.code, '双方拿到同一个房间号', `${eMatch.code} vs ${fMatch.code}`);

  const roomE = await e.wait((m) => m.type === 'room', 'room');
  const roomF = await f.wait((m) => m.type === 'room' || m.type === 'waiting-host', 'room');
  assert(roomE.code === eMatch.code, '房主侧本地房间已建立', roomE.code);
  assert(roomF.code === eMatch.code, '另一位挂到同一房间', roomF.code);

  e.close(); f.close();
  return { code: eMatch.code };
}

async function scenarioLobby() {
  console.log('\n[4] 大厅列表');
  const g = new Client('G');
  const h = new Client('H');
  await g.connect();
  await h.connect();
  await g.hello('大厅甲', 'openid-g-' + uniq());
  await h.hello('大厅乙', 'openid-h-' + uniq());

  g.send({ type: 'create' });
  const room = await g.wait((m) => m.type === 'room', 'room');

  h.send({ type: 'lobby' });
  const list = await h.wait((m) => m.type === 'rooms', 'rooms');
  const found = (list.rooms || []).find((r) => r.code === room.code);
  assert(!!found, '大厅列表里能看到刚创建的房间', `共 ${list.rooms.length} 间`);
  if (found) assert(found.count >= 1 && found.status === 'waiting', '房间状态与人数正确', JSON.stringify(found));

  g.close(); h.close();
}

(async () => {
  console.log('联机自测目标：' + URL);
  try {
    await scenarioRoomAndReconnect();
    await scenarioMatch();
    await scenarioLobby();
  } catch (e) {
    failed++;
    console.log('\n✗ 用例中断：' + (e && e.message ? e.message : e));
  }
  console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
