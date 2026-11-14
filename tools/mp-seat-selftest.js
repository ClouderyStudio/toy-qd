#!/usr/bin/env node
/* 联机回归：座位错位 / 玩家退出 / 回合判定。
 * 跑法：node tools/mp-seat-selftest.js
 * 直接驱动 rooms.js 的内部逻辑太绕，这里复刻它的关键约定做单元验证：
 *   - 引擎的 leave() 不删座位，服务端也必须保留占位
 *   - 退出后剩下的玩家 seat 索引不变，能正常行动
 *   - 两人局走掉一人，剩下那位直接结算，不会干等
 */
'use strict';

const BR = require('../js/items.js');
require('../js/engine-core.js');
require('../js/engine-act.js');
require('../js/engine-flow.js');
require('../js/engine-items.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  → ' + (extra === undefined ? '' : extra)}`);
  cond ? pass++ : fail++;
}

// 1) 引擎 leave 不改变座位数（服务端据此保留占位）
{
  const g = new BR.Game('mp', ['A', 'B', 'C']);
  g.startStage(1);
  const before = g.seats.length;
  g.leave(1);
  ok(g.seats.length === before, 'leave 后引擎座位数不变（占位保留）');
  ok(g.seats[1].connected === false, '离开的座位标记为断开');
  ok(g.seats[0].name === 'A' && g.seats[2].name === 'C', '其余座位索引不变');
}

// 2) 中间座位退出后，后面的玩家仍能按原座位号行动
{
  const g = new BR.Game('mp', ['A', 'B', 'C']);
  g.startStage(1);
  g.leave(1);                       // B 退出
  g.turn = 2;                       // 轮到 C
  let ev = null, err = null;
  try { ev = g.act(2, { type: 'shoot', target: 0 }); } catch (e) { err = e.message; }
  ok(!err, '退出者之后的玩家仍能用原座位号行动', err);
  ok(ev && ev.some((e) => e.t === 'shoot'), '产生了开枪事件');
}

// 3) 视图按座位号取，不会因为有人退出而错位
{
  const g = new BR.Game('mp', ['A', 'B', 'C']);
  g.startStage(1);
  g.leave(0);                       // 房主退出
  const v0 = g.getView(1);
  const v2 = g.getView(2);
  ok(v0.seats[1].name === 'B', '座位 1 的视图仍然对应 B');
  ok(v0.you === 1 && v2.you === 2, '视图的 you 字段与请求的座位一致');
}

// 4) 两人局走掉一人：直接结束，不能让剩下的人干等
{
  const g = new BR.Game('mp', ['A', 'B']);
  g.startStage(1);
  const ev = g.leave(1);
  ok(g.phase === 'over', '两人局少一人后立即结束', g.phase);
  ok(g.over === true, 'over 标志置位（客户端靠它收尾）', g.over);
  ok(ev.some((e) => e.t === 'over'), '广播了 over 事件');
  ok(g.result && g.result.winner === 0, '留下的玩家获胜', JSON.stringify(g.result));
}

// 5) 三人局走一人：还剩两人，对局继续，不能提前结束
{
  const g = new BR.Game('mp', ['A', 'B', 'C']);
  g.startStage(1);
  g.leave(1);
  ok(g.phase !== 'over', '三人局少一人后对局继续', g.phase);
  ok(g.over !== true, 'over 标志未被误置');
}

// 6) 走掉的人如果在当前回合：回合要正确移交，不能卡住
{
  const g = new BR.Game('mp', ['A', 'B', 'C']);
  g.startStage(1);
  g.turn = 1;
  g.leave(1);
  ok(g.phase !== 'over', '对局未结束');
  ok(g.turn !== 1, '回合已移交给仍然在场的玩家', `turn=${g.turn}`);
  ok(g.seats[g.turn].alive && g.seats[g.turn].connected, '当前回合属于活着且在线的人');
}

// 7) 主动操作非自己的回合，必须明确报错（这是正常的，不是 bug）
{
  const g = new BR.Game('mp', ['A', 'B']);
  g.startStage(1);
  g.turn = 0;
  let msg = '';
  try { g.act(1, { type: 'shoot', target: 0 }); } catch (e) { msg = e.message; }
  ok(msg === '还没轮到你', '非本回合操作被引擎拒绝', msg);
}

// 8) 自己回合内连发动作不应被拒（空弹打自己保留回合）
{
  const g = new BR.Game('mp', ['A', 'B']);
  g.startStage(1);
  g.turn = 0;
  // 子弹是槽位对象（{live,no}），别直接塞布尔值，否则引擎读 .live 会拿到 undefined
  g.shells = [false, false, false, false].map((live) => BR.slot(live, g.loadNo));
  g.idx = 0;
  let okCount = 0;
  for (let i = 0; i < 2; i++) {
    try { g.act(0, { type: 'shoot', target: 0 }); okCount++; } catch (e) { /* 记失败 */ }
  }
  ok(okCount === 2, '自己回合内连续两次动作都成功', `${okCount}/2`);
}

// 9) 全员掉线后房间应能正常收尾，不抛异常
{
  const g = new BR.Game('mp', ['A', 'B', 'C']);
  g.startStage(1);
  let err = null;
  try {
    g.leave(0); g.leave(1); g.leave(2);
  } catch (e) { err = e.message; }
  ok(!err, '连续离开不抛异常', err);
  ok(g.phase === 'over', '全部离开后对局结束', g.phase);
}

console.log(`\n${fail ? '有失败项' : '全部通过'}（${pass} 过 / ${fail} 败）`);
process.exit(fail ? 1 : 0);
