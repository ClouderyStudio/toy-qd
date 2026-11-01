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

  const save = { donUnlocked: '0', bestStory: '0', bestDon: '0', mpWins: '0', vol: '100' };

  BR.toy = {
    profile: null,
    save,

    async init() {
      try { Object.assign(save, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* 忽略损坏存档 */ }
      if (await has('getCloudStorage')) {
        try { Object.assign(save, await call(() => T().getCloudStorage(Object.keys(save)))); } catch (e) { /* 用本地 */ }
      }
      // 云存档里的音量偏好（含云同步覆盖本地后的最终值）
      BR.sfx && BR.sfx.applySaved && BR.sfx.applySaved();
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

    // 返回 { ok, reason }。提交结果要可见——预览环境不支持 submitScore，
    // 静默失败会让玩家以为「打了榜但榜上没数据」。
    async submit(board, score) {
      if (!(await has('submitScore'))) return { ok: false, reason: '当前环境不支持排行榜（正式链接内可用）' };
      score = Math.max(-16777216, Math.min(16777215, Math.round(score)));
      try { await call(() => T().submitScore({ board, score })); return { ok: true }; }
      catch (e) { return { ok: false, reason: '成绩上传失败：' + (e && (e.code || e.message) || '未知错误') }; }
    },

    async rank(board, period) {
      if (!(await has('getRankList'))) return null;
      try {
        const list = await call(() => T().getRankList({ board, period, limit: 50 }));
        const mine = (await has('getMyRank')) ? await call(() => T().getMyRank({ board, period })).catch(() => null) : null;
        return { list, mine };
      } catch (e) { return null; }
    },

    // 返回 { ok, kind, reason }。ok=true 放行；kind: dev（开发者旁路）| followed | unfollow | env | error。
    // 容错策略（已拍板）：一律拦截 —— 检测失败或环境不支持都不放行，宁严勿松。
    async followGate() {
      // 开发者通道已验证密码的会话直接放行，方便自己测试联机
      try { if (sessionStorage.getItem('br_dev_ok') === '1') return { ok: true, kind: 'dev' }; } catch (e) { /* 忽略 */ }
      if (!(await has('getAuthorRelation'))) {
        return { ok: false, kind: 'env', reason: '当前环境无法验证关注状态：请在 B站 App 内打开本页面' };
      }
      try {
        const r = await call(() => T().getAuthorRelation());
        if (r && r.status === 'ok') {
          return (r.data && r.data.isFollowing) ? { ok: true, kind: 'followed' } : { ok: false, kind: 'unfollow' };
        }
        return { ok: false, kind: 'error', reason: '暂时无法确认关注状态，稍后再试' };
      } catch (e) {
        return { ok: false, kind: 'error', reason: '关注状态检测失败：' + ((e && (e.code || e.message)) || '未知错误') };
      }
    },

    // 跳作者主页引导关注（SDK 要求用户手势触发，须在按钮点击里调用）。返回是否成功发起。
    async goFollow() {
      const mid = String((BR.config || {}).followMid || '').trim();
      if (!mid || !T() || !T().navigate) return false;
      try { await T().navigate({ type: 'space', id: mid }); return true; }
      catch (e) { return false; }
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
