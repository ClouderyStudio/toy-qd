/* 引擎：动作处理（开枪、伤害、回合推进）与按座位过滤的视图 */
(function (root) {
  const BR = root.BR || (root.BR = {});
  if (typeof module !== 'undefined' && !BR.Game) require('./engine-core.js');
  const G = BR.Game.prototype;

  // action: {type:'shoot', target} | {type:'item', slot, target?, steal?} | {type:'don', go}
  G.act = function (seat, a) {
    this.ev = [];
    if (!a || typeof a !== 'object') this.fail('无效动作');
    if (a.type === 'don') {
      if (this.phase !== 'donChoice' || seat !== 0) this.fail('现在不能选择');
      this.donChoice(!!a.go); return this.flush();
    }
    if (this.phase !== 'turn') this.fail('现在不能行动');
    if (seat !== this.turn) this.fail('还没轮到你');
    if (a.type === 'shoot') this.shoot(seat, a.target);
    else if (a.type === 'item') this.useItem(seat, a);
    else this.fail('未知动作');
    return this.flush();
  };

  G.validSeat = function (t) {
    return Number.isInteger(t) && t >= 0 && t < this.seats.length && this.seats[t].alive;
  };

  G.shoot = function (seat, target) {
    if (!this.validSeat(target)) this.fail('目标无效');
    const live = this.shells[this.idx];
    const dmg = live ? (this.sawed ? 2 : 1) : 0;
    this.idx++; this.sawed = false; this.spent.push(live);
    this.seats[seat].st.shots++;
    this.emit({ t: 'shoot', seat, target, live, dmg });
    if (live) this.damage(target, dmg);
    if (this.checkStageEnd()) return;
    const keep = !live && target === seat;
    this.endAction(seat, keep);
  };

  // keep=true：本人继续行动
  G.endAction = function (seat, keep) {
    if (this.phase !== 'turn') return;
    if (this.idx >= this.shells.length) {
      this.emit({ t: 'empty' });
      this.newLoad();
      if (this.mode !== 'mp') return this.startTurn(0);
      return keep && this.seats[seat].alive ? this.setTurn(seat) : this.passTurn(seat);
    }
    if (keep && this.seats[seat].alive) return;
    if (!this.seats[seat].alive && seat !== this.turn) return;
    this.passTurn(seat);
  };

  G.damage = function (s, n) {
    const p = this.seats[s];
    if (!p.alive) return;
    p.hp = p.wiresCut ? 0 : Math.max(0, p.hp - n);
    this.emit({ t: 'hp', seat: s, hp: p.hp });
    if (p.hp > 0 && this.plan.wires && !p.wiresCut && p.hp <= 2) {
      p.wiresCut = true; this.emit({ t: 'wires', seat: s });
    }
    if (p.hp === 0) { p.alive = false; p.items = []; this.emit({ t: 'down', seat: s }); }
  };

  G.heal = function (s, n) {
    const p = this.seats[s];
    if (!p.alive || p.wiresCut) { this.emit({ t: 'noheal', seat: s }); return; }
    p.hp = Math.min(p.maxHp, p.hp + n);
    this.emit({ t: 'hp', seat: s, hp: p.hp });
  };

  G.getView = function (seat) {
    const known = {};
    const k = this.known[seat] || {};
    Object.keys(k).forEach((i) => { if (+i >= this.idx) known[+i - this.idx] = k[i]; });
    return {
      you: seat, mode: this.mode, stage: this.stage, round: this.round, phase: this.phase,
      turn: this.turn, dir: this.dir, sawed: this.sawed, wires: !!(this.plan && this.plan.wires),
      left: this.shells.length - this.idx, loadLive: this.loadLive, loadBlank: this.loadBlank,
      spent: this.spent.slice(), known,
      seats: this.seats.map((s) => ({
        name: s.name, hp: s.hp, maxHp: s.maxHp, items: s.items.slice(), alive: s.alive,
        connected: s.connected, cuffed: s.cuffed, cuffLock: s.cuffLock, jammed: s.jammed,
        wiresCut: s.wiresCut, money: s.money, st: Object.assign({}, s.st)
      })),
      doors: this.doors, penalty: this.penalty, wins: this.wins, result: this.result
    };
  };

  // 私密字段 secret 只发给 e.to 本人
  BR.filterEvents = function (events, seat) {
    return events.map((e) => {
      if (e.secret === undefined || e.to === seat) return e;
      const c = Object.assign({}, e); delete c.secret; return c;
    });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
