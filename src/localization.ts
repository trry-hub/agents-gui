import { AssistantActionId } from './assistantTypes';

export type RuntimeLocale = 'en' | 'zh-CN';

type RuntimeMessageKey =
  | 'statusBar.text'
  | 'statusBar.tooltip'
  | 'notification.stoppedAll'
  | 'notification.installCommandCopied'
  | 'notification.installCommandSent'
  | 'notification.authCommandSent'
  | 'notification.messageCopied'
  | 'notification.refreshingProviders'
  | 'warning.starting'
  | 'error.unknownProvider'
  | 'error.activationFailed'
  | 'error.startFailed'
  | 'error.sendFailed'
  | 'error.missingSelection'
  | 'error.missingActiveFile'
  | 'warning.noOutput'
  | 'warning.apiProviderMissingKey'
  | 'providerExtension.notConfigured'
  | 'providerExtension.notInstalled'
  | 'providerExtension.openFailed'
  | 'providerAuth.unsupported'
  | 'mcpSettings.delete'
  | 'mcpSettings.confirmDelete';

const RUNTIME_MESSAGES: Record<RuntimeLocale, Record<RuntimeMessageKey, string>> = {
  en: {
    'statusBar.text': '$(sparkle) Agents GUI',
    'statusBar.tooltip': 'Open Agents GUI',
    'notification.stoppedAll': 'All AI CLI processes stopped.',
    'notification.installCommandCopied': 'Installation command copied to clipboard.',
    'notification.installCommandSent':
      'Installation command sent to the terminal. Click refresh after it finishes.',
    'notification.authCommandSent': '{provider} authentication command sent to the terminal.',
    'notification.messageCopied': 'Message copied to clipboard.',
    'notification.refreshingProviders': 'Refreshing Agents GUI providers...',
    'warning.starting': 'Agents GUI is still starting. Try again in a moment.',
    'error.unknownProvider': 'Unknown provider: {provider}',
    'error.activationFailed': 'Agents GUI failed to activate: {message}',
    'error.startFailed': 'Failed to start {provider}',
    'error.sendFailed': 'Failed to send input to CLI process',
    'error.missingSelection': 'Select code in the editor before running this action.',
    'error.missingActiveFile': 'Open a file in the editor before running this action.',
    'warning.noOutput':
      '{provider} is still running but has not produced output for {seconds}s. This usually means the CLI is waiting on auth, network, or a permission prompt.',
    'warning.apiProviderMissingKey':
      'API provider {provider} references {envName}, but that environment variable is not available to VS Code.',
    'providerExtension.notConfigured': 'No VS Code extension bridge is configured for {provider}.',
    'providerExtension.notInstalled':
      '{extension} is not installed. Opening the Extensions search.',
    'providerExtension.openFailed': 'Failed to open {extension}.',
    'providerAuth.unsupported': '{provider} does not expose a supported authentication command.',
    'mcpSettings.delete': 'Delete',
    'mcpSettings.confirmDelete': 'Delete MCP server "{name}"? This cannot be undone.',
  },
  'zh-CN': {
    'statusBar.text': '$(sparkle) Agents GUI',
    'statusBar.tooltip': '打开 Agents GUI',
    'notification.stoppedAll': '已停止所有 AI CLI 进程。',
    'notification.installCommandCopied': '安装命令已复制到剪贴板。',
    'notification.installCommandSent': '安装命令已发送到终端。完成后点击重新检测。',
    'notification.authCommandSent': '{provider} 认证命令已发送到终端。',
    'notification.messageCopied': '消息已复制到剪贴板。',
    'notification.refreshingProviders': '正在刷新 Agents GUI 提供方...',
    'warning.starting': 'Agents GUI 正在启动，请稍后再试。',
    'error.unknownProvider': '未知提供方：{provider}',
    'error.activationFailed': 'Agents GUI 激活失败：{message}',
    'error.startFailed': '启动 {provider} 失败',
    'error.sendFailed': '无法向 CLI 进程发送输入',
    'error.missingSelection': '请先在编辑器中选中代码，再运行这个动作。',
    'error.missingActiveFile': '请先在编辑器中打开一个文件，再运行这个动作。',
    'warning.noOutput':
      '{provider} 已运行 {seconds} 秒但还没有任何输出，通常是 CLI 正在等待登录、网络或权限提示。',
    'warning.apiProviderMissingKey':
      'API 供应商 {provider} 引用了 {envName}，但 VS Code 当前环境中没有这个环境变量。',
    'providerExtension.notConfigured': '{provider} 还没有配置对应的 VS Code 扩展入口。',
    'providerExtension.notInstalled': '尚未安装 {extension}，已打开扩展搜索。',
    'providerExtension.openFailed': '无法打开 {extension}。',
    'providerAuth.unsupported': '{provider} 没有可安全调用的认证命令。',
    'mcpSettings.delete': '删除',
    'mcpSettings.confirmDelete': '确认删除 MCP 服务器 "{name}"？此操作不可撤销。',
  },
};

const ACTION_LABELS: Record<RuntimeLocale, Record<AssistantActionId, string>> = {
  en: {
    freeform: 'Freeform request',
    explainSelection: 'Explain selected code',
    reviewFile: 'Review current file',
    generateTests: 'Generate tests',
    refactorSelection: 'Refactor selected code',
  },
  'zh-CN': {
    freeform: '自由提问',
    explainSelection: '解释选中代码',
    reviewFile: '审查当前文件',
    generateTests: '生成测试',
    refactorSelection: '重构选中代码',
  },
};

const ACTION_DEFAULT_TEXT: Record<RuntimeLocale, Record<AssistantActionId, string>> = {
  en: {
    freeform: 'Help with the current coding task.',
    explainSelection: 'Explain the selected code.',
    reviewFile: 'Review the current file for bugs, maintainability issues, and missing tests.',
    generateTests: 'Generate focused tests for the selected code or current file.',
    refactorSelection: 'Refactor the selected code while preserving behavior.',
  },
  'zh-CN': {
    freeform: '帮我处理当前编码任务。',
    explainSelection: '解释选中的代码。',
    reviewFile: '审查当前文件中的缺陷、可维护性问题和缺失测试。',
    generateTests: '为选中代码或当前文件生成聚焦的测试。',
    refactorSelection: '在保持行为不变的前提下重构选中代码。',
  },
};

export function resolveRuntimeLocale(language: string): RuntimeLocale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function runtimeT(
  locale: RuntimeLocale,
  key: RuntimeMessageKey,
  values: Record<string, string> = {}
): string {
  let message = RUNTIME_MESSAGES[locale][key] ?? RUNTIME_MESSAGES.en[key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replace(`{${name}}`, value);
  }
  return message;
}

export function runtimeActionLabel(locale: RuntimeLocale, action: AssistantActionId): string {
  return ACTION_LABELS[locale][action] ?? ACTION_LABELS.en[action];
}

export function runtimeDefaultActionText(locale: RuntimeLocale, action: AssistantActionId): string {
  return ACTION_DEFAULT_TEXT[locale][action] ?? ACTION_DEFAULT_TEXT.en[action];
}
