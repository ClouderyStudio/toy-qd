#!/usr/bin/env node
/* 面板不变式：loadLive + loadBlank + 被逆转器翻过的发数 = 剩余发数
 * 跑法：node tools/ammo-invariant-selftest.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const BR = (global.BR = {});
global.window = global;
for (const f of fs.readdirSync(path.join(__dirname, '..', 'js'))) {
  if (/^(items|engine-core|engine-act|engine-flow|engine-items)\.js$/.test(f)) {
    require(path.join(__dirname, '..', 'js', f));
  }
}
let failed = 0, bad = 0, checks = 0, flips = 0;
const fail = (m) => { console.log('  ✗ ' + m); failed++; };

for (let n = 0; n < 200; n++) {
  const g = new BR.Game('story', ['你', 'DEALER']);
  g.start();
  for (let i = 0; i < 300 && g.phase === 'turn'; i++) {
    const seat = g.turn;
    // 轮流：有时用逆转器，有时开枪
    if (i % 3 === 0 && g.idx < g.shells.length) {
      g.seats[seat].items = ['inverter'];
      g.act(seat, { type: 'item', slot: 0 });
      flips++;
    } else {
      g.act(seat, { type: 'shoot', target: 1 - seat });
    }
    const v = g.getView(0);
    const left = v.left;
    // 本次装弹里被翻过的（no != loadNo）且还没打出的发数
    const flippedLeft = g.shells.slice(g.idx).filter((s) => s.no !== g.loadNo).length;
    checks++;
    if (v.loadLive < 0 || v.loadBlank < 0) { bad++; }
    if (v.loadLive + v.loadBlank + flippedLeft !== left) {
      bad++;
      if (bad <= 3) fail(`不变式破了：实${v.loadLive}+空${v.loadBlank}+翻${flippedLeft} != 剩余${left}`);
    }
  }
}
if (!bad) console.log(`  ✓ ${checks} 个检查点全部满足「实 + 空 + 已翻转 = 剩余」（逆转器用了 ${flips} 次）`);
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
