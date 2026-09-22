# Bridge 本地读取协议

新版 Bridge 不再依赖 Hub 进程，通过本地文件系统直接读取：

- 安装时 Hub 把仓库登记表 `config.json` 的绝对路径写入 Bridge 的 `data.json`
  （`registryPath` 字段）。
- Bridge 加载时读取登记表，得到各仓库的 `id`、`name`、`path`，并对每个仓库做一次全量
  扫盘，建立内存索引。
- 搜索与分层浏览基于内存索引；正文预览按索引路径实时读取磁盘，文件存在性以磁盘为准。

旧版 HTTP 服务仅保留给已安装的旧插件，默认地址 `http://127.0.0.1:27124`，所有接口要求
`Authorization: Bearer <token>`，提供 `health`、`vaults`、`search`、`notes/resolve`、
`notes/browse`、`notes/content`、`bridge/heartbeat`、`open` 等接口，错误统一返回
`{ "error": { "code": "...", "message": "..." } }`。正式退役待新版实机验证与升级覆盖完成。
