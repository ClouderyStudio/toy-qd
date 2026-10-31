/* Toy SDK 封装：能力判断、首次手势取用户资料、云存储（本地兜底）、排行榜、输入安全 */
(function () {
  const BR = window.BR;
  const T = () => window.toy;
  const LS = 'br_save';
  const support = {};
  let gestured = false;

  async function has(ability) {
    if (!T() || !T().isSupport) return false;
    if (support[ability] === undefined) {
      try { support[ability] = !!(await T().isSupport(ability)); } catch (e) { support[ability] = false; }
    }
    return support[ability];
  }

  // 307044 限流：指数退避重试
  async function call(fn, tries) {
    for (let i = 0; i < (tries || 3); i++) {
      try { return await fn(); } catch (e) {
        if (String(e && (e.code || e.message)).indexOf('307044') < 0) throw e;
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
      }
    }
    throw new Error('rate limited');
  }

  const save = { donUnlocked: '0', bestStory: '0', bestDon: '0', mpWins: '0' };

  BR.toy = {
    profile: null,
    save,

    async init() {
      try { Object.assign(save, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* 忽略损坏存档 */ }
      if (await has('getCloudStorage')) {
        try { Object.assign(save, await call(() => T().getCloudStorage(Object.keys(save)))); } catch (e) { /* 用本地 */ }
      }
    },

    async set(k, val) {
      save[k] = String(val);
      try { localStorage.setItem(LS, JSON.stringify(save)); } catch (e) { /* 隐私模式 */ }
      if (await has('setCloudStorage')) {
        try { await call(() => T().setCloudStorage({ [k]: save[k] })); } catch (e) { /* 下次再同步 */ }
      }
    },

    // getUserProfile 与 setContainerMode 需要用户手势，放在第一次点击时
    async firstGesture() {
      if (gestured) return;
      gestured = true;
      if (await has('setContainerMode')) {
        try { await T().setContainerMode({ orientation: 'landscape', immersive: true }); } catch (e) { /* App 外不支持 */ }
      }
      if (await has('getUserProfile')) {
        try {
          const p = await T().getUserProfile();
          // toyOpenId 是「仅当前 Toy 内稳定」的假名标识，只用来让服务端认出同一个玩家（重连、战绩归属）。
          // 只放内存：不写 localStorage、不进日志、不上报埋点 —— 平台明确要求它不能用于跨 Toy 识别。
          BR.toy.profile = { nickname: p.nickname, avatar: p.avatar, openId: p.toyOpenId || null };
        } catch (e) { /* 用户拒绝或未登录 */ }
      }
    },

    async submit(board, score) {
      if (!(await has('submitScore'))) return null;
      score = Math.max(-16777216, Math.min(16777215, Math.round(score)));
      try { return await call(() => T().submitScore({ board, score })); } catch (e) { return null; }
    },

    async rank(board, period) {
      if (!(await has('getRankList'))) return null;
      try {
        const list = await call(() => T().getRankList({ board, period, limit: 50 }));
        const mine = (await has('getMyRank')) ? await call(() => T().getMyRank({ board, period })).catch(() => null) : null;
        return { list, mine };
      } catch (e) { return null; }
    },

    // 返回 { ok, msg }。平台外没有检测能力时放行；平台内 unavailable 不算通过
    async checkName(text) {
      if (!(await has('checkInputSafety'))) return { ok: true };
      try {
        const r = await T().checkInputSafety({ text, scene: 'nickname' });
        if (r.passed) return { ok: true };
        return { ok: false, msg: r.status === 'rejected' ? '这个名字不能用，换一个试试' : '暂时没法验证名字，稍后再试' };
      } catch (e) { return { ok: false, msg: '暂时没法验证名字，稍后再试' }; }
    }
  };
})();
