# Obsidian Hub 项目规则

## 1. 项目定位

Obsidian Hub 是一个 Windows 11 优先的独立桌面启动器。它在 Obsidian 加载任何仓库之前展示仓库列表，让多仓库用户选择目标仓库后再启动 Obsidian。

当前阶段只验证一个核心价值：用户是否愿意把 Obsidian Hub 作为日常进入 Obsidian 的默认入口。

## 2. 当前范围

### MVP 包含

- 手动添加、编辑和移除仓库条目。
- 展示、搜索、收藏和按最近打开时间排序仓库。
- 校验仓库路径与 `.obsidian` 目录。
- 通过 `obsidian://open` 打开已注册的 Obsidian 仓库。
- 保存本地配置和最近使用记录。
- 对路径失效、重复添加、URI 协议不可用等情况给出明确反馈。
- 完整的鼠标与键盘操作。

### MVP 不包含

- 自动扫描目录或全盘发现仓库。
- 跨仓库全文搜索、快速创建笔记和内容索引。
- 读取或修改仓库内的插件、主题和工作区配置。
- Git、同步、容量或性能分析。
- 系统托盘、全局快捷键和自动更新。
- macOS 与 Linux 的正式支持。

新增范围必须先更新 `docs/plan/plan.md` 和 `docs/todo/todo.md`，不得顺手实现。

## 3. 技术栈

- 桌面框架：Tauri 2。
- 前端：React、TypeScript、Vite。
- 后端：Rust，仅承载需要原生权限或更适合系统层处理的能力。
- 样式：项目自有 CSS 变量与组件样式，不依赖 Obsidian 内部 CSS。
- 图标：优先使用开源图标库；不得直接复制 Obsidian 商标或专有素材。
- 配置：应用数据目录中的版本化 JSON；MVP 不引入数据库。
- 包管理器：pnpm。只维护 `pnpm-lock.yaml`，不得混用 npm 或 yarn 锁文件。

引入新运行时依赖前必须说明必要性。能够用平台能力或少量项目代码完成的功能，不引入大型依赖。

## 4. 架构边界

```text
React UI
  -> application services
    -> typed Tauri commands/adapters
      -> Rust filesystem / URI integration
```

- UI 组件不得直接调用 Tauri API。
- 领域类型放在 `src/domain/`，不得散落在页面组件中重复定义。
- 本地持久化、仓库校验与启动动作必须通过明确接口隔离。
- Rust 命令只返回可序列化的稳定 DTO，不向前端暴露内部错误类型。
- 所有外部输入，包括路径、配置文件和 URI 参数，都必须校验。
- 默认只读访问仓库；除应用自己的配置文件外，不修改用户仓库内容。

## 5. 目录约定

实现阶段采用以下目录：

```text
.
├── CLAUDE.md
├── AGENTS.md
├── docs/
│   ├── plan/plan.md
│   └── todo/todo.md
├── src/
│   ├── app/
│   ├── components/
│   ├── domain/
│   ├── features/
│   ├── services/
│   ├── styles/
│   └── test/
├── src-tauri/
│   ├── capabilities/
│   └── src/
└── tests/
```

- React 组件使用 `PascalCase.tsx`。
- 非组件 TypeScript 文件使用 `camelCase.ts`。
- Rust 模块与文件使用 `snake_case`。
- 测试就近放置并使用 `*.test.ts(x)`；跨层端到端测试放在 `tests/`。
- 新建目录前先明确职责；空目录、重复入口和模糊的 `utils` 大杂烩禁止进入仓库。

## 6. 视觉与交互规范

产品追求“Obsidian 原生感”，而不是复刻 Obsidian。

- 借鉴 Obsidian 的深浅色语义、左侧导航、卡片层级、紫色强调色和命令式键盘体验。
- 使用项目自有设计令牌，确保未来可独立演进。
- 不导入、抓取或依赖 Obsidian 安装目录中的 CSS 和资源。
- 不使用 Obsidian 名称、图标或商标造成官方产品的误认。
- 所有核心操作必须可用键盘完成，并提供清晰焦点态。
- 界面默认紧凑、快速、低干扰；装饰不得影响首屏速度。

若仓库后续引入 `000-styleseed/engine/`，前端实现还必须遵循其中的 `DESIGN-LANGUAGE.md` 与 `CLAUDE.md`，完成后执行 `/ss-review`。

## 7. 数据与安全

- 配置文件必须包含 `schemaVersion`，迁移逻辑必须显式、可测试。
- 仓库身份以规范化后的绝对路径为主，不以可能重名的展示名称为主键。
- 路径比较在 Windows 上按不区分大小写处理。
- 展示名称、路径与描述都视为不可信输入，不拼接执行 shell 命令。
- 启动 Obsidian 优先使用已知 Vault ID；没有 ID 时使用 URI 编码后的名称，并明确处理重名风险。
- Tauri capability 采用最小权限，不开放通用 shell 执行能力。
- 日志不得记录笔记内容、密钥、token 或无必要的完整用户路径。

## 8. 开发流程

### 规划门槛

涉及以下任一情形时，必须先给计划并等待确认：

- 3 个及以上文件。
- 接口或类型签名变化。
- 数据结构、配置格式或存储迁移。
- 新架构层或新核心模块。
- 核心模块删除或重命名。

子项目规划先更新 `docs/plan/plan.md`，再更新 `docs/todo/todo.md`。

### 红线

以下操作必须先询问：

- 删除文件、目录或 Git 历史。
- 修改 `.env`、密钥、token、CI/CD。
- 数据库 schema 或数据迁移。
- `git push`、`rebase`、`reset` 或强推。
- 安装全局依赖或修改系统配置。
- 公开发布或生产部署。

### 完成标准

每轮实现必须：

1. 满足已确认的验收条件。
2. 运行与改动相称的格式检查、类型检查、单元测试和构建。
3. 清理死代码、无效 import、TODO、调试输出和被替代的旧实现。
4. 检查无意修改，不覆盖用户已有改动。
5. 更新相关规划或任务状态。

项目建立后，标准验证命令预期为：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm tauri build --debug
```

脚手架尚未建立时，以文档结构检查和 Git diff 检查代替。

## 9. Git 与 Commit

- 不主动执行提交或推送。
- 每轮改动后只提供一个建议的 commit message。
- 格式必须为 `<type>: <简短中文描述>`。
- 常用类型：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`。
