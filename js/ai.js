/* 庄家 AI：只使用 getView(seat) 给出的公开信息与自己已知的信息，不偷看子弹
 *
 * 三条曾被玩家明确指出的毛病（见 tools/inverter-selftest.js）：
 *  1. 已知当前这发是什么，还去翻放大镜 —— 白扔道具，还拖慢节奏
 *  2. 拿到逆转器不会用 —— 现在翻成实弹朝人打，翻成空弹就朝自己打保回合并立刻少一发
 *  3. 只剩最后一发子弹还铐人 —— 铐完枪就空了，手铐纯浪费；同理不吃过期药赌命
 */
(function (root) {
  const BR = root.BR || (root.BR = {});

  BR.aiDecide = function (v) {
    const me = v.you, S = v.seats[me];
    const foes = v.seats.map((s, i) => i).filter((i) => i !== me && v.seats[i].alive);
    // 没有对手可打时（理论上不该发生）只能打自己，避免下面 reduce 拿到 undefined
    if (!foes.length) return { type: 'shoot', target: me };
    const foe = foes.reduce((a, b) => (v.seats[b].hp < v.seats[a].hp ? b : a), foes[0]);
    const has = (k) => S.items.indexOf(k);
    const use = (k, extra) => Object.assign({ type: 'item', slot: has(k) }, extra || {});
    const shoot = (t) => ({ type: 'shoot', target: t });

    const left = Math.max(0, v.left || 0);
    const cur = v.known[0];                       // 0 号位 = 膛口这发，undefined 表示不知道
    const knowsCur = cur !== undefined;

    /* 推算当前这发是实弹的概率。
     * loadLive / loadBlank 是「本次装弹里还没打出、且没被逆转器翻过」的发数，
     * 被翻过的那发两边都不算，所以先把它从分母里摘出去。 */
    const spentLive = (v.spent || []).filter(Boolean).length;
    const spentBlank = (v.spent || []).filter((x) => !x).length;
    let live = Math.max(0, (v.loadLive || 0) - spentLive);
    let blank = Math.max(0, (v.loadBlank || 0) - spentBlank);
    Object.keys(v.known || {}).forEach((o) => {
      if (+o <= 0) return;                        // 0 号位单独判断，别重复扣
      if (v.known[o]) live--; else blank--;
    });
    const p = knowsCur ? (cur ? 1 : 0) : (live + blank > 0 ? Math.max(0, live) / (live + blank) : 0.5);
    const hurt = S.hp < S.maxHp && !S.wiresCut;
    const two = v.seats.length === 2;

    // 手铐只在「铐住之后还有子弹可打」时才值钱：只剩最后一发时铐了也立刻空膛
    const canCuff = two && has('handcuffs') >= 0 && !v.seats[foe].cuffed
      && !v.seats[foe].cuffLock && left > 1;

    /* ---- 治疗 ---- */
    // 香烟稳定 +1，先抽；过期药有 50% 反伤 1 点，只有在血量 > 1（不会被自己吃死）
    // 且这一枪的代价补不到时才去赌，绝不优先于香烟。
    if (hurt && has('cigarette') >= 0) return use('cigarette');
    if (hurt && S.maxHp - S.hp >= 2 && S.hp > 1 && has('medicine') >= 0) return use('medicine');

    /* ---- 只有「不知道膛口是什么」时才值得花情报道具 ---- */
    if (!knowsCur && left > 0 && has('magnifier') >= 0) return use('magnifier');
    if (!knowsCur && left >= 3 && has('burnerphone') >= 0) return use('burnerphone');

    // 肾上腺素：偷对方有用的道具
    const ad = has('adrenaline');
    if (ad >= 0 && two) {
      const its = v.seats[foe].items;
      const want = [];
      if (!knowsCur) want.push('magnifier');
      if (hurt) want.push('cigarette');
      if (p >= 0.5 && !v.sawed) want.push('handsaw');
      if (canCuff && !v.seats[foe].cuffed && !v.seats[foe].cuffLock) want.push('handcuffs');
      for (const w of want) {
        const j = its.indexOf(w);
        if (j >= 0) return { type: 'item', slot: ad, target: foe, steal: j };
      }
    }

    const jam = foes.find((i) => !v.seats[i].jammed);
    if (!two && has('jammer') >= 0 && jam !== undefined && Math.random() < 0.6) return use('jammer', { target: jam });
    if (!two && has('remote') >= 0 && Math.random() < 0.15) return use('remote');

    /* ---- 逆转器：把膛口这一发翻成自己要的样子 ----
     * 已知空弹 → 翻成实弹打对手；已知实弹又不想吃这一枪 → 不翻，直接打人。
     * 不知道是什么时不赌（它不会让你多知道任何信息）。 */
    if (cur === false && has('inverter') >= 0) {
      if (!v.sawed && has('handsaw') >= 0) return use('handsaw');   // 翻成实弹再锯一下，双倍伤害
      return use('inverter');
    }

    if (p >= 0.99) {
      if (canCuff) return use('handcuffs', { target: foe });
      if (!v.sawed && has('handsaw') >= 0) return use('handsaw');
      return shoot(foe);
    }
    if (p < 0.5 && has('beer') >= 0 && left > 1) return use('beer');
    if (canCuff && p >= 0.5) return use('handcuffs', { target: foe });
    if (p > 0.5) {
      if (!v.sawed && has('handsaw') >= 0 && p >= 0.66) return use('handsaw');
      return shoot(foe);
    }
    if (p === 0.5) return shoot(Math.random() < 0.5 ? foe : me);
    return shoot(me);   // 大概率空弹：打自己保回合并省下一发给对手看
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
