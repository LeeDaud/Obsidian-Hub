# Hub 更新与发布

## 用户更新

Hub 0.4.0 起提供主页“检查更新”。点击后读取本项目 GitHub Releases 的更新清单，展示版本与说明；点击“下载并安装”后才下载并验证更新签名。Windows 安装阶段退出 Hub，安装完成后重新启动。此功能只更新 Hub，仓库中的 Bridge 仍通过原有入口更新。

0.3.0 及更早版本需要手动安装 0.4.0。上传 Git 提交不会更新已安装程序，必须发布安装包和对应清单。新更新源首次发布前，按钮会提示暂时无法检查更新，不会把不存在的清单显示成“已是最新”。

更新沿用 `io.github.obsidian-hub` 应用标识及既有配置位置，不做数据迁移。下载失败可重试；签名验证不通过时不运行安装器。下载与安装期间不能关闭更新对话框。发布说明按纯文本展示。

## 签名与本地构建

签名私钥默认保存到 `%USERPROFILE%/.tauri/obsidian-hub-updater.key`；公钥写入 `src-tauri/tauri.conf.json`。私钥不进入 Git 或 Release，也不输出到日志。请安全备份该私钥；后续更新须用同一把私钥签名。此签名用于 Tauri 更新校验，不等同于 Windows Authenticode 代码签名。

本地准备正式安装包和 `latest.json`：

```powershell
pnpm update:build
```

本地 Debug 验证：

```powershell
pnpm update:build -Debug
```

也可直接执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/buildUpdate.ps1 -Debug`。
构建脚本从默认位置读取签名密钥路径，也支持外部设置 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。不修改系统环境变量，不生成或覆盖已有密钥。Vite 只允许 VITE* 与 TAURI_ENV* 前缀进入前端，签名私钥及密码不注入页面。

每次发布前同步更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 中的 Hub 版本，并更新 `docs/release-notes.md`。Bridge 版本独立维护。

`scripts/prepareUpdate.mjs` 检查版本、安装包和签名文件，生成固定 Windows x64 平台的更新清单；不上传任何内容。输出位于 `src-tauri/target/release/bundle/nsis/`：

- `Obsidian Hub_<版本>_x64-setup.exe`
- 同名 `.exe.sig`
- `latest.json`

## 发布步骤

1. 运行项目格式、Lint、类型、测试、Rust 测试与正式构建。
2. 检查本轮源代码和发布说明，完成提交并取得公开发布授权。
3. 创建与版本一致的 GitHub Release（例如 `v0.4.0`），先用草稿上传三个产物。
4. 确认更新清单指向该版本真实安装包，并附上 `docs/release-notes.md` 的说明，再发布为正式 Latest Release。不要把 Debug 包上传到正式更新源。
5. 检查 `https://github.com/LeeDaud/Obsidian-Hub/releases/latest/download/latest.json` 可匿名访问。
6. 在已安装的旧版 Hub 上检查、下载并更新，确认重启后版本号与仓库配置正确。

GitHub 上传后会将文件名空格改为点号，因此线上安装包名为 `Obsidian.Hub_<版本>_x64-setup.exe`；清单生成脚本已按此规则生成下载地址。

更新清单必须与安装包及签名来自同一轮构建。自动化测试不能替代实际安装升级验收。

参考：[Tauri 官方更新文档](https://v2.tauri.app/plugin/updater/)。
