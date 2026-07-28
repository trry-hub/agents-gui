# 更新日志

## v0.0.19 - 2026-07-28

### Windows 兼容性

- 修复 npm 安装的 OpenCode、Codex、Claude Code 与 Gemini `.cmd` shim 可发现但无法启动的问题，同时保持参数数组隔离，避免用户输入被解释为 shell 语法。
- 补全 Windows 用户级 CLI 搜索路径、OpenCode APPDATA/LOCALAPPDATA 路径、系统代理读取与进程树终止验证。
- 新增 Windows Node 20 CI，与 Ubuntu Node 18/20 一起执行完整质量检查。

### 发布质量

- 测试入口改为跨平台 Node 启动器，确保 Windows、macOS 与 Linux 使用一致的测试发现和参数传递逻辑。
- 发布审计只检查实际随扩展交付的运行时依赖；VSIX 明确排除内部工作树、Agent 元数据、Node.js、npm 与 `node_modules`。
- 扩展继续使用 VS Code Extension Host 自带的 Node.js，并调用系统中已安装的 Agent CLI。

## v0.0.18 - 2026-07-27

### 新增

- 新增与 Codex 对齐的规范化会话渲染链路，以 `thread → turn → typed item` 统一消息、推理、活动、审批、系统反馈与错误展示。
- 新增 React 类型化渲染器、流式增量合并、长会话 turn 级虚拟化和独立 Webview 预览。

### 改进

- Webview 重载时恢复 canonical transcript、活动运行时、Provider 与任务绑定，避免运行中的输入控制状态丢失。
- 新渲染器通过实验开关渐进启用，并支持无损回退到旧渲染层。

### 修复

- 修复重放与实时增量交错时的重复内容、宿主重启后的事件身份冲突，以及编辑器动作预检错误不可见的问题。
- 修复渲染器资源不可用时 canonical snapshot 可能被持久化流程清除的问题。

## v0.0.17 - 2026-07-27

### 新增

- 新增任务运行控制面，将轻量文本生成与有状态 Agent 执行拆分为独立链路。
- 新增 Provider 无关的能力策略与运输注册表，为后续 ACP 和原生协议适配建立统一边界。
- 新增流式回复渐进展示调度器，改善长回复的阅读节奏。
- 新增统一 SettingsManager，并强化 Extension Host smoke、Lint、Prettier 和提交前检查。

### 改进

- 提交信息生成使用精确 Git 仓库目录，并隔离 MCP、工具、插件与项目配置，显著缩短 OpenCode 首次输出时间。
- 提交信息生成支持分阶段超时、取消和 Provider 降级，命令层不再直接依赖 CLI 进程细节。
- CLI Provider 显式声明工作区读写、终端、会话续接和沙箱权限能力。
- 优化 OpenCode 服务端输出、会话状态、上下文统计和多 Provider 设置管理。

### 修复

- 修复交互请求的 assistant 流式消息未显示本次实际模型与上下文元数据的问题。
- 修复多根工作区下提交信息生成可能使用错误工作目录的问题。

## v0.0.16 - 2026-07-09

### 新增

- 会话历史面板改为扁平列表，移除按 Provider 分组的标题栏，每个会话项内联显示 Provider 图标。
- 会话历史面板支持拖拽调整宽度，宽度自动持久化，支持键盘方向键微调。
- 新增 OpenCodeConfigSync 模块，将 VS Code API Provider 配置自动同步写入 OpenCode 的 `opencode.json`，像 cc-switch 一样让 CLI 原生读取配置。
- 新增前端响应式状态管理器（stateManager.js），为后续 UI 架构演进打基础。

### 改进

- 会话生命周期职责分离：`register()` 只注册新会话，`replace()` 负责停止旧会话，消除重复的 `stopped` 消息。
- 请求链错误处理：前一个请求失败时通过 `postError` 上报给用户，不再静默吞掉。
- 设置页面 CSS 优先级修复，打开设置时正确遮盖会话历史面板和侧边栏。
- 会话历史项状态文案默认隐藏，仅在 hover 和键盘聚焦时展示。
- OpenCode 有侧边栏时隐藏工具栏历史下拉框，避免信息冗余。
- 会话续接逻辑加固：续接 ID 与 optionKey 绑定，切换 model/provider 后不再续接旧会话。
- Model 大小写规范化：写入 opencode.json 时匹配 models 列表中的规范大小写。
- 输出格式化缓冲区从 16K 提升到 64K，支持更大的 prompt echo 过滤。
- 代码围栏自适应：根据内容中的反引号/波浪号自动选择更长围栏，避免转义丢失。

### 修复

- 修复 `register()` 重复停止旧会话导致新会话运行状态被意外清除。
- 修复设置页面无法完全遮盖会话历史面板的 CSS 优先级问题。
- 修复会话历史项内容被截断的布局问题。
- 修复 fence 转义导致代码块内容丢失的问题。
- 修复 compactHistoryText 在 emoji 边界截断产生 lone surrogate 的问题。

## v0.0.9 - 2026-06-07

### 修复

- 优化提交信息生成的 OpenCode 模型选择，忽略 `configured` 占位值并支持自定义模型回填。
- 让提交信息生成在当前 CLI 失败后继续尝试其他已安装 CLI，提升可用性。
- 将 OpenCode 的提交信息生成切回标准 `run` 路径，避开 `prompt_async` 的 `session_message.seq` 写库错误。
- OpenCode 提交信息生成默认尊重自身 configured 模型，关闭 thinking 输出，并绕过后台 attach server。
- 提交信息生成尊重插件里的 CLI 设置；所选 CLI 使用本地 CLI 配置的模型，不再注入 GUI 侧模型参数。

## v0.0.8 - 2026-06-07

### 修复

- 修复 Gemini CLI 在 macOS 系统代理环境下的 headless 启动卡顿。
- 修复 Aider 与 Goose 使用自定义 OpenAI-compatible Provider 时的环境变量适配。
- 优化提交信息生成的 OpenCode 默认模型选择，避免默认模型不可用导致失败。

## v0.0.4 - 2026-05-25

Range: `v0.0.3..HEAD`

### 修复

- 修复提交生成停止态并拆分用户文档 (da78f76)

### 文档

- update website links (9954e6e)

## v0.0.3 - 2026-05-23

Range: `v0.0.2..HEAD`

### 修复

- harden commit message generation (0c3dc0d)

### 工作流

- 自动发布到 VS Code Marketplace (a5ac296)

## v0.0.2 - 2026-05-22

Range: `v0.0.1..HEAD`

### 修复

- 排除发布临时产物 (6da928c)
- 优化 Codex 输入区与 CLI 进程清理 (14b8612)
- 修复交互状态并补充 0.0.2 QA 文档 (d4e8aa0)

### 文档

- 生成 0.0.2 发布日志 (07e54b1)

### 维护

- 添加发布日志工作流 (6818a0b)

## 0.0.1 (2026-05-20)

- 首个公开版本。
- 提供多 Agent 侧边栏，支持 OpenCode、Codex CLI、Claude Code、Gemini CLI、Goose 和 Aider。
- 支持附加工作区、当前文件、选区和诊断信息的上下文感知提示词。
- 提供 CLI 配置系统，并为支持持久会话的 Agent 提供后台服务能力。
- 提供编辑器动作命令：解释、审查、生成测试和重构。
- 支持自定义 API 供应商配置，并可使用环境变量或 VS Code 设置同步密钥。
- 在 VS Code 源代码管理视图中，根据暂存区变更生成 Git 提交信息。
- 支持 Anthropic tokenizer 与 OpenAI cl100k 的 Token 统计。
- 支持英文和简体中文界面。
- 支持 OpenCode、Codex、Claude Code 和 Gemini CLI 的 VS Code 扩展桥接。
- 开发模式支持 Webview 热更新。
- 打包产物已包含 tiktoken wasm 运行时资源。
