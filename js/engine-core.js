/* 恶魔轮盘 · 权威游戏引擎核心（浏览器 / Node 共用）
   所有状态变化通过 act() 进入，返回事件数组；客户端只按事件播放动画。 */
(function (root) {
  const BR = root.BR || (root.BR = {});
  if (typeof module !== 'undefined' && !BR.ITEMS) require('./items.js');

  const MAX_ITEMS = 8, MAX_SHELLS = 8;
  // 彩蛋掉落率：每次发放道具、对每个存活座位判定一次。约 200 次发牌出一次。
  const GOD_SIGN_RATE = 0.005;
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

  /* 一发子弹 = 一个槽位 { live:bool, no:装弹序号 }。
   *
   * 为什么要记装弹序号：逆转器翻转的是「此刻膛口那发」。翻了以后，这一发就不再属于
   * 本次装弹的实/空统计了 —— 拿它去减就会把剩余实弹算成负数（玩家反馈的
   * 「逆转器子弹计数错」）。所以计数只数「本次装弹、没被翻过的槽位」，
   * 而客户端重放事件时会跟着事件里的翻转标记更新同一个 no，两边口径始终一致。 */
  const slot = (live, no) => ({ live: !!live, no: no || 0 });
  BR.slot = slot;

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
      this.known = []; this.loadNo = 0;
      this.round = 1; this.doors = 0; this.penalty = 0; this.wins = 0;
      this.result = null; this.ev = [];
    }
    emit(e) { this.ev.push(e); }
    flush() { const e = this.ev; this.ev = []; return e; }
    fail(msg) { this.ev = []; throw new Error(msg); }

    /* 本次装弹还剩多少实弹 / 空弹：只数「还没打出、且仍是本次装弹」的槽位。
     * 被逆转器翻过的那发 no 已清零，两边都不算 —— 它的最终类型由下一次翻转决定，
     * 替玩家预设成实弹或空弹都会骗人。所以：
     *   loadLive + loadBlank + （被翻过的发数）= 剩余发数
     * 面板照此显示，就不会出现「实 + 空 > 剩余」这种一眼假的数字。 */
    liveBlank() {
      const rest = this.shells.slice(this.idx);
      const no = this.loadNo;
      return {
        live: rest.filter((s) => s.live && s.no === no).length,
        blank: rest.filter((s) => !s.live && s.no === no).length
      };
    }

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
      // 槽位带上「第几次装弹」的记号，逆转器翻转后会把它清掉（见 engine-items 的 inverter）
      const no = this.loadNo;
      this.shells = shuffle(Array(l).fill(true).concat(Array(b).fill(false))).map((live) => slot(live, no));
      this.idx = 0; this.sawed = false; this.spent = [];
      this.known = this.seats.map(() => ({}));
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
      this.godGift(got);
      this.emit({ t: 'deal', items: got });
    }

    // 彩蛋：掏道具时有极小概率摸到「上帝签名」，换掉刚发的某一件。
    // 只影响那一个座位的那一件，不额外多给，因此不改变对局平衡。
    godGift(got) {
      for (let i = 0; i < got.length; i++) {
        if (!got[i].length) continue;
        if (Math.random() >= GOD_SIGN_RATE) continue;
        const j = ri(0, got[i].length - 1);
        const from = this.seats[i].items.lastIndexOf(got[i][j]);
        if (from < 0) continue;
        this.seats[i].items[from] = 'godsign';
        got[i][j] = 'godsign';
        this.emit({ t: 'godsign', seat: i });
      }
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
