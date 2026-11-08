#!/usr/bin/env node
/* 打包纯静态资源 dist/（Windows 版构建，等价于 tools/build-static.sh）
 * 用 node 全程按 UTF-8 读写，避免 PowerShell 在管道上改编码把中文注释弄成乱码。
 * 跑法（在仓库根目录）：
 *   node tools/build-static.js
 *   $env:BR_WS_URL='wss://...' ; $env:BR_FOLLOW_MID='526436598' ; node tools/build-static.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'css'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'js'), { recursive: true });

fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
for (const f of fs.readdirSync(path.join(ROOT, 'css'))) {
  if (f.endsWith('.css')) fs.copyFileSync(path.join(ROOT, 'css', f), path.join(OUT, 'css', f));
}
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(OUT, 'js', f));
}

const CFG = path.join(OUT, 'js', 'config.js');
let src = fs.readFileSync(CFG, 'utf8');

const ws = (process.env.BR_WS_URL || '').trim();
if (ws) {
  if (!/^wss:\/\//.test(ws)) {
    console.error('❌ BR_WS_URL 必须以 wss:// 开头：Toy 页面是 HTTPS，ws:// 会被按混合内容拦掉');
    process.exit(1);
  }
  if (!/wsUrl:\s*''/.test(src)) {
    console.error("config.js 里没找到空的 wsUrl: '' —— 是不是已经被改过了？");
    process.exit(1);
  }
  src = src.replace(/wsUrl:\s*''/, "wsUrl: '" + ws + "'");
  console.log('联机地址已注入：' + ws);
} else if (/wsUrl:\s*''/.test(src)) {
  console.log('⚠️  wsUrl 仍是空值：本地同源可用，传到 Toy 后会隐藏「多人联机」入口。');
}

const mid = (process.env.BR_FOLLOW_MID || '').trim();
if (mid) {
  if (!/^\d+$/.test(mid)) {
    console.error('❌ BR_FOLLOW_MID 必须是纯数字 UID');
    process.exit(1);
  }
  if (!/followMid:\s*''/.test(src)) {
    console.error("config.js 里没找到空的 followMid: '' —— 是不是已经被改过了？");
    process.exit(1);
  }
  src = src.replace(/followMid:\s*''/, "followMid: '" + mid + "'");
  console.log('关注解锁 UID 已注入：' + mid);
} else if (/followMid:\s*''/.test(src)) {
  console.log('⚠️  followMid 仍是空值：「去关注」按钮会不可用，只剩文字提示。');
}

fs.writeFileSync(CFG, src);   // 显式 UTF-8，无 BOM

// 打包后自检：确认编码没坏、注入值在位
const check = fs.readFileSync(CFG, 'utf8');
if (check.charCodeAt(0) === 0xfeff) { console.error('❌ config.js 带 BOM'); process.exit(1); }
if (/[\uFFFD]/.test(check)) { console.error('❌ config.js 出现替换字符，编码已损坏'); process.exit(1); }
if (ws && !check.includes("wsUrl: '" + ws + "'")) { console.error('❌ wsUrl 注入失败'); process.exit(1); }
if (mid && !check.includes("followMid: '" + mid + "'")) { console.error('❌ followMid 注入失败'); process.exit(1); }

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else files.push(p);
  }
})(OUT);
const total = files.reduce((n, p) => n + fs.statSync(p).size, 0);
console.log(`已生成 dist/（${files.length} 个文件，${(total / 1024).toFixed(1)} KB）`);
console.log('发布：toy update 50149917199360 dist --icon assets/icon.png --poster assets/icon.png --yes');
