export interface ProviderExtensionBridge {
  providerId: string;
  extensionId: string;
  displayName: string;
  openCommands: string[];
}

export const PROVIDER_EXTENSION_BRIDGES: ProviderExtensionBridge[] = [
  {
    providerId: 'codex',
    extensionId: 'openai.chatgpt',
    displayName: 'Codex',
    openCommands: ['chatgpt.openSidebar', 'chatgpt.newCodexPanel'],
  },
  {
    providerId: 'claude',
    extensionId: 'anthropic.claude-code',
    displayName: 'Claude Code',
    openCommands: ['claude-vscode.sidebar.open', 'claude-vscode.editor.openLast'],
  },
  {
    providerId: 'opencode',
    extensionId: 'sst-dev.opencode',
    displayName: 'OpenCode',
    openCommands: ['opencode.openTerminal'],
  },
  {
    providerId: 'gemini',
    extensionId: 'google.gemini-cli-vscode-ide-companion',
    displayName: 'Gemini CLI',
    openCommands: ['gemini-cli.runGeminiCLI'],
  },
];

export function getProviderExtensionBridge(
  providerId: string
): ProviderExtensionBridge | undefined {
  return PROVIDER_EXTENSION_BRIDGES.find((bridge) => bridge.providerId === providerId);
}
