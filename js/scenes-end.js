/* 结局：天堂（死亡）、车内结算（胜利）、多人局排名 */
(function () {
  const BR = window.BR;
  const g = BR.gfx;

  function statLines(v, cash) {
    const s = v.seats[0].st;
    return [
      ['回合', v.round], ['开枪次数', s.shots], ['退出子弹', s.ejected], ['踹门次数', v.doors],
      ['香烟', s.cigs], ['啤酒（ml）', s.beer * 495], ['现金', '$' + cash.toLocaleString()]
    ];
  }

  BR.scenes.heaven = {
    enter(o) { this.v = o.view; this.t0 = BR.t; BR.fx.flash = 2; },
    draw(t) {
      BR.bg('heaven');
      const k = t - this.t0;
      g.alpha(Math.min(1, k / 3), () => g.text('YOU ARE DEAD', 160, 70, { align: 'center', size: 16, col: '#202020' }));
      if (k > 3) g.text('你没能活着离开。', 160, 96, { align: 'center', size: 7, col: '#404040' });
      if (k > 4) BR.button('回到菜单', 125, 130, 70, 14, () => BR.go('menu'), { bg: '#c8c8d0', hi: '#ffffff' });
    }
  };

  BR.scenes.car = {
    enter(o) {
      this.t0 = BR.t; this.v = o.view; this.cash = o.result.cash; this.mode = o.mode;
      const T = BR.toy, cash = this.cash;
      if (this.mode === 'story') {
        T.set('donUnlocked', '1');
        if (cash > +T.save.bestStory) T.set('bestStory', cash);
        T.submit(1, cash);
      } else {
        if (cash > +T.save.bestDon) T.set('bestDon', cash);
        T.submit(2, cash);
      }
    },
    draw(t) {
      BR.bg('car');
      const k = t - this.t0;
      // 方向盘与仪表台
      g.rect(0, 128, 320, 52, '#08080a');
      g.ellipse(90, 150, 30, 22, '#151518'); g.ellipse(90, 150, 24, 17, '#08080a');
      g.rect(200, 136, 70, 20, '#101014');
      // 钱箱
      g.rect(170, 110, 46, 22, '#3a2a18'); g.rect(172, 112, 42, 18, '#4a3620');
      g.text('$', 193, 115, { align: 'center', size: 8, col: '#80c060' });
      g.text(this.mode === 'don' ? '你带着钱离开了。' : '你活了下来。', 160, 20, { align: 'center', size: 8, col: '#d8d4c0' });
      statLines(this.v, this.cash).forEach(([a, b], i) => {
        if (k < 0.5 + i * 0.4) return;
        g.text(a, 110, 36 + i * 10, { size: 6, col: '#a0a0b0' });
        g.text(String(b), 210, 36 + i * 10, { align: 'right', size: 6, col: i === 6 ? '#80e080' : '#e0e0e8' });
      });
      if (this.mode === 'story' && k > 3.5) g.text('浴室的洗手台上，多了一瓶药丸……', 160, 112, { align: 'center', size: 5, col: '#c06060' });
      if (k > 3.5) BR.button('回到菜单', 240, 162, 70, 13, () => BR.go('menu'), { size: 6 });
    }
  };

  BR.scenes.mpResult = {
    enter(o) {
      this.r = o.result; this.v = o.view; this.me = o.me;
      BR.net.close();
      if (this.r.winner === this.me) {
        const w = +BR.toy.save.mpWins + 1;
        BR.toy.set('mpWins', w);
        BR.toy.submit(3, w);
      }
    },
    draw(t) {
      BR.bg('table');
      g.alpha(0.75, () => g.rect(0, 0, g.W, g.H, '#000'));
      const win = this.r.winner === this.me;
      g.text(win ? '你赢了。' : '游戏结束', 160, 22, { align: 'center', size: 12, col: win ? '#e0c040' : '#c04040' });
      const order = this.v.seats.map((s, i) => i).sort((a, b) => this.r.money[b] - this.r.money[a]);
      order.forEach((i, k) => {
        const s = this.v.seats[i];
        const col = i === this.me ? '#ffe080' : '#d8d4c0';
        g.text(`${k + 1}. ${s.name}${s.connected ? '' : '（离开）'}`, 100, 56 + k * 14, { size: 7, col });
        g.text('$' + this.r.money[i].toLocaleString(), 220, 56 + k * 14, { align: 'right', size: 7, col });
      });
      BR.button('回到菜单', 125, 140, 70, 14, () => BR.go('menu'));
    }
  };
})();
