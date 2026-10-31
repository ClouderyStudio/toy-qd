/* 对局场景 UI：字幕、道具说明、瞄准按钮、偷取/选目标提示、Double or Nothing 选择 */
(function () {
  const BR = window.BR;
  const g = BR.gfx, S = BR.scenes.table;

  S.drawUI = function (t, v, ui, foes) {
    const { dir, me } = S.state();

    // 字幕
    if (dir.subT > 0 && dir.sub) {
      const lines = g.wrap(dir.sub, 220, 7);
      lines.forEach((l, i) => g.text(l, 160, 84 + i * 9 - lines.length * 4, { align: 'center', size: 7, col: '#f0ecd8', a: Math.min(1, dir.subT * 2) }));
    }

    // 道具说明
    const tip = S.tip && BR.ITEMS[S.tip];
    if (tip) {
      g.rect(64, 2, 192, 22, 'rgba(0,0,0,0.75)');
      g.text(`${tip.name}  ${tip.en}`, 160, 4, { align: 'center', size: 6, col: '#ffe080' });
      g.text(tip.desc, 160, 13, { align: 'center', size: 5, col: '#d8d4c0' });
      if (BR.touch && ui.sel >= 0 && S.canAct()) BR.button('使用', 140, 26, 40, 11, () => S.useSlot(ui.sel, true), { size: 6 });
    }

    if (!S.canAct() && ui.mode !== 'idle' && dir.v.phase !== 'donChoice') S.cancel();

    if (ui.mode === 'aim') {
      const btn = (label, x, target) => BR.button(label, x, 144, 70, 13, () => S.send({ type: 'shoot', target }), { size: 6 });
      const alive = foes.filter((f) => v.seats[f].alive);
      if (alive.length === 1) btn(v.mode === 'mp' ? `射 ${v.seats[alive[0]].name}` : '射向庄家', 84, alive[0]);
      else alive.forEach((f, k) => btn(`射 ${v.seats[f].name}`, 20 + k * 74, f));
      btn('射向自己', alive.length === 1 ? 166 : 20 + alive.length * 74, me);
      BR.button('放下', 290, 144, 28, 13, S.cancel, { size: 5 });
    }
    if (ui.mode === 'steal') {
      g.text('选择要偷取的道具', 160, 96, { align: 'center', size: 6, col: '#ffe080' });
      BR.button('取消', 290, 144, 28, 13, S.cancel, { size: 5 });
    }
    if (ui.mode === 'pickFoe') {
      g.text('选择一名玩家', 160, 96, { align: 'center', size: 6, col: '#ffe080' });
      BR.button('取消', 290, 144, 28, 13, S.cancel, { size: 5 });
    }

    // 回合提示（联机时带服务端下发的剩余秒数，最后 10 秒变红）
    const tl = S.turnLeft > 0 ? Math.ceil(S.turnLeft / 1000) : 0;
    const tlTxt = tl ? ` · ${tl}s` : '';
    const tlCol = tl && tl <= 10 ? '#ff7050' : null;
    if (S.canAct() && ui.mode === 'idle' && dir.subT <= 0) {
      g.text(`你的回合${tlTxt}`, 300, 100, { align: 'right', size: 5, col: tlCol || '#80f080' });
    }
    if (v.phase === 'turn' && dir.idle() && v.turn !== me && v.seats[me].alive) {
      const dots = '.'.repeat(1 + Math.floor(t * 2) % 3);
      g.text(`等待${dots}${tlTxt}`, 300, 100, { align: 'right', size: 5, col: tlCol || '#a0a090' });
    }
    if (!v.seats[me].alive && v.phase === 'turn' && v.mode === 'mp') {
      g.text('你倒下了。观战中……', 160, 30, { align: 'center', size: 6, col: '#c05050' });
    }

    // Double or Nothing：三关全胜后的选择
    if (v.phase === 'donChoice' && dir.idle()) {
      g.rect(70, 40, 180, 70, 'rgba(0,0,0,0.85)');
      g.text('DOUBLE OR NOTHING', 160, 46, { align: 'center', size: 8, col: '#e04040' });
      g.text(`当前奖金：$${dir.pot.toLocaleString()}`, 160, 60, { align: 'center', size: 7, col: '#ffe080' });
      g.text('继续则奖金翻倍，输掉则一无所有。', 160, 72, { align: 'center', size: 5 });
      BR.button('带钱离开', 84, 88, 70, 14, () => S.don(false), { size: 6 });
      BR.button('翻倍继续', 166, 88, 70, 14, () => S.don(true), { size: 6, hi: '#801010' });
    }

    // 角落信息
    const sawed = v.sawed ? ' · 已锯短' : '';
    g.text(`STAGE ${v.stage}${v.round > 1 ? ' · R' + v.round : ''}${sawed}`, 316, 2, { align: 'right', size: 5, col: '#706c60' });

    // 开发者入口：主菜单版权文字连点 5 次后本会话内生效
    try { if (sessionStorage.getItem('br_dev') === '1') BR.button('DEV', 294, 158, 24, 12, () => BR.overlay.devGame(), { size: 5, bg: '#202018', hi: '#404030' }); } catch (e) { /* 隐私模式 */ }
  };
})();
