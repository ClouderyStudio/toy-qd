/* 引擎：关卡结束、故事复活罚款、Double or Nothing、多人奖金、离开 */
(function (root) {
  const BR = root.BR || (root.BR = {});
  if (typeof module !== 'undefined' && !BR.Game) require('./engine-core.js');
  const G = BR.Game.prototype;
  const MP_PRIZE = [10000, 20000, 40000];
  const DON_BASE = 70000;

  G.checkStageEnd = function () {
    const alive = this.seats.map((s, i) => (s.alive ? i : -1)).filter((i) => i >= 0);
    if (alive.length > 1) return false;
    this.endStage(alive.length ? alive[0] : -1);
    return true;
  };

  G.endStage = function (winner) {
    this.phase = 'stageEnd';
    this.emit({ t: 'stageEnd', stage: this.stage, winner });
    if (this.mode === 'mp') {
      if (winner >= 0) this.seats[winner].money += MP_PRIZE[this.stage - 1];
      return this.stage < 3 ? this.startStage(this.stage + 1) : this.finish(null);
    }
    const won = winner === 0;
    if (won) this.wins++;
    if (this.mode === 'story') {
      if (!won) {
        if (this.stage === 3) return this.finish({ dead: true, cash: 0 });
        const fine = this.stage === 1 ? 4000 : (this.wins > 0 ? 4000 : 2000);
        this.penalty += fine; this.doors++;
        this.emit({ t: 'revive', fine });
      }
      if (this.stage < 3) return this.startStage(this.stage + 1);
      return this.finish({ dead: false, cash: Math.max(0, DON_BASE - this.penalty - this.vice()) });
    }
    // Double or Nothing：任何一关输了就死
    if (!won) return this.finish({ dead: true, cash: 0 });
    if (this.stage < 3) return this.startStage(this.stage + 1);
    this.pot = this.pot ? this.pot * 2 : Math.max(10000, DON_BASE - this.vice());
    this.phase = 'donChoice';
    this.emit({ t: 'donChoice', pot: this.pot, round: this.round });
  };

  // 香烟和啤酒会扣一点奖金（近似原作结算）
  G.vice = function () {
    const s = this.seats[0].st;
    return s.cigs * 220 + s.beer * 495;
  };

  /* 玩家此刻"手里有多少钱"。所有模式统一成一个字段，界面直接画。
   * 故事/DoN 还没有真实钱包，这里给的是按当前进度算出的预计到手奖金：
   *   DoN 进行中 = 当前奖池；否则 = 基础奖金 - 罚款 - 烟酒消耗。
   * 地牢里被医生救活会加罚款，所以这个数字会当场变小 —— 正是玩家想看到的反馈。 */
  G.purse = function () {
    if (this.mode === 'mp') {
      return this.seats.map((s) => s.money);
    }
    if (this.mode === 'don' && this.pot) return this.pot;
    return Math.max(0, DON_BASE - this.penalty - this.vice());
  };

  G.donChoice = function (go) {
    if (go) {
      this.round++;
      return this.startStage(1);
    }
    this.finish({ dead: false, cash: this.pot });
  };

  G.finish = function (result) {
    this.phase = 'over';
    // over 是给视图/客户端判断"这局结束了"的正式标志，必须一并置上。
    // 少这一句时 phase 虽然是 over，但 view.over 仍是 undefined，
    // 客户端会继续显示"等待"，而服务端已经不再调度回合 —— 表现就是卡住。
    this.over = true;
    if (this.mode === 'mp') {
      let best = -1;
      this.seats.forEach((s, i) => {
        if (s.connected && (best < 0 || s.money > this.seats[best].money)) best = i;
      });
      result = { winner: best, money: this.seats.map((s) => s.money) };
    }
    this.result = result;
    this.emit({ t: 'over', result });
  };

  G.leave = function (seat) {
    this.ev = [];
    const p = this.seats[seat];
    if (!p || !p.connected) return [];
    p.connected = false;
    this.emit({ t: 'left', seat });
    if (this.phase === 'over') return this.flush();
    if (this.seats.filter((s) => s.connected).length < 2) {
      this.finish(this.mode === 'mp' ? null : { dead: false, cash: 0 });
      return this.flush();
    }
    if (p.alive) {
      p.alive = false; p.items = [];
      this.emit({ t: 'down', seat });
      if (this.phase === 'turn' && !this.checkStageEnd() && this.turn === seat) this.passTurn(seat);
    }
    return this.flush();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
