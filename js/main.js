/* 主循环：场景切换、指针输入、即时模式按钮、全屏特效 */
(function () {
  const BR = window.BR;
  const g = BR.gfx;
  BR.scenes = BR.scenes || {};
  let cur = null, curName = '';
  let hot = [], nextHot = [];
  const mouse = { x: -1, y: -1 };
  const fx = BR.fx = { shake: 0, flash: 0, red: 0, black: 0 };
  BR.mouse = mouse;
  BR.t = 0;

  /* ── 服务器维护公告 ──────────────────────────────────────────────
   * 展示策略：对局中只画一条顶部横幅，不挡操作区；大厅/菜单用 DOM 浮层。
   * level=down 时菜单上禁止开新局（服务端也会拒），避免玩家点了才看到报错。 */
  const notice = { cur: null, flashT: 0, dismissed: false };
  BR.notice = notice;

  BR.net.onNoticeInfo = (n) => {
    const changed = JSON.stringify(n) !== JSON.stringify(notice.cur);
    notice.cur = n;
    if (changed) {
      notice.dismissed = false;
      notice.flashT = 6;          // 新公告进来时先醒目 6 秒
      if (n && n.level === 'warn' && BR.sfx) BR.sfx.beep && BR.sfx.beep();
    }
  };

  /* 顶部横幅：对局中常驻，闪一下之后变成低调的一条，点一下可以收起。 */
  BR.drawNotice = function (t) {
    const n = notice.cur;
    if (!n || notice.dismissed) return;
    const col = n.level === 'down' ? '#e04040' : (n.level === 'warn' ? '#e0a040' : '#7aa0c0');
    const hot = notice.flashT > 0;
    const a = hot ? 0.95 : 0.55;
    // 顶部一条，高 13，不侵入桌面操作区（桌面从 y=14 开始）
    g.alpha(a, () => {
      g.rect(0, 0, g.W, 13, hot ? '#1a0f0f' : '#0c0c10');
      g.rect(0, 12, g.W, 1, col);
    });
    const text = n.text.length > 26 ? n.text.slice(0, 26) + '…' : n.text;
    g.text(`[${n.level === 'down' ? '维护中' : (n.level === 'warn' ? '维护提醒' : '公告')}] ${text}`, 6, 3, { size: 5, col });
    g.text('点此收起', g.W - 6, 3, { align: 'right', size: 5, col: '#5a5850' });
    BR.hot({ x: 0, y: 0, w: g.W, h: 13 }, () => { notice.dismissed = true; });
  };

  BR.isNoticeBlocking = () => !!(notice.cur && notice.cur.block);

  BR.go = function (name, arg) {
    if (cur && cur.exit) cur.exit();
    curName = name;
    cur = BR.scenes[name];
    BR.overlay && BR.overlay.hide();
    if (cur.enter) cur.enter(arg);
  };
  BR.sceneName = () => curName;

  const inside = (r) => mouse.x >= r.x && mouse.x < r.x + r.w && mouse.y >= r.y && mouse.y < r.y + r.h;
  BR.hover = inside;

  // 注册可点击区域；返回是否悬停
  BR.hot = function (r, onClick) {
    nextHot.push({ r, onClick });
    return inside(r);
  };

  BR.button = function (label, x, y, w, h, onClick, o) {
    o = o || {};
    const r = { x, y, w, h };
    const over = BR.hot(r, onClick);
    g.rect(x, y, w, h, '#000');
    g.rect(x + 1, y + 1, w - 2, h - 2, over ? (o.hi || '#5a1010') : (o.bg || '#1a1a16'));
    g.text(label, x + w / 2, y + (h - (o.size || 7)) / 2, { align: 'center', size: o.size || 7, col: over ? '#fff' : '#c8c4b0' });
    return over;
  };

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    BR.t += dt;
    if (notice.flashT > 0) notice.flashT -= dt;
    g.clear('#000');
    if (cur && cur.update) cur.update(dt);
    if (cur && cur.draw) cur.draw(BR.t, dt);
    BR.drawNotice(BR.t);
    if (fx.flash > 0) { g.alpha(Math.min(1, fx.flash), () => g.rect(0, 0, g.W, g.H, '#fff8e0')); fx.flash -= dt * 4; }
    if (fx.red > 0) { g.alpha(Math.min(0.6, fx.red), () => g.rect(0, 0, g.W, g.H, '#800000')); fx.red -= dt * 1.5; }
    if (fx.black > 0) { g.alpha(Math.min(1, fx.black), () => g.rect(0, 0, g.W, g.H, '#000')); fx.black -= dt * 0.8; }
    g.grain(120);
    let sx = 0, sy = 0;
    if (fx.shake > 0) { sx = (Math.random() - 0.5) * fx.shake * 8; sy = (Math.random() - 0.5) * fx.shake * 8; fx.shake -= dt * 3; }
    g.present(sx, sy);
    hot = nextHot; nextHot = [];
    requestAnimationFrame(frame);
  }

  function point(e) {
    const p = g.toLow(e.clientX, e.clientY);
    mouse.x = p.x; mouse.y = p.y;
  }

  window.addEventListener('load', () => {
    const cv = document.getElementById('screen');
    g.init(cv);
    cv.addEventListener('pointermove', point);
    cv.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1; });
    cv.addEventListener('pointerdown', (e) => {
      point(e);
      BR.touch = e.pointerType === 'touch';
      BR.sfx.unlock();
      BR.sfx.bgm(true);   // BGM 全局常驻：主页/对局连续播放，手势后才能出声（浏览器策略）
      BR.toy && BR.toy.firstGesture();
      for (let i = hot.length - 1; i >= 0; i--) {
        if (inside(hot[i].r)) { hot[i].onClick(); return; }
      }
      if (cur && cur.click) cur.click(mouse.x, mouse.y);
    });
    window.addEventListener('keydown', (e) => { if (cur && cur.key) cur.key(e.key); });
    BR.toy && BR.toy.init();
    BR.go('menu');
    requestAnimationFrame(frame);
  });
})();
