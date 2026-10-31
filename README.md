# 恶魔轮盘 · Buckshot Roulette

原作 Mike Klubnika 的同人像素风复刻，基于 Canvas 渲染，支持 B站 Toy SDK 接入与多人联机。

> ⚠️ 非官方同人项目，仅用于学习交流。原作版权归 Mike Klubnika 所有。

## 运行

```bash
cd backend
npm install
node server.js          # 默认 8080 端口，可用 PORT 环境变量修改
```

浏览器打开 `http://localhost:8080/` 即可游玩。后端同一端口同时提供网页静态文件与 WebSocket 联机。

联机的大厅列表与快速匹配依赖 ClouderyApi（`/toy/*`），不配也能玩「报房间号」模式：

```bash
TOY_API_BASE=https://api.cldery.com TOY_SERVER_KEY=<与服务端 Toy:ServerKey 一致> node server.js
```

## 功能

- **故事模式**：三关（2 / 4 / 6 血），第三关有断线机制；输了被医生救回并罚款。
- **Double or Nothing**：通关故事模式后，浴室洗手台出现药丸；三关全胜后可选择带钱离开或奖金翻倍继续。
- **多人联机**：2 ~ 4 人，可射向任意玩家；专属道具干扰器、遥控器。
- **联机大厅**：房间号开房、公开房间列表、一键快速匹配（配对由 ClouderyApi 的等待池完成）。
- **断线重连**：对局中掉线座位保留 60 秒，带令牌回来直接回到原座位并补发当前局面。
- **11 种道具**：放大镜、香烟、啤酒、手锯、手铐、肾上腺素、一次性手机、逆转器、过期药、干扰器、遥控器。
- **Toy SDK 接入**：云存储（本地兜底）、排行榜（故事奖金 / DoN 奖金 / 多人胜场）、横屏沉浸、昵称安全检测；`toyOpenId` 用于联机身份。
- **像素风画面**：320×180 低分辨率最近邻放大，Bayer 抖动背景，WebAudio 合成音效。

## 项目结构

```
index.html            入口页面
css/style.css         像素风样式
js/
  config.js           部署配置（WS 地址）
  items.js            道具定义与道具池
  engine-core.js      引擎核心：关卡、装弹、回合
  engine-act.js       开枪、伤害、视图过滤
  engine-flow.js      关卡结束、复活、DoN、离开
  engine-items.js     道具使用校验与效果
  ai.js               庄家 AI（不偷看子弹）
  gfx.js              渲染底层：缩放、文字、特效
  sprites.js          道具像素图标
  bg.js               场景背景预渲染
  audio.js            WebAudio 合成音效
  draw-dealer.js      庄家、对手、吊灯绘制
  draw-table.js       霰弹枪、子弹、道具格、除颤器
  toy.js              Toy SDK 封装
  net.js              联机客户端
  director.js         事件播放器
  scenes-menu.js      菜单、浴室、夜店、免责书
  scene-table*.js     对局场景
  scenes-end.js       天堂、车内结算、多人排名
  overlays.js         DOM 浮层（大厅、排行榜、规则）
  main.js             主循环与场景切换
backend/
  server.js           HTTP 静态服务 + WebSocket
  rooms.js            房间管理、权威引擎、断线保留与重连
  api.js              ClouderyApi 客户端（身份 / 房间登记 / 快速匹配）
  tools/              联机自测脚本（房间号、降级、座位超时）
  package.json
docs/backend-api.md   后端协议文档
tools/build-static.sh 生成 dist/ 发布包（只含浏览器需要的静态文件）
```

## 部署

前端与联机后端是**可以分开部署**的两块。Toy 只吃纯静态文件（不能跑 Node），所以要拆成：

| 部分 | 放哪 | 说明 |
|---|---|---|
| `index.html` / `css/` / `js/` | Toy 静态托管（或任意静态站 / CDN） | 全相对路径引用，可以直接放进子目录 |
| `backend/server.js` | 自己的服务器（systemd / 1Panel 的 Node 环境） | 常驻进程，对外暴露 `wss://` |
| `ClouderyApi` | 已有的 `api.cldery.com` | 大厅 / 快速匹配 / 战绩，可选 |

步骤：

1. 把 `js/config.js` 的 `wsUrl` 改成 `'wss://你的联机域名'`（例 `wss://game.cldery.com`）。
   留空只在「网页和后端同机同源」时成立；页面不在本机又留空会直接提示「联机服务器未配置」。
2. 打包出纯静态目录（只含 `index.html` / `css/` / `js/`，约 140KB）：
   ```bash
   bash tools/build-static.sh    # 生成 dist/
   toy create dist --title "恶魔轮盘" --category GAME --yes     # 首次
   toy update <toy-id> dist --yes                              # 之后更新
   ```
   不要直接在仓库根目录跑 `toy create`：CLI 是整目录打包，会把 `backend/`（服务端实现与
   `node_modules`）和 `docs/` 一起传上去。
3. 服务器上 `cd backend && npm install`，带环境变量启动：
   ```bash
   PORT=8080 \
   TOY_API_BASE=https://api.cldery.com \
   TOY_SERVER_KEY=<与 API 的 Toy:ServerKey 一致> \
   ALLOWED_ORIGINS=<Toy 页面来源> \
   node server.js
   ```
   建议用 systemd（`Restart=always`）或 1Panel 的 Node 项目托管，别用 `nohup` 挂着。
4. 反代（Nginx / OpenResty / 1Panel 网站）必须转发 WebSocket 升级头，否则握手 400：
   ```nginx
   location / {
     proxy_pass http://127.0.0.1:8080;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
     proxy_read_timeout 300s;
   }
   ```
5. 证书用公网 CA（Toy 里是 HTTPS 页面，`ws://` 会被当混合内容拦掉，自签证书在 App 内置 WebView 里通常也过不去）。

### 分开部署要注意的点

- **跨域**：浏览器只连 WebSocket、不发任何 HTTP 请求，所以不存在 CORS 预检问题；WS 本身不受同源策略限制。`ALLOWED_ORIGINS` 用来防止别人把自己的网页挂到你的联机服务器上白嫖 API 配额，留空则不校验。
- **空闲断连**：反向代理与 CDN 一般 60~100 秒掐掉无数据的连接。服务端已每 30 秒 `ping` 一次保活，并把半开连接清掉；即使被掐，客户端也会自动重连带令牌回原座位。
- **单实例**：房间与对局状态在 Node 内存里，只能跑一个进程。要横向扩容得先把房间状态搬出去（Redis），当前不做。
- **更新方式变两段**：前端改完重新上传 Toy，后端改完重启 Node 进程，互不影响。改 `js/config.js` 后记得让 CDN 缓存失效或强刷。

### 与 ClouderyApi 的关系

```
浏览器 ──wss（可跨域）──> backend/server.js ──X-Toy-Server-Key──> ClouderyApi /toy/*
                              │                                      │
                        权威对局（JS 引擎）                    玩家档案 / 房间目录 / 匹配等待池（MySQL）
```

- 浏览器**不直接**访问 ClouderyApi：`toyOpenId` 与玩家令牌都不出游戏自己的域，API 也不用为 Toy 页面开 CORS 白名单。
- 权威对局仍在 Node 进程内存里（直接复用前端的 JS 引擎）；API 只存跨进程需要共享的三样东西：谁是谁、有哪些房间可进、谁和谁配上了。
- API 挂了只影响大厅与快速匹配，房间号玩法与断线重连不受影响。

## 注意事项

- 奖金计算公式为近似值，多人模式各关血量为推测值。
- Toy 平台是否允许外部 WebSocket 连接需自行确认（页面侧 CSP `connect-src` 若被限制，需要平台放行你的联机域名）。
- 房间与座位在 Node 进程内存里：进程重启后房间全部消失，玩家需要重新开房。
- 联机域名需公网可访问且已完成备案（Toy 面向国内用户，未备案域名通常会被拦）。
