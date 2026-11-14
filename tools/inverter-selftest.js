#!/usr/bin/env node
/* 逆转器 / 子弹计数 / 庄家 AI 回归：纯逻辑，不需要浏览器。
 *
 * 跑法：node tools/inverter-selftest.js
 *
 * 覆盖玩家反馈的三类问题：
 *  1. 逆转器翻转后，「剩余实弹 / 空弹」（子弹自动计数）是否还对得上真实弹序
 *  2. 联机时每个客户端各自累加计数，会不会越算越偏
 *  3. 庄家在已知子弹时仍用放大镜、不用逆转器、最后一发也铐人、残血先吃过期药
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Director 只用到 window.BR / sfx / fx，垫一个最小浏览器环境
global.window = global;
const BR = (global.BR = {});
BR.sfx = new Proxy({}, { get: () => () => {} });
BR.fx = { shake: 0, flash: 0, red: 0, black: 0 };

for (const f of fs.readdirSync(path.join(__dirname, '..', 'js'))) {
  if (/^(items|engine-core|engine-act|engine-flow|engine-items|ai|director)\.js$/.test(f)) {
    require(path.join(__dirname, '..', 'js', f));
  }
}

let failed = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
};

/* 用固定牌序的局，方便构造「第 n 发是什么」的场景。
 * 直接改 engine 内部字段：引擎的 shells 是「每发一个槽位」的数组。 */
function fixedGame(shells, mode = 'story') {
  const g = new BR.Game(mode, ['你', 'DEALER']);
  g.start();
  // 按固定牌序覆盖，槽位带上本次装弹序号（逆转器会把它清零）
  g.shells = shells.map((live) => BR.slot(live && live.live !== undefined ? live.live : live, g.loadNo));
  g.idx = 0;
  g.spent = [];
  g.known = g.seats.map(() => ({}));
  g.plan.items = 0;
  g.phase = 'turn';
  g.turn = 0;
  g.seats.forEach((s) => { s.items = []; });
  return g;
}

/* 给某个座位塞一件道具并立刻使用它（只取第一格，免得上一个动作改过道具表） */
function useForced(g, seat, key, extra) {
  g.seats[seat].items = [key];
  return g.act(seat, Object.assign({ type: 'item', slot: 0 }, extra || {}));
}

/* 一个槽位是「本次装弹的原装子弹」还是「被逆转器翻过的临时子弹」 */
function isOriginal(g, s) { return s.no === g.loadNo; }

/* 从真实弹序里数出「本次装弹还剩多少实弹 / 空弹」——
 * 这是玩家看到的数字，口径必须和引擎一致：只数还没打出、且没被翻过的原装槽位。
 * 翻转后的子弹既不算实也不算空（它会被翻成什么由玩家当下决定，不能替玩家预设）。 */
function truth(g) {
  const rest = g.shells.slice(g.idx).filter((s) => isOriginal(g, s));
  return {
    live: rest.filter((s) => s.live).length,
    blank: rest.filter((s) => !s.live).length,
    left: g.shells.length - g.idx
  };
}

/* ---------- 1) 逆转器后，剩余子弹计数必须与真实弹序一致 ---------- */
{
  // 3 实 3 空，第 1 发是空弹：用逆转器把它翻成实弹
  const g = fixedGame([false, true, true, true, false, false]);
  const view0 = g.getView(0);
  ok(view0.loadLive === 3 && view0.loadBlank === 3, `初始计数 3 实 3 空（实际 ${view0.loadLive}/${view0.loadBlank}）`);

  useForced(g, 0, 'inverter');

  const v = g.getView(0);
  const t = truth(g);
  ok(g.shells[0].live === true, '逆转器把第 1 发空弹翻成了实弹');
  ok(v.loadLive === t.live && v.loadBlank === t.blank,
    `计数与真实弹序一致（计数 ${v.loadLive}/${v.loadBlank}，真实 ${t.live}/${t.blank}）`);
  ok(v.loadLive + v.loadBlank === t.left - 1,
    `被翻过的那发不进实/空统计：实+空 = 剩余 ${t.left} − 1（实际 ${v.loadLive}+${v.loadBlank}=${v.loadLive + v.loadBlank}）`);
}

/* ---------- 2) 连续翻转 + 啤酒退弹 + 开枪，计数始终对得上 ---------- */
{
  const g = fixedGame([false, false, true, true, false, true]);
  const steps = [
    () => useForced(g, 0, 'inverter'),          // 翻转第 1 发
    () => g.act(0, { type: 'shoot', target: 0 }),   // 打出第 1 发（空弹 → 保回合）
    () => useForced(g, 0, 'inverter'),          // 翻转第 2 发
    () => useForced(g, 0, 'beer'),              // 退掉第 2 发
    () => useForced(g, 0, 'inverter')           // 翻转第 3 发
  ];
  for (let i = 0; i < steps.length; i++) {
    try { steps[i](); } catch (e) { /* 手铐之类不可用时忽略 */ }
    const v = g.getView(0), t = truth(g);
    ok(v.loadLive === t.live && v.loadBlank === t.blank,
      `第 ${i + 1} 步后计数一致（计数 ${v.loadLive}/${v.loadBlank}，真实 ${t.live}/${t.blank}）`);
  }
}

/* ---------- 3) 联机：每个客户端各自重放事件，计数也必须一致 ---------- */
{
  const g = new BR.Game('mp', ['甲', '乙']);
  const dirA = new BR.Director(g.getView(0), 0);
  const dirB = new BR.Director(g.getView(1), 1);
  // 把两个客户端的队列都推到底：每个事件按服务端的时长播放，直到空闲
  const settle = (d) => {
    for (let n = 0; n < 400 && !d.idle(); n++) d.update(d.wait > 0 ? d.wait : 0.1);
    d.update(0.1);
  };
  const fan = (events) => {
    dirA.push(events, g.getView(0));
    dirB.push(BR.filterEvents(events, 1), g.getView(1));
    settle(dirA); settle(dirB);
  };

  fan(g.start());

  let flipped = 0, shots = 0, checked = 0, bad = 0;
  const checkClients = () => {
    const lb = g.liveBlank();
    checked++;
    if (dirA.v.loadLive !== lb.live || dirA.v.loadBlank !== lb.blank) bad++;
    if (dirB.v.loadLive !== lb.live || dirB.v.loadBlank !== lb.blank) bad++;
    if (dirA.v.loadLive < 0 || dirA.v.loadBlank < 0 || dirB.v.loadLive < 0 || dirB.v.loadBlank < 0) bad++;
  };
  for (let i = 0; i < 120 && g.phase === 'turn'; i++) {
    const seat = g.turn;
    // 每隔几枪让当前行动者用一次逆转器，专门压测翻转后的计数
    if (flipped < 3 && shots >= flipped) {
      g.seats[seat].items = ['inverter'];
      fan(g.act(seat, { type: 'item', slot: 0 }));
      flipped++;
      checkClients();
      continue;
    }
    const t = 1 - seat;
    fan(g.act(seat, { type: 'shoot', target: g.seats[t].alive ? t : seat }));
    shots++;
    checkClients();
  }

  ok(dirA.idle() && dirB.idle(), '两个客户端都播完了事件');
  ok(flipped === 3, `压测确实用到了逆转器（${flipped} 次）`);
  ok(bad === 0, `${checked} 个检查点里，两台客户端的计数全都等于服务端数字（异常 ${bad} 次）`);
}

/* ---------- 4) 庄家 AI：已知子弹类型时不该再用放大镜 ---------- */
{
  const view = {
    you: 1, mode: 'story', phase: 'turn', turn: 1, left: 4, sawed: false, dir: 1,
    loadLive: 2, loadBlank: 2, spent: [], known: { 0: true },
    seats: [
      { name: '你', hp: 3, maxHp: 3, items: [], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false },
      { name: 'DEALER', hp: 3, maxHp: 3, items: ['magnifier'], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false }
    ]
  };
  const a = BR.aiDecide(view);
  ok(!(a.type === 'item' && view.seats[1].items[a.slot] === 'magnifier'),
    `已知当前是实弹时不使用放大镜（实际 ${JSON.stringify(a)}）`);

  // 反过来：子弹未知时应该用
  const view2 = Object.assign({}, view, { known: {} });
  const a2 = BR.aiDecide(view2);
  ok(a2.type === 'item' && view2.seats[1].items[a2.slot] === 'magnifier',
    `子弹未知时使用放大镜（实际 ${JSON.stringify(a2)}）`);
}

/* ---------- 5) 庄家 AI：已知当前是空弹且有逆转器，应该用逆转器 ---------- */
{
  const view = {
    you: 1, mode: 'story', phase: 'turn', turn: 1, left: 4, sawed: false, dir: 1,
    loadLive: 2, loadBlank: 2, spent: [], known: { 0: false },
    seats: [
      { name: '你', hp: 3, maxHp: 3, items: [], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false },
      { name: 'DEALER', hp: 3, maxHp: 3, items: ['inverter'], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false }
    ]
  };
  const a = BR.aiDecide(view);
  ok(a.type === 'item' && view.seats[1].items[a.slot] === 'inverter',
    `已知空弹且有逆转器时使用逆转器（实际 ${JSON.stringify(a)}）`);
}

/* ---------- 6) 庄家 AI：只剩最后一发子弹时不用手铐 ---------- */
{
  const view = {
    you: 1, mode: 'story', phase: 'turn', turn: 1, left: 1, sawed: false, dir: 1,
    loadLive: 1, loadBlank: 0, spent: [], known: { 0: true },
    seats: [
      { name: '你', hp: 3, maxHp: 3, items: [], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false },
      { name: 'DEALER', hp: 3, maxHp: 3, items: ['handcuffs'], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false }
    ]
  };
  const a = BR.aiDecide(view);
  ok(!(a.type === 'item' && view.seats[1].items[a.slot] === 'handcuffs'),
    `最后一发子弹时不用手铐（实际 ${JSON.stringify(a)}）`);
}

/* ---------- 7) 庄家 AI：残血有香烟时不该先吃过期药 ---------- */
{
  const view = {
    you: 1, mode: 'don', phase: 'turn', turn: 1, left: 4, sawed: false, dir: 1,
    loadLive: 2, loadBlank: 2, spent: [], known: {},
    seats: [
      { name: '你', hp: 3, maxHp: 3, items: [], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false },
      { name: 'DEALER', hp: 1, maxHp: 6, items: ['medicine', 'cigarette'], alive: true, cuffed: false, cuffLock: false, jammed: false, wiresCut: false }
    ]
  };
  const a = BR.aiDecide(view);
  const key = a.type === 'item' ? view.seats[1].items[a.slot] : null;
  ok(key === 'cigarette', `残血有香烟时先抽香烟（实际 ${JSON.stringify(a)} → ${key}）`);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
