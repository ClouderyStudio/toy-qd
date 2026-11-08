#!/usr/bin/env node
/* 维护公告端到端：写 notice.json → 新连接收到 → 分配 blocker → 清掉恢复。
 * 跑法（先起服务）：
 *   TOY_DATA_DIR=/tmp/xx node backend/server.js
 *   TOY_DATA_DIR=/tmp/xx node backend/tools/notice-selftest.js ws://127.0.0.1:8086
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const WS = process.argv[2] || 'ws://127.0.0.1:8086';
const DIR = process.env.TOY_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'notice.json');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  → ' + (extra === undefined ? '' : extra)}`);
  cond ? pass++ : fail++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (ws) => new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
const send = (ws, m) => ws.send(JSON.stringify(m));

function wait(ws, type, ms) {
  const types = Array.isArray(type) ? type : [type];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('等不到 ' + types.join('/'))); }, ms || 8000);
    const h = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (types.indexOf(m.type) < 0) return;
      clearTimeout(t); ws.off('message', h); resolve(m);
    };
    ws.on('message', h);
  });
}

/* 收集一段时间内某类消息 */
function collect(ws, type, ms) {
  const got = [];
  const h = (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === type) got.push(m);
  };
  ws.on('message', h);
  return sleep(ms).then(() => { ws.off('message', h); return got; });
}

function writeNotice(obj) {
  fs.mkdirSync(DIR, { recursive: true });
  if (obj === null) { try { fs.unlinkSync(FILE); } catch (e) { /* 已不存在 */ } return; }
  fs.writeFileSync(FILE, JSON.stringify(obj));
}

(async () => {
  // 先确保干净
  writeNotice(null);
  await sleep(200);

  const a = new WebSocket(WS);
  await open(a);
  send(a, { type: 'hello', name: '测试甲' });
  await wait(a, 'you');
  // 握手后会带一份公告；没有公告时 notice 应为 null
  const first = await wait(a, 'notice-info', 4000).catch(() => null);
  ok(!!first, '握手后收到 notice-info');
  ok(first && first.notice === null, '无公告时 notice 为 null', first && JSON.stringify(first.notice));

  // 1) 写一条 info 公告，等待广播（服务端 5 秒轮询）
  console.log('\n写入 info 公告……');
  writeNotice({ text: '今晚 23:00 停机维护', level: 'info' });
  const got1 = await collect(a, 'notice-info', 7000);
  const n1 = got1.length ? got1[got1.length - 1].notice : null;
  ok(!!n1, '在线连接收到公告广播', got1.length + ' 条');
  ok(n1 && n1.text === '今晚 23:00 停机维护', '文本正确', n1 && n1.text);
  ok(n1 && n1.level === 'info', '级别正确', n1 && n1.level);
  ok(n1 && n1.block === false, 'info 不阻止开新局', n1 && n1.block);

  // 2) 改成 down：应当广播并且 block=true
  console.log('\n改为 down 公告……');
  writeNotice({ text: '维护进行中，预计 30 分钟', level: 'down' });
  const got2 = await collect(a, 'notice-info', 7000);
  const n2 = got2.length ? got2[got2.length - 1].notice : null;
  ok(n2 && n2.level === 'down', '收到 down 公告', n2 && n2.level);
  ok(n2 && n2.block === true, 'down 默认阻止开新局', n2 && n2.block);

  // 3) 维护中开新局应被服务端拒绝
  console.log('\n维护中尝试开局……');
  const b = new WebSocket(WS);
  await open(b);
  send(b, { type: 'hello', name: '测试乙' });
  await wait(b, 'you');
  send(a, { type: 'create' });
  const room = await wait(a, 'room');
  send(b, { type: 'join', code: room.code });
  await wait(b, 'room');
  await sleep(300);
  send(a, { type: 'start' });
  const rejected = await wait(a, ['error', 'start'], 5000).catch(() => null);
  ok(rejected && rejected.type === 'error', '维护中开局被拒绝', rejected && rejected.type);
  ok(rejected && /维护/.test(rejected.message || ''), '错误信息提到维护', rejected && rejected.message);

  // 4) 显式 block:false 时即使 warn 也允许开局
  console.log('\n改为 warn + block:false……');
  writeNotice({ text: '即将维护，请打完当前这局', level: 'warn', block: false });
  await sleep(6000);
  send(a, { type: 'start' });
  const started = await wait(a, ['start', 'error'], 6000).catch(() => null);
  ok(started && started.type === 'start', 'warn 且不 block 时可以开局', started && started.type);

  // 5) 清掉公告
  console.log('\n清除公告……');
  writeNotice(null);
  const got3 = await collect(a, 'notice-info', 7000);
  const n3 = got3.length ? got3[got3.length - 1].notice : undefined;
  ok(got3.length > 0 && n3 === null, '清除后广播 null', JSON.stringify(n3));

  // 6) 坏文件不应让服务崩，也不该显示垃圾内容
  console.log('\n写入损坏的 notice.json……');
  fs.writeFileSync(FILE, '{ 这不是合法 JSON ');
  const c = new WebSocket(WS);
  await open(c);
  send(c, { type: 'hello', name: '测试丙' });
  await wait(c, 'you');
  const bad = await wait(c, 'notice-info', 4000).catch(() => null);
  ok(!!bad, '损坏文件时连接仍然可用');
  ok(bad && bad.notice === null, '损坏文件被当作无公告', bad && JSON.stringify(bad.notice));

  writeNotice(null);
  [a, b, c].forEach((w) => { try { w.close(); } catch (e) { /* 忽略 */ } });
  console.log(`\n${fail ? '有失败项' : '全部通过'}（${pass} 过 / ${fail} 败）`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
