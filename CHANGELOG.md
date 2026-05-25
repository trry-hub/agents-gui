# 更新日志

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
