/* 恶魔轮盘 · 联机后端：HTTP 静态文件 + WebSocket（同一端口） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const rooms = require('./rooms.js');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const MAX_MSG = 2048;        // 单条消息最大字节
const RATE = 20;             // 每秒最多消息数

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const allowed = rel === 'index.html' || /^(css|js)\/[\w.-]+\.(css|js)$/.test(rel);
  if (!allowed || !file.startsWith(ROOT)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });

wss.on('connection', (ws) => {
  ws.room = null;
  let count = 0, since = Date.now();
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - since > 1000) { since = now; count = 0; }
    if (++count > RATE) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    rooms.handle(ws, msg);
  });
  ws.on('close', () => rooms.leave(ws));
});

server.listen(PORT, () => {
  console.log(`[Server] 恶魔轮盘已启动 http://localhost:${PORT}  (WebSocket 同端口)`);
});
