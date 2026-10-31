/* 对局场景绘制与点击热区 */
(function () {
  const BR = window.BR;
  const g = BR.gfx, D = BR.draw, S = BR.scenes.table;
  const GUN = { x: 160, y: 136 };

  // 多人局对手的座位位置（不含自己）
  function foePos(n, k) {
    if (n === 1) return { x: 160, y: 56 };
    const xs = n === 2 ? [100, 220] : [70, 160, 250];
    return { x: xs[k], y: 64 };
  }

  S.draw = function (t) {
    const { dir, me, ui } = S.state();
    const v = dir.v, foes = S.foes(), two = v.seats.length === 2;
    BR.bg('table');
    D.lamp(t, v.wires);

    foes.forEach((f, k) => {
      const p = foePos(foes.length, k), s = v.seats[f];
      const st = { hit: dir.hit[f] > 0 ? 1 : 0, a: s.alive ? 1 : 0.25, dead: !s.alive };
      if (two && v.mode !== 'mp') { D.dealer(p.x, p.y - 10, t, st); D.dealerHands(p.x, 104, t, st.a); }
      else D.player(p.x, p.y, t, f, st);
      if (s.cuffed) g.text('[铐]', p.x, p.y - 30, { align: 'center', size: 5, col: '#c0c0c8' });
      if (s.jammed) g.text('[干扰]', p.x, p.y - 30, { align: 'center', size: 5, col: '#e06060' });
      if (dir.aim === f && dir.gun === 'far') g.alpha(0.5, () => g.ellipse(p.x, p.y, 20, 22, '#400000'));
      if (!two || v.mode === 'mp') g.text(s.name, p.x, p.y + 30, { align: 'center', size: 5, col: v.turn === f ? '#ffe080' : '#a0a090' });
      if (ui.mode === 'pickFoe' && s.alive) BR.hot({ x: p.x - 20, y: p.y - 24, w: 40, h: 54 }, () => S.pickFoe(f));
    });

    D.tableProps();

    // 对手道具
    if (two) {
      const f = foes[0];
      const hv = ui.mode === 'steal' ? hoverSlot('far') : -1;
      D.slots('far', v.seats[f].items, hv, false);
      if (ui.mode === 'steal') for (let i = 0; i < 8; i++) BR.hot(D.slotRect('far', i), () => S.steal(i));
    } else {
      foes.forEach((f, k) => {
        const p = foePos(foes.length, k);
        v.seats[f].items.forEach((it, j) => {
          const r = { x: p.x - 32 + (j % 4) * 16, y: 110 + Math.floor(j / 4) * 14, w: 14, h: 13 };
          g.rect(r.x, r.y, r.w, r.h, '#1a1d17');
          BR.drawSprite(it, r.x + 1, r.y + 1);
          if (ui.mode === 'steal' && ui.foe === f) BR.hot(r, () => S.steal(j));
          if (BR.hover(r)) S.tip = it;
        });
      });
    }

    D.lcd(v, t);

    // 霰弹枪
    if (dir.reveal) D.shells(dir.reveal, 160, 132);
    else if (dir.gun === 'self') D.shotgun('self', v.sawed, 160, 120);
    else if (dir.gun === 'far') D.shotgun('far', v.sawed, foePos(foes.length, Math.max(0, foes.indexOf(dir.aim))).x, 120);
    else {
      D.shotgun('table', v.sawed, GUN.x, GUN.y);
      if (S.canAct() && ui.mode === 'idle') {
        const over = BR.hot({ x: GUN.x - 46, y: GUN.y - 6, w: 110, h: 16 }, () => { ui.mode = 'aim'; });
        if (over) g.text('拿起霰弹枪', GUN.x, GUN.y - 16, { align: 'center', size: 6, col: '#ffe080' });
      }
    }
    if (v.known[0] !== undefined && !dir.reveal) {
      g.text(v.known[0] ? '当前：实弹' : '当前：空弹', 268, 140, { size: 5, col: v.known[0] ? '#e05050' : '#80a0c0' });
    }

    // 自己的道具
    const mine = v.seats[me].items, hv = hoverSlot('near');
    D.slots('near', mine, ui.sel >= 0 ? ui.sel : hv, !S.canAct());
    S.tip = hv >= 0 ? mine[hv] : (ui.sel >= 0 ? mine[ui.sel] : S.tip);
    for (let i = 0; i < 8; i++) BR.hot(D.slotRect('near', i), () => S.useSlot(i));

    S.drawUI(t, v, ui, foes);
    S.tip = null;
  };

  function hoverSlot(side) {
    for (let i = 0; i < 8; i++) if (BR.hover(D.slotRect(side, i))) return i;
    return -1;
  }
})();
