# Bridge 安装与启用

Bridge 构建产物为 `manifest.json`、`main.js` 和 `styles.css`。Hub 在用户明确授权后，
把它们复制到：

```text
<仓库>/.obsidian/plugins/obsidian-hub-bridge/
```

安装同时写入该插件自己的 `data.json`，包含本机仓库登记表路径（`registryPath`）与当前仓库
ID，供 Bridge 独立读取已登记仓库。安装还会在 `.obsidian/community-plugins.json` 中登记
Bridge 自身条目完成启用；Hub 不会关闭受限模式，也不会修改其他插件。若该仓库的 Obsidian
正在运行，重启后启用生效。

开发构建使用 `pnpm bridge:build`。桌面打包会将上述三个文件作为资源携带。
