/* 预渲染背景：Bayer 4x4 抖动的昏暗光照，每个场景只算一次 */
(function () {
  const BR = window.BR;
  const { W, H } = BR.gfx;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const cache = {};

  // fn(x,y) 返回 [调色板序号的连续值]，抖动后取整
  function render(pal, fn) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const img = c.createImageData(W, H);
    const P = pal.map(hex);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = fn(x, y) * (P.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5;
        const col = P[Math.max(0, Math.min(P.length - 1, Math.round(v)))];
        const o = (y * W + x) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }
  const glow = (x, y, cx, cy, r) => Math.max(0, 1 - Math.hypot(x - cx, (y - cy) * 1.3) / r);

  const SCENES = {
    // 对局房间：头顶吊灯，墙面暗，桌面绿灰
    table: () => render(['#050505', '#0e0f0d', '#1a1c18', '#2a2e26', '#3d4436', '#56604a', '#76806a'], (x, y) => {
      if (y < 108) {
        const wall = glow(x, y, 160, 10, 210) * 0.55;
        const panel = (x % 40 < 1 || y === 70) ? -0.08 : 0;
        return wall + panel;
      }
      const t = glow(x, y, 160, 120, 190);
      return 0.2 + t * 0.8 - (y > 172 ? 0.15 : 0);
    }),
    // 浴室：瓷砖墙、洗手台、绿色日光灯
    bathroom: () => render(['#040605', '#0b100d', '#152019', '#22332a', '#34493d', '#4c6656', '#6d8a78'], (x, y) => {
      const tile = (x % 16 === 0 || y % 16 === 0) ? -0.12 : 0;
      const light = glow(x, y, 160, 0, 230) * 0.75;
      if (y > 130) return light * 0.5 + 0.05;
      return light + tile;
    }),
    // 夜店走廊：红色灯光
    club: () => render(['#040202', '#100506', '#200a0c', '#361014', '#521820', '#76222c', '#a03440'], (x, y) => {
      const strobe = glow(x, y, 80, 30, 120) + glow(x, y, 240, 40, 120);
      const floor = y > 120 ? 0.15 : 0;
      return Math.min(1, strobe * 0.6 + floor);
    }),
    // 天堂：白色强光
    heaven: () => render(['#8a8a90', '#a8a8b0', '#c4c4cc', '#dcdce4', '#eeeef4', '#ffffff'], (x, y) => {
      return 0.3 + glow(x, y, 160, 60, 220) * 0.7;
    }),
    // 车内夜景
    car: () => render(['#020204', '#06070c', '#0d1018', '#161c2a', '#22304a', '#34486a'], (x, y) => {
      if (y > 120) return 0.08;
      if (x < 30 || x > 290 || y < 14) return 0.02;
      return 0.15 + (1 - y / 120) * 0.4 + glow(x, y, 160, 118, 60) * 0.4;
    })
  };

  BR.bg = function (name) {
    if (!cache[name]) cache[name] = SCENES[name]();
    BR.gfx.c.drawImage(cache[name], 0, 0);
  };
})();
