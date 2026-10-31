/* 联机客户端：连接 server.js，回调交给大厅与对局场景 */
(function () {
  const BR = window.BR;
  let ws = null;

  function url() {
    if (BR.config.wsUrl) return BR.config.wsUrl;
    if (location.protocol === 'file:') return 'ws://localhost:8080';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }

  const net = BR.net = {
    onRoom: null, onStart: null, onEvents: null, onError: null, onClosed: null,
    connected: () => ws && ws.readyState === 1,

    connect() {
      return new Promise((resolve, reject) => {
        if (net.connected()) return resolve();
        try { ws = new WebSocket(url()); } catch (e) { return reject(e); }
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('无法连接联机服务器'));
        ws.onclose = () => { ws = null; net.onClosed && net.onClosed('与服务器的连接已断开'); };
        ws.onmessage = (m) => {
          let msg;
          try { msg = JSON.parse(m.data); } catch (e) { return; }
          if (msg.type === 'room') net.onRoom && net.onRoom(msg);
          else if (msg.type === 'start') net.onStart && net.onStart(msg);
          else if (msg.type === 'events') net.onEvents && net.onEvents(msg.events, msg.view);
          else if (msg.type === 'error') net.onError && net.onError(msg.message);
          else if (msg.type === 'closed') net.onClosed && net.onClosed(msg.reason);
        };
      });
    },

    send(msg) { if (net.connected()) ws.send(JSON.stringify(msg)); },

    close() {
      if (!ws) return;
      net.send({ type: 'leave' });
      const w = ws; ws = null;
      w.onclose = null;
      w.close();
    }
  };
})();
