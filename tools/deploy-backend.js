#!/usr/bin/env node
/* 一键部署：把当前 git HEAD 的后端代码推到 180.97.215.247 并重启。
 *
 * 为什么不用 rsync 直连：远端是 Rocky Linux + systemd，路径与权限需要对，
 * 且要保证"要么全成功、要么回滚"。这里拆成三步：
 *   1. git archive 出干净的 HEAD 快照（不含 node_modules / .env / data）
 *   2. scp 上传压缩包，远端解包到临时目录
 *   3. 调用远端 deploy-toy-mp.sh（内含预检 / 备份 / 同步 / 重启 / 验证 / 回滚）
 *
 * 跑法（在 toy 仓库根目录）：
 *   node tools/deploy-backend.js            部署
 *   node tools/deploy-backend.js --dry-run  只上传不重启
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST = process.env.DEPLOY_HOST || '180.97.215.247';
const KEY = process.env.DEPLOY_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519_cloudery_cn');
const REMOTE = '/tmp/toy-deploy';
const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

const SSH_OPTS = [
  '-i', KEY, '-p', '22',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=NUL',
  '-o', 'BatchMode=yes'
];

function run(cmd, args, opts) {
  const out = execFileSync(cmd, args, Object.assign({ encoding: 'utf8', stdio: 'pipe' }, opts || {}));
  return String(out || '');
}

function ssh(remoteCmd) {
  return run('ssh', SSH_OPTS.concat([`root@${HOST}`, remoteCmd]));
}

function scp(local, remote) {
  return run('scp', ['-i', KEY, '-P', '22', '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL', local, `root@${HOST}:${remote}`]);
}

function step(msg) { console.log(`\n▶ ${msg}`); }
function ok(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ! ${msg}`); }

(async () => {
  if (!fs.existsSync(KEY)) {
    console.error(`私钥不存在：${KEY}`);
    process.exit(1);
  }

  // ── 1. 打包 ─────────────────────────────────────────────────────
  step('打包当前 HEAD');
  const head = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).trim();
  const dirty = run('git', ['status', '--porcelain'], { cwd: ROOT }).trim();
  if (dirty) warn('工作区有未提交改动，只会部署已提交的内容');
  const zip = path.join(os.tmpdir(), `toy-backend-${head}.zip`);
  run('git', ['archive', '--format=zip', `-o`, zip, 'HEAD'], { cwd: ROOT });
  ok(`HEAD=${head}  包大小=${(fs.statSync(zip).size / 1024).toFixed(1)}KB`);

  // ── 2. 上传 ─────────────────────────────────────────────────────
  step('上传到服务器');
  ssh(`rm -rf ${REMOTE} && mkdir -p ${REMOTE}`);
  scp(zip, `${REMOTE}.zip`);
  ok('上传完成');

  // ── 3. 解包 ─────────────────────────────────────────────────────
  step('远端解包');
  const hasUnzip = ssh('command -v unzip >/dev/null && echo yes || echo no').trim() === 'yes';
  if (hasUnzip) {
    ssh(`cd ${REMOTE} && unzip -q ../${path.basename(REMOTE)}.zip`);
  } else {
    // 没有 unzip 就用 python 兜底，避免为了部署装包
    ssh(`cd ${REMOTE} && python3 -c "import zipfile,sys; zipfile.ZipFile('../${path.basename(REMOTE)}.zip').extractall('.')"`);
  }
  const listed = ssh(`ls ${REMOTE}/backend/*.js 2>/dev/null | wc -l`).trim();
  ok(`解出 ${listed} 个后端 js 文件`);
  if (+listed < 3) {
    console.error('解包结果异常，中止');
    process.exit(1);
  }

  // ── 4. 部署 ─────────────────────────────────────────────────────
  if (DRY) {
    step('--dry-run：停在解包阶段，未重启服务');
    ok(`代码已就位：${REMOTE}/backend`);
    console.log(`\n手动部署：ssh root@${HOST} 'bash ${REMOTE}/backend/deploy/deploy-toy-mp.sh ${REMOTE}/backend'`);
    process.exit(0);
  }

  step('执行远端部署（预检 → 备份 → 同步 → 重启 → 验证）');
  const out = ssh(`bash ${REMOTE}/backend/deploy/deploy-toy-mp.sh ${REMOTE}/backend 2>&1`);
  console.log(out.split('\n').map((l) => '  ' + l).join('\n'));

  if (/\[deploy\]\[ERROR\]/.test(out)) {
    console.error('\n部署失败');
    process.exit(1);
  }
  step('部署完成');
  ssh(`rm -f ${REMOTE}.zip && rm -rf ${REMOTE}`);
  ok('已清理临时包');
})().catch((e) => {
  console.error('\n失败：', e.message);
  if (e.stdout) console.error(String(e.stdout));
  if (e.stderr) console.error(String(e.stderr));
  process.exit(1);
});
