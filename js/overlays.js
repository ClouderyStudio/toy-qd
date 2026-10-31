/* DOM 浮层：免责书签名、联机大厅、排行榜、规则。在 canvas 之上 */
(function () {
  const BR = window.BR;
  let box = null;

  function panel(html) {
    if (!box) {
      box = document.createElement('div');
      box.id = 'overlay';
      document.body.appendChild(box);
    }
    box.innerHTML = html;
    box.style.display = 'flex';
    return box;
  }

  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  BR.overlay = {
    hide() { if (box) box.style.display = 'none'; },

    waiver(def, onOk) {
      const p = panel(`
        <div class="ov-card">
          <h2>GENERAL RELEASE OF LIABILITY</h2>
          <p class="ov-sub">通用免责声明</p>
          <p>本人已知晓本活动存在人身伤害乃至死亡的风险，<br>自愿放弃对主办方追究任何责任的权利。</p>
          <p class="ov-warn">姓名最多 6 个字符，禁用 DEALER / GOD。</p>
          <input id="w-name" maxlength="6" value="${esc(def)}" placeholder="你的名字">
          <div class="ov-actions">
            <button id="w-ok" class="pix-btn">签 字</button>
            <button id="w-no" class="pix-btn ghost">算了</button>
          </div>
        </div>`);
      const input = p.querySelector('#w-name');
      setTimeout(() => input.focus(), 50);
      const submit = () => {
        let n = input.value.trim().slice(0, 6);
        if (!n || /^(DEALER|GOD)$/i.test(n)) { input.value = ''; return; }
        BR.overlay.hide(); onOk(n);
      };
      p.querySelector('#w-ok').onclick = submit;
      p.querySelector('#w-no').onclick = () => { BR.overlay.hide(); BR.go('menu'); };
      input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    },

    lobby() {
      const ident = BR.net.identity() || {};
      const st = {
        name: (BR.toy.profile || {}).nickname || ident.nickname || '',
        openId: (BR.toy.profile || {}).openId || null,
        rooms: [], inRoom: false, code: '', you: 0, host: false, queued: false, online: true, timer: null, leaving: false
      };

      const p = panel(`
        <div class="ov-card wide">
          <h2>多人联机</h2>
          <p class="ov-sub">2 ~ 4 人对战</p>
          <div id="lb-ident">
            <div class="ov-row">
              <input id="lb-name" maxlength="6" placeholder="你的名字" value="${esc(st.name)}">
              <button id="lb-enter" class="pix-btn">进入联机</button>
            </div>
          </div>
          <div id="lb-main" style="display:none">
            <div class="ov-row">
              <button id="lb-match" class="pix-btn">快速匹配</button>
              <button id="lb-create" class="pix-btn ghost">创建房间</button>
              <button id="lb-refresh" class="pix-btn ghost">刷新</button>
            </div>
            <div id="lb-list-wrap"><div id="lb-rooms"></div></div>
            <div class="ov-row">
              <input id="lb-code" maxlength="6" placeholder="房间号（6 位）" class="ov-code">
              <button id="lb-join" class="pix-btn">加入房间</button>
            </div>
            <div id="lb-room" style="display:none">
              <p>房间号：<b id="lb-room-code"></b></p>
              <p>玩家：<span id="lb-room-players"></span></p>
              <button id="lb-start" class="pix-btn" style="display:none">开始游戏</button>
            </div>
          </div>
          <p class="ov-msg" id="lb-msg"></p>
          <button id="lb-back" class="pix-btn ghost">返回</button>
        </div>`);

      const el = (id) => p.querySelector('#' + id);
      const msg = el('lb-msg');
      const show = (m) => { msg.textContent = m; };

      function renderRooms() {
        const box = el('lb-rooms');
        if (!st.rooms.length) {
          box.innerHTML = `<p class="ov-empty">${st.online ? '还没有人在等人，创建一间吧' : '大厅不可用，可直接用房间号开房'}</p>`;
          return;
        }
        box.innerHTML = st.rooms.map((r) => `
          <button class="ov-room" data-code="${esc(r.code)}">
            <span class="ov-room-code">${esc(r.code)}</span>
            <span class="ov-room-names">${esc((r.players || []).join('、'))}</span>
            <span class="ov-room-count">${r.count || (r.players || []).length}/${r.maxPlayers || 4}</span>
          </button>`).join('');
        box.querySelectorAll('button[data-code]').forEach((b) => {
          b.onclick = () => doJoin(b.dataset.code);
        });
      }

      function renderRoom(r) {
        st.inRoom = true;
        st.code = r.code; st.you = r.you; st.host = r.you === 0;
        el('lb-room').style.display = 'block';
        el('lb-list-wrap').style.display = 'none';
        el('lb-match').style.display = 'none';
        el('lb-create').style.display = 'none';
        el('lb-room-code').textContent = r.code;
        el('lb-room-players').innerHTML = (r.players || []).map((n, i) =>
          esc(n) + (r.offline && r.offline[i] ? ' <span class="ov-off">掉线</span>' : '')).join('、');
        el('lb-start').style.display = (st.host && (r.players || []).length >= 2) ? 'inline-block' : 'none';
        show(st.host ? '把房间号发给朋友，或等待匹配' : '等房主开始');
      }

      function startRefresh() {
        if (st.timer) return;
        st.timer = setInterval(() => { if (!st.inRoom) BR.net.lobby(); }, 4000);
      }

      function stopRefresh() {
        if (st.timer) { clearInterval(st.timer); st.timer = null; }
      }

      // ── 回调：大厅与房间都由服务端推送 ──
      BR.net.onRooms = (rooms, online) => {
        st.rooms = rooms; st.online = online !== false;
        if (!st.inRoom) renderRooms();
      };
      BR.net.onRoom = (r) => { st.queued = false; renderRoom(r); };
      BR.net.onMatch = (m) => {
        if (m.status === 'queued') { st.queued = true; show(`正在匹配… 队列第 ${m.position} 位`); return; }
        if (m.status === 'matched') { st.queued = false; show('匹配成功，正在进入房间…'); return; }
        if (m.status === 'timeout') { st.queued = false; show('暂时没匹配到人，可以再试或创建房间'); return; }
        if (m.status === 'unavailable' || m.status === 'error') { st.queued = false; show(m.message || '匹配不可用'); return; }
        if (m.status === 'cancelled') { st.queued = false; show('已取消匹配'); }
      };
      BR.net.onWaitingHost = (w) => {
        st.inRoom = true;
        el('lb-room').style.display = 'block';
        el('lb-list-wrap').style.display = 'none';
        el('lb-room-code').textContent = w.code;
        el('lb-room-players').textContent = (w.players || []).join('、');
        show('正在等房主进入房间…');
      };
      BR.net.onNotice = (t) => show(t);
      BR.net.onError = (t) => { st.queued = false; show(t); };
      BR.net.onClosed = (why) => {
        if (st.leaving) return;
        show(why || '连接已断开');
        noteOffline();
      };
      BR.net.onStatus = (s, n) => {
        if (s === 'reconnecting') show(`连接中断，正在重连（${n}）…`);
        else if (s === 'online') { if (msg.textContent.indexOf('重连') >= 0) show('已重连'); }
      };
      BR.net.onStart = (s) => {
        stopRefresh();
        BR.overlay.hide();
        BR.go('table', { net: true, you: s.you, view: s.view, turnLeft: s.turnLeft });
      };
      // 重连回到对局：大厅这边只处理「不在对局场景」的情况（对局中由 scene-table 接管）
      BR.net.onResume = (view, you, turnLeft) => {
        if (!view) return;
        stopRefresh();
        BR.overlay.hide();
        BR.go('table', { net: true, you, view, resume: true, turnLeft });
      };

      function noteOffline() {
        stopRefresh();
        st.inRoom = false; st.queued = false;
        el('lb-start').style.display = 'none';
        el('lb-room').style.display = 'none';
        el('lb-list-wrap').style.display = 'block';
      }

      // ── 动作 ──
      el('lb-enter').onclick = async () => {
        const name = el('lb-name').value.trim().slice(0, 6);
        if (!name) return show('请输入名字');
        if (/^(DEALER|GOD)$/i.test(name)) return show('这个名字不能用');
        const ck = await BR.toy.checkName(name);
        if (!ck.ok) return show(ck.msg);
        el('lb-enter').disabled = true;
        show('正在连接…');
        try {
          await BR.net.connect(name, st.openId);
          el('lb-ident').style.display = 'none';
          el('lb-main').style.display = 'block';
          show('');
          BR.net.lobby();
          startRefresh();
        } catch (e) {
          show(e.message || '连接失败');
        } finally {
          el('lb-enter').disabled = false;
        }
      };

      el('lb-create').onclick = () => { show('正在创建…'); BR.net.create(); };
      el('lb-refresh').onclick = () => { BR.net.lobby(); };
      el('lb-match').onclick = () => {
        if (st.queued) { BR.net.cancelMatch(); return; }
        show('正在匹配…');
        BR.net.match();
      };
      el('lb-join').onclick = () => doJoin(el('lb-code').value.trim().toUpperCase());
      el('lb-start').onclick = () => { show('开始！'); BR.net.start(); };

      function doJoin(code) {
        if (!code) return show('请输入房间号');
        if (!/^[A-Z0-9]{6}$/.test(code)) return show('房间号为 6 位字母数字');
        show('正在加入 ' + code + '…');
        BR.net.join(code);
      }

      el('lb-back').onclick = () => {
        st.leaving = true;
        stopRefresh();
        BR.net.reset();
        BR.net.close();
        BR.overlay.hide();
      };
    },

    async rank() {
      const p = panel(`<div class="ov-card wide"><h2>排行榜</h2><div id="r-tabs"></div><div id="r-body"></div><button id="r-back" class="pix-btn ghost">返回</button></div>`);
      p.querySelector('#r-back').onclick = () => BR.overlay.hide();
      const tabs = [{ b: 1, n: '故事奖金' }, { b: 2, n: 'DoN 奖金' }, { b: 3, n: '多人胜场' }];
      let cur = 1;
      const drawTabs = () => p.querySelector('#r-tabs').innerHTML = tabs.map((t) =>
        `<button class="pix-btn tab ${t.b === cur ? 'active' : ''}" data-b="${t.b}">${t.n}</button>`).join('');
      const body = p.querySelector('#r-body');
      const load = async () => {
        body.innerHTML = '加载中…';
        const r = await BR.toy.rank(cur, 'all');
        if (!r) { body.innerHTML = '排行榜不可用（需要在 B站 Toy 内打开）'; return; }
        body.innerHTML = (r.mine && r.mine.ranked ?
          `<p class="ov-mine">我的名次：第 ${r.mine.rank} 名  分数：${r.mine.score}</p>` : '') +
          '<table>' + r.list.map((x) =>
            `<tr><td>${x.rank}</td><td>${esc(x.nickname)}</td><td>${x.score}</td></tr>`).join('') + '</table>';
      };
      drawTabs(); load();
      // 页签会被 drawTabs() 重绘，绑定必须挂在容器上做事件委托，
      // 否则点过一次之后新的按钮全是死元素（点 DoN 后另外两个点不动）。
      p.querySelector('#r-tabs').onclick = (e) => {
        const b = e.target.closest('button[data-b]');
        if (!b) return;
        cur = +b.dataset.b;
        drawTabs(); load();
      };
    },

    // 开发者面板（入口：主菜单底部版权文字连点 5 次，不对普通玩家暴露）
    dev() {
      try { sessionStorage.setItem('br_dev', '1'); } catch (e) { /* 忽略 */ }
      const p = panel(`<div class="ov-card wide"><h2>开发者面板</h2>
        <p class="ov-sub">本会话内对局桌面右下角会出现 DEV 按钮。</p>
        <h3 style="margin:8px 0 4px">存档（金钱 / 胜场基准值）</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <label>故事奖金 <input id="dv-story" size="9"></label>
          <label>DoN 奖金 <input id="dv-don" size="9"></label>
          <label>多人胜场 <input id="dv-mp" size="6"></label>
        </div>
        <div class="ov-actions"><button id="dv-save" class="pix-btn">保存存档</button></div>
        <h3 style="margin:8px 0 4px">排行榜测试提交（正式链接内才真正生效）</h3>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select id="dv-board"><option value="1">故事奖金</option><option value="2">DoN 奖金</option><option value="3">多人胜场</option></select>
          <input id="dv-score" size="9" placeholder="分数">
          <button id="dv-submit" class="pix-btn">提交</button>
        </div>
        <p id="dv-result" class="ov-sub" style="min-height:14px"></p>
        <button id="dv-back" class="pix-btn ghost">返回</button>
      </div>`);
      const T = BR.toy;
      p.querySelector('#dv-story').value = T.save.bestStory;
      p.querySelector('#dv-don').value = T.save.bestDon;
      p.querySelector('#dv-mp').value = T.save.mpWins;
      p.querySelector('#dv-save').onclick = async () => {
        const s = p.querySelector('#dv-story').value, d = p.querySelector('#dv-don').value, m = p.querySelector('#dv-mp').value;
        await T.set('bestStory', s); await T.set('bestDon', d); await T.set('mpWins', m);
        p.querySelector('#dv-result').textContent = '存档已保存（云存储同步异步进行）';
      };
      p.querySelector('#dv-submit').onclick = async () => {
        const board = +p.querySelector('#dv-board').value;
        const score = Math.round(+p.querySelector('#dv-score').value || 0);
        p.querySelector('#dv-result').textContent = '提交中…';
        const r = await T.submit(board, score);
        p.querySelector('#dv-result').textContent = r.ok
          ? `board ${board} ← ${score} 提交成功`
          : `提交失败：${r.reason}`;
      };
      p.querySelector('#dv-back').onclick = () => BR.overlay.hide();
    },

    // 对局内开发者快捷操作（DEV 按钮；联机模式每条请求带密码，服务端校验）
    devGame() {
      const S = BR.scenes.table;
      let saved = '';
      try { saved = sessionStorage.getItem('br_dev_pwd') || ''; } catch (e) { /* 忽略 */ }
      const p = panel(`<div class="ov-card"><h2>DEV · 对局操作</h2>
        <div style="text-align:center"><input id="dg-pwd" size="12" placeholder="调试密码" value="${esc(saved)}"></div>
        <div class="ov-actions">
          <button id="dg-end" class="pix-btn">一键随机结束</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;justify-content:center">
          <input id="dg-money" size="9" placeholder="金额（可负）">
          <button id="dg-add" class="pix-btn">加钱</button>
        </div>
        <p class="ov-sub" id="dg-note"></p>
        <button id="dg-back" class="pix-btn ghost">关闭</button>
      </div>`);
      const pwd = () => {
        const v = p.querySelector('#dg-pwd').value;
        try { sessionStorage.setItem('br_dev_pwd', v); } catch (e) { /* 忽略 */ }
        return v;
      };
      p.querySelector('#dg-end').onclick = () => { S.devEnd(pwd()); BR.overlay.hide(); };
      p.querySelector('#dg-add').onclick = () => {
        const n = Math.round(+p.querySelector('#dg-money').value || 0);
        S.devMoney(n, pwd());
        p.querySelector('#dg-note').textContent = `已请求 ${n >= 0 ? '+' : ''}${n}（密码不对会被服务端拒绝）`;
      };
      p.querySelector('#dg-back').onclick = () => BR.overlay.hide();
    },

    rules() {
      const p = panel(`<div class="ov-card wide"><h2>规则</h2>
        <div class="ov-rules">
          <p>· 轮流操作霰弹枪：可以射向自己（空弹可继续行动）或对手。</p>
          <p>· 每发子弹可能是实弹或空弹，装弹时会向所有人展示。</p>
          <p>· 倒下后若除颤器电线未断，可被救回；电线断了再挨一枪就是死。</p>
          <p>· 最多持有 8 个道具；每装弹发一次道具。</p>
          <p>· 故事模式三关全胜，浴室会出现药丸，进入 DOUBLE OR NOTHING。</p>
          <p>· 多人模式可射向任意玩家，每关胜者得一箱钱，三关后钱多者胜。</p>
        </div>
        <button id="u-back" class="pix-btn ghost">返回</button></div>`);
      p.querySelector('#u-back').onclick = () => BR.overlay.hide();
    }
  };
})();
