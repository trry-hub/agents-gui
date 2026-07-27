import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RuntimeLocale } from './localization';

export interface WebviewAssetManifest {
  html: string;
  assets: Array<{ placeholder: string; path: string }>;
  providerIcons: Record<string, { light: string; dark: string }>;
  static: string[];
}

export function readWebviewAssetManifest(
  extensionUri: vscode.Uri
): WebviewAssetManifest {
  const manifestPath = path.join(
    extensionUri.fsPath,
    'media',
    'webview-assets.json'
  );
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WebviewAssetManifest;
}

export function webviewAssetPaths(extensionUri: vscode.Uri): string[] {
  const manifest = readWebviewAssetManifest(extensionUri);
  return [
    manifest.html,
    'webview-assets.json',
    ...manifest.assets.map((asset) => asset.path),
    ...Object.values(manifest.providerIcons).flatMap((icon) => [
      icon.light,
      icon.dark,
    ]),
    ...manifest.static,
  ];
}

export function providerIconPaths(
  extensionUri: vscode.Uri,
  providerId: string
): { light: string; dark: string } | undefined {
  return readWebviewAssetManifest(extensionUri).providerIcons[providerId];
}

export function renderWebviewHtml(options: {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  locale: RuntimeLocale;
  codexRendererEnabled: boolean;
}): string {
  const manifest = readWebviewAssetManifest(options.extensionUri);
  const htmlPath = path.join(
    options.extensionUri.fsPath,
    'media',
    manifest.html
  );
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
  for (const asset of manifest.assets) {
    html = html.replace(
      new RegExp(asset.placeholder, 'g'),
      getWebviewUri(
        options.extensionUri,
        options.webview,
        'media',
        ...asset.path.split('/')
      )
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
