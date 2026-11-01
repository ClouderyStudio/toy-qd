#!/usr/bin/env node
/* followGate 纯逻辑回归：mock Toy SDK 各分支，不需要浏览器。
 * 跑法：node tools/follow-gate-selftest.js
 * 覆盖：开发者旁路 / 无 SDK 环境 / 已关注 / 未关注 / 接口异常 / 非法 status
 */
'use strict';

function makeEnv({ devOk, sdk } = {}) {
  const store = {};
  global.sessionStorage = {
    getItem: (k) => (devOk ? '1' : (store[k] ?? null)),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; }
  };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.window = { BR: {} };
  if (sdk) global.window.toy = sdk;
  delete require.cache[require.resolve('../js/toy.js')];
  require('../js/toy.js');
  return global.window.BR.toy;
}

const cases = [
  ['开发者旁路（br_dev_ok）直接放行', { devOk: true }, (r) => r.ok === true && r.kind === 'dev'],
  ['无 SDK 环境拦截（kind=env）', { sdk: null }, (r) => r.ok === false && r.kind === 'env'],
  ['已关注放行', { sdk: mock({ isFollowing: true }) }, (r) => r.ok === true && r.kind === 'followed'],
  ['未关注拦截（kind=unfollow）', { sdk: mock({ isFollowing: false }) }, (r) => r.ok === false && r.kind === 'unfollow'],
  ['接口异常拦截（kind=error）', { sdk: mock({ boom: true }) }, (r) => r.ok === false && r.kind === 'error'],
  ['status 非 ok 拦截（kind=error）', { sdk: mock({ badStatus: true }) }, (r) => r.ok === false && r.kind === 'error'],
  ['不支持 getAuthorRelation 拦截（kind=env）', { sdk: { isSupport: async () => false } }, (r) => r.ok === false && r.kind === 'env'],
  ['goFollow 无 mid 返回 false', { sdk: mock({ isFollowing: false }) }, null]
];

function mock({ isFollowing, boom, badStatus }) {
  return {
    isSupport: async (a) => ['getAuthorRelation', 'navigate'].includes(a),
    getAuthorRelation: async () => {
      if (boom) throw new Error('net down');
      if (badStatus) return { status: 'error' };
      return { status: 'ok', data: { isFollowing } };
    },
    navigate: async (req) => { if (!req || req.type !== 'space') throw new Error('invalid'); }
  };
}

(async () => {
  let pass = 0, fail = 0;
  for (const [name, env, check] of cases) {
    const t = makeEnv(env);
    try {
      const r = name.includes('goFollow')
        ? { ok: (await t.goFollow()) === false, kind: 'goFollow' }
        : await t.followGate();
      const ok = check ? check(r) : r.ok;
      console.log(`  ${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `  → ${JSON.stringify(r)}`));
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`  ✗ ${name}  → 抛异常: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${fail ? '有失败项' : '全部通过'}（${pass} 过 / ${fail} 败）`);
  process.exit(fail ? 1 : 0);
})();
