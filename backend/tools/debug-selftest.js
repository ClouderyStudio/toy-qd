/* 开发者通道自测：debug-money 加钱后视图同步，debug-end 随机收尾进入结算
 *
 *   TOY_DEBUG=1 TURN_TIMEOUT_SECONDS=30 PORT=8094 node server.js
 *   node tools/debug-selftest.js ws://127.0.0.1:8094
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://127.0.0.1:8094';
const TIMEOUT = 8000;

let failed = 0;
function assert(cond, name, extra) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || extra === undefined ? '' : '：' + extra}`);
  if (!cond) failed++;
}

class Client {
  constructor(label) {
    this.label = label;
    this.inbox = [];
    this.waiters = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', resolve);
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
  wait(match, what) {
    const idx = this.inbox.findIndex(match);
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label} 等不到 ${what || '消息'}`)), TIMEOUT);
      this.waiters.push({ match, resolve, timer });
    });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  async hello(name, openId) {
    this.send({ type: 'hello', name, openId });
    return this.wait((m) => m.type === 'you', 'you');
  }
  close() { if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); } }
}

const uniq = () => Math.random().toString(36).slice(2, 10);

(async () => {
  console.log(`\n[开发者通道] ${URL}`);
  const a = new Client('A');
  const b = new Client('B');
  await a.connect();
  await b.connect();
  await a.hello('甲调试', 'dbg-' + uniq());
  await b.hello('乙', 'dbg-' + uniq());

  a.send({ type: 'create' });
  const room = await a.wait((m) => m.type === 'room', 'room');
  b.send({ type: 'join', code: room.code });
  await b.wait((m) => m.type === 'room', 'room');
  a.send({ type: 'start' });
  const startA = await a.wait((m) => m.type === 'start', 'start');
  await b.wait((m) => m.type === 'start', 'start');

  // 加钱：A 加 12345，双方视图都同步
  a.send({ type: 'debug-money', amount: 12345 });
  const moneyA = await a.wait((m) => m.type === 'events' && m.view.seats[0].money === 12345, 'A 视图加钱');
  await b.wait((m) => m.type === 'events' && m.view.seats[0].money === 12345, 'B 视图加钱');
  assert(!!moneyA, '加钱后双方视图同步（seat0 = 12345）');

  // 随机收尾：over 事件 + phase=over + 有 winner
  a.send({ type: 'debug-end' });
  const overA = await a.wait((m) => m.type === 'events' && m.view.phase === 'over', 'A over');
  await b.wait((m) => m.type === 'events' && m.view.phase === 'over', 'B over');
  assert(overA.view.result && typeof overA.view.result.winner === 'number', '随机收尾给出 winner', JSON.stringify(overA.view.result));
  assert(overA.view.seats.every((s) => s.money > 0), '收尾时发了随机奖金', JSON.stringify(overA.view.seats.map((s) => s.money)));

  a.close();
  b.close();
  console.log(failed ? `\n${failed} 项失败` : '\n开发者通道全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
