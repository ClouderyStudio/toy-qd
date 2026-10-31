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
      const p = panel(`
        <div class="ov-card">
          <h2>多人联机</h2>
          <p class="ov-sub">2 ~ 4 人对战</p>
          <input id="l-name" maxlength="6" placeholder="你的名字" value="${esc((BR.toy.profile || {}).nickname || '')}">
          <div class="ov-row">
            <button id="l-create" class="pix-btn">创建房间</button>
          </div>
          <div class="ov-row">
            <input id="l-code" maxlength="6" placeholder="房间号（6 位）" class="ov-code">
            <button id="l-join" class="pix-btn">加入房间</button>
          </div>
          <div id="l-room" style="display:none">
            <p>房间号：<b id="l-code-show"></b></p>
            <p>玩家：<span id="l-players"></span></p>
            <button id="l-start" class="pix-btn" style="display:none">开始游戏</button>
          </div>
          <p class="ov-msg" id="l-msg"></p>
          <button id="l-back" class="pix-btn ghost">返回</button>
        </div>`);
      const msg = p.querySelector('#l-msg');
      let roomCode = '', you = 0, host = false;

      p.querySelector('#l-back').onclick = () => { BR.net.close(); BR.overlay.hide(); };
      p.querySelector('#l-create').onclick = async () => {
        const name = p.querySelector('#l-name').value.trim();
        if (!name) return showMsg('请输入名字');
        const ck = await BR.toy.checkName(name);
        if (!ck.ok) return showMsg(ck.msg);
        try {
          await BR.net.connect();
          BR.net.onRoom = (r) => {
            roomCode = r.code; you = r.you; host = r.you === 0;
            p.querySelector('#l-code-show').textContent = roomCode;
            p.querySelector('#l-players').textContent = r.players.join('、');
            p.querySelector('#l-room').style.display = 'block';
            p.querySelector('#l-start').style.display = host && r.players.length >= 2 ? 'inline-block' : 'none';
          };
          BR.net.onStart = (s) => { BR.overlay.hide(); BR.go('table', { net: true, you: s.you, view: s.view }); };
          BR.net.onError = showMsg;
          BR.net.onClosed = (why) => showMsg(why || '连接已断开');
          BR.net.send({ type: 'create', name });
        } catch (e) { showMsg(e.message); }
      };
      p.querySelector('#l-join').onclick = async () => {
        const name = p.querySelector('#l-name').value.trim();
        const code = p.querySelector('#l-code').value.trim().toUpperCase();
        if (!name || !code) return showMsg('请输入名字和房间号');
        if (!/^[A-Z0-9]{6}$/.test(code)) return showMsg('房间号为 6 位字母数字');
        const ck = await BR.toy.checkName(name);
        if (!ck.ok) return showMsg(ck.msg);
        try {
          await BR.net.connect();
          BR.net.onRoom = (r) => {
            roomCode = r.code; you = r.you; host = false;
            p.querySelector('#l-code-show').textContent = roomCode;
            p.querySelector('#l-players').textContent = r.players.join('、');
            p.querySelector('#l-room').style.display = 'block';
            p.querySelector('#l-start').style.display = 'none';
          };
          BR.net.onStart = (s) => { BR.overlay.hide(); BR.go('table', { net: true, you: s.you, view: s.view }); };
          BR.net.onError = showMsg;
          BR.net.onClosed = (why) => showMsg(why || '连接已断开');
          BR.net.send({ type: 'join', code, name });
        } catch (e) { showMsg(e.message); }
      };
      p.querySelector('#l-start').onclick = () => BR.net.send({ type: 'start' });

      function showMsg(m) { msg.textContent = m; }
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
      p.querySelectorAll('#r-tabs button').forEach((b) => b.onclick = () => { cur = +b.dataset.b; drawTabs(); load(); });
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
