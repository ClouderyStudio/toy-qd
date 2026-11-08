/* 封面文字：标题在 6 倍像素网格上阈值化（比场景 12 倍更细，笔画才不糊）
 * 所有文字都在 4:3 安全区 x 240~1680 内，且避开底部 ~20% 播放量条 */
(function () {
  const o = document.getElementById('out').getContext('2d');
  const FONT = '"SimHei", "Microsoft YaHei", sans-serif';
  let GW = 320, GH = 180, GS = 6;

  function pixelText(s, cx, top, size, spacing, ramp, hi, gs) {
    GS = gs || 6; GW = 1920 / GS; GH = 1080 / GS;
    const m = document.createElement('canvas'); m.width = GW; m.height = GH;
    const mc = m.getContext('2d');
    mc.font = `900 ${size}px ${FONT}`; mc.textAlign = 'center'; mc.textBaseline = 'top';
    mc.letterSpacing = spacing + 'px';
    mc.fillStyle = '#fff'; mc.fillText(s, cx + spacing / 2, top);
    const d = mc.getImageData(0, 0, GW, GH).data;
    const on = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && d[(y * GW + x) * 4 + 3] > 110;
    const pts = [];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (on(x, y)) pts.push([x, y]);
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const L = document.createElement('canvas'); L.width = GW; L.height = GH;
    const l = L.getContext('2d');
    l.fillStyle = '#1a0000'; pts.forEach(([x, y]) => l.fillRect(x + 1, y + 2, 2, 2));   // 投影
    l.fillStyle = '#000'; pts.forEach(([x, y]) => l.fillRect(x - 1, y - 1, 3, 3));       // 描边
    pts.forEach(([x, y]) => {
      const k = Math.min(ramp.length - 1, Math.floor(((y - y0) / (y1 - y0 + 1)) * ramp.length));
      l.fillStyle = ramp[k]; l.fillRect(x, y, 1, 1);
    });
    l.fillStyle = hi; pts.forEach(([x, y]) => { if (!on(x, y - 1)) l.fillRect(x, y, 1, 1); });
    o.imageSmoothingEnabled = false;
    o.drawImage(L, 0, 0, GW * GS, GH * GS);
  }

  // 主标题：约 1220px 宽、300px 高
  pixelText('恶魔轮盘', 160, 87, 54, 4, ['#ff7050', '#f04030', '#d02420', '#a81418', '#7a0c10'], '#ffd8b8');
  // 副标题：像素白字
  pixelText('像素联机版', 240, 210, 31, 5, ['#ffffff', '#e8e0c8', '#c8c0a8'], '#ffffff', 4);

  // 扫描线
  o.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < 1080; y += 6) o.fillRect(0, y, 1920, 2);

  // 右上角人数印章（4:3 安全区内）
  o.save(); o.translate(1440, 150); o.rotate(-0.08);
  o.fillStyle = '#000'; o.fillRect(-190 + 10, -72 + 10, 380, 144);
  o.fillStyle = '#c01818'; o.fillRect(-190, -72, 380, 144);
  o.fillStyle = '#f0e0c8'; o.fillRect(-178, -60, 356, 120);
  o.fillStyle = '#c01818'; o.fillRect(-168, -50, 336, 100);
  o.font = `900 84px ${FONT}`; o.textAlign = 'center'; o.textBaseline = 'middle';
  o.fillStyle = '#fff0e0'; o.fillText('2~4人', 0, 6);
  o.restore();

  document.title = 'ready';
})();
