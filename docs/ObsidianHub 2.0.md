## 一、项目背景

当前个人知识系统由多个独立 Obsidian Vault 组成，各个仓库承担不同职责。

现有仓库主要包括：

Echo Vault  
用于记录临时想法、随笔、碎片化思考和即时输入。该仓库承担最上游的 Capture 角色。

Main Vault  
个人主仓库，用于存放相对成熟的认知、长期笔记、日记、思考以及个人知识沉淀。

Knowledge Vault  
外部知识库，主要通过 Obsidian Web Clipper 等方式收集文章、推文和其他外部资料，并通过 LLM 辅助整理。

Output Vault  
用于存放经过整理后的成体系认知输出，例如文章、长文、公众号内容等。

除此之外，当前已经存在 Obsidian Hub 与 Bridge。

Obsidian Hub 目前主要承担多 Vault 入口功能。

Bridge 已经能够实现跨 Vault 链接、访问与预览，使 Main Vault 中可以直接引用其他 Vault 的笔记，无需切换仓库。

目前的核心问题已经从“如何跨库访问”转向“如何统一管理多个 Vault，并让多个 Vault 形成完整的知识流转系统”。

Obsidian Hub 2.0 的目标，就是在现有 Hub + Bridge 基础上继续演化，使 Hub 成为整个多 Vault 知识系统的控制中心。

---

# 二、项目定位

Obsidian Hub 2.0 定位为：

**多 Vault 个人知识管理控制中心。**

整体系统采用三层架构。

```
Obsidian Hub Software
Interaction Layer
Dashboard / Search / Task / Flow / AI

↓

Hub Vault
Working Layer
MOC / Workspace / Today / Workflow

↓

Echo / Main / Knowledge / Output
Storage Layer
```

其中：

Obsidian Hub Software 负责统一展示、跨库聚合、任务管理、流程调度和未来 AI 接入。

Hub Vault 负责总览结构、MOC、工作区、临时加工内容以及知识流转过程中的中间状态。

各业务 Vault 负责长期保存真实知识内容。

系统设计原则：

```
需要长期保存的内容
→ 对应业务 Vault

需要临时加工的内容
→ Hub Workspace

需要跨 Vault 计算形成的视图
→ Obsidian Hub Software
```

---

# 三、各 Vault 职责定义

## 3.1 Echo Vault

定位：

```
Capture Layer
```

主要负责记录未经充分加工的新想法，包括：

临时想法

即时灵感

随笔

碎片化思考

手机端快速记录

临时 Todo

Echo 内容允许保持低结构化状态。

核心问题：

```
我刚刚想到了什么？
```

---

## 3.2 Main Vault

定位：

```
Cognition Layer
```

主要负责形成和沉淀个人认知。

Echo 中有价值的想法经过进一步思考之后，最终进入 Main。

Main 中的内容代表相对成熟的：

个人观点

知识理解

长期认知

主题笔记

思考过程

概念体系

核心问题：

```
我怎么看这件事？
```

---

## 3.3 Knowledge Vault

定位：

```
Reference Layer
```

Knowledge Vault 保存外部世界的知识，包括：

文章

推文

研究资料

他人观点

理论

案例

Web Clipper 内容

Knowledge Vault 不作为知识流转主链中的必经存储节点。

它主要作为 Main 阶段的外部增强知识源。

核心问题：

```
别人怎么看？

已有知识对此有什么解释？
```

---

## 3.4 Output Vault

定位：

```
Expression Layer
```

用于保存经过整理、融合和加工后的正式输出。

例如：

公众号文章

长文

研究输出

体系化表达

最终稿

核心问题：

```
我最终如何表达这件事？
```

---

## 3.5 Hub Vault

定位：

```
Control + Workspace Layer
```

Hub Vault 不作为新的长期知识仓库。

其主要职责为：

全局 MOC

总览结构

Topic 导航

Workspace

Workflow

Today Plan

知识流转中的中间稿

系统配置

模板

Hub Vault 应严格避免逐渐演化成第五个 Main Vault。

---

# 四、核心知识流转模型

当前确定的核心知识链路为：

```
Echo
↓
Main v1
↓
Knowledge Enrichment
↓
Main v2
↓
Output
```

对应认知过程：

```
Capture
↓
Think
↓
Form
↓
Enrich
↓
Reflect
↓
Express
```

更完整的逻辑为：

```
                     Knowledge
                         │
                         │ Retrieve / Compare
                         ▼

Echo ─────→ Main v1 ─────→ Main v2 ─────→ Output
Idea       Original         Enriched       Expression
           Cognition        Cognition
```

Knowledge Vault 作为旁路知识增强来源。

Main 是整个认知链路的核心。

---

# 五、核心工作流程

## 5.1 Echo → Main

用户首先在 Echo 中产生临时想法。

例如：

```
AI 时代可能不需要维护所有底层知识，
人只需要管理高层知识结构。
```

该内容首先作为 Echo 内容保存。

用户随后在 Hub 中查看 Echo Inbox。

选择一条 Echo 后执行：

```
Develop
```

Hub 在 Hub Vault Workspace 中创建新的 Cognition Draft。

例如：

```
Hub/
Workspace/
Cognition/
AI时代的知识结构.md
```

自动带入：

原始 Echo 内容

Echo 来源链接

创建时间

目标 Vault

基础 Metadata

用户随后通过 Obsidian 原生编辑器进行深入思考。

---

## 5.2 Workspace → Main

完成第一阶段思考后，用户执行：

```
Promote to Main
```

Hub 将 Workspace 中的认知笔记转移至 Main Vault。

例如：

```
Hub/Workspace/Cognition/AI时代的知识结构.md

↓

Main/AI时代的知识结构.md
```

Hub Workspace 中的副本不长期保存。

系统可以选择：

删除工作副本

或仅保留轻量引用 Stub

推荐第一阶段采用：

```
完成流转后删除 Workspace 副本
```

避免内容重复。

---

## 5.3 Main → Knowledge Enrichment

当 Main 中的初步认知已经形成后，可以进入 Knowledge Enrichment 阶段。

Hub 调用：

当前 Main 内容

Knowledge Vault

可选 Past Main

可选 Existing Output

AI 可以辅助：

检索相关外部资料

寻找相似观点

寻找理论联系

发现观点冲突

提出反例

提出进一步思考问题

此阶段 AI 应优先输出：

```
Relevant Sources

Possible Connections

Different Views

Possible Conflicts

Questions Worth Thinking About
```

AI 不应默认直接改写用户认知正文。

---

## 5.4 Knowledge → Main v2

用户阅读外部知识和 AI 联想结果后，继续修改 Main 笔记。

此阶段形成：

```
Main v2
```

其意义是：

```
我原本怎么想
↓

外部知识怎么说
↓

重新思考以后我现在怎么想
```

Main v2 才是最终成熟认知。

---

## 5.5 Main → Output

成熟认知完成后，用户执行：

```
Create Output
```

Hub 在 Workspace 中创建 Output Draft。

例如：

```
Hub/
Workspace/
Output/
AI时代我们如何管理知识.md
```

初始 Context 可以包括：

Main 成熟认知

引用过的 Knowledge

相关 Echo

相关历史 Output

用户通过 Obsidian 原生编辑器继续编写。

AI 可以辅助：

整理文章结构

扩展论证

语言润色

章节组织

摘要生成

最终完成后：

```
Publish to Output
```

文件进入：

```
Output Vault
```

---

# 六、Hub Vault Workspace 设计

Hub Vault 中增加：

```
Workspace/
```

初期建议结构：

```
Hub/

00 Home/

01 MOC/

02 Topics/

03 Workspace/
    Cognition/
    Output/
    Scratch/

04 Workflow/

05 System/
    Templates/
    Registry/
    Config/
```

Workspace 中的 Markdown 内容默认具有生命周期。

建议流程：

```
Draft
↓
Processing
↓
Promoted
↓
Remove Workspace Copy
```

Workspace 定位类似：

```
Working Tree
```

Main / Output 则类似正式状态。

---

# 七、Home Dashboard

Home Dashboard 建议主要由 Obsidian Hub Software 原生实现。

原因：

首页内容本质上是多 Vault 动态聚合结果。

不适合作为普通 Markdown 长期维护。

Hub Vault 中仍然可以存在：

```
Home.md
```

用于保存半静态内容，例如：

长期 MOC

当前关注方向

长期项目

Pinned Notes

Obsidian Hub Software 首页负责动态内容。

---

# 八、Home Dashboard 初期模块

## 8.1 Today

展示当天基础概览。

包括：

今日日期

任务数量

新增 Echo

新增 Knowledge

待处理数量

---

## 8.2 Today's Tasks

扫描全部 Vault 中的 Markdown Task。

例如：

```
- [ ] 完成 Hub 首页设计
```

Hub 将不同 Vault 中的任务统一展示。

任务真实数据仍保存在原始 Markdown。

Hub 不复制 Task 内容。

---

## 8.3 Today Plan

全局 Task 与 Today Plan 分离。

例如：

```
Global Tasks
83

Today's Tasks
5
```

任务 Source of Truth：

```
原始 Vault
```

Hub 只保存：

```
今天选择哪些 Task
```

---

## 8.4 Focus

提供基础专注计时功能。

后期可以绑定：

Task

Project

Note

初期只需支持：

开始

暂停

结束

---

## 8.5 Echo Inbox

统一显示 Echo 中新增内容。

支持：

Open

Develop

Create Task

Reviewed

Archive

---

## 8.6 Processing Inbox

显示所有待处理知识。

例如：

Echo 未处理内容

Knowledge 新增 Web Clip

Main Draft

Workspace Draft

未来可根据 status 自动判断。

---

## 8.7 Continue Working

显示最近持续编辑的笔记。

例如：

Obsidian Hub

AI Brain Architecture

Agent Memory

用于快速恢复工作上下文。

---

## 8.8 Active Projects

显示当前活跃项目。

可展示：

项目名称

最近修改时间

未完成 Task 数量

相关笔记

---

## 8.9 Recent Activity

统一展示全部 Vault 最近变化。

包括：

Created

Modified

Moved

Completed Task

示例：

```
12 min ago
Main
Agent Memory.md
Modified
```

---

## 8.10 Recent Knowledge

展示 Knowledge Vault 最近新增内容。

重点体现：

最近输入了什么？

---

## 8.11 Recent Cognition

展示 Main 最近新增或修改的核心认知。

重点体现：

最近自己的认知发生了什么变化？

---

## 8.12 Recent Output

显示最近产生的 Output。

---

## 8.13 Knowledge Flow

展示知识系统近期流转状态。

例如：

```
This Week

Echo          18
Sources       27
Cognition      6
Outputs        2
```

后期可以进一步展示：

Developing

Ready to Enrich

Ready to Output

---

## 8.14 Pinned

固定高频内容。

例如：

MOC

Project

Note

Web Page

Vault

---

## 8.15 Quick Actions

建议包括：

```
New Echo

New Note

New Task

Open Main

Open Knowledge

Open Output

Search All Vaults

Ask Claudian
```

---

## 8.16 Global Search

提供跨 Vault 搜索。

后期可以支持模式切换：

```
Search

Ask AI

Command
```

---

## 8.17 Vault Status

显示各 Vault 基础状态。

例如：

```
Main        Ready
Echo        Ready
Knowledge   Ready
Output      Ready
```

未来可以增加：

Git Status

Last Scan

File Count

Sync Status

---

# 九、待办管理

待办管理采用：

```
Distributed Storage
+
Centralized View
```

Task 继续存放在原始 Markdown 中。

例如 Echo：

```
- [ ] 调研 Obsidian Workspace API
```

Main：

```
- [ ] 完成 Hub Knowledge Flow
```

Hub 软件扫描全部 Vault。

生成统一 Task Index。

Hub 中勾选完成时，直接修改原始 Markdown。

禁止建立独立 Todo 文件复制所有任务。

避免出现：

```
原文件
与
Hub Todo
```

之间的同步冲突。

---

# 十、Hub 与 Bridge

Bridge 继续承担跨 Vault 访问能力。

初期职责：

读取其他 Vault

打开笔记

预览笔记

跨 Vault 链接

创建文件

移动文件

修改文件

未来可以扩展：

跨 Vault 搜索

Backlink

统一 Index

Knowledge Graph

---

# 十一、AI 与 Claudian

当前阶段不计划重新开发完整 AI Agent。

优先考虑直接利用现有 Claudian。

Claudian 可以作为 Hub 中的 AI Workspace 或 AI Engine。

整体结构：

```
Hub
├── Home
├── Vaults
├── Search
├── Workflow
└── AI
    └── Claudian
```

Hub 为 Claudian 提供上下文。

例如：

当前 Echo

当前 Workspace

当前 Main

Knowledge Search Results

Past Main

Existing Output

---

# 十二、AI 初期权限模型

当前阶段推荐：

```
Read Everything

Search Everything

Suggest Everything

Write Only When Explicitly Requested
```

AI 可以：

理解内容

检索知识

发现关联

寻找反例

提出问题

生成草稿

辅助输出

AI 默认不应：

自动修改 Main 正文

自动删除知识

自动移动重要文件

自动改变用户认知

所有关键写操作应由用户主动触发。

例如：

```
Create Cognition

Insert Suggestion

Promote to Main

Create Output

Publish
```

---

# 十三、未来知识关系

建议在第一版就保留基础 Lineage。

例如 Main：

```
origin:
  vault: echo
  note: xxx
```

Output：

```
derived_from:
  - main-xxx

references:
  - knowledge-xxx
  - knowledge-yyy
```

使 Hub 可以未来展示：

```
Knowledge Lineage

Echo
↓

Main v1
↓

Knowledge References
↓

Main v2
↓

Output
```

这类关系以后可以继续扩展成 Cognition Evolution。

---

# 十四、阶段性设计原则

当前阶段优先解决工作流问题。

暂时不优先开发：

复杂 Agent

GraphRAG

Embedding

向量数据库

复杂 Knowledge Graph

自动化知识搬运

自动生成认知

当前阶段重点为：

```
多 Vault 聚合

Home Dashboard

Echo Inbox

Hub Workspace

Main 流转

Knowledge 辅助

Output 流转

Global Tasks

Claudian 接入
```

先让知识流真正跑通。

后续再根据真实使用体验决定哪些环节值得自动化。

---

# 十五、当前版本目标

Obsidian Hub 2.0 第一阶段目标：

**将多个独立 Obsidian Vault 编排成一个统一的个人知识工作空间。**

核心用户路径：

```
打开 Obsidian Hub

↓

Home Dashboard

↓

查看 Today / Task / Echo / Recent Activity

↓

选择 Echo

↓

Develop

↓

Hub Workspace

↓

使用 Obsidian 原生编辑器深度思考

↓

Promote to Main

↓

Knowledge Enrichment

↓

继续完善 Main

↓

Create Output

↓

Hub Workspace 编辑

↓

Publish to Output
```

整个过程中：

用户主要停留在 Hub 与 Obsidian 中。

底层文件继续分别保存在独立 Vault。

Hub 负责统一管理工作流。

---

# 十六、系统最终角色划分

```
Echo
负责捕获

Main
负责认知

Knowledge
负责外部知识

Output
负责表达

Hub Vault
负责加工和结构

Obsidian Hub Software
负责统一管理和调度

Bridge
负责打通 Vault 边界

Claudian
负责 AI 辅助
```

阶段性核心理念：

```
Vault 保存知识。

Hub Vault 加工知识。

Obsidian Hub 管理知识流。

Bridge 打破物理边界。

AI 辅助理解和联想。
```