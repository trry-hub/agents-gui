import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
const sidebar = readFileSync(
  new URL('../src/sidebarProvider.ts', import.meta.url),
  'utf8'
);
const renderer = readFileSync(
  new URL('../src/webviewHtmlRenderer.ts', import.meta.url),
  'utf8'
);
const protocol = readFileSync(
  new URL('../src/webviewProtocol.ts', import.meta.url),
  'utf8'
);

test('manifest exposes a production-safe Codex renderer feature flag', () => {
  assert.deepEqual(
    manifest.contributes.configuration.properties[
      'agents-gui.experimental.codexRenderer'
    ],
    {
      type: 'boolean',
      default: false,
      description: '%config.experimental.codexRenderer.description%',
    }
  );
});

test('webview injects the renderer flag and loads the React bundle before the coordinator', () => {
  assert.match(html, /<body[^>]*data-codex-renderer="__CODEX_RENDERER_ENABLED__"/);
  assert.match(
    html,
    /__CODEX_RENDERER_JS_URI__[\s\S]*__MAIN_JS_URI__/
  );
  assert.match(renderer, /\['__CODEX_RENDERER_JS_URI__', \['media', 'codex-renderer\.js'\]\]/);
  assert.match(renderer, /codexRendererEnabled: boolean/);
  assert.match(renderer, /__CODEX_RENDERER_ENABLED__/);
  assert.match(sidebar, /this\.extensionMode === vscode\.ExtensionMode\.Development/);
  assert.match(sidebar, /get<boolean>\('experimental\.codexRenderer', false\)/);
  assert.match(
    sidebar,
    /renderWebviewHtml\(\{[\s\S]*codexRendererEnabled: this\.isCodexRendererEnabled\(\)/
  );
});

test('legacy shell mounts and delegates transcript ownership to the renderer when enabled', () => {
  assert.match(script, /const codexRenderer = window\.AgentsGuiCodexRenderer;/);
  assert.match(
    script,
    /const codexRendererEnabled = document\.body\.dataset\.codexRenderer === 'true'/
  );
  assert.match(script, /codexRenderer\.mount\(\{/);
  assert.match(script, /case 'threadEvent':\s*codexRenderer\?\.dispatch\(message\);/);
  assert.match(
    script,
    /if \(codexRendererEnabled\) \{\s*syncCodexRendererContext\(\);\s*\} else \{\s*renderMessages\(\);/
  );
  assert.match(script, /threadId: activeThreadId\(providerId\)/);
  assert.match(
    script,
    /codexRendererEnabled\s*\?\s*codexRenderer\.getConversationHistory\(cliId, activeThreadId\(cliId\)\)/
  );
  assert.match(script, /conversationSnapshot: codexRendererEnabled \? codexRenderer\.serialize\(\) : undefined/);
});

test('flag-on lifecycle handlers update shell state without mutating legacy transcript arrays', () => {
  assert.match(script, /case 'output':\s*if \(!codexRendererEnabled\) \{\s*updateStream\(message\);/);
  assert.match(
    script,
    /case 'sessionEnd':\s*if \(codexRendererEnabled\) \{\s*markCodexSessionEnded\(message\);/
  );
  assert.match(script, /codexRenderer\.ensureThread\(cliId, thread\.id, thread\.title/);
  assert.match(script, /codexRenderer\.deleteThread\(cliId, thread\.id\)/);
  assert.match(script, /codexRenderer\.getThreadSummaries\(\)/);
});

test('renderer failure can disable the experiment without taking down the shell', () => {
  assert.match(protocol, /\{ command: 'disableCodexRenderer' \}/);
  assert.match(sidebar, /case 'disableCodexRenderer':\s*await this\.disableCodexRenderer\(\);/);
  assert.match(script, /command: 'disableCodexRenderer'/);
  assert.match(css, /\.codex-renderer-error\s*\{/);
  assert.match(css, /\.conversation-virtual-spacer\s*\{/);
  assert.match(css, /\.conversation-scroll-bottom\s*\{/);
});

