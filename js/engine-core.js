/* 恶魔轮盘 · 权威游戏引擎核心（浏览器 / Node 共用）
   所有状态变化通过 act() 进入，返回事件数组；客户端只按事件播放动画。 */
(function (root) {
  const BR = root.BR || (root.BR = {});
  if (typeof module !== 'undefined' && !BR.ITEMS) require('./items.js');

  const MAX_ITEMS = 8, MAX_SHELLS = 8;
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  BR.MAX_ITEMS = MAX_ITEMS;
  BR.ri = ri;

  // hp 起始电量；items 每装弹发放道具数；wires 断线机制；loads 固定装弹 [实, 空]
  BR.stagePlan = function (mode, stage) {
    if (mode === 'story') return [
      { hp: 2, items: 0, wires: false, loads: [[1, 2], [3, 2]] },
      { hp: 4, items: 2, wires: false, loads: [[1, 1]] },
      { hp: 6, items: 4, wires: true, loads: [] }
    ][stage - 1];
    if (mode === 'don') return [
      { hp: ri(2, 4), items: ri(1, 3), wires: false, loads: [] },
      { hp: ri(3, 5), items: ri(2, 4), wires: false, loads: [] },
      { hp: 6, items: ri(3, 4), wires: true, loads: [] }
    ][stage - 1];
    return [
      { hp: 3, items: 2, wires: false, loads: [] },
      { hp: 4, items: 3, wires: false, loads: [] },
      { hp: 5, items: 4, wires: false, loads: [] }
    ][stage - 1];
  };

  function randomLoad() {
    const total = ri(2, MAX_SHELLS);
    let live = Math.round(total / 2) + ri(-1, 1);
    live = Math.max(1, Math.min(total - 1, live));
    return [live, total - live];
  }

  class Game {
    constructor(mode, names) {
      this.mode = mode;                       // 'story' | 'don' | 'mp'
      this.seats = names.map((name) => ({
        name, hp: 0, maxHp: 0, items: [], alive: true, connected: true,
        cuffed: false, cuffLock: false, jammed: false, wiresCut: false, money: 0,
        st: { shots: 0, ejected: 0, cigs: 0, beer: 0 }
      }));
      this.stage = 0; this.phase = 'idle'; this.turn = 0; this.dir = 1;
      this.shells = []; this.idx = 0; this.sawed = false; this.spent = [];
      this.known = []; this.loadNo = 0; this.loadLive = 0; this.loadBlank = 0;
      this.round = 1; this.doors = 0; this.penalty = 0; this.wins = 0;
      this.result = null; this.ev = [];
    }
    emit(e) { this.ev.push(e); }
    flush() { const e = this.ev; this.ev = []; return e; }
    fail(msg) { this.ev = []; throw new Error(msg); }

    start() { this.startStage(1); return this.flush(); }

    startStage(n) {
      this.stage = n; this.plan = BR.stagePlan(this.mode, n);
      this.loadNo = 0; this.dir = 1; this.phase = 'turn';
      this.seats.forEach((s) => {
        Object.assign(s, { hp: this.plan.hp, maxHp: this.plan.hp, items: [], alive: s.connected,
          cuffed: false, cuffLock: false, jammed: false, wiresCut: false });
      });
      this.emit({ t: 'stage', stage: n, round: this.round, hp: this.plan.hp, wires: this.plan.wires });
      this.newLoad();
      const first = this.mode === 'mp' ? (n - 1) % this.seats.length : 0;
      this.startTurn(first);
    }

    newLoad() {
      const [l, b] = this.plan.loads[this.loadNo] || randomLoad();
      this.loadNo++;
      this.shells = shuffle(Array(l).fill(true).concat(Array(b).fill(false)));
      this.idx = 0; this.sawed = false; this.spent = [];
      this.known = this.seats.map(() => ({}));
      this.loadLive = l; this.loadBlank = b;
      this.seats.forEach((s) => { s.cuffed = false; s.cuffLock = false; });
      this.emit({ t: 'load', live: l, blank: b });
      if (this.plan.items) this.deal(this.plan.items);
    }

    deal(n) {
      let pool = BR.POOLS[this.mode];
      if (this.plan.hp <= 2) pool = pool.filter((k) => k !== 'handsaw');
      const got = this.seats.map((s) => {
        const g = [];
        if (!s.alive) return g;
        for (let i = 0; i < n && s.items.length < MAX_ITEMS; i++) {
          const k = pool[ri(0, pool.length - 1)];
          s.items.push(k); g.push(k);
        }
        return g;
      });
      this.emit({ t: 'deal', items: got });
    }

    nextSeat(s) {
      const n = this.seats.length;
      for (let k = 1; k <= n; k++) {
        const i = ((s + this.dir * k) % n + n) % n;
        if (this.seats[i].alive) return i;
      }
      return s;
    }

    startTurn(s) {
      if (!this.seats[s].alive) return this.passTurn(s);
      if (this.skip(s)) return this.passTurn(s);
      this.setTurn(s);
    }

    passTurn(cur) {
      let s = this.nextSeat(cur);
      for (let guard = 0; guard < this.seats.length * 2 && this.skip(s); guard++) s = this.nextSeat(s);
      this.setTurn(s);
    }

    skip(s) {
      const p = this.seats[s];
      if (p.cuffed) { p.cuffed = false; p.cuffLock = true; this.emit({ t: 'skip', seat: s, why: 'cuffs' }); return true; }
      if (p.jammed) { p.jammed = false; this.emit({ t: 'skip', seat: s, why: 'jam' }); return true; }
      return false;
    }

    setTurn(s) {
      this.turn = s;
      this.seats[s].cuffLock = false;
      this.emit({ t: 'turn', seat: s });
    }
  }

  BR.Game = Game;
  BR.shuffle = shuffle;
  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
