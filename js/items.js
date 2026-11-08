/* 道具定义与道具池（浏览器 / Node 共用） */
(function (root) {
  const BR = root.BR || (root.BR = {});

  BR.ITEMS = {
    magnifier:   { name: '放大镜',     en: 'MAGNIFYING GLASS', desc: '查看枪膛里当前这发子弹。' },
    cigarette:   { name: '香烟',       en: 'CIGARETTES',       desc: '回复 1 点电量。断线后无效。' },
    beer:        { name: '啤酒',       en: 'BEER',             desc: '拉动枪栓，退出当前这发子弹。' },
    handsaw:     { name: '手锯',       en: 'HAND SAW',         desc: '锯短枪管，下一枪伤害翻倍。' },
    handcuffs:   { name: '手铐',       en: 'HANDCUFFS',        desc: '铐住对手，使其跳过下一回合。' },
    adrenaline:  { name: '肾上腺素',   en: 'ADRENALINE',       desc: '偷取对手一件道具并立即使用。' },
    burnerphone: { name: '一次性手机', en: 'BURNER PHONE',     desc: '神秘来电，告诉你后面某一发的类型。' },
    inverter:    { name: '逆转器',     en: 'INVERTER',         desc: '翻转当前子弹：实弹变空弹，空弹变实弹。' },
    medicine:    { name: '过期药',     en: 'EXPIRED MEDICINE', desc: '50% 回复 2 点电量，否则失去 1 点。' },
    jammer:      { name: '干扰器',     en: 'JAMMER',           desc: '指定一名玩家，跳过其下一回合。', needsTarget: true },
    remote:      { name: '遥控器',     en: 'REMOTE',           desc: '反转出手顺序。' },
    // 彩蛋道具：不进道具池，只在发道具时低概率掉落（见 engine-core 的 deal）
    godsign:     { name: '上帝签名',   en: "GOD'S SIGNATURE",  desc: '一份署名为 GOD 的免责声明。没有任何用处，但值得炫耀。' }
  };

  const BASE = ['magnifier', 'cigarette', 'beer', 'handsaw', 'handcuffs'];
  const EXTRA = ['adrenaline', 'burnerphone', 'inverter', 'medicine'];
  BR.POOLS = {
    story: BASE,
    don: BASE.concat(EXTRA),
    mp: ['magnifier', 'cigarette', 'beer', 'handsaw', 'jammer', 'remote'].concat(EXTRA)
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BR;
})(typeof window !== 'undefined' ? window : global);
