# Agents GUI

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=agents-gui.agents-gui)
[![Website](https://img.shields.io/badge/Website-agents--gui.pages.dev-7c3aed)](https://agents-gui.pages.dev/)

**Agents GUI** 是一个面向 VS Code 的多 Agent 工作台。它把 Claude Code、Codex CLI、Gemini CLI、OpenCode、Goose 和 Aider 等外部编码 Agent 汇聚到同一个侧边栏，并将任务原样交给用户本机安装的 CLI 执行。

> **早期版本。** Agents GUI 正在围绕真实 VS Code 工作流持续迭代。

---

## 相关链接

- **官网 / 在线文档**：https://agents-gui.pages.dev/
- **VS Code Marketplace**：https://marketplace.visualstudio.com/items?itemName=agents-gui.agents-gui
- **GitHub 仓库**：https://github.com/trry-hub/agents-gui

---

## 功能特性

- **多 Agent 侧边栏**：在 VS Code 内直接选择已安装的 CLI Agent；本机 CLI 自身的认证、API、Provider、模型、权限、运行模式、MCP、插件和会话策略决定执行结果。
- **本机 CLI 直通**：扩展解析系统安装的可执行文件，只将已解析命令所在目录加入继承的 `PATH`，设置工作目录，并传递该 CLI 的原生单次提示词参数；输出会被流式解析，且可以停止。
- **全新单次进程**：每个用户请求和后续追问都会启动新的本机 CLI 进程，不复用进程或会话。上一轮对话会以文本、连同编辑器动作、IDE 上下文和附件，组成下一次提示词内容。
- **只读显示**：模型和上下文的已配置显示仅用于观察，不会向 CLI 注入模型、Provider、权限、运行模式或其他执行覆盖。
- **CLI 配置系统**：内置受支持 CLI 的发现、命令解析和原生单次提示词传输；扩展不会注入自定义 API Provider，也不会覆盖模型、运行模式或权限。
- **OpenCode 升级迁移**：只有配置中存在精确布尔标记 `__agents_gui_synced === true` 的旧 Provider 时，才会在变更前创建备份，并只删除这些旧 Provider 及匹配的顶层模型；没有带标记的 Provider 时不写入配置，也不创建备份，所有用户定义或未标记的配置都会保留。
- **编辑器动作命令**：在编辑器右键菜单中解释选区、审查当前文件、生成测试或重构代码，并自动路由到当前 Agent。
- **Git 提交信息生成**：在 VS Code 源代码管理视图中，根据暂存区 diff 生成符合 Conventional Commits 的提交信息。
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

扩展默认使用 **OpenCode**。你可以在设置项 `agents-gui.defaultProvider` 中修改默认 Agent。所选 CLI 是唯一执行目标：扩展不会在失败时自动切换到其他 CLI，也不会启动或连接受管的 OpenCode 后台服务，或施加任务策略/快速通道覆盖层。

---

## Git 提交信息生成

Agents GUI 会接入 VS Code 原生源代码管理视图：

1. 先用 `git add` 把需要提交的文件加入暂存区。
2. 在源代码管理标题栏点击 Agents GUI 提交信息图标。
3. 扩展会只读取暂存区 diff，并结合输入框里已有的草稿提示生成提交信息。
4. 生成结果会流式写入提交信息输入框，完成后可直接提交。

提交信息默认遵循 VS Code 显示语言。中文界面下会默认生成中文提交信息，也可通过 `agents-gui.commitMessage.language` 手动切换。要指定生成使用的 CLI，可在提交信息设置里选择具体 CLI，或将 `agents-gui.commitMessage.provider` 设为 `ask` 让每次生成前弹出选择。生成只调用所选 CLI，不会自动回退到其他 CLI。

---

## 常用配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `agents-gui.defaultProvider` | `"opencode"` | 编辑器命令默认选择的本机 CLI |
| `agents-gui.context.*` | — | 控制发送给 CLI 的提示词中附带的 IDE 上下文；不改变 CLI 的模型、Provider、权限或运行模式 |
| `agents-gui.home.visibleAgentIds` | `[]` | 首页标题区展示的 Agent |
| `agents-gui.home.agentOrder` | `[]` | 首页标题区 Agent 展示顺序 |
| `agents-gui.commitMessage.provider` | `"default"` | Git 提交信息生成使用的 CLI，支持 `default`、`ask` 或 CLI 配置 ID |
| `agents-gui.commitMessage.language` | `"auto"` | Git 提交信息语言，默认跟随 VS Code |
| `agents-gui.commitMessage.maxDiffChars` | `60000` | 生成提交信息时附加的暂存区 diff 最大字符数 |

---

## 支持的 CLI Agent

| Agent | 配置 ID | 原生单次提示词传输 | Token 统计 |
|-------|--------|------------------|------------|
| OpenCode | `opencode` | argument | Anthropic tokens |
| Codex CLI | `codex` | argument | tiktoken cl100k |
| Claude Code | `claude` | argument | Anthropic tokens |
| Gemini CLI | `gemini` | argument | 暂无 |
| Goose | `goose` | stdin | 暂无 |
| Aider | `aider` | argument | tiktoken cl100k |

---

## 反馈与支持

- 官网与使用文档：<https://agents-gui.pages.dev/>
- 问题反馈：<https://github.com/trry-hub/agents-gui/issues>

---

## 许可证

MIT
