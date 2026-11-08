/* 开场流程：主菜单 → 浴室（药丸 / 踹门）→ 夜店走廊 → 签免责书 → 对局 */
(function () {
  const BR = window.BR;
  const g = BR.gfx;
  BR.scenes = BR.scenes || {};
  let run = null;   // 本次进入的模式与踹门数

  BR.scenes.menu = {
    draw(t) {
      BR.bg('table');
      g.alpha(0.6, () => g.rect(0, 0, g.W, g.H, '#000'));
      BR.draw.lamp(t, true);
      BR.draw.dealer(160, 52, t, { a: 0.35 });
      g.text('BUCKSHOT ROULETTE', 160, 26, { align: 'center', size: 14, col: '#c02020' });
      g.text('恶 魔 轮 盘', 160, 46, { align: 'center', size: 9, col: '#d8d4c0' });
      const b = (label, y, fn) => BR.button(label, 120, y, 80, 14, fn, { size: 7 });
      // 左上角贴边：制作人署名（等距 11px）；左下角贴边：版本号
      g.text('制作人', 6, 6, { size: 5, col: '#c04040' });
      g.text('云术工作室', 6, 17, { size: 6, col: '#d8d4c0' });
      g.text('云竹', 6, 29, { size: 5, col: '#a8a490' });
      g.text('胖头鱼不吃鱼', 6, 40, { size: 5, col: '#a8a490' });
      g.text(String((BR.config || {}).version || ''), 6, 169, { size: 5, col: '#6a6860' });
      // 局外也看得到钱：右上角展示个人最佳战绩（故事 / DoN / 多人胜场）。
      // 这几个数来自云存档，跨设备同步；没有记录时显示 "—"。
      const best = (k) => (BR.toy && BR.toy.save ? Number(BR.toy.save[k] || 0) : 0);
      // 不用 toLocaleString：部分 WebView 里不带 locale 数据时会抛错，
      // 手写千分位更稳，且不依赖运行环境。
      const fmt = (n) => {
        const s = String(Math.round(Math.abs(n) || 0));
        let out = '';
        for (let i = 0; i < s.length; i++) {
          if (i > 0 && (s.length - i) % 3 === 0) out += ',';
          out += s[i];
        }
        return (n < 0 ? '-' : '') + out;
      };
      // 放左下角：右上角留给「子弹计数」入口，标题区留空，互不遮挡。
      const panel = { x: 6, y: 100, w: 108, h: 44 };
      g.rect(panel.x, panel.y, panel.w, panel.h, 'rgba(0,0,0,0.55)');
      g.text('最佳战绩', panel.x + 5, panel.y + 3, { size: 5, col: '#c04040' });
      const row = (label, val, y, col) => {
        g.text(label, panel.x + 5, y, { size: 5, col: '#7a7666' });
        g.text(val ? fmt(val) : '—', panel.x + panel.w - 5, y - 1, { align: 'right', size: 6, col: val ? col : '#4a4840' });
      };
      row('故事', best('bestStory'), panel.y + 12, '#ffe080');
      row('DoN', best('bestDon'), panel.y + 23, '#ffe080');
      row('胜场', best('mpWins'), panel.y + 34, '#80f080');
      // 联机地址没配时（纯静态发布、后端还没上线）不摆这个入口，免得玩家点了只看到报错。
      const online = BR.net.configured();
      b('开始游戏', 84, () => BR.go('bathroom'));
      let y = 102;
      if (online) { b('多人联机', y, () => BR.overlay.gateLobby()); y += 16; }
      b('排行榜', y, () => BR.overlay.rank());
      b('规则', y + 16, () => BR.overlay.rules());
      b('设置', y + 32, () => BR.overlay.settings());
      // 右侧：三连解锁的子弹自动计数入口。做成与按钮同高的一条，别抢主菜单的视觉重心
      const unlocked = BR.toy.bulletUnlocked();
      const card = { x: 212, y: 84, w: 80, h: 14 };
      const over = BR.hot(card, () => BR.overlay.bullet());
      g.rect(card.x, card.y, card.w, card.h, '#000');
      g.rect(card.x + 1, card.y + 1, card.w - 2, card.h - 2, over ? '#241616' : '#12120f');
      g.rect(card.x + 1, card.y + 1, card.w - 2, 1, over ? '#6a3030' : '#2a2a24');
      g.text('子弹计数', card.x + 6, card.y + 4, { size: 5, col: over ? '#fff' : '#c8c4b0' });
      g.text(unlocked ? '已解锁' : '三连解锁', card.x + card.w - 6, card.y + 4, { align: 'right', size: 5, col: unlocked ? '#80f080' : '#c08040' });
      // 更新日志：挂在子弹计数下面，同样的窄条样式
      const logBtn = { x: 212, y: 102, w: 80, h: 14 };
      const logOver = BR.hot(logBtn, () => BR.overlay.changelog());
      g.rect(logBtn.x, logBtn.y, logBtn.w, logBtn.h, '#000');
      g.rect(logBtn.x + 1, logBtn.y + 1, logBtn.w - 2, logBtn.h - 2, logOver ? '#241616' : '#12120f');
      g.rect(logBtn.x + 1, logBtn.y + 1, logBtn.w - 2, 1, logOver ? '#6a3030' : '#2a2a24');
      g.text('更新日志', logBtn.x + 6, logBtn.y + 4, { size: 5, col: logOver ? '#fff' : '#c8c4b0' });
      g.text(String((BR.config || {}).version || '').replace(/^v/, 'v'), logBtn.x + logBtn.w - 6, logBtn.y + 4, { align: 'right', size: 5, col: '#7a7666' });
      g.text('非官方同人复刻 · 原作 Mike Klubnika', 160, 168, { align: 'center', size: 5, col: '#5a5850' });
      // 开发者入口：连点版权文字 5 次（3 秒内），不显示任何提示
      if (this.taps === undefined) { this.taps = 0; this.lastTap = -10; }
      BR.hot({ x: 80, y: 162, w: 160, h: 12 }, () => {
        if (t - this.lastTap > 3) this.taps = 0;
        this.lastTap = t;
        if (++this.taps >= 5) { this.taps = 0; BR.overlay.dev(); }
      });
    }
  };

  BR.scenes.bathroom = {
    enter() { run = { doors: 0 }; this.kick = 0; },
    draw(t) {
      BR.bg('bathroom');
      // 洗手台、镜子、门
      g.rect(30, 110, 90, 8, '#8a9a90'); g.rect(40, 118, 70, 30, '#5a6a60');
      g.rect(45, 40, 60, 60, '#1a2420'); g.rect(48, 43, 54, 54, '#2a3a34');
      const dx = this.kick > 0 ? 6 : 0;
      g.rect(210 + dx, 30, 70, 120, '#2a1a10'); g.rect(214 + dx, 34, 62, 112, '#3a2616');
      g.rect(266 + dx, 90, 4, 6, '#a08040');
      g.text('浴室', 6, 4, { size: 6, col: '#6a8a78' });
      const door = BR.hot({ x: 210, y: 30, w: 70, h: 120 }, () => {
        BR.sfx.door(); BR.fx.shake = 0.8; this.kick = 0.5;
        setTimeout(() => BR.go('club', { mode: 'story' }), 600);
      });
      if (door) g.text('踹开门', 245, 20, { align: 'center', size: 6, col: '#ffe080' });
      // Double or Nothing 药丸：通关故事模式后出现
      if (BR.toy.save.donUnlocked === '1') {
        g.rect(70, 104, 10, 6, '#c8c0a0'); g.rect(72, 102, 6, 2, '#e8e0c0');
        const pill = BR.hot({ x: 62, y: 96, w: 26, h: 16 }, () => { BR.fx.black = 1.5; setTimeout(() => BR.go('club', { mode: 'don' }), 500); });
        if (pill) g.text('吞下药丸（DOUBLE OR NOTHING）', 75, 88, { align: 'center', size: 5, col: '#e04040' });
      }
      BR.button('返回', 4, 164, 34, 12, () => BR.go('menu'), { size: 5 });
      this.kick -= 0.016;
    }
  };

  BR.scenes.club = {
    enter(o) { run.mode = o.mode; run.doors = (run.doors || 0) + 1; this.t0 = BR.t; },
    draw(t) {
      BR.bg('club');
      const k = t - this.t0;
      for (let i = 0; i < 6; i++) g.rect(20 + i * 50 + Math.sin(t * 3 + i) * 6, 90, 14, 40, '#100406');
      const lines = ['地下室传来低沉的音乐……', '一扇门。一张桌子。', '有人在等你。'];
      lines.forEach((l, i) => { if (k > i * 1.1) g.text(l, 160, 40 + i * 14, { align: 'center', size: 7, col: '#e0b0b0' }); });
      if (k > 3.6) BR.go('waiver');
    },
    click() { BR.go('waiver'); }
  };

  BR.scenes.waiver = {
    enter() {
      const def = (BR.toy.profile && BR.toy.profile.nickname) || '';
      BR.overlay.waiver(def, (name) => BR.go('table', { mode: run.mode, name, doors: run.doors }));
    },
    draw() {
      BR.bg('table');
      g.alpha(0.7, () => g.rect(0, 0, g.W, g.H, '#000'));
    }
  };
})();
