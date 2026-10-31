/* 道具像素图标（12x12 字符网格 + 调色板），首次使用时缓存为 canvas */
(function () {
  const BR = window.BR;
  const PAL = {
    k: '#0c0c0c', w: '#e8e4d0', g: '#8a8a80', d: '#4a4a44', r: '#b02020', R: '#e04040',
    y: '#d8b040', o: '#a06020', b: '#3a6ab0', B: '#80b0e0', n: '#6a4020', G: '#40a050',
    p: '#c060c0', s: '#c0c0c8', c: '#60d0d0'
  };
  const ART = {
    magnifier: ['....kkkk....', '...kBBBBk...', '..kBcBBBBk..', '..kBcBBBBk..', '..kBBBBBBk..', '..kBBBBBBk..',
      '...kBBBBk...', '....kkkkg...', '.......gnn..', '........nn..', '.........nn.', '..........n.'],
    cigarette: ['............', '..kkkkkkkk..', '..krrrrrrk..', '..krwwwwrk..', '..krrrrrrk..', '..kwwwwwwk..',
      '..kwwwwwwk..', '..kwwwwwwk..', '..kwwwwwwk..', '..kwwwwwwk..', '..kkkkkkkk..', '............'],
    beer: ['....ssss....', '...sggggs...', '...kGGGGk...', '..kGGGGGGk..', '..kGwwwwGk..', '..kGwrrwGk..',
      '..kGwwwwGk..', '..kGGGGGGk..', '..kGGGGGGk..', '..kGGGGGGk..', '...kkkkkk...', '............'],
    handsaw: ['............', 'nn..........', 'nnn.........', 'nnnsssssssss', 'nnnsssssssss', 'nn.sssssssss',
      '...ksksksksk', '............', '............', '............', '............', '............'],
    handcuffs: ['............', '..sss..sss..', '.s...ss...s.', '.s...ss...s.', '.s...ss...s.', '..sss..sss..',
      '............', '............', '............', '............', '............', '............'],
    adrenaline: ['..........k.', '.........k..', '........kg..', '.......kGGk.', '......kGGk..', '.....kGGk...',
      '....kGGk....', '...kGGk.....', '..kssk......', '.kssk.......', '.kk.........', '............'],
    burnerphone: ['...kkkkkk...', '...kccccck..', '...kccccck..', '...kccccck..', '...kkkkkk...', '...kdgdgdk..',
      '...kgdgdgk..', '...kdgdgdk..', '...kgdgdgk..', '...kdddddk..', '...kkkkkk...', '............'],
    inverter: ['............', '...kkkkkk...', '..kyyyyyyk..', '..kyRRBByk..', '..kyRRBByk..', '..kyyyyyyk..',
      '..kykkkkyk..', '..kyyyyyyk..', '...kkkkkk...', '............', '............', '............'],
    medicine: ['............', '...kkkkkk...', '...kwwwwk...', '...kkkkkk...', '...kooook...', '...kowwok...',
      '...kowrok...', '...kowwok...', '...kooook...', '...kkkkkk...', '............', '............'],
    jammer: ['.......k....', '.......k....', '......kk....', '..kkkkkkkk..', '..kddddddk..', '..kdRdddRk..',
      '..kddddddk..', '..kdgggggk..', '..kddddddk..', '..kkkkkkkk..', '............', '............'],
    remote: ['............', '....kkkk....', '....kddk....', '....kRdk....', '....kddk....', '....kgbk....',
      '....kbgk....', '....kgbk....', '....kddk....', '....kkkk....', '............', '............'],
    bolt: ['....yy', '...yy.', '..yyyy', '...yy.', '..yy..', '.y....']
  };
  const cache = {};

  BR.sprite = function (key) {
    if (cache[key]) return cache[key];
    const rows = ART[key];
    if (!rows) return null;
    const cv = document.createElement('canvas');
    const w = Math.max(...rows.map((r) => r.length));
    cv.width = w; cv.height = rows.length;
    const c = cv.getContext('2d');
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        const col = PAL[r[x]];
        if (col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); }
      }
    });
    return (cache[key] = cv);
  };

  BR.drawSprite = function (key, x, y, alpha) {
    const s = BR.sprite(key);
    if (!s) return;
    const c = BR.gfx.c;
    if (alpha !== undefined) c.globalAlpha = alpha;
    c.drawImage(s, Math.round(x), Math.round(y));
    c.globalAlpha = 1;
  };
})();
