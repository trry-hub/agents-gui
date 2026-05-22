# Full-Spectrum Test Report: Agents GUI

测试日期: 2026-05-22
测试环境: VS Code Extension Development Host `[扩展开发宿主] 欢迎 — pc`, macOS, `agents-gui@0.0.2`
测试方法: `full-spectrum-test` 三阶段工作流，结合既有 Computer Use 真实 UI 验证、Node 自动化测试、源码/manifest 静态检查、VSIX 打包验证。

## 1. 测试概览

| 指标 | 数量 |
| --- | ---: |
| 总用例 | 181 |
| 通过 | 166 |
| 修复后通过 | 4 |
| 失败 | 0 |
| 阻塞/未执行 | 11 |
| 已执行通过率 | 100% |
| 总体覆盖通过率 | 93.9% |

状态分布:

| 状态 | 数量 |
| --- | ---: |
| Automated pass | 117 |
| Static pass | 25 |
| Manual pass | 24 |
| Fixed | 4 |
| Not run | 11 |

## 2. 测试计划

| 维度 | 范围 | P0/P1 重点 |
| --- | --- | --- |
| 功能正确性 | 激活、Provider 检测、Composer、运行生命周期、历史会话、设置、SCM 提交信息、编辑器上下文 | 扩展能启动；发送/停止状态不串；提交信息只基于 staged diff；无暂存变更不误导 |
| UI/视觉 | Sidebar、Composer、Settings、Slash Palette、Light theme、图标/品牌 | 斜杠菜单不悬浮错层；设置页和主界面不重叠；按钮/图标清晰 |
| 交互体验 | Esc、外部点击、菜单、输入启用、帮助弹窗、保存反馈 | Esc 能结束当前浮层；保存有明确反馈；菜单不造成重复加载态 |
| 易用性 | 空状态、禁用提示、无障碍名称、中文文案、错误提示 | 用户知道下一步；不可用按钮有原因；状态可被读屏识别 |
| 接口/数据 | Git API staged diff、OpenCode event stream、provider config、Settings Sync/secrets | staged-only；API key 不进同步态；流式输出可解析且归属正确 |
| 稳定性/性能 | Reload、打包、全量回归、长输出、ANSI/JSON chunk、后台清理 | reload 后恢复；159 条回归全过；VSIX 包含正确资源 |

Codex 专项补测: 已新增 `AGUI-CX-001` 到 `AGUI-CX-030`，覆盖 Codex CLI profile、模型/运行/权限、Codex composer、terminal banner、provider extension bridge、slash scope、SCM provider、输出清理和外部 Codex web/ChatGPT bridge 风险项。

## 3. 各维度详细结果

### 3.1 功能测试

| 模块 | 用例数 | 通过/修复 | 未执行 | 结论 |
| --- | ---: | ---: | ---: | --- |
| 安装、激活、打包 | 10 | 9 | 1 | manifest 命令、激活顺序、资源打包均通过；干净 profile 安装未执行 |
| Provider 检测 | 10 | 10 | 0 | OpenCode 默认激活、已安装 Provider 展示、缺失 Provider 防护、刷新按钮回归均通过 |
| Composer 与输入 | 19 | 17 | 2 | 空输入禁用、普通输入启用、长输入上限、模型/Agent 菜单、隐藏 native select 焦点保护、换行逻辑通过；真实发送和附件流程未执行 |
| 运行生命周期 | 14 | 13 | 1 | 停止态、流式输出、错误规整、owned-session 过滤通过；真实 provider 发送未执行 |
| 历史与会话 | 8 | 6 | 2 | 删除保护、确认/取消弹窗、OpenCode fork 清理路径通过；真实新会话/切换未执行 |
| 设置 | 15 | 15 | 0 | 设置进入/返回、保存反馈、Agent 布局、重排、显示全部、提交设置重置、API provider/secrets 均通过 |
| SCM 提交信息 | 17 | 17 | 0 | staged-only、超时/取消、中文格式、无暂存入口隐藏均通过 |
| 编辑器上下文 | 8 | 8 | 0 | 无选择禁用、当前文件/选择保护、诊断与截断通过 |
| Codex 专项 | 30 | 28 | 2 | CLI 参数、模型/权限/运行模式、Composer、terminal banner、输出清理、web/quota action 均通过；真实 Codex 发送、ChatGPT bridge 未执行 |

### 3.2 UI/视觉测试

| 检查点 | 结果 | 证据 |
| --- | --- | --- |
| Slash Palette 布局 | Pass after fix | Computer Use 观察 + CSS 回归，菜单成为 composer 内部 in-flow 区域 |
| 设置页布局 | Pass | 设置页替换主界面和 composer，无重叠 |
| Sidebar 空状态 | Pass | Provider tabs、历史选择、起始操作、composer 均可读 |
| Light theme 对比度 | Pass | 当前浅色主题视觉检查通过 |
| Logo/图标资源 | Pass | 自动化断言确认全局 logo 和 SCM title icon 使用正确资源 |
| Dark theme | Not run | 需要切换用户主题设置，本轮未改动用户环境 |

### 3.3 交互测试

| 检查点 | 优先级 | 结果 | 备注 |
| --- | --- | --- | --- |
| Slash `Esc` 关闭 | P0 | Fixed | 已加全局 Escape 处理，优先关闭 slash palette |
| Slash 外部点击关闭 | P1 | Fixed | 已加全局 click 处理 |
| `/help` 本地命令 | P1 | Pass | 打开帮助弹窗，不发起 provider 调用，`Esc` 可关闭 |
| `/sessions`/`/models`/`/agents` 本地菜单 | P1 | Pass | 静态回归确认只打开 OpenCode 本地 dialog，不触发 provider run |
| 设置保存反馈 | P1 | Pass | 显示 `正在保存...` 后显示 `设置已保存` |
| 设置显示全部/重排/重置 | P1 | Pass | 已补充本地状态和默认值回归，显示全部提供未保存提示 |
| 模型/Agent 菜单 | P1 | Pass | 原生菜单可打开，未出现重复加载状态 |
| 设置返回 | P1 | Pass | 从 settings 返回主界面无 stale state |

### 3.4 易用性测试

| 检查点 | 结果 | 建议 |
| --- | --- | --- |
| 禁用态说明 | Pass | 选择类操作在无选择时禁用并提供帮助说明 |
| 空状态引导 | Pass | 起始区域提供审查当前文件、生成单元测试等可操作入口 |
| 提交信息入口 | Fixed | 无暂存变更时隐藏 SCM 顶部入口，减少误导 |
| 中文文案 | Pass | Settings、slash、commit 设置均有中文文案 |
| 键盘完整焦点巡航 | Not run | 已补菜单项 `focus-visible` 轮廓，并验证隐藏 native select 不再抢焦点；完整 Tab 顺序仍需要单独长流程验证 |

### 3.5 接口/数据测试

| 数据流 | 结果 | 证据 |
| --- | --- | --- |
| Git staged diff | Pass | `commitMessage` 测试确认只读取 `repository.diff(true)` 和 staged diff |
| SCM 无暂存状态 | Fixed | Git API `indexChanges` 同步到 `agents-gui.hasStagedChanges`，manifest 入口受 context 控制 |
| Provider stream | Pass | OpenCode/Claude/Codex formatter 测试覆盖 JSON/SSE/chunk/error |
| Settings Sync | Pass | 非 secret 状态同步，API key/token 不进入 plain global state |
| 输出清理 | Pass | ANSI、内部 prompt、终端 trace、reasoning prose 均有回归覆盖 |
| Codex profile data | Pass | Codex `o200k_base` tokenizer、`258000` context window、`--color never`、`--ephemeral`、model/runtime/permission args 均纳入专项矩阵 |

### 3.6 稳定性/性能

| 检查点 | 结果 | 证据 |
| --- | --- | --- |
| 全量测试 | Pass | `npm test`，159 pass |
| 构建 | Pass | `npm run build` |
| 打包 | Pass | `npm run package`，生成 `agents-gui-0.0.2.vsix` |
| 空白检查 | Pass | `git diff --check` |
| Reload 恢复 | Pass | Computer Use 观察 provider detection 后恢复 composer |
| 长输出/异常输出 | Pass | formatter 回归覆盖长 transcript、JSON chunk、ANSI 片段 |

## 4. 问题汇总

### P0 - 严重

无未解决 P0。

已修复:

- Slash Palette 的 `Esc` 关闭范围过窄，导致焦点漂移时无法关闭。

### P1 - 中等

无未解决 P1。

已修复:

- Slash Palette 外部点击无法关闭。

### P2 - 优化

无未解决 P2。

已修复:

- Source Control 顶部提交信息按钮在无 staged diff 时仍显示，容易误导。
- 自定义菜单内视觉隐藏的原生 select 会进入 Tab 顺序，导致焦点落到不可见控件上。

## 5. 未执行项

未执行 11 项，原因如下:

| 类型 | 代表用例 | 原因 |
| --- | --- | --- |
| 干净安装 | AGUI-001 | 需要新 VS Code profile 或安装隔离环境 |
| 真实 provider 运行 | AGUI-023, AGUI-056 | 会触发真实 CLI/provider 任务，可能耗时或产生外部状态 |
| 文件选择/附件 | AGUI-028 | 会打开系统文件选择器 |
| 会话状态变更 | AGUI-070, AGUI-071 | 新会话、切换历史会改变本地历史状态 |
| 环境切换 | AGUI-127, AGUI-129 | 需要切换主题或长键盘巡航 |
| 发布凭据 | AGUI-150 | 需要 Marketplace publisher/PAT |
| Codex 外部状态 | AGUI-CX-020, AGUI-CX-030 | 会触发真实 Codex CLI 任务，或依赖 ChatGPT VS Code 扩展 |

## 6. 验证命令

```bash
npm test
npm run build
npm run package
git diff --check
```

Codex 专项补充:

```bash
node --test tests/promptBuilder.test.mjs
```

补充执行:

```bash
node -e "parse comprehensive-test-matrix.md status counts"
```

## 7. 2026-05-22 复测记录

本轮重新执行了可自动化、静态和打包验证的 full-spectrum 覆盖项:

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 矩阵计数 | Pass | 181 total: 117 Automated pass, 25 Static pass, 24 Manual pass, 4 Fixed, 11 Not run |
| Webview JS 语法 | Pass | `node --check media/main.js` |
| Codex/UI 专项断言 | Pass | `node --test tests/promptBuilder.test.mjs`，135 pass |
| 隐藏 select 焦点复验 | Pass | Playwright 预览中打开 Codex runtime 菜单后按 Tab，焦点进入可见 `menuitemradio` 并显示 1px outline |
| 全量 Node 回归 | Pass | `npm test`，159 pass |
| VSIX 打包 | Pass | `npm run package`，生成 `agents-gui-0.0.2.vsix`，26 files，3.53 MB |
| 空白检查 | Pass | `git diff --check` 和 `git diff --cached --check` |

本轮没有把 11 个外部依赖项标为通过；它们仍需要干净 VS Code profile、真实 provider/Codex 运行、文件选择器、主题切换、完整键盘巡航、ChatGPT extension bridge 或 Marketplace 凭据。

## 8. 总体评价

当前 `0.0.2` 的核心发布路径已经达到可发布状态: 主 UI、设置、slash palette、SCM 提交信息、Codex/OpenCode/Claude provider 输出规整、打包资源均有覆盖，且本轮发现的 4 个交互/易用性问题均已修复并纳入回归。

本轮又把 8 个原本依赖手动验证的低风险项前移到了自动化/静态质量门槛里，并补齐 30 个 Codex 专项用例。发布前剩余的高价值补测是干净 profile 安装、真实 provider/Codex 发送、文件选择器、主题/键盘长流程、ChatGPT bridge 和 Marketplace 上传；这些依赖隔离环境、真实运行、登录态或发布凭据，建议作为发布动作前的最后人工确认。
