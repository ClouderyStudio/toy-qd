/* 部署配置：联机服务器地址
 *
 * 两种部署形态：
 *   1) 自己一台机器跑 backend/server.js，网页与 WebSocket 同源 —— wsUrl 留空。
 *   2) 前端传到 Toy（纯静态托管，跑不了 Node）—— 必须填 wss:// 的联机服务地址。
 *      Toy 页面是 HTTPS，ws:// 会被浏览器按混合内容拦掉，只能用 wss://。
 *
 * 留空且页面不在本机时，客户端会直接报「联机服务器未配置」，而不是拿 Toy 的
 * 静态域名去连 WebSocket（那只会得到一个看不懂的连接失败）。
 *
 * 线上值不要手改这一行：用构建脚本注入，源码保持留空，本地联调不受影响。
 *   BR_WS_URL=wss://api.cloudery.cn/toy-mp bash tools/build-static.sh
 */
window.BR = window.BR || {};
window.BR.config = {
  wsUrl: '',     // 构建时由 BR_WS_URL 注入，例：'wss://你的域名/toy-mp'
  followMid: '', // 构建时由 BR_FOLLOW_MID 注入（作者 B站 UID），「关注解锁联机」跳作者主页用
  version: 'v1.0.0'   // 主菜单左下角显示的发版号，每次发布手改
};
