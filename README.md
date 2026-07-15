# Obsidian Hub

Obsidian Hub 是一个面向 Windows 11 的多仓库启动器，并通过配套的 Obsidian Hub Bridge
插件提供跨仓库笔记浏览、链接和只读预览。

> 当前版本：Hub `0.1.0`，Bridge `0.5.0`。项目处于早期可用阶段，建议在重要仓库中先完成备份。

## 功能

- 集中添加、搜索、收藏和启动多个本地 Obsidian 仓库。
- 检查仓库路径与 `.obsidian` 标记，并记录最近打开时间。
- 从 Hub 安装、更新并检测各仓库中的 Bridge 插件状态。
- 在 Obsidian 中输入 `@`，先选择其他仓库，再逐层浏览文件夹和 Markdown 文件。
- 在当前目录树中递归筛选笔记，并分批加载较大的结果集。
- 使用 `@仓库[[路径]]` 保存可读的跨仓库链接，不影响原生 `[[双链]]`。
- 在当前 Obsidian 窗口只读预览其他仓库的 Markdown，按需再打开目标仓库。

## 安装

1. 从 GitHub Releases 下载最新的 `Obsidian Hub_*_x64-setup.exe`。
2. 安装并启动 Obsidian Hub，然后添加已有的 Obsidian 仓库。
3. 在仓库条目中安装 Bridge。
4. 打开该仓库的 Obsidian 设置，在“第三方插件”中启用 `Obsidian Hub Bridge`。
5. 保持 Hub 运行，在编辑器行首或空白后输入 `@` 开始选择仓库。

Hub 只在用户确认后写入 Bridge 自身目录：

```text
<仓库>/.obsidian/plugins/obsidian-hub-bridge/
```

它不会自动关闭 Obsidian 受限模式，也不会修改社区插件启用列表或笔记正文。

## 跨仓库链接

```md
@工作仓库[[项目/计划]]
@资料库[[网络/TCP|TCP 协议]]
```

- 输入 `@` 后选择仓库，候选框会显示仓库根目录的文件夹和文件。
- 选择文件夹可逐级进入；输入文字会递归搜索当前目录树。
- 点击已有链接默认打开只读预览，不创建临时笔记。
- 预览中的“在目标仓库打开”会通过 Obsidian URI 切换到目标笔记。
- 普通 `[[笔记]]` 完全由 Obsidian 原生处理。

更多说明见 [跨仓库链接](docs/cross-vault-links.md) 和
[Bridge 安装与启用](docs/bridge-installation.md)。

## 本地开发

需要 Node.js、pnpm、Rust 和 Tauri 2 的 Windows 构建环境。

```powershell
pnpm install
pnpm tauri dev
```

常用验证命令：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

Bridge 可以单独构建：

```powershell
pnpm bridge:build
```

## 项目结构

```text
src/                          Hub React 前端
src-tauri/                    Tauri/Rust 启动器、本地 API 与笔记索引
apps/bridge/                  Obsidian Bridge 插件
packages/protocol/            Hub 与 Bridge 共享协议
packages/cross-vault-parser/  跨仓库链接解析器
docs/                         规划、协议、安全与使用文档
```

## 当前限制

- 正式支持 Windows 11；macOS 和 Linux 尚未完成适配。
- Hub 必须运行，Bridge 才能浏览和预览其他仓库。
- 预览以 Markdown 正文为主，跨仓库图片、附件和嵌入资源暂不保证完整显示。
- 笔记索引目前在 Hub 启动或仓库配置更新时刷新，尚未提供实时文件监听。

## 数据与安全

Hub 的本地 API 只监听 `127.0.0.1` 并使用随机令牌认证。索引保存文件元数据，不保存笔记
正文；正文只在用户打开预览时按需读取。详细边界见 [Bridge 安全说明](docs/bridge-security.md)。
