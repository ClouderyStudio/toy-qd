/* 引擎：道具使用校验与效果 */
(function (root) {
  const BR = root.BR || (root.BR = {});
  if (typeof module !== 'undefined' && !BR.Game) require('./engine-core.js');
  const G = BR.Game.prototype;

  // 两人局的默认目标是另一位玩家
  G.defaultTarget = function (seat) {
    return this.seats.length === 2 ? 1 - seat : undefined;
  };

  // a: { slot, target?, steal? }  steal 为肾上腺素偷取对方的道具格
  G.useItem = function (seat, a) {
    const me = this.seats[seat];
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= me.items.length) this.fail('道具格无效');
    let key = me.items[a.slot];
    let target = a.target === undefined ? this.defaultTarget(seat) : a.target;

    if (key === 'adrenaline') {
      if (!this.validSeat(target) || target === seat) this.fail('偷取目标无效');
      const vic = this.seats[target];
      if (!Number.isInteger(a.steal) || a.steal < 0 || a.steal >= vic.items.length) this.fail('偷取道具无效');
      const stolen = vic.items[a.steal];
      if (stolen === 'adrenaline') this.fail('不能偷肾上腺素');
      // 被偷的道具立即使用；它的目标默认就是被偷的那位
      const sub = stolen === 'jammer' ? a.subTarget : target;
      this.check(seat, stolen, sub);
      me.items.splice(a.slot, 1);
      vic.items.splice(a.steal, 1);
      this.emit({ t: 'steal', seat, from: target, item: stolen });
      return this.apply(seat, stolen, sub);
    }
    this.check(seat, key, target);
    me.items.splice(a.slot, 1);
    this.apply(seat, key, target);
  };

  G.check = function (seat, key, target) {
    if (!BR.ITEMS[key]) this.fail('未知道具');
    if (key === 'handsaw' && this.sawed) this.fail('枪管已经锯短了');
    if (key === 'handcuffs') {
      if (!this.validSeat(target) || target === seat) this.fail('手铐目标无效');
      const t = this.seats[target];
      if (t.cuffed || t.cuffLock) this.fail('对方已被铐住');
    }
    if (key === 'jammer') {
      if (!this.validSeat(target) || target === seat) this.fail('干扰目标无效');
      if (this.seats[target].jammed) this.fail('对方已被干扰');
    }
  };

  G.apply = function (seat, key, target) {
    const me = this.seats[seat];
    switch (key) {
      case 'magnifier': {
        const live = this.shells[this.idx];
        this.known[seat][this.idx] = live;
        this.emit({ t: 'item', seat, item: key, to: seat, secret: live });
        break;
      }
      case 'cigarette':
        me.st.cigs++;
        this.emit({ t: 'item', seat, item: key });
        this.heal(seat, 1);
        break;
      case 'beer': {
        const live = this.shells[this.idx];
        this.idx++; this.spent.push(live);
        me.st.ejected++; me.st.beer++;
        this.emit({ t: 'item', seat, item: key, live });
        if (this.idx >= this.shells.length) return this.endAction(seat, true);
        break;
      }
      case 'handsaw':
        this.sawed = true;
        this.emit({ t: 'item', seat, item: key });
        break;
      case 'handcuffs':
        this.seats[target].cuffed = true;
        this.emit({ t: 'item', seat, item: key, target });
        break;
      case 'burnerphone': {
        const rest = this.shells.length - this.idx;
        if (rest < 2) { this.emit({ t: 'item', seat, item: key, to: seat, secret: null }); break; }
        const off = BR.ri(1, rest - 1);
        const live = this.shells[this.idx + off];
        this.known[seat][this.idx + off] = live;
        this.emit({ t: 'item', seat, item: key, to: seat, secret: { off, live } });
        break;
      }
      case 'inverter':
        this.shells[this.idx] = !this.shells[this.idx];
        this.known.forEach((k) => { if (this.idx in k) k[this.idx] = !k[this.idx]; });
        this.emit({ t: 'item', seat, item: key });
        break;
      case 'medicine': {
        const good = Math.random() < 0.5;
        this.emit({ t: 'item', seat, item: key, good });
        if (good) this.heal(seat, 2); else this.damage(seat, 1);
        if (!good && this.checkStageEnd()) return;
        if (!me.alive) return this.endAction(seat, false);
        break;
      }
      case 'jammer':
        this.seats[target].jammed = true;
        this.emit({ t: 'item', seat, item: key, target });
        break;
      case 'remote':
        this.dir = -this.dir;
        this.emit({ t: 'item', seat, item: key, dir: this.dir });
        break;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
