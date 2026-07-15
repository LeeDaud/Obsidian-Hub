# Bridge 安装与启用

Bridge 构建产物为 `manifest.json`、`main.js` 和 `styles.css`。Hub 只会在用户明确授权后，
把它们复制到：

```text
<仓库>/.obsidian/plugins/obsidian-hub-bridge/
```

安装同时写入该插件自己的 `data.json`，包含本机 API 地址、随机访问令牌和 Hub 仓库 ID。
Hub 不会修改 Obsidian 的社区插件启用列表，也不会关闭受限模式。复制完成后，用户仍需在
Obsidian 设置中检查并启用“Obsidian Hub Bridge”。

开发构建使用 `pnpm bridge:build`。桌面打包会将上述三个文件作为资源携带。
