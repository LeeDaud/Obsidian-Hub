# Obsidian Hub

Obsidian Hub 是一个面向 Windows 11 的多仓库启动器，并通过配套的 Obsidian Hub Bridge
插件提供跨仓库笔记浏览、链接和只读预览。

> `master` 保留 Hub `0.4.0` 基线。本分支是 `2.0.0-preview.1` 预发布版，Bridge `0.6.0`；使用独立预览更新通道。建议在重要仓库中先完成备份。

## 2.0 本地预览

2.0 提供单页工作台、跨库元数据搜索、全局 Markdown 任务和 Echo → Main → Output 直接创建流程。正文由你在 Obsidian 中完成。先通过“仓库管理”添加已有仓库，再从“角色设置”指定 Echo、Main、Output；Knowledge 作为可选资料库。无需创建或初始化 Hub Vault。

- 工作台整合今日任务、全部任务、待处理灵感、认知、资料、输出与最近内容。筛选和搜索都在同一清单完成，按窗口高度分页；角色配置使用弹窗。
- 任务星标只保存今日选择，勾选会修改来源 Markdown 的单个任务标记。
- Echo 笔记点击“创建认知笔记”，确认标题与目录后直接在 Main 创建笔记。Main 笔记点击“创建输出笔记”，可多选 Knowledge 资料，然后直接在 Output 创建笔记。
- 新文件只包含创建时间、来源属性、Bridge 跨库链接、标题和空正文，不复制来源正文。Echo、Main 与 Knowledge 的来源笔记不被修改或删除；不自动写入反向链接。
- 标题默认沿用来源标题，可编辑；无需填写 .md，不强制日期或阶段前缀。同名文件拒绝覆盖，也不会自动追加序号。保存目录默认为目标仓库根目录，可输入已有相对目录（用 / 分隔）；本轮不保存持久默认目录设置。
- 创建成功会尝试在 Obsidian 中打开。即使打开失败，已创建的笔记仍保留，可从列表再次打开，不应重复创建。
- 旧 Hub Workspace 草稿保持原位置，可从最近内容或搜索打开；旧 Develop/Promote/Publish 搬运入口已退役。
- 跨库链接使用可读仓库名和稳定仓库 ID，例如 `@Echo:仓库ID[[想法.md]]`。需通过本预览版“仓库管理”安装或更新并启用 Bridge，使其使用预览版登记表。仓库 ID 稳定不等于笔记路径稳定：笔记重命名或移动后，需手动更新已有链接。

预览版使用独立的 Windows 应用标识和 AppData。首次启动只读复制正式版的仓库登记表，再迁移到预览版配置；不会修改正式版配置。此后两个版本的仓库登记不会自动同步。签名预览包通过独立通道发布，不进入正式 Latest。preview.0 需手动安装一次 preview.1，之后可通过 Hub 检查预览更新。Bridge 继续只读登记仓库；Hub 的文件写入仅由上述显式操作触发。先使用临时 Vault 验证流程，再连接真实知识库。

本地预览构建运行 `pnpm tauri build --debug`，安装包生成在 `src-tauri/target/debug/bundle/nsis/`；当前未公开发布。

## 功能

- 集中添加、搜索、收藏和启动多个本地 Obsidian 仓库。
- 检查仓库路径与 `.obsidian` 标记，并记录最近打开时间。
- 从 Hub 安装、更新并启用各仓库中的 Bridge 插件，安装后无需 Hub 常驻。
- 在 Obsidian 中输入 `@`，先选择其他仓库，再逐层浏览文件夹和 Markdown 文件。
- 在当前目录树中递归筛选笔记，并分批加载较大的结果集。
- 使用 `@仓库[[路径]]` 保存可读的跨仓库链接，不影响原生 `[[双链]]`。
- 在当前 Obsidian 窗口只读预览其他仓库的 Markdown，按需再打开目标仓库。

## 正式版安装（0.4.0）

1. 从 GitHub Releases 下载最新的 `Obsidian Hub_*_x64-setup.exe`。
2. 安装并启动 Obsidian Hub，然后添加已有的 Obsidian 仓库。
3. 在仓库条目中安装 Bridge，Hub 会同时写入启用列表完成启用。
4. 若该仓库的 Obsidian 正在运行，重启它使启用生效。
5. 在编辑器行首或空白后输入 `@` 开始选择仓库；此后无需保持 Hub 运行。

Hub 安装时写入 Bridge 自身目录，并在社区插件启用列表中登记 Bridge 自身条目：

```text
<仓库>/.obsidian/plugins/obsidian-hub-bridge/
<仓库>/.obsidian/community-plugins.json
```

它不会关闭 Obsidian 受限模式，不会修改其他插件、主题或笔记正文。

## Hub 更新

0.4.0 起可通过主页“检查更新”查看新版本，点击“下载并安装”后完成签名校验、安装和重启。首次需要手动安装带更新功能的版本。网络不可用或更新清单尚未发布时会提示重试。

本地构建与发布操作见 [Hub 更新与发布](docs/hub-updates.md)。

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
src-tauri/                    Tauri/Rust 启动器、Bridge 安装与旧版兼容服务
apps/bridge/                  Obsidian Bridge 插件
packages/protocol/            Hub 与 Bridge 共享协议
packages/cross-vault-parser/  跨仓库链接解析器
docs/                         规划、协议、安全与使用文档
```

## 当前限制

- 正式支持 Windows 11；macOS 和 Linux 尚未完成适配。
- Bridge 依赖桌面端 Node 能力，不支持移动端 Obsidian。
- 预览以 Markdown 正文为主，跨仓库图片、附件和嵌入资源暂不保证完整显示。
- 笔记索引在每次进入仓库（Bridge 加载）时全量扫描，文件变化需重新进入仓库或手动刷新。
- 2.0 预览版的搜索覆盖标题、路径、别名与标签，不搜索正文；Knowledge 增强由用户手动检索与编辑，尚无 Claudian 内部接入。
- 全局任务目前识别 Markdown 的 `- [ ]`、`* [ ]`、`+ [ ]` 任务标记，跳过围栏代码块；不解析任务插件的扩展语法。
- 最近内容依据文件修改时间排序；不单独追踪创建、移动或任务完成事件。
- 2.0 预览版尚需在真实 Windows 11 Vault 中完成手工验收；不要将 Debug 包视为正式发布版本。

## 数据与安全

Bridge 直接读取本机仓库登记表并在每次进入仓库时扫描文件，索引只保存元数据、不保存正文；
正文在打开预览时按需实时读取，文件存在性以磁盘校验为准。旧版 HTTP 服务仅保留兼容并监听
`127.0.0.1`。详细边界见 [Bridge 安全说明](docs/bridge-security.md)。
