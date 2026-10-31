/* 联机客户端：连接 server.js，回调交给大厅与对局场景
 *
 * 身份：连上后先 hello（昵称 + Toy 的 toyOpenId + 上次的令牌），服务端回 you（玩家 id + 令牌）。
 * 令牌存在 localStorage，断线重连时带上去，服务端据此把保留的座位还回来。
 * 重连是自动的：连丢后按 0.5/1/2/4/8 秒退避重试 5 次，期间大厅与对局都会收到 onStatus。
 */
(function () {
  const BR = window.BR;
  const IDENT_KEY = 'br_ident';
  const BACKOFF = [0, 500, 1000, 2000, 4000];

  let ws = null;
  let ident = null;          // { playerId, token, nickname }
  let closing = false;       // 主动关闭：不再自动重连
  let attempt = 0;
  let pendingHello = null;   // connect() 的 resolve/reject
  let reconnectTimer = null;
  let lastHello = { name: '', openId: null };

  function loadIdent() {
    try { ident = JSON.parse(localStorage.getItem(IDENT_KEY) || 'null'); } catch (e) { ident = null; }
    return ident;
  }

  function saveIdent(v) {
    ident = v;
    try { localStorage.setItem(IDENT_KEY, JSON.stringify(v)); } catch (e) { /* 隐私模式：仅内存 */ }
  }

  // 本机 / 局域网调试：允许同源推导（后端和网页在同一台机器上）
  function isLocalHost() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === ''
      || /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
      || /\.local$/.test(h);
  }

  function url() {
    if (BR.config.wsUrl) return BR.config.wsUrl;
    if (location.protocol === 'file:') return 'ws://localhost:8080';
    // 静态托管里后端不在同源：必须显式配置，否则会连到静态站域名上白等。
    if (!isLocalHost()) throw new Error('联机服务器未配置：请在 js/config.js 填入 wss:// 地址');
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }

  function dispatch(msg) {
    switch (msg.type) {
      case 'you':
        saveIdent({ playerId: msg.playerId, token: msg.token, nickname: msg.nickname });
        attempt = 0;
        if (pendingHello) { const p = pendingHello; pendingHello = null; p.resolve(msg); }
        BR.net.onStatus && BR.net.onStatus('online');
        break;
      case 'room': BR.net.onRoom && BR.net.onRoom(msg); break;
      case 'rooms': BR.net.onRooms && BR.net.onRooms(msg.rooms || [], msg.online); break;
      case 'start': BR.net.onStart && BR.net.onStart(msg); break;
      case 'events': BR.net.onEvents && BR.net.onEvents(msg.events, msg.view, msg.turnLeft || 0); break;
      case 'resume': BR.net.onResume && BR.net.onResume(msg.view, msg.you, msg.turnLeft || 0); break;
      case 'resumed': BR.net.onResume && BR.net.onResume(null, msg.you); break;
      case 'match': BR.net.onMatch && BR.net.onMatch(msg); break;
      case 'waiting-host': BR.net.onWaitingHost && BR.net.onWaitingHost(msg); break;
      case 'closed': BR.net.onClosed && BR.net.onClosed(msg.reason); break;
      case 'offline-left': BR.net.onNotice && BR.net.onNotice(`${msg.name} 掉线超时，已离开`); break;
      case 'notice': BR.net.onNotice && BR.net.onNotice(msg.text); break;
      case 'error': BR.net.onError && BR.net.onError(msg.message); break;
      default: break;
    }
  }

  function open(name, openId) {
    return new Promise((resolve, reject) => {
      closing = false;
      try { ws = new WebSocket(url()); } catch (e) { return reject(e); }
      pendingHello = { resolve, reject };

      ws.onopen = () => {
        // hello 里带上令牌：服务端能认出老玩家并把保留座位还回来
        ws.send(JSON.stringify({ type: 'hello', name: name || '', openId: openId || null, token: ident ? ident.token : null }));
      };

      ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(m.data); } catch (e) { return; }
        dispatch(msg);
      };

      ws.onerror = () => {
        if (pendingHello) { const p = pendingHello; pendingHello = null; p.reject(new Error('无法连接联机服务器')); }
      };

      ws.onclose = () => {
        ws = null;
        if (pendingHello) { const p = pendingHello; pendingHello = null; p.reject(new Error('无法连接联机服务器')); return; }
        if (closing) { BR.net.onClosed && BR.net.onClosed('已断开联机'); return; }

        // 非主动断开：座位在服务端保留，自动重连带令牌回去
        if (attempt < BACKOFF.length) {
          BR.net.onStatus && BR.net.onStatus('reconnecting', attempt + 1);
          reconnectTimer = setTimeout(() => {
            attempt++;
            open(lastHello.name, lastHello.openId).catch(() => { /* onclose 会继续排下一次 */ });
          }, BACKOFF[attempt]);
        } else {
          BR.net.onClosed && BR.net.onClosed('与服务器的连接已断开');
        }
      };
    });
  }

  const net = BR.net = {
    onRoom: null, onStart: null, onEvents: null, onError: null, onClosed: null,
    onRooms: null, onMatch: null, onWaitingHost: null, onResume: null, onStatus: null, onNotice: null,

    connected: () => !!ws && ws.readyState === 1,
    identity: () => ident || loadIdent(),

    /** 当前页面是否配好了联机服务（没配就不该把「多人联机」摆给玩家看）。 */
    configured() {
      if (BR.config.wsUrl) return true;
      return location.protocol === 'file:' || isLocalHost();
    },

    /** 建立连接并完成身份握手；已连上则直接复用。 */
    connect(name, openId) {
      lastHello = { name: name || '', openId: openId || null };
      if (net.connected() && ident) return Promise.resolve(ident);
      if (ws && !ident) return new Promise(() => {});   // 握手进行中，靠 onStatus 通知
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      attempt = 0;
      return open(lastHello.name, lastHello.openId);
    },

    send(msg) { if (net.connected()) ws.send(JSON.stringify(msg)); },

    lobby() { net.send({ type: 'lobby' }); },
    create() { net.send({ type: 'create' }); },
    join(code) { net.send({ type: 'join', code }); },
    start() { net.send({ type: 'start' }); },
    action(a) { net.send({ type: 'action', action: a }); },
    match() { net.send({ type: 'match' }); },
    cancelMatch() { net.send({ type: 'cancel-match' }); },

    /** 离开房间但保持连接（回大厅继续看列表）。 */
    leave() { net.send({ type: 'leave' }); },

    /** 彻底断开：不再自动重连。 */
    close() {
      closing = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (!ws) return;
      net.send({ type: 'leave' });
      const w = ws;
      ws = null;
      w.onclose = null;
      w.close();
    },

    /** 清空回调（离开对局场景时调用），避免旧场景继续收消息。 */
    reset() {
      net.onRoom = net.onStart = net.onEvents = net.onError = net.onClosed = null;
      net.onRooms = net.onMatch = net.onWaitingHost = net.onResume = net.onStatus = net.onNotice = null;
    }
  };

  loadIdent();
})();
