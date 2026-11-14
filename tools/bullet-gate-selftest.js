#!/usr/bin/env node
/* 三连解锁「子弹自动计数」纯逻辑回归：mock Toy SDK 各分支，不需要浏览器。
 * 跑法：node tools/bullet-gate-selftest.js
 * 覆盖：三连齐 / 缺项 / 开发者旁路 / 无 SDK / 接口异常 / 非法 status /
 *       未配置视频 / 完整链接解析 / 已解锁后不再请求 / 余弹计数推算
 */
'use strict';

const path = require('path');

function makeEnv({ devOk, sdk, video } = {}) {
  const store = {};
  global.sessionStorage = {
    getItem: (k) => (devOk ? '1' : (store[k] ?? null)),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; }
  };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.window = { BR: {} };
  delete require.cache[require.resolve('../js/config.js')];
  require('../js/config.js');
  if (video !== undefined) global.window.BR.config.bulletVideo = video;
  if (sdk) global.window.toy = sdk;
  delete require.cache[require.resolve('../js/toy.js')];
  require('../js/toy.js');
  return global.window.BR.toy;
}

function mock({ liked = true, coinCount = 1, favorited = true, boom, badStatus, unsupported } = {}) {
  return {
    isSupport: async (a) => (unsupported ? false : ['getVideoUserActions'].includes(a)),
    getVideoUserActions: async () => {
      if (boom) { const e = new Error('net down'); e.code = 500; throw e; }
      if (badStatus) return { items: [{ bvid: 'BV1nbxx6zETG', status: 'error' }] };
      return { items: [{ aid: 1, bvid: 'BV1nbxx6zETG', status: 'ok', liked, coinCount, favorited }] };
    }
  };
}

// 余弹计数：3 实 2 空，已打出 1 实 1 空 -> 实 2 / 空 1
function ammoText(view) {
  global.window.BR = global.window.BR || {};
  global.document = { createElement: () => ({ getContext: () => ({}) }) };
  for (const f of ['../js/gfx.js', '../js/draw-table.js']) delete require.cache[require.resolve(f)];
  require('../js/gfx.js');
  const rec = [];
  global.window.BR.gfx.rect = () => {};
  global.window.BR.gfx.text = (s) => rec.push(String(s));
  require('../js/draw-table.js');
  global.window.BR.draw.ammo(view);
  return rec.join('|');
}

const cases = [
  ['三连齐：解锁并写入存档', { sdk: mock() }, async (t) => {
    const r = await t.bulletGate();
    return r.ok && r.kind === 'unlocked' && t.save.bulletUnlock === '1';
  }],
  ['已解锁后不再请求平台', { sdk: mock() }, async (t) => {
    await t.bulletGate();
    const calls = [];
    global.window.toy.getVideoUserActions = async (req) => { calls.push(req); return { items: [] }; };
    const r = await t.bulletGate();
    return r.ok && r.kind === 'unlocked' && calls.length === 0;
  }],
  ['缺投币 / 收藏：unfinished 且 missing 精确', { sdk: mock({ coinCount: 0, favorited: false }) }, async (t) => {
    const r = await t.bulletGate();
    return !r.ok && r.kind === 'unfinished' && r.missing.join(',') === 'coin,favorite';
  }],
  ['开发者旁路：直接解锁', { devOk: true, sdk: null }, async (t) => {
    const r = await t.bulletGate();
    return r.ok && r.kind === 'dev';
  }],
  ['无 SDK：拦截（kind=env）', { sdk: null }, async (t) => {
    const r = await t.bulletGate();
    return !r.ok && r.kind === 'env';
  }],
  ['不支持 getVideoUserActions：拦截（kind=env）', { sdk: mock({ unsupported: true }) }, async (t) => {
    const r = await t.bulletGate();
    return !r.ok && r.kind === 'env';
  }],
  ['接口异常：kind=error 且带原因', { sdk: mock({ boom: true }) }, async (t) => {
    const r = await t.bulletGate();
    return !r.ok && r.kind === 'error' && /500/.test(r.reason);
  }],
  ['status 非 ok：kind=error', { sdk: mock({ badStatus: true }) }, async (t) => {
    const r = await t.bulletGate();
    return !r.ok && r.kind === 'error';
  }],
  ['未配置视频：kind=config', { sdk: mock(), video: '' }, async (t) => {
    const r = await t.bulletGate();
    return !r.ok && r.kind === 'config';
  }],
  ['完整链接也能取出 BV 号', { sdk: mock(), video: 'https://www.bilibili.com/video/BV1nbxx6zETG/?vd_source=x' }, async (t) => {
    return t.bulletVideoId() === 'BV1nbxx6zETG';
  }],
  ['无视频配置时 goBulletVideo 返回 false', { sdk: mock(), video: '' }, async (t) => {
    return (await t.goBulletVideo()) === false;
  }],
  ['余弹计数按公开信息推算', {}, async () => {
    global.window = { BR: {} };
    // 视图里的 loadLive / loadBlank 已由 director 对平过，绘制层只照画不做减法
    return ammoText({ left: 3, loadLive: 2, loadBlank: 1 }) === '剩余|3|实|2|空|1';
  }],
  ['余弹计数不会画出负数', {}, async () => {
    global.window = { BR: {} };
    return ammoText({ left: 0, loadLive: -1, loadBlank: undefined }) === '剩余|0|实|0|空|0';
  }]
];

(async () => {
  let pass = 0, fail = 0;
  for (const [name, env, check] of cases) {
    try {
      const t = name.includes('余弹计数') ? null : makeEnv(env);
      const ok = await check(t);
      console.log(`  ${ok ? '✓' : '✗'} ${name}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`  ✗ ${name}  → 抛异常: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${fail ? '有失败项' : '全部通过'}（${pass} 过 / ${fail} 败）`);
  process.exit(fail ? 1 : 0);
})();
