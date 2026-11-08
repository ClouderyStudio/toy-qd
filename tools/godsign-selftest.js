#!/usr/bin/env node
/* 「上帝签名」彩蛋回归：掉率、不改变道具总数、不在道具池、能正常使用。
 * 跑法：node tools/godsign-selftest.js
 */
'use strict';

global.window = undefined;
const BR = require('../js/items.js');
require('../js/engine-core.js');
require('../js/engine-act.js');
require('../js/engine-flow.js');
require('../js/engine-items.js');

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  → ' + (extra || '')}`);
  cond ? pass++ : fail++;
}

// 1) 不在任何道具池里 —— 只能靠彩蛋掉落，不能正常抽到
const inPool = Object.keys(BR.POOLS).some((m) => BR.POOLS[m].indexOf('godsign') >= 0);
assert(!inPool, 'godsign 不在任何模式的道具池');

// 2) 有定义，且不参与需要目标道具的判定
assert(!!BR.ITEMS.godsign, 'ITEMS 里有 godsign 定义');
assert(!BR.ITEMS.godsign.needsTarget, 'godsign 不需要选目标');

// 3) 发牌不改变道具总数（彩蛋只是替换，不额外多给）
let total = 0;
const N = 3000;
for (let i = 0; i < N; i++) {
  const g = new BR.Game('story', ['A', 'DEALER']);
  g.startStage(1);
  g.seats.forEach((s) => { s.items = []; });
  g.deal(4);
  total += g.seats.reduce((n, s) => n + s.items.length, 0);
}
assert(total === N * 8, '发牌后总道具数恒为 座位数×发放数', `${total} vs ${N * 8}`);

// 4) 掉率在合理区间（约 0.5%/座位次）：统计出现次数
let hits = 0, trials = 0;
for (let i = 0; i < N; i++) {
  const g = new BR.Game('don', ['A', 'DEALER']);
  g.startStage(1);
  g.seats.forEach((s) => { s.items = []; });
  g.deal(4);
  trials += 2;
  hits += g.seats.reduce((n, s) => n + s.items.filter((k) => k === 'godsign').length, 0);
}
const rate = hits / trials;
assert(rate > 0.0005 && rate < 0.02, '掉率落在合理区间', `观测 ${(rate * 100).toFixed(3)}%（${hits}/${trials}）`);
console.log(`    观测掉率：${(rate * 100).toFixed(3)}%  （目标 ~0.5%，${hits}/${trials} 座位次）`);

// 5) 掏出彩蛋时引擎会发 godsign 事件
let sawEvent = false;
for (let i = 0; i < 200000 && !sawEvent; i++) {
  const g = new BR.Game('story', ['A', 'DEALER']);
  g.startStage(1);
  g.seats.forEach((s) => { s.items = []; });
  g.ev = [];
  g.deal(4);
  if (g.flush().some((e) => e.t === 'godsign')) sawEvent = true;
}
assert(sawEvent, '掏出彩蛋时发出 godsign 事件');

// 6) 使用后正常消耗、不改变任何对局状态
{
  const g = new BR.Game('story', ['A', 'DEALER']);
  g.startStage(1);
  const st = g.seats[0];
  st.items = ['godsign'];
  const before = { hp: st.hp, left: g.left, sawed: g.sawed, dir: g.dir, idx: g.idx };
  const ev = g.act(0, { type: 'item', slot: 0 });
  const item = ev.find((e) => e.t === 'item' && e.item === 'godsign');
  assert(!!item, '使用彩蛋发出 item 事件');
  assert(st.items.length === 0, '使用后道具被消耗');
  assert(st.hp === before.hp && g.left === before.left && g.sawed === before.sawed && g.dir === before.dir && g.idx === before.idx,
    '使用彩蛋不改变任何对局状态');
}

// 7) 不能偷「肾上腺素」那种限制不适用于彩蛋，但彩蛋本身可被偷（设计上允许）
{
  const g = new BR.Game('story', ['A', 'DEALER']);
  g.startStage(1);
  g.seats[1].items = ['godsign'];
  g.seats[0].items = ['adrenaline'];
  const ev = g.act(0, { type: 'item', slot: 0, target: 1, steal: 0 });
  assert(ev.some((e) => e.t === 'steal' && e.item === 'godsign'), '彩蛋可被肾上腺素偷取并使用');
}

console.log(`\n${fail ? '有失败项' : '全部通过'}（${pass} 过 / ${fail} 败）`);
process.exit(fail ? 1 : 0);
