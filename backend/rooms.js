/* 房间管理：2~4 人，房主开局，服务器运行权威引擎并按座位过滤事件 */
const BR = require('../js/items.js');
require('../js/engine-core.js');
require('../js/engine-act.js');
require('../js/engine-flow.js');
require('../js/engine-items.js');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const rooms = new Map();

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

function roomInfo(room) {
  room.players.forEach((p, i) => send(p.ws, {
    type: 'room', code: room.code, you: i, host: 0, players: room.players.map((x) => x.name)
  }));
}

function broadcastEvents(room, events) {
  room.players.forEach((p, i) => {
    if (!p.ws) return;
    send(p.ws, { type: 'events', events: BR.filterEvents(events, i), view: room.game.getView(i) });
  });
}

function create(ws, name) {
  if (ws.room) return send(ws, { type: 'error', message: '你已经在房间里了' });
  const room = { code: genCode(), players: [{ ws, name: cleanName(name) }], game: null };
  rooms.set(room.code, room);
  ws.room = room;
  roomInfo(room);
}

function join(ws, code, name) {
  if (ws.room) return send(ws, { type: 'error', message: '你已经在房间里了' });
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return send(ws, { type: 'error', message: '房间不存在' });
  if (room.game) return send(ws, { type: 'error', message: '游戏已开始' });
  if (room.players.length >= MAX_PLAYERS) return send(ws, { type: 'error', message: '房间已满' });
  room.players.push({ ws, name: cleanName(name) });
  ws.room = room;
  roomInfo(room);
}

function start(ws) {
  const room = ws.room;
  if (!room || room.game) return;
  if (room.players[0].ws !== ws) return send(ws, { type: 'error', message: '只有房主可以开始' });
  if (room.players.length < 2) return send(ws, { type: 'error', message: '至少需要 2 名玩家' });
  room.game = new BR.Game('mp', room.players.map((p) => p.name));
  const events = room.game.start();
  room.players.forEach((p, i) => send(p.ws, { type: 'start', you: i, view: room.game.getView(i) }));
  broadcastEvents(room, events);
}

function action(ws, a) {
  const room = ws.room;
  if (!room || !room.game) return;
  const seat = room.players.findIndex((p) => p.ws === ws);
  let events;
  try { events = room.game.act(seat, a); } catch (e) { return send(ws, { type: 'error', message: e.message }); }
  broadcastEvents(room, events);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const seat = room.players.findIndex((p) => p.ws === ws);
  if (seat < 0) return;
  if (!room.game) {
    room.players.splice(seat, 1);
    if (!room.players.length || seat === 0) {
      room.players.forEach((p) => { p.ws.room = null; send(p.ws, { type: 'closed', reason: '房主离开了房间' }); });
      rooms.delete(room.code);
    } else roomInfo(room);
    return;
  }
  room.players[seat].ws = null;
  const events = room.game.leave(seat);
  if (events.length) broadcastEvents(room, events);
  if (room.players.every((p) => !p.ws)) rooms.delete(room.code);
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'create': return create(ws, msg.name);
    case 'join': return join(ws, msg.code, msg.name);
    case 'start': return start(ws);
    case 'action': return action(ws, msg.action);
    case 'leave': return leave(ws);
    default: return send(ws, { type: 'error', message: '未知消息' });
  }
}

module.exports = { handle, leave, rooms, cleanName };
