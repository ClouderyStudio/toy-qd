/* 事件播放器：按顺序播放引擎事件的动画与字幕，播完后同步为最新视图 */
(function () {
  const BR = window.BR;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  class Director {
    constructor(view, me) {
      this.v = clone(view); this.me = me;
      this.q = []; this.wait = 0; this.latest = null;
      this.gun = 'table'; this.aim = -1; this.reveal = null;
      this.hit = {}; this.sub = ''; this.subT = 0; this.pot = 0; this.result = null;
    }
    push(events, view) { this.q.push(...events); this.latest = view; }
    idle() { return !this.q.length && this.wait <= 0; }
    say(s, t) { this.sub = s; this.subT = t || 2; }
    name(i) {
      if (i === this.me) return '你';
      return this.v.mode === 'mp' ? this.v.seats[i].name : '庄家';
    }
    update(dt) {
      this.subT -= dt;
      Object.keys(this.hit).forEach((k) => { this.hit[k] -= dt; });
      if (this.wait > 0) { this.wait -= dt; return; }
      if (this.q.length) {
        this.gun = 'table'; this.aim = -1;
        const e = this.q.shift();
        const h = H[e.t];
        this.wait = h ? (h.call(this, e) || 0) : 0;
        return;
      }
      if (this.latest) { this.v = clone(this.latest); this.latest = null; this.reveal = null; }
      // 队列跑空即把枪收回桌面。朝自己开空弹会保留回合，引擎不会再发 turn 事件，
      // 若停在这里，枪会一直画成「枪口对着自己」，而绘制层只在 gun==='table' 时
      // 注册「拿起霰弹枪」热区 —— 玩家就再也点不动，界面却仍旧显示「你的回合」。
      this.gun = 'table';
      this.aim = -1;
    }
    removeItem(seat, key) {
      const it = this.v.seats[seat].items, j = it.indexOf(key);
      if (j >= 0) it.splice(j, 1);
    }
  }

  const ITEM_TEXT = {
    magnifier: (d, e) => e.secret === undefined ? `${d.name(e.seat)}看了看枪膛……` : `当前这发是 ${e.secret ? '实弹' : '空弹'}。`,
    cigarette: (d, e) => `${d.name(e.seat)}抽了根烟。`,
    beer: (d, e) => `${d.name(e.seat)}喝了啤酒，退出一发${e.live ? '实弹' : '空弹'}。`,
    handsaw: (d, e) => `${d.name(e.seat)}锯短了枪管。下一枪伤害翻倍。`,
    handcuffs: (d, e) => `${d.name(e.seat)}铐住了${d.name(e.target)}。`,
    burnerphone: (d, e) => {
      if (e.secret === undefined) return `${d.name(e.seat)}接了个电话……`;
      if (!e.secret) return '电话那头：真遗憾……';
      return `电话那头：第 ${e.secret.off + 1} 发……${e.secret.live ? '实弹' : '空弹'}。`;
    },
    inverter: (d, e) => `${d.name(e.seat)}按下了逆转器。`,
    medicine: (d, e) => `${d.name(e.seat)}吞下过期药……${e.good ? '感觉好多了。' : '不太对劲。'}`,
    jammer: (d, e) => `${d.name(e.seat)}干扰了${d.name(e.target)}。`,
    remote: (d, e) => `${d.name(e.seat)}按下遥控器，出手顺序反转。`
  };

  // 每个处理函数返回本事件占用的秒数
  const H = {
    stage(e) {
      this.v.stage = e.stage; this.v.wires = e.wires;
      this.v.seats.forEach((s) => { s.hp = s.maxHp = e.hp; s.items = []; s.wiresCut = false; s.alive = s.connected; });
      this.say(e.round > 1 ? `第 ${e.round} 轮 · 第 ${e.stage} 关` : `第 ${e.stage} 关`, 2);
      BR.sfx.heart();
      return 1.6;
    },
    load(e) {
      const arr = Array(e.live).fill(true).concat(Array(e.blank).fill(false));
      this.reveal = arr;
      this.v.left = e.live + e.blank; this.v.loadLive = e.live; this.v.loadBlank = e.blank;
      this.v.spent = []; this.v.known = {}; this.v.sawed = false;
      this.v.seats.forEach((s) => { s.cuffed = false; s.cuffLock = false; });
      this.say(`${e.live} 发实弹，${e.blank} 发空弹。`, 2.6);
      BR.sfx.load();
      setTimeout(() => { this.reveal = null; BR.sfx.rack(); }, 2400);
      return 2.8;
    },
    deal(e) {
      let any = false;
      e.items.forEach((list, i) => { list.forEach((k) => { this.v.seats[i].items.push(k); any = true; }); });
      if (!any) return 0;
      BR.sfx.item();
      this.say('道具已发放。', 1.2);
      return 1.0;
    },
    turn(e) {
      this.v.turn = e.seat;
      this.v.seats[e.seat].cuffLock = false;
      if (this.v.mode === 'mp') this.say(e.seat === this.me ? '轮到你了。' : `轮到 ${this.name(e.seat)}。`, 1.2);
      return 0.3;
    },
    skip(e) {
      const s = this.v.seats[e.seat];
      if (e.why === 'cuffs') { s.cuffed = false; s.cuffLock = true; } else s.jammed = false;
      this.say(`${this.name(e.seat)}${e.why === 'cuffs' ? '被铐着' : '被干扰'}，跳过回合。`, 1.6);
      return 1.4;
    },
    // 开枪分两段：先举枪瞄准，再插入 fire 事件结算
    shoot(e) {
      this.gun = e.target === this.me ? 'self' : 'far';
      this.aim = e.target;
      const who = e.seat === e.target ? '自己' : this.name(e.target);
      this.say(`${this.name(e.seat)}把枪对准了${who}……`, 1.2);
      this.q.unshift(Object.assign({}, e, { t: 'fire' }));
      return 1.1;
    },
    fire(e) {
      this.gun = e.target === this.me ? 'self' : 'far';
      this.aim = e.target;
      if (e.live) {
        BR.sfx.shot();
        BR.fx.shake = e.dmg > 1 ? 1.4 : 1; BR.fx.flash = 1;
        if (e.target === this.me) BR.fx.red = 1;
        this.hit[e.target] = 0.6;
        this.say(e.dmg > 1 ? '轰！（双倍伤害）' : '轰！', 1.4);
      } else {
        BR.sfx.click();
        this.say('咔哒。空弹。', 1.4);
      }
      this.v.left--; this.v.spent.push(e.live); this.v.sawed = false;
      const k = {};
      Object.keys(this.v.known).forEach((o) => { if (+o > 0) k[+o - 1] = this.v.known[o]; });
      this.v.known = k;
      return 1.2;
    },
    hp(e) {
      const s = this.v.seats[e.seat];
      if (e.hp > s.hp) BR.sfx.heal(); else BR.sfx.zap();
      s.hp = e.hp;
      return 0.5;
    },
    wires(e) {
      this.v.seats[e.seat].wiresCut = true;
      BR.sfx.zap();
      this.say(`${this.name(e.seat)}的除颤器电线被切断了。再挨一枪就是死。`, 2.4);
      return 1.8;
    },
    down(e) {
      const s = this.v.seats[e.seat];
      s.alive = false; s.items = []; s.hp = 0;
      return 0.6;
    },
    noheal(e) { this.say('电线已断，无法回复。', 1.4); return 0.8; },
    empty() { this.say('枪膛空了。重新装填。', 1.4); BR.sfx.rack(); return 1.0; },
    steal(e) {
      this.removeItem(e.seat, 'adrenaline');
      this.removeItem(e.from, e.item);
      this.stolen = true;
      BR.sfx.item();
      this.say(`${this.name(e.seat)}注射肾上腺素，抢走了${this.name(e.from)}的${BR.ITEMS[e.item].name}。`, 1.8);
      return 1.4;
    },
    item(e) {
      if (this.stolen) this.stolen = false; else this.removeItem(e.seat, e.item);
      const sfx = { handsaw: 'saw', handcuffs: 'cuff', burnerphone: 'phone', cigarette: 'heal', beer: 'rack' }[e.item];
      (BR.sfx[sfx] || BR.sfx.item)();
      if (e.item === 'magnifier' && e.secret !== undefined) this.v.known[0] = e.secret;
      if (e.item === 'burnerphone' && e.secret) this.v.known[e.secret.off] = e.secret.live;
      if (e.item === 'beer') {
        this.v.left--; this.v.spent.push(e.live);
        const k = {};
        Object.keys(this.v.known).forEach((o) => { if (+o > 0) k[+o - 1] = this.v.known[o]; });
        this.v.known = k;
      }
      if (e.item === 'handsaw') this.v.sawed = true;
      if (e.item === 'inverter' && 0 in this.v.known) this.v.known[0] = !this.v.known[0];
      if (e.item === 'handcuffs') this.v.seats[e.target].cuffed = true;
      if (e.item === 'jammer') this.v.seats[e.target].jammed = true;
      if (e.item === 'remote') this.v.dir = e.dir;
      this.say(ITEM_TEXT[e.item](this, e), 2);
      return 1.4;
    },
    stageEnd(e) {
      this.v.phase = 'stageEnd';
      const w = e.winner;
      this.say(w < 0 ? '没有人活下来。' : (w === this.me ? '你活了下来。' : `${this.name(w)}赢下了这一关。`), 2.4);
      return 2.4;
    },
    revive(e) {
      BR.fx.black = 2.5;
      this.say(`医生把你救了回来。费用 $${e.fine}。`, 3);
      return 3.2;
    },
    donChoice(e) { this.pot = e.pot; this.v.phase = 'donChoice'; return 0.5; },
    over(e) { this.result = e.result; this.v.phase = 'over'; return 1.5; },
    left(e) { this.v.seats[e.seat].connected = false; this.say(`${this.v.seats[e.seat].name} 离开了。`, 1.6); return 0.8; }
  };

  BR.Director = Director;
})();