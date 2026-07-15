# Hub–Bridge 本地协议

默认地址为 `http://127.0.0.1:27124`，所有接口都要求：

```http
Authorization: Bearer <token>
```

Bridge 通过 Obsidian 的 `requestUrl` 发起本地请求，避免桌面 WebView 的跨源策略拦截
`127.0.0.1` API；请求仍受插件设置中的超时限制。

接口：

- `GET /api/v1/health`：连接与认证检查。
- `GET /api/v1/vaults`：已登记仓库。
- `GET /api/v1/search?q=&vaultId=&excludeVaultId=&limit=`：搜索指定仓库的笔记元数据。
- `GET /api/v1/notes/resolve?vault=&path=`：解析目标笔记。
- `POST /api/v1/bridge/heartbeat`：上报插件在线状态。
- `POST /api/v1/open`：校验目标并调用 Obsidian URI。

错误统一返回 `{ "error": { "code": "...", "message": "..." } }`。当前实现使用固定端口；
端口占用时 Hub 启动器仍可运行，但 Bridge 服务不可用。Bridge 请求设置超时并在后续心跳重试。
