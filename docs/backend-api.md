# 恶魔轮盘 · 联机后端协议

后端为单进程 Node 服务，同一端口同时提供网页静态文件与 WebSocket 联机。游戏逻辑由服务器运行，客户端只负责播放动画与发送玩家动作。

身份、房间目录、快速匹配三件事落在 ClouderyApi 的 `/toy/*` 端点（房间与对局的权威状态仍在 Node 进程内存里）。浏览器只跟 Node 同源通信，由 Node 用服务端密钥代调 API。

## 运行

```bash
cd backend
npm install
node server.js              # 默认端口 8080，可用 PORT 环境变量修改
```

接 ClouderyApi（可选，不配也能玩房间号模式）：

```bash
TOY_API_BASE=https://api.cldery.com \
TOY_SERVER_KEY=<与服务端 Toy:ServerKey 一致> \
node server.js
```

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 8080 |
| `TOY_API_BASE` | ClouderyApi 根地址；留空则「大厅 / 快速匹配」降级，房间号玩法照旧 |
| `TOY_SERVER_KEY` | 服务端共享密钥，与 API 侧 `Toy:ServerKey` 一致 |
| `ALLOWED_ORIGINS` | 允许连 WS 的页面来源（逗号分隔，例 `https://toy.example.com`）。留空则不校验；无 Origin 的连接始终放行 |

打开 `http://localhost:8080/` 即可游玩；浏览器客户端会自动连接到同源 WebSocket。

**前端与后端分开部署时**（Toy 只支持纯静态托管，跑不了 Node）：网页上传到静态站，本服务跑在自己的
服务器上并对外提供 `wss://`，客户端靠 `js/config.js` 的 `wsUrl` 找到它。浏览器只发 WebSocket、
没有任何 HTTP 请求，因此不需要 CORS；反代需转发 `Upgrade` / `Connection` 头，否则握手失败。

## 静态文件服务

仅暴露以下路径，其余一律返回 404（防止读取后端源码或 `node_modules`）：

- `/` → `index.html`
- `/css/*.css`
- `/js/*.js`

## 身份与连接

连接后第一条消息必须是 `hello`，服务端回 `you`（玩家 id + 令牌），之后才允许建房/进房/匹配。

- `openId` 来自 Toy SDK 的 `toyOpenId`（仅当前 Toy 内稳定的假名标识）。它只到 Node 为止：Node 换回玩家 id 与令牌，客户端只存令牌。平台外打开时为空，服务端生成一次性匿名种子。
- 令牌存 `localStorage`（键 `br_ident`），断线重连带回来即可回到原座位。
- API 不可用时会退回本地身份（玩家 id 为负数、令牌以 `local.` 开头），房间号玩法与重连仍然可用，只是没有大厅与快速匹配。

## 房间

- 房间号：6 位字符，字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。
- 每房 2 ~ 4 人，房主（第一个创建者）可开局。
- 玩家名最多 6 个字符，禁用 `DEALER`、`GOD`，并会过滤控制字符与 HTML 特殊字符。
- 房主离开则房间关闭；游戏中离开视为退出对局。
- **断线不立刻判负**：座位保留（对局中 60 秒、大厅 20 秒），超时才真正移除；对局中移除会走引擎的 `leave` 结算。

## WebSocket 协议

消息均为 JSON。

### 客户端 → 服务端

| type | 字段 | 说明 |
|---|---|---|
| `hello` | `name`, `openId?`, `token?` | 身份握手，回 `you`；带令牌会顺带恢复保留座位 |
| `create` | — | 创建房间，返回房间号 |
| `join` | `code` | 加入指定房间（本地没有会向 API 查） |
| `start` | — | 房主开始游戏 |
| `action` | `action` | 玩家动作（见下） |
| `leave` | — | 离开房间（保留连接） |
| `lobby` | — | 拉取大厅房间列表，回 `rooms` |
| `match` | — | 进入快速匹配等待池 |
| `cancel-match` | — | 退出等待池 |

### 动作格式

```json
{ "type": "action", "action": { "type": "shoot", "target": 1 } }
{ "type": "action", "action": { "type": "item", "slot": 2 } }
{ "type": "action", "action": { "type": "item", "slot": 0, "target": 1 } }          // 手铐 / 干扰器
{ "type": "action", "action": { "type": "item", "slot": 0, "target": 1, "steal": 2 } } // 肾上腺素偷取
{ "type": "action", "action": { "type": "don", "go": true } }                         // Double or Nothing 选择
```

- `slot`：己方道具格下标（0~7）。
- `target`：目标座位号（非自己）。
- `steal`：被偷者道具格下标（肾上腺素专用）。

### 服务端 → 客户端

| type | 字段 | 说明 |
|---|---|---|
| `you` | `playerId`, `token`, `nickname`, `online` | 握手结果；`online=false` 表示未接 API（本地身份） |
| `room` | `code`, `you`, `host`, `players`, `offline`, `started` | 房间信息，每次有人进出都会广播；`offline[i]` 标记该座位是否掉线中 |
| `start` | `you`, `view` | 游戏开始，附带该玩家的初始视图 |
| `events` | `events`, `view` | 本帧产生的事件序列与最新视图（事件已按座位过滤） |
| `resume` | `you`, `view` | 断线重连回到对局座位，附带当前视图（客户端用它重建播放器） |
| `resumed` | `code`, `you` | 断线重连回到大厅里的房间 |
| `rooms` | `rooms`, `online` | 大厅列表 |
| `match` | `status`, `position?`, `code?`, `host?`, `message?` | `queued` / `matched` / `timeout` / `cancelled` / `unavailable` / `error` |
| `waiting-host` | `code`, `players`, `max` | 已配对但房主的本地房间还没建好，先等着 |
| `offline-left` | `name` | 某位玩家掉线超时，已被移出对局 |
| `error` | `message` | 动作非法等错误，不改变状态 |
| `closed` | `reason` | 房间关闭原因 |

### 视图 `view` 字段

```json
{
  "you": 0, "mode": "mp", "stage": 2, "round": 1, "phase": "turn",
  "turn": 1, "dir": 1, "sawed": false, "wires": false,
  "left": 4, "loadLive": 2, "loadBlank": 2, "spent": [true, false],
  "known": {},   // 该玩家已知的子弹（相对当前这发的偏移 → 是否实弹）
  "seats": [ { "name":"..", "hp":4, "maxHp":4, "items":[..], "alive":true,
               "connected":true, "cuffed":false, "cuffLock":false,
               "jammed":false, "wiresCut":false, "money":0, "st":{..} } ],
  "doors": 0, "penalty": 0, "wins": 0, "result": null
}
```

### 事件类型

事件均为 `{ t: "..", ... }`，按顺序播放。含 `secret` 字段的事件只发给 `to` 指定的本人。

| t | 关键字段 | 说明 |
|---|---|---|
| `stage` | `stage`, `round`, `hp`, `wires` | 进入新关卡 |
| `load` | `live`, `blank` | 装弹：实弹 / 空弹数量 |
| `deal` | `items[][]` | 发放道具（每位玩家得到的道具列表） |
| `turn` | `seat` | 轮到某玩家 |
| `skip` | `seat`, `why` | 跳过（`cuffs` / `jam`） |
| `shoot` | `seat`, `target`, `live`, `dmg` | 开枪（瞄准阶段，未结算） |
| `hp` | `seat`, `hp` | 血量变化（回复或扣血后） |
| `wires` | `seat` | 除颤器电线被切断 |
| `down` | `seat` | 玩家倒下 |
| `noheal` | `seat` | 电线已断，无法回复 |
| `empty` | — | 枪膛打空，即将重装 |
| `steal` | `seat`, `from`, `item` | 肾上腺素偷取道具 |
| `item` | `seat`, `item`, `to?`, `secret?`, `target?`, `live?`, `good?`, `dir?` | 使用道具 |
| `stageEnd` | `stage`, `winner` | 本关结束 |
| `revive` | `fine` | 故事模式被救回（罚款） |
| `donChoice` | `pot`, `round` | DoN 三关全胜后选择 |
| `over` | `result` | 整局结束 |
| `left` | `seat` | 玩家离开 |

## ClouderyApi `/toy/*` 端点

Node 调用的部分（`X-Toy-Server-Key` 头）：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/toy/rooms` | 登记房间（同房主重复登记只刷心跳） |
| POST | `/toy/rooms/{code}/sync` | 心跳 + 座位快照；房间被回收时回 404，Node 会补登记 |
| DELETE | `/toy/rooms/{code}` | 关闭房间 |
| POST | `/toy/match/poll` | 批量查询排队状态（一个 tick 一条请求） |

玩家通道（`Authorization: Bearer ty1.…`，由 Node 代持）：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/toy/match` | 进入等待池；够两人就分配房间号并返回 `matched` |
| DELETE | `/toy/match` | 退出等待池 |

公开只读：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/toy/session` | `toyOpenId` + 昵称换玩家 id 与令牌 |
| POST | `/toy/session/verify` | 令牌换回身份 |
| GET | `/toy/rooms` | 大厅列表（只含等人中且心跳未过期的房间） |
| GET | `/toy/rooms/{code}` | 按房间号查（加入前判断是否存在 / 是否已开局） |

房间是临时数据：心跳过期（默认 120 秒）即从列表消失，更久之后被回收。

## 安全性

- 服务器权威：所有动作在服务端校验，子弹真实类型从不直接发送。
- 信息隔离：`magnifier`、`burnerphone` 揭示的内容只发给使用者本人。
- 身份隔离：`toyOpenId` 只在 Node 与 API 之间出现一次，库里只存 SHA-256 摘要；不写日志、不做埋点。
- 降级：API 抖动只影响大厅与快速匹配，不影响开房、对局与重连。
- 限流：单连接每秒最多 20 条消息，超过直接丢弃；单条消息最大 2048 字节。
- 输入校验：房间号、座位号、道具格下标均做边界与类型校验。

## 自测脚本

```bash
node tools/mp-selftest.js            # 房间号 / 断线重连 / 快速匹配 / 大厅列表
node tools/offline-selftest.js       # API 未配置时的降级路径
node tools/reserve-ttl-selftest.js   # 座位保留超时（大厅 20 秒）
```
