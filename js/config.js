/* 部署配置：联机服务器地址。留空则使用当前页面同源（server.js 同时提供网页与 WebSocket） */
window.BR = window.BR || {};
window.BR.config = {
  wsUrl: ''   // 例：'wss://your-domain.com'。Toy 页面为 HTTPS，必须用 wss://
};
