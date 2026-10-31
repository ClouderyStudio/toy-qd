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
    g.clear('#000');
    if (cur && cur.update) cur.update(dt);
    if (cur && cur.draw) cur.draw(BR.t, dt);
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
