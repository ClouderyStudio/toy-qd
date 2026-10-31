/* 像素渲染底层：320x180 低分辨率画布最近邻放大，文字在高分辨率层绘制 */
(function () {
  const BR = window.BR || (window.BR = {});
  const W = 320, H = 180;
  const lo = document.createElement('canvas');
  lo.width = W; lo.height = H;
  const c = lo.getContext('2d');
  let cv, m, scale = 1, ox = 0, oy = 0, dpr = 1;
  const texts = [];
  const FONT = '"Courier New", "SimHei", "Microsoft YaHei", monospace';
  const g = BR.gfx = { W, H, c, lo };

  g.init = function (canvas) {
    cv = canvas; m = cv.getContext('2d');
    window.addEventListener('resize', g.resize);
    g.resize();
  };

  g.resize = function () {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    scale = Math.min(cv.width / W, cv.height / H);
    if (scale >= 2) scale = Math.floor(scale);
    ox = Math.floor((cv.width - W * scale) / 2);
    oy = Math.floor((cv.height - H * scale) / 2);
  };

  // 屏幕坐标 -> 低分辨率坐标
  g.toLow = (x, y) => ({ x: (x * dpr - ox) / scale, y: (y * dpr - oy) / scale });

  g.clear = (col) => { c.fillStyle = col || '#000'; c.fillRect(0, 0, W, H); };
  g.rect = (x, y, w, h, col) => {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  g.px = (x, y, col) => g.rect(x, y, 1, 1, col);
  g.ellipse = (cx, cy, rx, ry, col) => {
    c.fillStyle = col;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  };
  g.line = (x0, y0, x1, y1, col) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    c.fillStyle = col;
    for (let n = 0; n < 2000; n++) {
      c.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  g.alpha = (a, fn) => { c.globalAlpha = a; fn(); c.globalAlpha = 1; };

  // 文字：x/y 为低分辨率坐标，size 为低分辨率像素高度
  g.text = (s, x, y, o) => texts.push(Object.assign({ s: String(s), x, y, size: 7, col: '#d8d8c8', align: 'left', a: 1 }, o));

  g.measure = (s, size) => {
    m.font = `bold ${Math.round((size || 7) * scale)}px ${FONT}`;
    return m.measureText(s).width / scale;
  };

  // 按宽度换行（中英混排逐字测量）
  g.wrap = (s, width, size) => {
    const lines = [];
    String(s).split('\n').forEach((para) => {
      let cur = '';
      for (const ch of para) {
        if (g.measure(cur + ch, size) > width && cur) { lines.push(cur); cur = ch.trim(); } else cur += ch;
      }
      lines.push(cur);
    });
    return lines;
  };

  g.grain = (n, col) => {
    c.fillStyle = col || 'rgba(0,0,0,0.35)';
    for (let i = 0; i < n; i++) c.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
  };

  // sx/sy：屏幕震动偏移（低分辨率像素）
  g.present = function (sx, sy) {
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.fillStyle = '#000';
    m.fillRect(0, 0, cv.width, cv.height);
    m.imageSmoothingEnabled = false;
    m.drawImage(lo, ox + Math.round(sx || 0) * scale, oy + Math.round(sy || 0) * scale, W * scale, H * scale);
    // 扫描线
    m.fillStyle = 'rgba(0,0,0,0.16)';
    const lh = Math.max(1, Math.floor(scale / 3));
    for (let y = oy; y < oy + H * scale; y += Math.max(2, scale)) m.fillRect(ox, y, W * scale, lh);
    m.textBaseline = 'top';
    for (const t of texts) {
      m.font = `bold ${Math.round(t.size * scale)}px ${FONT}`;
      m.textAlign = t.align;
      m.globalAlpha = t.a;
      const x = ox + t.x * scale, y = oy + t.y * scale, sh = Math.max(1, scale * 0.6);
      m.fillStyle = '#000';
      m.fillText(t.s, x + sh, y + sh);
      m.fillStyle = t.col;
      m.fillText(t.s, x, y);
    }
    m.globalAlpha = 1;
    texts.length = 0;
  };
})();
