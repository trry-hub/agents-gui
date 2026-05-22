# Agents GUI

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=agents-gui.agents-gui)
[![CI](https://github.com/trry-hub/agents-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/trry-hub/agents-gui/actions/workflows/ci.yml)

**Agents GUI** 是一个面向 VS Code 的多 Agent 工作台。它把 Claude Code、Codex CLI、Gemini CLI、OpenCode、Goose 和 Aider 等外部编码 Agent 汇聚到同一个侧边栏里，并提供上下文感知提示词、CLI 配置管理、自定义 API 供应商桥接和原生 Git 提交信息生成能力。

> **早期版本 v0.0.2。** 核心扩展逻辑和 Webview UI 已可用，后续会围绕真实工作流持续迭代。

---

## 功能特性

- **多 Agent 侧边栏**：在 VS Code 内直接切换已安装的 CLI Agent，每个 Agent 都保留自己的模型、模式、运行时和权限控制。
- **上下文感知提示词**：自动附加工作区信息、当前文件、选区和诊断信息，并可在设置中控制上下文大小。
- **CLI 配置系统**：内置 Claude Code、Codex CLI、Gemini CLI、OpenCode、Goose 和 Aider 的执行配置，处理命令查找、参数构造、输入模式和后台服务生命周期。
- **后台服务支持**：OpenCode 等支持持久会话的 Agent 可以保持后台服务运行，降低连续对话延迟。
- **编辑器动作命令**：在编辑器右键菜单中解释选区、审查当前文件、生成测试或重构代码，并自动路由到当前 Agent。
- **Git 提交信息生成**：在 VS Code 源代码管理视图中，根据暂存区 diff 生成符合 Conventional Commits 的提交信息。
- **自定义 API 供应商**：可配置自己的 API 地址、模型和密钥，并按 Agent 映射使用；密钥可通过 VS Code 设置同步或环境变量管理。
- **中英文界面**：扩展命令、设置项和 Webview 均支持简体中文与英文。
- **供应商扩展桥接**：可从侧边栏直接打开 OpenCode、Codex、Claude Code、Gemini CLI 等配套 VS Code 扩展。
- **Token 统计**：支持 Anthropic tokenizer 和 OpenAI cl100k 统计，并提供按供应商回退的估算能力。

---

## 使用要求

- **VS Code** 1.85+
- **Node.js** 18+
- 至少安装一个受支持的 CLI Agent：
  - [OpenCode](https://github.com/sst/opencode)
  - [Codex CLI](https://github.com/openai/codex)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Goose](https://github.com/block/goose)
  - [Aider](https://github.com/paul-gauthier/aider)

---

## 快速开始

1. 从 VS Code Marketplace 安装 **Agents GUI**。
2. 安装至少一个 CLI Agent，例如 OpenCode 或 Codex CLI。
3. 点击活动栏里的 Agents GUI 图标，或运行命令 `Agents GUI：打开面板`。
4. 在侧边栏顶部选择 Agent，然后输入任务开始使用。

扩展默认使用 **OpenCode**。你可以在设置项 `agents-gui.defaultProvider` 中修改默认 Agent。

---

## Git 提交信息生成

Agents GUI 会接入 VS Code 原生源代码管理视图：

1. 先用 `git add` 把需要提交的文件加入暂存区。
2. 在源代码管理标题栏点击 Agents GUI 提交信息图标。
3. 扩展会只读取暂存区 diff，并结合输入框里已有的草稿提示生成提交信息。
4. 生成结果会流式写入提交信息输入框，完成后可直接提交。

提交信息默认遵循 VS Code 显示语言。中文界面下会默认生成中文提交信息，也可通过 `agents-gui.commitMessage.language` 手动切换。

---

## 常用配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `agents-gui.defaultProvider` | `"opencode"` | 编辑器命令默认使用的 AI 提供方 |
| `agents-gui.context.includeWorkspace` | `true` | 是否附加工作区元数据 |
| `agents-gui.context.includeCurrentFile` | `true` | 是否附加当前活动文件 |
| `agents-gui.context.includeSelection` | `true` | 是否附加当前编辑器选区 |
| `agents-gui.context.includeDiagnostics` | `true` | 是否附加当前文件诊断 |
| `agents-gui.context.maxFileChars` | `12000` | 当前文件上下文最大字符数 |
| `agents-gui.context.maxSelectionChars` | `8000` | 选区上下文最大字符数 |
| `agents-gui.context.maxDiagnostics` | `12` | 附加诊断的最大数量 |
| `agents-gui.apiProviders.customProviders` | `[]` | 自定义 API 供应商配置 |
| `agents-gui.apiProviders.defaultProviderId` | `""` | 全局默认自定义 API 供应商 |
| `agents-gui.apiProviders.agentProviderByCliId` | `{}` | 每个 Agent 的自定义 API 供应商覆盖配置 |
| `agents-gui.home.visibleAgentIds` | `[]` | 首页标题区展示的 Agent |
| `agents-gui.home.agentOrder` | `[]` | 首页标题区 Agent 展示顺序 |
| `agents-gui.commitMessage.provider` | `"default"` | Git 提交信息生成使用的 AI 提供方 |
| `agents-gui.commitMessage.language` | `"auto"` | Git 提交信息语言，默认跟随 VS Code |
| `agents-gui.commitMessage.maxDiffChars` | `60000` | 生成提交信息时附加的暂存区 diff 最大字符数 |

---

## 开发

```bash
# 安装依赖
npm install

# 构建扩展
npm run build

# 监听模式
npm run watch

# 运行测试
npm test

# 打包 VSIX
npm run package
```

### 发布与变更日志

本仓库使用 git tag 发布版本。推送 `v*` tag 后，`.github/workflows/release.yml` 会自动：

- 运行测试和 VSIX 打包。
- 根据历史 git commit 生成 release notes。
- 使用仓库密钥 `VSCE_PAT` 自动发布到 VS Code Marketplace。
- 创建或更新 GitHub Release，并上传 `agents-gui-<version>.vsix`。
- 将发布说明同步到 `docs` 分支，作为线上发布日志承接分支。

自动发布到 VS Code Marketplace 前，需要在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中新增 `VSCE_PAT`。该值应为 Azure DevOps Marketplace Personal Access Token，并且需要有管理/发布 VS Code 扩展的权限。

本地发布流程：

```bash
npm run changelog -- --version v0.0.2 --changelog CHANGELOG.md --release-notes dist/release-notes.md --docs-dir dist/release-docs
npm run package
git tag v0.0.2
git push origin main v0.0.2
```

### 项目结构

```text
src/
├── extension.ts          # 扩展激活与命令注册
├── sidebarProvider.ts    # Webview Provider 与消息处理
├── cliManager.ts         # CLI 进程生命周期管理
├── cliProfiles.ts        # 内置 Agent 配置
├── cliPathResolver.ts    # CLI 命令查找与 Shell 集成
├── apiProviders.ts       # 自定义 API 供应商运行时
├── contextCollector.ts   # IDE 上下文收集
├── promptBuilder.ts      # 上下文感知提示词构建
├── outputFormatter.ts    # CLI 输出归一化
├── tokenCounter.ts       # Token 统计
├── localization.ts       # 运行时多语言
├── opencodeAgents.ts     # OpenCode Agent 发现
├── actionGuards.ts       # 动作前置条件
├── providerExtensions.ts # VS Code 扩展桥接
└── assistantTypes.ts     # 共享类型定义
media/
├── main.html             # Webview 布局
├── main.js               # Webview 逻辑
├── main.css              # Webview 样式
├── i18n.js               # Webview 多语言
└── icon.svg              # 扩展图标
```

---

## 支持的 CLI Agent

| Agent | 配置 ID | 输入模式 | 后台服务 | Token 统计 |
|-------|--------|----------|----------|------------|
| OpenCode | `opencode` | argument | 支持，端口范围 46100+ | Anthropic tokens |
| Codex CLI | `codex` | argument | 不支持 | tiktoken cl100k |
| Claude Code | `claude` | argument | 不支持 | Anthropic tokens |
| Gemini CLI | `gemini` | argument | 不支持 | 暂无 |
| Goose | `goose` | stdin | 不支持 | 暂无 |
| Aider | `aider` | argument | 不支持 | tiktoken cl100k |

---

## 许可证

MIT
