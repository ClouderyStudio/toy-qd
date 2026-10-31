/* 人物绘制：庄家（面具脸、大嘴利齿、枯手）、多人局对手、吊灯 */
(function () {
  const BR = window.BR;
  const g = BR.gfx;
  const D = BR.draw || (BR.draw = {});

  D.lamp = function (t, flicker) {
    g.rect(159, 0, 2, 8, '#111');
    g.ellipse(160, 10, 12, 3, '#2a2a24');
    g.rect(148, 10, 25, 2, '#1a1a16');
    const on = !flicker || Math.sin(t * 37) > -0.92;
    if (on) g.ellipse(160, 13, 4, 1, '#f0e8b0');
  };

  // st: { a: 透明度, hit: 受击闪白 0~1, lean: 前倾 0~1, gone: 是否离场 }
  D.dealer = function (cx, cy, t, st) {
    st = st || {};
    if (st.gone) return;
    const breath = Math.round(Math.sin(t * 1.6) * 1);
    const y = cy + breath + Math.round((st.lean || 0) * 6);
    g.alpha(st.a === undefined ? 1 : st.a, () => {
      // 身体
      for (let i = 0; i < 36; i++) {
        const w = 18 + i * 0.9;
        g.rect(cx - w, y + 18 + i, w * 2, 1, i < 3 ? '#0a0a0a' : '#141412');
      }
      g.rect(cx - 4, y + 18, 8, 10, '#0a0a0a');
      // 脖子与头
      g.rect(cx - 5, y + 12, 10, 8, '#8c8878');
      const face = st.hit > 0.5 ? '#ffffff' : '#c8c4b0';
      g.ellipse(cx, y, 15, 17, '#9a9682');
      g.ellipse(cx, y - 1, 14, 16, face);
      // 眼窝
      g.ellipse(cx - 6, y - 5, 4, 3, '#0c0c0a');
      g.ellipse(cx + 6, y - 5, 4, 3, '#0c0c0a');
      const look = Math.round(Math.sin(t * 0.7) * 1);
      g.px(cx - 6 + look, y - 5, '#e8e0c0');
      g.px(cx + 6 + look, y - 5, '#e8e0c0');
      // 鼻孔
      g.px(cx - 1, y + 1, '#3a3830'); g.px(cx + 1, y + 1, '#3a3830');
      // 大嘴与牙
      const open = 3 + Math.round((Math.sin(t * 0.9) + 1) * 0.8) + (st.lean ? 2 : 0);
      g.rect(cx - 10, y + 5, 21, open + 2, '#1a0606');
      for (let i = 0; i < 10; i++) {
        g.rect(cx - 10 + i * 2 + 1, y + 5, 1, 2, '#e8e2c8');
        g.rect(cx - 10 + i * 2 + 1, y + 5 + open, 1, 2, '#d8d0b0');
      }
      g.rect(cx - 11, y + 4, 23, 1, '#7a7464');
    });
  };

  D.dealerHands = function (cx, y, t, a) {
    g.alpha(a === undefined ? 1 : a, () => {
      [-1, 1].forEach((s) => {
        const hx = cx + s * 38;
        g.rect(hx - 6, y - 2, 12, 4, '#b8b4a0');
        for (let f = 0; f < 4; f++) g.rect(hx - 6 + f * 3, y + 2, 2, 4 + (f % 2), '#a8a490');
      });
    });
  };

  // 多人局对手：剪影 + 苍白的脸 + 衣服颜色区分
  const SHIRT = ['#5a2a2a', '#2a3a5a', '#2a5a3a', '#5a4a2a'];
  D.player = function (cx, cy, t, seat, st) {
    st = st || {};
    const y = cy + Math.round(Math.sin(t * 1.4 + seat) * 1);
    g.alpha(st.a === undefined ? 1 : st.a, () => {
      for (let i = 0; i < 28; i++) g.rect(cx - 12 - i * 0.6, y + 12 + i, 24 + i * 1.2, 1, SHIRT[seat % 4]);
      g.ellipse(cx, y, 9, 11, st.hit > 0.5 ? '#ffffff' : '#a89a88');
      g.rect(cx - 9, y - 11, 18, 5, '#1a1410');
      g.rect(cx - 5, y - 2, 3, 2, '#101010');
      g.rect(cx + 2, y - 2, 3, 2, '#101010');
      g.rect(cx - 3, y + 5, 6, 1, '#4a2a2a');
      if (st.dead) { g.line(cx - 6, y - 4, cx - 2, y, '#600'); g.line(cx + 2, y - 4, cx + 6, y, '#600'); }
    });
  };
})();
