/* ClouderyApi 客户端：玩家身份、房间登记、快速匹配（Node → API，服务端凭据）
 *
 * 设计取舍：
 * - 浏览器只跟本服务同源通信，openId 与玩家令牌都不出这个域；API 的 CORS 白名单
 *   也就不用为「B站 Toy 页面」开洞（那等于给整个 bilibili 域开带凭据的跨站写权限）。
 * - API 不可用时**不阻塞对局**：房间号玩法照旧在本地跑，只有大厅列表与快速匹配降级。
 *   一个数据中心抖动不该让「约好朋友报房号开局」这种主路径失效。
 */
const BASE = (process.env.TOY_API_BASE || '').replace(/\/+$/, '');
const KEY = process.env.TOY_SERVER_KEY || '';
const TIMEOUT_MS = 4000;

function enabled() { return !!(BASE && KEY); }

function log(action, detail) {
  console.warn(`[api] ${action} 失败：${detail}`);   // 只在异常路径打，正常请求不刷日志
}

async function call(method, path, body, token) {
  if (!enabled()) return { ok: false, offline: true, detail: 'API 未配置' };
  const headers = { 'X-Toy-Server-Key': KEY };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  try {
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* 网关错误页不是 JSON */ }
    if (!res.ok) {
      log(`${method} ${path}`, `${res.status} ${(data && data.detail) || text.slice(0, 80)}`);
      return { ok: false, status: res.status, detail: (data && data.detail) || '服务端错误' };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    log(`${method} ${path}`, e && e.message ? e.message : String(e));
    return { ok: false, offline: true, detail: '联机服务暂时不可用' };
  }
}

module.exports = {
  enabled,
  base: BASE,

  /** Toy 身份 → 玩家 id + 令牌（openId 为空 = 平台外匿名）。 */
  session: (openId, nickname) => call('POST', '/toy/session', { openId: openId || null, nickname }),

  /** 已有令牌 → 玩家身份（平台外也能记住人）。 */
  verify: (token) => call('POST', '/toy/session/verify', { token }),

  listRooms: () => call('GET', '/toy/rooms'),

  getRoom: (code) => call('GET', '/toy/rooms/' + encodeURIComponent(code)),

  registerRoom: (code, hostPlayerId, hostName) =>
    call('POST', '/toy/rooms', { code, hostPlayerId, hostName }),

  syncRoom: (code, players, status) =>
    call('POST', `/toy/rooms/${encodeURIComponent(code)}/sync`, { players, status }),

  closeRoom: (code) => call('DELETE', '/toy/rooms/' + encodeURIComponent(code)),

  /** 玩家通道：进入等待池（配对成功会带回房间号与房主身份）。 */
  match: (token) => call('POST', '/toy/match', undefined, token),

  cancelMatch: (token) => call('DELETE', '/toy/match', undefined, token),

  /** 服务端通道：一次问掉本进程所有排队玩家。 */
  pollMatch: (playerIds) => call('POST', '/toy/match/poll', { playerIds })
};
