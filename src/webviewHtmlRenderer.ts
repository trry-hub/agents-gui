import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RuntimeLocale } from './localization';

const WEBVIEW_ASSETS = [
  ['__MAIN_CSS_URI__', ['media', 'main.css']],
  ['__I18N_JS_URI__', ['media', 'i18n.js']],
  ['__MESSAGE_TEXT_JS_URI__', ['media', 'messageText.js']],
  ['__MESSAGE_CHOICES_JS_URI__', ['media', 'messageChoices.js']],
  ['__PROVIDER_RUN_STATE_JS_URI__', ['media', 'providerRunState.js']],
  ['__PROVIDER_CAPABILITIES_JS_URI__', ['media', 'providerCapabilities.js']],
  ['__CONVERSATION_STORE_JS_URI__', ['media', 'conversationStore.js']],
  ['__SESSION_HISTORY_JS_URI__', ['media', 'sessionHistory.js']],
  ['__SLASH_COMMANDS_JS_URI__', ['media', 'slashCommands.js']],
  ['__OPEN_CODE_DIALOG_STATE_JS_URI__', ['media', 'openCodeDialogState.js']],
  ['__CLAUDE_ACTIONS_JS_URI__', ['media', 'claudeActions.js']],
  ['__INLINE_MARKDOWN_JS_URI__', ['media', 'inlineMarkdown.js']],
  ['__WORKBENCH_LAYOUT_JS_URI__', ['media', 'workbenchLayout.js']],
  ['__TASK_BOARD_STATE_JS_URI__', ['media', 'taskBoardState.js']],
  ['__COMPOSER_STATE_JS_URI__', ['media', 'composerState.js']],
  ['__PROVIDER_OPTIONS_JS_URI__', ['media', 'providerOptions.js']],
  ['__STATE_MANAGER_JS_URI__', ['media', 'stateManager.js']],
  ['__PACED_REVEAL_JS_URI__', ['media', 'pacedReveal.js']],
  ['__CODEX_RENDERER_JS_URI__', ['media', 'codex-renderer.js']],
  ['__MAIN_JS_URI__', ['media', 'main.js']],
] as const;

export function renderWebviewHtml(options: {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  locale: RuntimeLocale;
  codexRendererEnabled: boolean;
}): string {
  const htmlPath = path.join(options.extensionUri.fsPath, 'media', 'main.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const nonce = getNonce();
  const csp = [
    `default-src 'none';`,
    `img-src ${options.webview.cspSource} data: https:;`,
    `style-src ${options.webview.cspSource};`,
    `script-src ${options.webview.cspSource} 'nonce-${nonce}';`,
    `font-src ${options.webview.cspSource};`,
    `base-uri 'none';`,
    `form-action 'none';`,
  ].join(' ');

  html = html.replace('__CSP__', csp);
  html = html.replace(/__NONCE__/g, nonce);
  html = html.replace(/__LOCALE__/g, options.locale);
  html = html.replace(
    /__CODEX_RENDERER_ENABLED__/g,
    String(options.codexRendererEnabled)
  );
  for (const [placeholder, assetPath] of WEBVIEW_ASSETS) {
    html = html.replace(
      new RegExp(placeholder, 'g'),
      getWebviewUri(options.extensionUri, options.webview, ...assetPath)
    );
  }
  return html;
}

function getWebviewUri(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  ...paths: string[]
): string {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...paths)).toString();
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
