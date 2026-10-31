/* 桌面绘制：霰弹枪、子弹排、道具格、除颤器 LCD 计分机 */
(function () {
  const BR = window.BR;
  const g = BR.gfx;
  const D = BR.draw || (BR.draw = {});
  const SLOT = 14;

  // side: 'near' 玩家这边（下方）| 'far' 对面（上方）
  D.slotRect = function (side, i) {
    const left = i < 4, k = i % 4;
    const x = left ? 64 + k * (SLOT + 1) : 196 + k * (SLOT + 1);
    return { x, y: side === 'near' ? 158 : 112, w: SLOT, h: SLOT };
  };

  D.slots = function (side, items, hover, dim) {
    for (let i = 0; i < 8; i++) {
      const r = D.slotRect(side, i);
      g.rect(r.x, r.y, r.w, r.h, '#1a1d17');
      g.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, hover === i ? '#4a5440' : '#2a2f25');
      if (items[i]) BR.drawSprite(items[i], r.x + 1, r.y + 1, dim ? 0.4 : 1);
    }
  };

  // mode: 'table' 横放 | 'far' 指向对面 | 'self' 枪口对着镜头
  D.shotgun = function (mode, sawed, x, y) {
    if (mode === 'self') {
      g.ellipse(x, y, 30, 26, '#1e1a16');
      g.ellipse(x - 11, y, 10, 10, '#3a3a3a');
      g.ellipse(x + 11, y, 10, 10, '#3a3a3a');
      g.ellipse(x - 11, y, 7, 7, '#000');
      g.ellipse(x + 11, y, 7, 7, '#000');
      return;
    }
    const len = sawed ? 40 : 62;
    if (mode === 'far') {
      g.rect(x - 8, y + 10, 16, 26, '#5a3a20');
      g.rect(x - 4, y - len / 2, 8, len / 2 + 12, '#2c2c2e');
      g.rect(x - 3, y - len / 2, 2, 2, '#000'); g.rect(x + 1, y - len / 2, 2, 2, '#000');
      return;
    }
    g.rect(x - 44, y - 2, 30, 7, '#5a3a20');      // 枪托
    g.rect(x - 44, y + 4, 10, 4, '#4a2e18');
    g.rect(x - 16, y - 2, 14, 6, '#3a3a3c');       // 机匣
    g.rect(x - 2, y - 2, len, 3, '#2c2c2e');       // 双管
    g.rect(x - 2, y + 1, len, 2, '#232325');
    g.rect(x + 4, y + 3, 22, 3, '#4a2e18');        // 护木
    if (sawed) g.rect(x + len - 3, y - 2, 1, 5, '#8a8a8a');
  };

  // shells: true 实弹（红）/ false 空弹（蓝灰）
  D.shells = function (shells, cx, y) {
    const w = 7, total = shells.length * w;
    shells.forEach((live, i) => {
      const x = cx - total / 2 + i * w;
      g.rect(x, y, 5, 12, live ? '#b02020' : '#4a5a70');
      g.rect(x, y + 8, 5, 4, '#c8a040');
      g.rect(x + 1, y + 1, 1, 6, live ? '#e05050' : '#7a8aa0');
    });
  };

  // 除颤器计分机：每位玩家一行名字与闪电电量
  D.lcd = function (v, t) {
    const n = v.seats.length;
    g.rect(2, 108, 56, 18 + n * 14, '#2a2d26');
    g.rect(4, 110, 52, 14 + n * 14, '#0c1a0c');
    for (let s = 1; s <= 3; s++) g.rect(6 + (s - 1) * 6, 112, 4, 3, v.stage >= s ? '#60e060' : '#1a3a1a');
    v.seats.forEach((s, i) => {
      const y = 118 + i * 14;
      const name = v.mode === 'mp' || i === 0 ? s.name : 'DEALER';
      g.text(name.slice(0, 6), 6, y, { size: 5, col: s.alive ? '#80f080' : '#2a5a2a' });
      const dark = v.wires ? 2 : 0;
      for (let k = 0; k < s.maxHp; k++) {
        const bx = 6 + k * 8, by = y + 6;
        const lit = k < s.hp;
        const isDark = k < dark;
        if (s.wiresCut && lit && Math.sin(t * 12) < 0) continue;
        g.rect(bx, by, 7, 6, isDark ? '#061006' : '#0a140a');
        if (lit) BR.drawSprite('bolt', bx, by, isDark ? 0.6 : 1);
      }
      if (s.wiresCut) g.line(48, y + 6, 54, y + 11, '#c03030');
    });
  };

  D.tableProps = function () {
    g.rect(0, 106, 320, 2, '#0a0a08');
    g.rect(0, 176, 320, 4, '#0e100c');
  };
})();
