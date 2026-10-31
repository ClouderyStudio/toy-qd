/* 对局场景：本地（对庄家 AI）或联机（服务器权威），输入状态机 */
(function () {
  const BR = window.BR;
  const S = BR.scenes.table = {};
  let game, dir, me, net, ui, aiT, leaving, pending;

  S.enter = function (o) {
    net = !!o.net; ui = { mode: 'idle', sel: -1, foe: -1 }; aiT = 0; leaving = false; pending = false;
    if (net) {
      me = o.you; game = null;
      dir = new BR.Director(o.view, me);
      BR.net.onEvents = (ev, view) => { pending = false; dir.push(ev, view); };
      BR.net.onError = (msg) => { pending = false; dir.say(msg, 2); };
      BR.net.onClosed = (why) => { dir.say(why || '连接已断开', 3); setTimeout(() => BR.go('menu'), 2500); };
      // 断线重连回到座位：服务端补发最新视图，直接用它重建播放器（比回放事件更稳，也不会重复播放动画）
      BR.net.onResume = (view, you) => {
        if (!view) return;
        me = you; pending = false;
        dir = new BR.Director(view, me);
        dir.say('已重新连上，回到座位', 1.8);
      };
      BR.net.onStatus = (s, n) => {
        if (s === 'reconnecting') dir.say(`连接中断，正在重连（${n}）…`, 2.5);
      };
      BR.net.onNotice = (t) => dir.say(t, 2);
    } else {
      me = 0;
      game = new BR.Game(o.mode, [o.name, 'DEALER']);
      game.doors = o.doors || 0;
      const ev = game.start();
      dir = new BR.Director(game.getView(0), 0);
      dir.push(ev, game.getView(0));
    }
    S.mode = o.mode || 'mp';
    BR.sfx.drone(true);
  };
  S.exit = function () {
    BR.sfx.drone(false);
    if (net) {
      BR.net.onEvents = BR.net.onError = BR.net.onClosed = null;
      BR.net.onResume = BR.net.onStatus = BR.net.onNotice = null;
    }
  };

  S.send = function (a) {
    ui = { mode: 'idle', sel: -1, foe: -1 };
    if (net) { pending = true; BR.net.send({ type: 'action', action: a }); return; }
    try { dir.push(game.act(0, a), game.getView(0)); } catch (e) { dir.say(e.message, 1.6); }
  };

  S.canAct = () => dir.idle() && !pending && dir.v.phase === 'turn' && dir.v.turn === me && dir.v.seats[me].alive;
  S.foes = () => dir.v.seats.map((s, i) => i).filter((i) => i !== me);

  S.update = function (dt) {
    dir.update(dt);
    if (!dir.idle()) return;
    // 本地庄家回合
    if (!net && game.phase === 'turn' && game.turn !== 0) {
      aiT += dt;
      if (aiT < 0.9) return;
      aiT = 0;
      const a = BR.aiDecide(game.getView(game.turn));
      let ev;
      try { ev = game.act(game.turn, a); } catch (e) { ev = game.act(game.turn, { type: 'shoot', target: 0 }); }
      dir.push(ev, game.getView(0));
      return;
    }
    if (dir.result && !leaving) {
      leaving = true;
      const v = dir.v, r = dir.result;
      setTimeout(() => {
        if (v.mode === 'mp') BR.go('mpResult', { result: r, view: v, me });
        else if (r.dead) BR.go('heaven', { view: v });
        else BR.go('car', { result: r, view: v, mode: S.mode });
      }, 1500);
    }
  };

  // 点击道具格
  // 触屏第一次点击只选中并显示说明，再点一次或按"使用"才生效
  S.useSlot = function (i, confirm) {
    const key = dir.v.seats[me].items[i];
    if (!key || !S.canAct()) return;
    if (BR.touch && !confirm && ui.sel !== i) { ui.sel = i; return; }
    const two = dir.v.seats.length === 2;
    if (key === 'adrenaline') {
      if (two) ui = { mode: 'steal', slot: i, foe: 1 - me };
      else ui = { mode: 'pickFoe', slot: i, then: 'steal' };
      return;
    }
    if (key === 'jammer' || (key === 'handcuffs' && !two)) { ui = { mode: 'pickFoe', slot: i, then: 'use' }; return; }
    S.send({ type: 'item', slot: i });
  };

  S.pickFoe = function (f) {
    if (ui.then === 'steal') ui = { mode: 'steal', slot: ui.slot, foe: f };
    else S.send({ type: 'item', slot: ui.slot, target: f });
  };

  S.steal = function (j) {
    const it = dir.v.seats[ui.foe].items[j];
    if (!it) return;
    if (it === 'adrenaline') { dir.say('不能偷肾上腺素。', 1.4); return; }
    S.send({ type: 'item', slot: ui.slot, target: ui.foe, steal: j, subTarget: ui.foe });
  };

  S.don = function (go) {
    if (!net) dir.push(game.act(0, { type: 'don', go }), game.getView(0));
  };

  S.state = () => ({ dir, me, ui, net });
  S.cancel = () => { ui = { mode: 'idle', sel: -1, foe: -1 }; };
  S.key = (k) => { if (k === 'Escape') S.cancel(); };
})();
