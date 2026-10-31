/* 恶魔轮盘 · 联机后端：HTTP 静态文件 + WebSocket（同一端口） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const rooms = require('./rooms.js');
const store = require('./store.js');

const PORT = process.env.PORT || 8080;
// 生产只监听回环：公网入口统一走 OpenResty（它反代到 127.0.0.1:<PORT>）。
// 绑 0.0.0.0 会让 IP:PORT 直接对外，绕过 CDN 与来源校验，纯属多余暴露面。
const BIND = process.env.BIND || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const MAX_MSG = 2048;        // 单条消息最大字节
const RATE = 20;             // 每秒最多消息数
const PING_MS = 30000;       // 保活间隔：反代 / CDN 一般 60~100 秒掐空闲连接

// 前端静态站和后端不同域时（例如前端在 Toy、后端在自己服务器），浏览器是跨域连 WS。
// 设置 ALLOWED_ORIGINS 后只放行名单内的页面；不设则不限（本地调试 / 同源部署）。
// 无 Origin 的连接（Node 脚本、服务端调用）一律放行 —— Origin 本来就可以被非浏览器伪造。
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// HTTP 接口（/report /api/stats）从静态站跨域调用：按名单回 CORS 头。
// 与 WS 同一策略：无 Origin（脚本 / 服务端调用）也放行。
function cors(req, res) {
  const origin = req.headers.origin || '';
  if (!ALLOWED.length || !origin || ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

function readBody(req, limit, cb) {
  let buf = '';
  req.on('data', (c) => { buf += c; if (buf.length > limit) req.destroy(); });
  req.on('end', () => cb(buf));
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);

  // 单机结算自报：无法验证，只作 reference（权威数据是服务端算的 mp 结果）
  if (p === '/report' && req.method === 'POST') {
    if (!cors(req, res)) { res.writeHead(403); return res.end(); }
    return readBody(req, 1024, (body) => {
      let d = {};
      try { d = JSON.parse(body || '{}'); } catch (e) { /* 空对象 */ }
      store.recordClaimed(d.name, d.playerId, d.mode, d.cash);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  }

  // 服务器战绩聚合榜（排行榜面板「服务器战绩」页签）
  if (p === '/api/stats' && req.method === 'GET') {
    if (!cors(req, res)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ players: store.topPlayers(50) }));
  }

  if (req.method === 'OPTIONS' && (p === '/report' || p === '/api/stats')) {
    if (!cors(req, res)) { res.writeHead(403); return res.end(); }
    res.writeHead(204);
    return res.end();
  }

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

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MSG,
  verifyClient: (info, done) => {
    if (!ALLOWED.length) return done(true);
    const origin = info.origin || info.req.headers.origin || '';
    if (!origin || ALLOWED.includes(origin)) return done(true);
    done(false, 403, 'Origin not allowed');
  }
});

wss.on('connection', (ws) => {
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
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
  // 断开不等于离开：rooms.disconnect 先把座位保留一段时间，等带令牌的重连回来接管。
  ws.on('close', () => rooms.disconnect(ws));
});

// 大厅里挂机时可能几十秒没有一条消息，Nginx / Cloudflare / EdgeOne 会按空闲把连接掐掉。
// 服务器主动 ping：既保活，也能把半开连接（手机切网、进程被冻）清出去。
const keepalive = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, PING_MS);
keepalive.unref();

server.listen(PORT, BIND, () => {
  console.log(`[Server] 恶魔轮盘已启动 http://${BIND}:${PORT}  (WebSocket 同端口)`);
  console.log(`[Server] 联机 API：${process.env.TOY_API_BASE ? process.env.TOY_API_BASE : '未配置（降级为房间号模式）'}`);
  console.log(`[Server] 允许的页面来源：${ALLOWED.length ? ALLOWED.join(', ') : '不限'}`);
});
