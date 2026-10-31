/* 庄家 AI：只使用 getView(seat) 给出的公开信息与自己已知的信息，不偷看子弹 */
(function (root) {
  const BR = root.BR || (root.BR = {});

  BR.aiDecide = function (v) {
    const me = v.you, S = v.seats[me];
    const foes = v.seats.map((s, i) => i).filter((i) => i !== me && v.seats[i].alive);
    const foe = foes.reduce((a, b) => (v.seats[b].hp < v.seats[a].hp ? b : a), foes[0]);
    const has = (k) => S.items.indexOf(k);
    const use = (k, extra) => Object.assign({ type: 'item', slot: has(k) }, extra || {});
    const shoot = (t) => ({ type: 'shoot', target: t });

    // 推算当前这发是实弹的概率
    const spentLive = v.spent.filter(Boolean).length;
    let live = Math.max(0, v.loadLive - spentLive);
    let blank = Math.max(0, v.left - live);
    Object.keys(v.known).forEach((o) => { if (+o > 0) { if (v.known[o]) live--; else blank--; } });
    const cur = v.known[0];
    const p = cur === undefined ? (live + blank > 0 ? Math.max(0, live) / Math.max(1, live + blank) : 0.5) : (cur ? 1 : 0);
    const hurt = S.hp < S.maxHp && !S.wiresCut;
    const two = v.seats.length === 2;

    if (hurt && S.maxHp - S.hp >= 2 && S.hp > 1 && has('medicine') >= 0) return use('medicine');
    if (hurt && has('cigarette') >= 0) return use('cigarette');
    if (cur === undefined && v.left > 0 && has('magnifier') >= 0) return use('magnifier');
    if (cur === undefined && v.left >= 3 && has('burnerphone') >= 0) return use('burnerphone');

    // 肾上腺素：偷对方有用的道具
    const ad = has('adrenaline');
    if (ad >= 0 && two) {
      const its = v.seats[foe].items;
      const want = [];
      if (cur === undefined) want.push('magnifier');
      if (hurt) want.push('cigarette');
      if (p >= 0.5 && !v.sawed) want.push('handsaw');
      if (!v.seats[foe].cuffed && !v.seats[foe].cuffLock) want.push('handcuffs');
      for (const w of want) {
        const j = its.indexOf(w);
        if (j >= 0) return { type: 'item', slot: ad, target: foe, steal: j };
      }
    }

    const canCuff = two && has('handcuffs') >= 0 && !v.seats[foe].cuffed && !v.seats[foe].cuffLock && v.left > 1;
    const jam = foes.find((i) => !v.seats[i].jammed);
    if (!two && has('jammer') >= 0 && jam !== undefined && Math.random() < 0.6) return use('jammer', { target: jam });
    if (!two && has('remote') >= 0 && Math.random() < 0.15) return use('remote');

    if (cur === false) {
      if (has('inverter') >= 0) return use('inverter');
      return shoot(me);
    }
    if (p >= 0.99) {
      if (canCuff) return use('handcuffs', { target: foe });
      if (!v.sawed && has('handsaw') >= 0) return use('handsaw');
      return shoot(foe);
    }
    if (p < 0.5 && has('beer') >= 0 && v.left > 1) return use('beer');
    if (canCuff && p >= 0.5) return use('handcuffs', { target: foe });
    if (p > 0.5) {
      if (!v.sawed && has('handsaw') >= 0 && p >= 0.66) return use('handsaw');
      return shoot(foe);
    }
    if (p === 0.5) return shoot(Math.random() < 0.5 ? foe : me);
    return shoot(me);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
