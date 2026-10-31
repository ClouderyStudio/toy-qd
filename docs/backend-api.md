# 恶魔轮盘 · 联机后端协议

后端为单进程 Node 服务，同一端口同时提供网页静态文件与 WebSocket 联机。游戏逻辑由服务器运行，客户端只负责播放动画与发送玩家动作。

## 运行

```bash
cd backend
npm install
node server.js          # 默认端口 8080，可用 PORT 环境变量修改
```

打开 `http://localhost:8080/` 即可游玩；浏览器客户端会自动连接到同源 WebSocket。

## 静态文件服务

仅暴露以下路径，其余一律返回 404（防止读取后端源码或 `node_modules`）：

- `/` → `index.html`
- `/css/*.css`
- `/js/*.js`

## 房间

- 房间号：6 位字符，字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。
- 每房 2 ~ 4 人，房主（第一个创建者）可开局。
- 玩家名最多 6 个字符，禁用 `DEALER`、`GOD`，并会过滤控制字符与 HTML 特殊字符。
- 房主离开则房间关闭；游戏中离开视为退出对局。

## WebSocket 协议

消息均为 JSON。

### 客户端 → 服务端

| type | 字段 | 说明 |
|---|---|---|
| `create` | `name` | 创建房间，返回房间号 |
| `join` | `code`, `name` | 加入指定房间 |
| `start` | — | 房主开始游戏 |
| `action` | `action` | 玩家动作（见下） |
| `leave` | — | 离开房间 |

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
| `room` | `code`, `you`, `host`, `players` | 房间信息，每次有人进出都会广播 |
| `start` | `you`, `view` | 游戏开始，附带该玩家的初始视图 |
| `events` | `events`, `view` | 本帧产生的事件序列与最新视图（事件已按座位过滤） |
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

## 安全性

- 服务器权威：所有动作在服务端校验，子弹真实类型从不直接发送。
- 信息隔离：`magnifier`、`burnerphone` 揭示的内容只发给使用者本人。
- 限流：单连接每秒最多 20 条消息，超过直接丢弃；单条消息最大 2048 字节。
- 输入校验：房间号、座位号、道具格下标均做边界与类型校验。
