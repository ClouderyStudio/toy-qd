/* 房间管理：2~4 人，房主开局，服务器运行权威引擎并按座位过滤事件
 *
 * 除了「对局权威」，本服务还承担三件跨进程职责，都通过 api.js 打到 ClouderyApi：
 *  1. 身份：Toy SDK 的 toyOpenId 只到本服务为止，换成玩家 id + 令牌（客户端存令牌用于重连）。
 *  2. 房间目录：房间号仍由本服务分配，但会登记到 API 供大厅列表与「按号查房」使用。
 *  3. 快速匹配：等待池在 API（多实例可共享），本服务每个 tick 批量轮询一次。
 *
 * 断线不立刻判负：座位保留一段时间（对局中 60 秒、大厅 20 秒），凭令牌重连回到原座位。
 * API 不可用时自动降级为「纯房间号」模式，不阻塞开房与对局。
 */
const crypto = require('crypto');
const BR = require('../js/items.js');
require('../js/engine-core.js');
require('../js/engine-act.js');
require('../js/engine-flow.js');
require('../js/engine-items.js');
require('../js/ai.js');   // 超时代打用的决策函数（只用视图公开信息，不偷看子弹）
const api = require('./api.js');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const RESERVE_GAME_MS = 60 * 1000;   // 对局中掉线保留座位
const RESERVE_LOBBY_MS = 20 * 1000;  // 大厅里掉线保留座位
const HEARTBEAT_MS = 15 * 1000;      // 房间心跳（API 侧 TTL 120 秒）
const POLL_MS = 1500;                // 快速匹配轮询间隔
const TURN_TIMEOUT_MS = Math.max(10, Number(process.env.TURN_TIMEOUT_SECONDS) || 40) * 1000;
const DEBUG_TOOLS = !!process.env.TOY_DEBUG;   // 调试通道总开关；不开时 debug-* 消息一律忽略
const DEBUG_PASSWORD = process.env.TOY_DEBUG_PASSWORD || '';   // 不设密码 = 调试通道保持禁用

const rooms = new Map();       // code -> room
const seats = new Map();       // playerId -> { room, seat }（重连找回座位）
const waitingHost = new Map(); // code -> [{ ws, player }] 等房主建房的加入者
const queue = new Map();       // playerId -> { ws, player } 正在快速匹配
const locals = new Map();      // token -> player（未接 API 时用本地令牌认人，进程重启即失效）

let localSeq = 0;              // API 不可用时的本地玩家 id（负数，永不与真实 id 冲突）

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function cleanName(raw) {
  let s = String(raw || '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim().slice(0, 6);
  if (!s || /^(DEALER|GOD)$/i.test(s)) s = 'PLAYER';
  return s;
}

function genCode() {
  let c;
  do { c = Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}

// ── 广播 ────────────────────────────────────────────────────────────────

function roomInfo(room) {
  room.players.forEach((p, i) => send(p.ws, {
    type: 'room',
    code: room.code,
    you: i,
    host: 0,
    players: room.players.map((x) => x.name),
    offline: room.players.map((x) => !x.ws),
    started: !!room.game
  }));
}

function broadcastEvents(room, events) {
  room.players.forEach((p, i) => {
    if (!p.ws) return;
    send(p.ws, { type: 'events', events: BR.filterEvents(events, i), view: room.game.getView(i), turnLeft: room.turnLeft || 0 });
  });
}

// ── 回合超时：轮到谁超时不动作，就由系统按 AI 代打一歩，不让全场干等 ──────

function clearTurn(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  room.turnLeft = 0;
}

function scheduleTurn(room) {
  clearTurn(room);
  if (!room.game || room.game.phase !== 'turn') return;
  room.turnLeft = TURN_TIMEOUT_MS;
  room.turnTimer = setTimeout(() => autoPlay(room), TURN_TIMEOUT_MS);
}

function autoPlay(room) {
  room.turnTimer = null;
  room.turnLeft = 0;
  const game = room.game;
  if (!game || game.phase !== 'turn') return;
  const seat = game.turn;
  const name = room.players[seat] ? room.players[seat].name : `P${seat + 1}`;
  let action = null;
  try { action = BR.aiDecide(game.getView(seat)); } catch (e) { action = null; }
  if (!action || action.type === 'item') action = { type: 'shoot', target: seat };   // 代打只开枪，不替人用道具
  if (action.type === 'shoot' && !game.validSeat(action.target)) action = { type: 'shoot', target: seat };
  let events = [];
  try { events = game.act(seat, action); } catch (e) {
    try { events = game.act(seat, { type: 'shoot', target: seat }); } catch (e2) { return; }
  }
  sendToAll(room, { type: 'notice', text: `${name} 超时，系统代为行动` });
  scheduleTurn(room);
  broadcastEvents(room, events);
}

function seatOf(room, ws) {
  return room.players.findIndex((p) => p.ws === ws);
}

function names(room) {
  return room.players.map((p) => p.name);
}

function sendToAll(room, msg) {
  room.players.forEach((p) => send(p.ws, msg));
}

// ── 身份握手 ────────────────────────────────────────────────────────────

/* hello：客户端带昵称（和可能存在的令牌）来换身份。
 * 有令牌且 API 认它 → 复用老玩家；否则用 openId（平台外为空）现场建档。 */
async function hello(ws, msg) {
  if (ws.player) return sendYou(ws);

  const name = cleanName(msg.name);
  const typed = !!(msg.name && String(msg.name).trim());   // 玩家这次手输的名字优先于档案里的旧名
  let player = null;

  if (api.enabled() && msg.token) {
    const r = await api.verify(String(msg.token));
    if (r.ok && r.data) {
      player = {
        id: r.data.playerId,
        token: String(msg.token),
        nickname: typed ? name : (cleanName(r.data.nickname) || name)
      };
    }
  }

  if (!player && api.enabled()) {
    const r = await api.session(msg.openId, name);
    if (r.ok && r.data) {
      player = { id: r.data.playerId, token: r.data.token, nickname: cleanName(r.data.nickname) || name };
    }
  }

  // API 未接入：用本进程签发过的本地令牌认人（能重连，但换进程就失效）。
  if (!player && !api.enabled() && msg.token && locals.has(String(msg.token))) {
    const known = locals.get(String(msg.token));
    player = { id: known.id, token: known.token, nickname: typed ? name : known.nickname };
  }

  // API 不可用（或未配置）时退回本地身份：能玩、能重连，只是没有跨进程战绩与大厅。
  if (!player) {
    player = { id: -(++localSeq), token: 'local.' + crypto.randomUUID(), nickname: name };
    locals.set(player.token, player);
  }

  ws.player = player;
  sendYou(ws);
  resume(ws, player);
}

function sendYou(ws) {
  const p = ws.player;
  send(ws, { type: 'you', playerId: p.id, token: p.token, nickname: p.nickname, online: api.enabled() });
}

/* 带着令牌回来：把保留的座位换成当前连接，并把当前局面补发一遍。 */
function resume(ws, player) {
  const held = seats.get(player.id);
  if (!held) return;

  const { room, seat } = held;
  if (!room.players.includes(seat)) { seats.delete(player.id); return; }

  attach(ws, room, seat);
  const index = room.players.indexOf(seat);
  roomInfo(room);

  if (room.game) send(ws, { type: 'resume', you: index, view: room.game.getView(index), turnLeft: room.turnLeft || 0 });
  else send(ws, { type: 'resumed', code: room.code, you: index });
}

// ── 房间生命周期 ────────────────────────────────────────────────────────

function createRoom(code, player) {
  const room = { code, players: [], game: null, registered: false };
  rooms.set(code, room);
  const seat = { ws: null, playerId: player.id, name: player.nickname, token: player.token, offlineAt: 0, timer: null };
  room.players.push(seat);
  seats.set(player.id, { room, seat });
  return room;
}

function attach(ws, room, seat) {
  if (seat.timer) { clearTimeout(seat.timer); seat.timer = null; }
  seat.ws = ws;
  seat.offlineAt = 0;
  ws.room = room;
  seats.set(seat.playerId, { room, seat });
}

async function create(ws) {
  if (!ws.player) return send(ws, { type: 'error', message: '尚未完成身份握手' });
  if (ws.room) return send(ws, { type: 'error', message: '你已经在房间里了' });

  const room = createRoom(genCode(), ws.player);
  attach(ws, room, room.players[0]);
  roomInfo(room);
  await registerRoom(room);
}

async function registerRoom(room) {
  if (!api.enabled()) return;
  const host = room.players[0];
  const r = await api.registerRoom(room.code, host.playerId, host.name);
  room.registered = !!r.ok;
  if (!r.ok) console.warn(`[room ${room.code}] 登记失败：${r.detail || '未知原因'}`);
}

/* 加入：本地有就直接进；没有就问 API（房间可能刚被快速匹配建出来，房主还没落地）。 */
async function join(ws, code) {
  if (!ws.player) return send(ws, { type: 'error', message: '尚未完成身份握手' });
  const key = String(code || '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(key)) return send(ws, { type: 'error', message: '房间号为 6 位字母数字' });
  if (ws.room) return send(ws, { type: 'error', message: '你已经在房间里了' });

  const room = rooms.get(key);
  if (room) return enterRoom(ws, room);

  const probe = api.enabled() ? await api.getRoom(key) : { ok: false, detail: '房间不存在' };
  if (!probe.ok) return send(ws, { type: 'error', message: probe.detail || '房间不存在' });
  if (probe.data.room.status === 'playing') return send(ws, { type: 'error', message: '游戏已开始' });
  if (probe.data.room.count >= probe.data.room.maxPlayers) return send(ws, { type: 'error', message: '房间已满' });

  // 房主那边还没建好本地房间：挂起，等它建好后一次性放进去。
  const list = waitingHost.get(key) || [];
  list.push({ ws, player: ws.player });
  waitingHost.set(key, list);
  send(ws, {
    type: 'waiting-host',
    code: key,
    players: probe.data.room.players || [],
    max: probe.data.room.maxPlayers
  });
}

function enterRoom(ws, room) {
  if (ws.room) return send(ws, { type: 'error', message: '你已经在房间里了' });
  if (room.game) return send(ws, { type: 'error', message: '游戏已开始' });
  if (room.players.length >= MAX_PLAYERS) return send(ws, { type: 'error', message: '房间已满' });

  // 同一个玩家换了连接回来（比如刷新页面）：直接接管原座位。
  const mine = room.players.find((p) => p.playerId === ws.player.id);
  if (mine) {
    attach(ws, room, mine);
    roomInfo(room);
    if (room.game) send(ws, { type: 'resume', you: room.players.indexOf(mine), view: room.game.getView(room.players.indexOf(mine)), turnLeft: room.turnLeft || 0 });
    return;
  }

  const seat = { ws: null, playerId: ws.player.id, name: ws.player.nickname, token: ws.player.token, offlineAt: 0, timer: null };
  room.players.push(seat);
  attach(ws, room, seat);
  roomInfo(room);
  flushWaitingHost(room);
  syncRoom(room);
}

function flushWaitingHost(room) {
  const list = waitingHost.get(room.code);
  if (!list || !list.length) return;
  waitingHost.delete(room.code);

  list.forEach(({ ws, player }) => {
    if (!ws || ws.readyState !== 1) return;
    if (ws.room) return;
    if (room.game) return send(ws, { type: 'error', message: '游戏已开始' });
    if (room.players.length >= MAX_PLAYERS) return send(ws, { type: 'error', message: '房间已满' });

    const seat = { ws: null, playerId: player.id, name: player.nickname, token: player.token, offlineAt: 0, timer: null };
    room.players.push(seat);
    attach(ws, room, seat);
  });

  roomInfo(room);
  syncRoom(room);
}

function start(ws) {
  const room = ws.room;
  if (!room || room.game) return;
  if (room.players[0].playerId !== ws.player.id) return send(ws, { type: 'error', message: '只有房主可以开始' });
  if (room.players.length < 2) return send(ws, { type: 'error', message: '至少需要 2 名玩家' });

  room.game = new BR.Game('mp', room.players.map((p) => p.name));
  const events = room.game.start();
  scheduleTurn(room);
  room.players.forEach((p, i) => send(p.ws, { type: 'start', you: i, view: room.game.getView(i), turnLeft: room.turnLeft || 0 }));
  broadcastEvents(room, events);
  syncRoom(room, 'playing');
}

function action(ws, a) {
  const room = ws.room;
  if (!room || !room.game) return;
  const seat = seatOf(room, ws);
  if (seat < 0) return;
  let events;
  try { events = room.game.act(seat, a); } catch (e) { return send(ws, { type: 'error', message: e.message }); }
  scheduleTurn(room);
  broadcastEvents(room, events);
}

// ── 开发者通道（TOY_DEBUG=1 且 TOY_DEBUG_PASSWORD 已设才生效）──────────────
// 每条 debug 消息都要带密码，服务端 timing-safe 比对；错密码随机延迟，拖垮爆破。

let debugFailAt = 0;

function debugCheck(ws, password) {
  if (!DEBUG_TOOLS || !DEBUG_PASSWORD) return false;
  const sha = (s) => crypto.createHash('sha256').update(String(s || '')).digest();
  if (crypto.timingSafeEqual(sha(password), sha(DEBUG_PASSWORD))) return true;
  const wait = 300 + Math.floor(Math.random() * 500);
  const left = Math.max(0, wait - (Date.now() - debugFailAt));
  debugFailAt = Date.now() + left;
  setTimeout(() => send(ws, { type: 'error', message: '调试密码不对' }), left + Math.floor(Math.random() * 400));
  return false;
}

function debugAuth(ws, password) {
  if (!DEBUG_TOOLS || !DEBUG_PASSWORD) return send(ws, { type: 'error', message: '服务端未开启调试通道' });
  if (!debugCheck(ws, password)) return;
  send(ws, { type: 'debug-auth', ok: true });
}

function debugEnd(ws, password) {
  if (!debugCheck(ws, password)) return;
  const room = ws.room;
  const game = room && room.game;
  if (!game || game.phase === 'over') return;
  // 随机收尾：在线座位各发一笔随机奖金，钱最多者胜（finish(null) 自己算 winner）
  game.ev = [];
  game.seats.forEach((s) => { if (s.connected) s.money += (1 + Math.floor(Math.random() * 9)) * 10000; });
  if (game.mode === 'mp') game.finish(null);
  else game.finish({ dead: false, cash: 100000 });
  scheduleTurn(room);
  broadcastEvents(room, game.flush());
}

function debugMoney(ws, amount, password) {
  if (!debugCheck(ws, password)) return;
  const room = ws.room;
  if (!room || !room.game) return;
  const seat = seatOf(room, ws);
  if (seat < 0) return;
  const n = Math.max(-1000000000, Math.min(1000000000, Math.round(Number(amount) || 0)));
  room.game.seats[seat].money += n;
  // 纯视图同步（没有引擎事件，直接广播一帧新视图）
  room.players.forEach((p, i) => send(p.ws, { type: 'events', events: [], view: room.game.getView(i), turnLeft: room.turnLeft || 0 }));
}

/* 主动离开（点返回）：大厅直接走人；对局中按退出处理并立刻通知其他人。 */
function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const seat = seatOf(room, ws);
  if (seat < 0) return;
  const player = room.players[seat];
  if (player.timer) { clearTimeout(player.timer); player.timer = null; }
  seats.delete(player.playerId);
  removeSeat(room, seat, true);
}

/* 连接断开：先保留座位，超时才真正判离。 */
function disconnect(ws) {
  if (!ws.player) return;
  dropFromQueue(ws);
  dropFromWaitingHost(ws);

  const room = ws.room;
  if (!room) return;
  const seat = seatOf(room, ws);
  ws.room = null;
  if (seat < 0) return;

  const player = room.players[seat];
  player.ws = null;
  player.offlineAt = Date.now();
  const ttl = room.game ? RESERVE_GAME_MS : RESERVE_LOBBY_MS;
  player.timer = setTimeout(() => expireSeat(room, player), ttl);
  roomInfo(room);
}

function expireSeat(room, player) {
  const seat = room.players.indexOf(player);
  if (seat < 0 || player.ws) return;
  seats.delete(player.playerId);
  const name = player.name;
  removeSeat(room, seat, true);
  if (rooms.has(room.code)) sendToAll(room, { type: 'offline-left', name });
}

function removeSeat(room, seat, notifyGame) {
  const leftHost = seat === 0;
  room.players.splice(seat, 1);

  if (!room.players.length) return teardown(room);

  // 房主走了且还没开局：直接关房（与旧行为一致，避免没人能按开始）。
  if (leftHost && !room.game) {
    sendToAll(room, { type: 'closed', reason: '房主离开了房间' });
    return teardown(room);
  }

  if (notifyGame && room.game) {
    let events = [];
    try { events = room.game.leave(seat) || []; } catch (e) { events = []; }
    scheduleTurn(room);
    if (events.length) broadcastEvents(room, events);
  }

  roomInfo(room);
  syncRoom(room);
}

function teardown(room) {
  clearTurn(room);
  room.players.forEach((p) => {
    if (p.ws) p.ws.room = null;
    seats.delete(p.playerId);
  });
  rooms.delete(room.code);

  const list = waitingHost.get(room.code);
  if (list) {
    waitingHost.delete(room.code);
    list.forEach(({ ws }) => send(ws, { type: 'error', message: '房间不存在' }));
  }

  if (api.enabled()) api.closeRoom(room.code);
}

function syncRoom(room, status) {
  if (!api.enabled()) return;
  api.syncRoom(room.code, names(room), status || (room.game ? 'playing' : 'waiting')).then((r) => {
    if (r.ok) { room.registered = true; return; }
    if (r.status === 404) registerRoom(room);   // 被 API 回收过：补登记，自愈
  });
}

// ── 大厅与快速匹配 ──────────────────────────────────────────────────────

async function lobby(ws) {
  const local = [...rooms.values()]
    .filter((r) => !r.game)
    .map((r) => ({
      code: r.code,
      hostName: r.players[0] ? r.players[0].name : '',
      players: names(r),
      count: r.players.length,
      maxPlayers: MAX_PLAYERS,
      status: 'waiting',
      local: true
    }));

  let remote = [];
  if (api.enabled()) {
    const r = await api.listRooms();
    if (r.ok && r.data) remote = r.data.rooms || [];
  }

  // 本地已知的房间优先（同一进程里看到的更新），远端列表补上其它实例的。
  const seen = new Set(local.map((x) => x.code));
  const merged = local.concat(remote.filter((x) => !seen.has(x.code)));
  merged.sort((a, b) => (a.ageSeconds || 0) - (b.ageSeconds || 0));
  send(ws, { type: 'rooms', rooms: merged, online: api.enabled() });
}

async function match(ws) {
  if (!ws.player) return send(ws, { type: 'error', message: '尚未完成身份握手' });
  if (ws.room) return send(ws, { type: 'error', message: '你已经在房间里了' });

  if (!api.enabled()) {
    return send(ws, { type: 'match', status: 'unavailable', message: '快速匹配需要联机服务，请用房间号开房' });
  }

  const r = await api.match(ws.player.token);
  if (!r.ok) return send(ws, { type: 'match', status: 'error', message: r.detail || '匹配失败' });

  if (r.data.status === 'matched') {
    queue.delete(ws.player.id);
    return onMatched({ ws, player: ws.player }, r.data);
  }

  queue.set(ws.player.id, { ws, player: ws.player });
  send(ws, { type: 'match', status: 'queued', position: r.data.queuePosition || 1 });
  startPolling();
}

async function cancelMatch(ws) {
  if (!ws.player) return;
  queue.delete(ws.player.id);
  if (api.enabled()) api.cancelMatch(ws.player.token);
  send(ws, { type: 'match', status: 'cancelled' });
}

function dropFromQueue(ws) {
  if (!ws.player) return;
  if (!queue.delete(ws.player.id)) return;
  if (api.enabled()) api.cancelMatch(ws.player.token);
}

function dropFromWaitingHost(ws) {
  waitingHost.forEach((list, code) => {
    const next = list.filter((x) => x.ws !== ws);
    if (next.length) waitingHost.set(code, next);
    else waitingHost.delete(code);
  });
}

/* 配对成功：房主在本进程建房间，另一位挂起等房主落地。 */
function onMatched(entry, state) {
  const { ws, player } = entry;
  const code = state.code;
  if (!ws || ws.readyState !== 1) return;   // 人已经走了：房间交给 API 的 TTL 回收

  // 配对已经落地，把等待池里这一行清掉（否则要等 90 秒 TTL 才回收）
  if (api.enabled()) api.cancelMatch(player.token);

  if (state.isCreator) {
    send(ws, { type: 'match', status: 'matched', code, host: true });
    if (rooms.has(code)) {
      const existing = rooms.get(code);
      if (!existing.game) enterRoom(ws, existing);
      return;
    }
    const room = createRoom(code, player);
    attach(ws, room, room.players[0]);
    roomInfo(room);
    flushWaitingHost(room);
    syncRoom(room);
    return;
  }

  send(ws, { type: 'match', status: 'matched', code, host: false });
  const room = rooms.get(code);
  if (room && !room.game && room.players.length < MAX_PLAYERS) return enterRoom(ws, room);

  const list = waitingHost.get(code) || [];
  list.push({ ws, player });
  waitingHost.set(code, list);
  send(ws, {
    type: 'waiting-host',
    code,
    players: (state.players || []).map((p) => p.nickname),
    max: MAX_PLAYERS
  });
}

let pollTimer = null;
function startPolling() {
  if (pollTimer || !api.enabled()) return;
  pollTimer = setInterval(async () => {
    if (!queue.size) { clearInterval(pollTimer); pollTimer = null; return; }

    const r = await api.pollMatch([...queue.keys()]);
    if (!r.ok) return;   // 下一 tick 再试，不把玩家踢出队列

    (r.data.statuses || []).forEach((item) => {
      const entry = queue.get(item.playerId);
      if (!entry) return;
      if (item.state.status === 'matched') {
        queue.delete(item.playerId);
        onMatched(entry, item.state);
      } else if (item.state.status === 'none') {
        queue.delete(item.playerId);
        send(entry.ws, { type: 'match', status: 'timeout' });
      }
    });
  }, POLL_MS);
}

// ── 心跳：刷新 API 侧房间的 LastSeenAt ───────────────────────────────────

const heartbeat = setInterval(() => {
  if (!api.enabled()) return;
  rooms.forEach((room) => syncRoom(room));
}, HEARTBEAT_MS);
heartbeat.unref();

// ── 入口 ────────────────────────────────────────────────────────────────

function handle(ws, msg) {
  switch (msg.type) {
    case 'hello': return hello(ws, msg);
    case 'create': return create(ws);
    case 'join': return join(ws, msg.code);
    case 'start': return start(ws);
    case 'action': return action(ws, msg.action);
    case 'debug-auth': return debugAuth(ws, msg.password);
    case 'debug-end': return debugEnd(ws, msg.password);
    case 'debug-money': return debugMoney(ws, msg.amount, msg.password);
    case 'leave': return leave(ws);
    case 'lobby': return lobby(ws);
    case 'match': return match(ws);
    case 'cancel-match': return cancelMatch(ws);
    default: return send(ws, { type: 'error', message: '未知消息' });
  }
}

module.exports = { handle, leave, disconnect, rooms, cleanName, seats };
