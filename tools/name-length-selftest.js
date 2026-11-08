#!/usr/bin/env node
/* 昵称长度回归：服务器战绩榜上的名字不能被截短。
 * 跑法：node tools/name-length-selftest.js
 *
 * 背景：之前 rooms.js 的 cleanName 把昵称截成 6 个字，导致玩家在
 * 「服务器战绩」榜上看到的名字全是缺一半的。这里锁住这个行为。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  → ' + (extra === undefined ? '' : extra)}`);
  cond ? pass++ : fail++;
}

// 直接从源码里取出 cleanName 与 clipName 做纯函数验证，避免启动整个服务端
const roomsSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'rooms.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'store.js'), 'utf8');

function extract(src, name, decl) {
  const re = new RegExp(decl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?\\n}');
  const m = src.match(re);
  if (!m) throw new Error('找不到函数 ' + name);
  return m[0];
}

const maxM = roomsSrc.match(/const NAME_MAX = (\d+);/);
ok(!!maxM, 'rooms.js 定义了 NAME_MAX');

const NAME_MAX = maxM ? +maxM[1] : 6;
ok(NAME_MAX >= 16, '昵称上限不小于 16 个字符（足够正常昵称）', `NAME_MAX=${NAME_MAX}`);

const cleanName = eval('(' + extract(roomsSrc, 'cleanName', 'function cleanName(raw)').replace(/^function cleanName\(raw\)/, 'function (raw)') + ')');

// 1) 正常长度昵称原样保留
ok(cleanName('假鹰君') === '假鹰君', '3 字昵称原样保留');
ok(cleanName('天师傅海豹面') === '天师傅海豹面', '6 字昵称完整保留');
ok(cleanName('这是一个十二个字的玩家') === '这是一个十二个字的玩家', '长昵称不再被截成 6 个字', cleanName('这是一个十二个字的玩家'));

// 2) 超长昵称裁到上限
const long = '啊'.repeat(40);
ok(Array.from(cleanName(long)).length === NAME_MAX, `超长昵称裁到 ${NAME_MAX} 字`, Array.from(cleanName(long)).length);

// 3) emoji 不被切坏（按字符而非 UTF-16 码元）
const emoji = '玩家🎮名字';
const r = cleanName(emoji);
ok(r === emoji, 'emoji 昵称完整保留', r);
const many = '🎮'.repeat(30);
const cut = cleanName(many);
ok(!/[\uD800-\uDBFF]$/.test(cut), '超长 emoji 昵称不会切出半个代理对', JSON.stringify(cut.slice(-2)));

// 4) 非法输入仍被处理
ok(cleanName('') === 'PLAYER', '空昵称回落为 PLAYER');
ok(cleanName('DEALER') === 'PLAYER', 'DEALER 被拒绝');
ok(cleanName('GOD') === 'PLAYER', 'GOD 被拒绝');
ok(!/[<>&"'`]/.test(cleanName('<b>坏&amp;人</b>')), '标签字符被清洗', cleanName('<b>坏&amp;人</b>'));

// 5) store.js 的名字截断同样是按字符
ok(/const NAME_STORE_MAX = \d+;/.test(storeSrc), 'store.js 定义了 NAME_STORE_MAX');
ok(/function clipName\(raw\)[\s\S]*?Array\.from/.test(storeSrc), 'store.js 的 clipName 按字符截断');
ok(/name: clipName\(p\.name\)/.test(storeSrc), 'recordResult 用 clipName 处理玩家名');
ok(/const nm = clipName\(name\);/.test(storeSrc), 'recordClaimed 用 clipName 处理玩家名');

// 6) 客户端输入框不再限制成 6 个字
const overlaysSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'overlays.js'), 'utf8');
ok(!/maxlength="6"\s+value="\$\{esc\(def\)\}"/.test(overlaysSrc), '免责书输入框不再限制 6 字');
ok(!/maxlength="6"\s+placeholder="你的名字"/.test(overlaysSrc), '联机昵称输入框不再限制 6 字');
ok(/maxlength="16"/.test(overlaysSrc), '输入框上限改为 16 字');

// 7) 画布上仍然会截断（显示空间有限），但按字符截
const drawSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'draw-table.js'), 'utf8');
ok(/Array\.from\(name\)\.slice\(0, 6\)/.test(drawSrc), 'LCD 名字按字符截到 6 个显示');

console.log(`\n${fail ? '有失败项' : '全部通过'}（${pass} 过 / ${fail} 败）`);
process.exit(fail ? 1 : 0);
