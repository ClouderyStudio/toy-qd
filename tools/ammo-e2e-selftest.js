#!/usr/bin/env node
/* 端到端：真实引擎 + 真实 Director + 真实绘制层，验「玩家眼睛看到的数字」
 *
 * 只把 canvas 抽象掉，其余全是 dist/ 里要发出去的那份代码，
 * 所以这个脚本通过 = 玩家看到的面板数字是对的。
 *
 * 跑法：node tools/ammo-e2e-selftest.js [js 目录，默认 dist/js]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const JS = path.resolve(__dirname, '..', process.argv[2] || 'dist/js');
const BR = (global.BR = {});
global.window = global;

// 最小 canvas / SDK 垫片
BR.sfx = new Proxy({}, { get: () => () => {} });
BR.fx = { shake: 0, flash: 0, red: 0, black: 0 };
global.document = { createElement: () => ({ getContext: () => ({}) }) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.sessionStorage = { getItem: () => null, setItem: () => {} };

for (const f of ['config', 'items', 'engine-core', 'engine-act', 'engine-flow', 'engine-items',
  'gfx', 'draw-table', 'director']) {
  require(path.join(JS, f + '.js'));
}

let failed = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };

// 把 gfx 的文字收集下来，就是玩家在面板上看到的字
let rec = [];
BR.gfx.rect = () => {};
BR.gfx.text = (s) => rec.push(String(s));
const panel = (v) => {
  rec = [];
  BR.draw.ammo(v);
  // 结构：剩余 | N | 实 | n | 空 | m
  return { left: +rec[1], live: +rec[3], blank: +rec[5], raw: rec.join('|') };
};

/* 场景：故意让逆转器把膛口翻成实弹，然后连打，直到重新装弹。
 * 每个中间状态都核对一次面板数字。跑多局，避免某一副牌恰好蒙混过关。 */
{
  let checks = 0, bad = 0, flips = 0, rounds = 0;
  for (let game = 0; game < 30; game++) {
    const g = new BR.Game('story', ['你', 'DEALER']);
    const dir = new BR.Director(g.getView(0), 0);
    const settle = (d) => {
      for (let n = 0; n < 400 && !d.idle(); n++) d.update(d.wait > 0 ? d.wait : 0.1);
      d.update(0.1);
    };
    const fan = (ev) => { dir.push(ev, g.getView(0)); settle(dir); };
    const panelOf = () => {
      rec = [];
      BR.draw.ammo(dir.v);
      return { left: +rec[1], live: +rec[3], blank: +rec[5] };
    };

    fan(g.start());
    rounds++;

    for (let i = 0; i < 300 && g.phase === 'turn'; i++) {
      // 每次轮到玩家且还没翻过：用一个逆转器压测翻转后的口径
      if (g.turn === 0 && flips % 2 === 0 && g.idx === 0) {
        g.seats[0].items = ['inverter'];
        fan(g.act(0, { type: 'item', slot: 0 }));
        flips++;
        const p = panelOf(), lb = g.liveBlank();
        checks++;
        if (p.live !== lb.live || p.blank !== lb.blank || p.live < 0 || p.blank < 0) bad++;
        continue;
      }
      const seat = g.turn, t = 1 - seat;
      let ev;
      try { ev = g.act(seat, { type: 'shoot', target: g.seats[t].alive ? t : seat }); }
      catch (e) { break; }
      fan(ev);
      const p = panelOf(), lb = g.liveBlank();
      checks++;
      if (p.live !== lb.live || p.blank !== lb.blank || p.left !== g.shells.length - g.idx
        || p.live < 0 || p.blank < 0 || p.left < 0) bad++;
    }
  }

  ok(flips > 0, `${rounds} 局里用到了逆转器（${flips} 次）`);
  ok(checks > 50, `采集到 ${checks} 个面板快照`);
  ok(bad === 0, `全部快照的面板数字都对得上（异常 ${bad} 次）`);

  // 再补一条不变式：没被翻转时 剩余 = 实 + 空
  const g2 = new BR.Game('story', ['你', 'DEALER']);
  g2.start();
  const dir2 = new BR.Director(g2.getView(0), 0);
  dir2.push(g2.flush(), g2.getView(0));
  for (let n = 0; n < 400 && !dir2.idle(); n++) dir2.update(dir2.wait > 0 ? dir2.wait : 0.1);
  dir2.update(0.1);
  const p2 = panel(dir2.v);
  ok(p2.left === p2.live + p2.blank, `装弹面板自洽：剩余 ${p2.left} = 实 ${p2.live} + 空 ${p2.blank}`);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
