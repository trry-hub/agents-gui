# Agents GUI 开发指南

这份文档面向仓库维护者和贡献者。VS Code Marketplace 与扩展详情页展示的用户文档在 [README.md](./README.md)，不要把本地开发、发布密钥或维护者流程写入 Marketplace 用户说明。

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
npm run changelog -- --version vX.Y.Z --changelog CHANGELOG.md --release-notes dist/release-notes.md --docs-dir dist/release-docs
npm run package
git tag vX.Y.Z
git push origin main vX.Y.Z
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
