# Codex Full-Spectrum Test Report

测试日期: 2026-05-22
测试对象: Agents GUI `0.0.2` 的 Codex provider 专项能力
测试方法: `full-spectrum-test` 三阶段工作流，结合 Node 自动化测试、源码/资源静态检查、Playwright webview 预览、现有 QA 矩阵补测。

## 1. 结论

之前 Codex 没有作为独立专项完整测试，只在 provider 通用回归里被覆盖到。此次补测新增 30 个 Codex 专项用例，其中 28 个通过，2 个因需要真实外部状态或会触发实际 Codex 运行而标记为未执行。

| 指标 | 数量 |
| --- | ---: |
| Codex 专项用例 | 30 |
| Automated pass | 22 |
| Static pass | 6 |
| Not run | 2 |
| 失败 | 0 |
| 已执行通过率 | 100% |
| 专项覆盖通过率 | 93.3% |

## 2. 测试计划

| 维度 | 覆盖范围 | 重点风险 |
| --- | --- | --- |
| 功能正确性 | Codex CLI profile、模型、运行模式、权限、Agent 模式、命令查找 | CLI 参数错误会导致运行失败或权限模式不符合用户预期 |
| UI/视觉 | Codex provider icon、composer、runtime/permission/model 菜单、terminal banner | Codex UI 可能和 OpenCode/Claude 样式串扰，或者出现按钮错层 |
| 交互体验 | terminal banner 显隐、停止、详情跳转、slash provider scope、真实发送 | 停止按钮不生效、详情打开错误扩展、发送后产生重复 loading |
| 易用性 | 安装提示、本地模式文案、危险权限提示、SCM provider 配置 | 用户不清楚是否本地执行、误选危险权限或不可用云端模式 |
| 接口/数据 | CLI args 组合、token metadata、输出 JSON/HTML/noise 清理 | Codex 输出噪声污染 transcript，或模型/权限参数组合错误 |
| 稳定性/性能 | 无 ANSI color、ephemeral run、外部 Codex web/quota、ChatGPT bridge | 真实外部状态不可控，需要隔离实跑确认 |

## 3. 执行结果

### 3.1 功能正确性

| 检查点 | 结果 | 证据 |
| --- | --- | --- |
| CLI profile | Pass | `tests/promptBuilder.test.mjs` 覆盖 `codex` command、`-a never exec --color never --ephemeral`、argument input |
| 模型选项 | Pass | 默认 `gpt-5.4`，`gpt-5.5` / `gpt-5.4-mini` / `gpt-5.3-codex` / custom 都有参数断言 |
| 运行模式 | Pass | Local mode 可选，Codex web 和 quota 为 action-only，send cloud disabled |
| 权限模式 | Pass | `read-only`、`workspace-write`、`--full-auto`、danger flag 均有断言 |
| Agent 模式 | Pass | Build/Plan/Review workflow 和 implementation/review routing 有源码/测试覆盖 |
| 命令查找 | Pass | 登录 zsh 查找 `codex`，并过滤 nvm startup noise |

### 3.2 UI/视觉

| 检查点 | 结果 | 证据 |
| --- | --- | --- |
| Provider icon | Pass | Codex provider icon 被自动化断言为 light/dark slot 均可用 |
| Codex composer | Pass | CSS 回归覆盖 Codex compact shell、footer controls、灰色 send button |
| Terminal banner | Pass | HTML/i18n/CSS/JS 均有回归断言，包含 stop 与 details 按钮 |
| Runtime menu | Pass | 菜单为单层结构，Codex web/quota 显示 action affordance，文案本地化 |
| Permission menu | Pass | Codex read-only 隐藏规则和 danger warning 色彩有测试覆盖 |
| Dark theme live visual | Not run | 需要切换用户主题；当前只完成资源槽位静态验证 |

### 3.3 交互体验

| 检查点 | 结果 | 证据 |
| --- | --- | --- |
| Banner 显隐 | Pass | 仅 active provider 为 Codex 且 running 时显示；task board 可见时隐藏 |
| Banner stop | Pass | stop 复用 `requestStopActiveProvider()`，不会新建第二套停止逻辑 |
| Banner details | Pass | details 发送 `openProviderExtension`，进入 provider bridge |
| Provider bridge | Pass | Codex bridge 指向 `openai.chatgpt`，命令序列为 `chatgpt.newCodexPanel` / `chatgpt.openSidebar` |
| Slash commands | Pass | Native slash commands 包含 Codex provider scope |
| 真实 Codex 发送 | Not run | 会触发真实 Codex CLI 任务，可能消耗额度或改动工作区状态 |

### 3.4 易用性

| 检查点 | 结果 | 说明 |
| --- | --- | --- |
| 安装提示 | Pass | Codex profile 提供 `npm install -g @openai/codex` |
| Local-first 文案 | Pass | 默认 runtime 为 local processing，send cloud 处于 disabled 状态 |
| 危险权限提示 | Pass | danger mode 带 dangerous metadata 与明确风险文案 |
| SCM provider | Pass | Commit settings 识别 Codex provider，并避免把 `disabled` 映射持久化为有效 provider |

### 3.5 接口/数据

| 数据链路 | 结果 | 证据 |
| --- | --- | --- |
| CLI args 组合 | Pass | `buildCliOptionArgs` 覆盖模型、custom model、runtime fallback、permission flags |
| Token metadata | Pass | Codex profile 声明 `o200k_base` tokenizer、`258000` context window 和 auto-compaction |
| JSON 错误清理 | Pass | Codex JSON error 被规整为 `Error: ...` |
| 噪声清理 | Pass | telemetry warning、startup noise、Cloudflare challenge HTML 被过滤 |

### 3.6 稳定性/性能

| 检查点 | 结果 | 说明 |
| --- | --- | --- |
| 无 ANSI color | Pass | Codex profile 固定 `--color never` |
| ephemeral run | Pass | Codex profile 固定 `--ephemeral`，避免复用陈旧会话状态 |
| Codex web/quota 动作 | Pass | action-only 点击会打开 provider extension bridge，且不改变本地 runtime 选择 |
| Runtime 菜单键盘焦点 | Pass | Playwright 预览确认 `Tab` 跳过隐藏 native select，进入可见 runtime menuitem |
| ChatGPT extension 真机 bridge | Not run | 需要 Extension Host 安装并启用 `openai.chatgpt` 扩展 |

## 4. 问题汇总

无新增 P0/P1/P2 未解决问题。

本次暴露出的不是代码缺陷，而是测试缺口: 原报告没有把 Codex 从通用 provider 覆盖里单独拆出来，因此用户无法确认 Codex 的 CLI、UI、交互和数据链路到底测到了哪些点。现已补齐 `AGUI-CX-001` 到 `AGUI-CX-030`。

## 5. 未执行项

| 用例 | 原因 | 建议 |
| --- | --- | --- |
| AGUI-CX-020 | 真实 Codex prompt send 会触发真实 CLI 任务，可能消耗额度或改变工作区 | 发布前在隔离工作区用只读/临时 prompt 手动验证 |
| AGUI-CX-030 | ChatGPT extension bridge 依赖 `openai.chatgpt` 在 Extension Host 内可用 | 安装/启用后验证 details 按钮能打开对应 Codex 面板 |

## 6. 验证命令

```bash
node --test tests/promptBuilder.test.mjs
npm test
git diff --check
```

## 7. 2026-05-22 复测记录

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| Codex 专项矩阵 | Pass | `AGUI-CX-001` 到 `AGUI-CX-030` 仍为 28 pass / 2 not run |
| Codex CLI/UI/输出断言 | Pass | `node --test tests/promptBuilder.test.mjs`，135 pass |
| Codex runtime action 预览 | Pass | `codexWeb` 和 `quota` 均发送 `openProviderExtension`，菜单关闭且本地 runtime 不变 |
| Runtime 菜单焦点预览 | Pass | 打开 Codex runtime 菜单后按 Tab，焦点进入可见 `menuitemradio` 并显示 1px outline |
| 全量回归 | Pass | `npm test`，159 pass |
| 打包资源 | Pass | `npm run package` 包含 Codex icon、`media/main.html`、`media/main.js`、`media/main.css` |
