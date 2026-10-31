/*
 * 引擎 + 动画播放器联测：验证「回合不会死锁」
 *
 * 背景：朝自己开空弹时引擎保留回合（keep=true），不会再发 turn 事件。
 * Director 若不在队列跑空后把枪收回桌面，就会一直停在 gun='self'，
 * 而绘制层只在 gun==='table' 时注册「拿起霰弹枪」的点击热区 —— 玩家于是再也点不动。
 *
 * 用法：node backend/tools/director-selftest.js
 */
const path = require('path');

// ---- 最小浏览器垫片：Director 只用到 window.BR / sfx / fx ----
global.window = global;
const BR = (global.BR = {});
BR.sfx = new Proxy({}, { get: () => () => {} });
BR.fx = { shake: 0, flash: 0, red: 0, black: 0 };

const js = path.join(__dirname, '..', '..', 'js');
require(path.join(js, 'engine-core.js'));
require(path.join(js, 'engine-act.js'));
require(path.join(js, 'engine-flow.js'));
require(path.join(js, 'director.js'));

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

// 把时间往前推，直到播放器把队列播完（或超时）。
// 真实主循环每帧都会调 update()，队列跑空的那一帧之后还会继续走帧，
// 所以这里在 idle 之后补一帧，与运行时对齐。
function settle(dir, limit = 30) {
  let t = 0;
  while (!dir.idle() && t < limit) { dir.update(0.1); t += 0.1; }
  dir.update(0.1);
  return t;
}

/* ---------- 1) 朝自己开空弹：回合保留，枪必须回到桌面 ---------- */
{
  // 第一关装弹是 1 实 2 空，先找一副「第 1 发是空弹」的牌，第一枪就能打出这个分支
  let game;
  for (let i = 0; i < 200; i++) {
    game = new BR.Game('story', ['你', 'DEALER']);
    game.start();
    if (game.shells[0] === false) break;
  }
  ok(game.shells[0] === false, '构造成功：第 1 发是空弹');
  ok(game.phase === 'turn' && game.turn === 0, `构造成功：轮到我（phase=${game.phase} turn=${game.turn}）`);

  const dir = new BR.Director(game.getView(0), 0);

  const events = game.act(0, { type: 'shoot', target: 0 });
  dir.push(events, game.getView(0));
  settle(dir);

  const kept = game.turn === 0 && game.phase === 'turn';
  ok(kept, '空弹打自己后引擎保留回合并未发 turn 事件');
  ok(dir.gun === 'table', `队列跑空后枪应回到桌面（实际 gun=${JSON.stringify(dir.gun)}）`);
  ok(dir.aim === -1, `队列跑空后瞄准目标应清空（实际 aim=${dir.aim}）`);
  ok(dir.idle(), '播放器已空闲，玩家可以继续操作');
  // 还能接着打：证明不是只能看不能动
  let again = null;
  try { again = game.act(0, { type: 'shoot', target: 1 }); } catch (e) { again = null; }
  ok(Array.isArray(again) && again.length > 0, '空弹之后仍能继续行动');
}

/* ---------- 2) 朝庄家开枪后，枪同样要回到桌面 ---------- */
{
  const game = new BR.Game('story', ['你', 'DEALER']);
  const dir = new BR.Director(game.getView(0), 0);
  dir.push(game.start(), game.getView(0));
  settle(dir);
  dir.push(game.act(0, { type: 'shoot', target: 1 }), game.getView(0));
  settle(dir);
  ok(dir.gun === 'table', `射击庄家后枪回到桌面（实际 gun=${JSON.stringify(dir.gun)}）`);
  ok(dir.aim === -1, `射击庄家后瞄准目标清空（实际 aim=${dir.aim}）`);
}

/* ---------- 3) 连打 30 局随机动作，检查任何时刻都点得动 ---------- */
{
  let dead = 0, steps = 0;
  for (let n = 0; n < 30; n++) {
    const game = new BR.Game('story', ['你', 'DEALER']);
    const dir = new BR.Director(game.getView(0), 0);
    dir.push(game.start(), game.getView(0));
    settle(dir);
    for (let i = 0; i < 40; i++) {
      if (!dir.idle()) { settle(dir); continue; }
      if (game.phase === 'over' || game.phase === 'donChoice') break;
      if (game.phase !== 'turn') break;
      // 轮到庄家：让 AI 走；轮到我：随机开枪
      const seat = game.turn;
      const target = seat === 0 ? (Math.random() < 0.5 ? 0 : 1) : 0;
      let events;
      try { events = game.act(seat, { type: 'shoot', target }); } catch (e) { break; }
      dir.push(events, game.getView(0));
      settle(dir);
      steps++;
      // 关键断言：播放器空闲后，若轮到人类且存活，必须能点枪（gun === 'table'）
      if (game.phase === 'turn' && game.turn === 0 && game.seats[0].alive && dir.gun !== 'table') dead++;
    }
  }
  ok(dead === 0, `随机 30 局 × 最多 40 步（${steps} 步）中无死锁（可点枪状态异常 ${dead} 次）`);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
