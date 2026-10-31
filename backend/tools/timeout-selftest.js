/* 回合超时自测：轮到的人不动作，服务端要在时限后 AI 代打，全场继续推进
 *
 *   TURN_TIMEOUT_SECONDS=2 PORT=8093 node server.js   # 另开进程
 *   node tools/timeout-selftest.js ws://127.0.0.1:8093
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://127.0.0.1:8093';
const TIMEOUT = 30000;   // 要等超时代打，留足余量

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
  console.log(`\n[回合超时] TURN_TIMEOUT_SECONDS=2 的服务 ${URL}`);
  const a = new Client('A');
  const b = new Client('B');
  await a.connect();
  await b.connect();
  await a.hello('甲超时', 'to-' + uniq());
  await b.hello('乙', 'to-' + uniq());

  a.send({ type: 'create' });
  const room = await a.wait((m) => m.type === 'room', 'room');
  b.send({ type: 'join', code: room.code });
  await b.wait((m) => m.type === 'room', 'room');

  a.send({ type: 'start' });
  const startA = await a.wait((m) => m.type === 'start', 'start');
  await b.wait((m) => m.type === 'start', 'start');
  assert(typeof startA.turnLeft === 'number' && startA.turnLeft > 0, 'start 带回合剩余毫秒', JSON.stringify(startA.turnLeft));

  const firstTurn = startA.view.turn;
  // 谁都不动手，等系统代打
  const notice = await a.wait((m) => m.type === 'notice' && /超时/.test(m.text || ''), 'notice');
  assert(!!notice, `超时后收到系统代打提示（${notice.text}）`);
  const shootMatch = (m) => m.type === 'events' && m.events.some((e) => e.t === 'shoot');
  const ev = await a.wait(shootMatch, 'events');
  assert(ev.events.some((e) => e.t === 'shoot'), '代打产生了开枪事件');
  assert(typeof ev.turnLeft === 'number', '事件消息带下一回合剩余毫秒', JSON.stringify(ev.turnLeft));

  const bEv = await b.wait(shootMatch, 'B events');
  assert(bEv.events.some((e) => e.t === 'shoot'), '另一位玩家同样收到代打事件');

  // 对局仍在推进：视图里 phase 仍是 turn（除非这一枪直接终结了关卡）
  assert(['turn', 'stageEnd'].includes(ev.view.phase), '代打后对局继续', ev.view.phase);

  a.close();
  b.close();
  console.log(failed ? `\n${failed} 项失败` : '\n回合超时全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
