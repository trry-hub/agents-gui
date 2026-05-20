import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const esbuildScript = readFileSync(new URL('../esbuild.mjs', import.meta.url), 'utf8');
const vscodeIgnore = readFileSync(new URL('../.vscodeignore', import.meta.url), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('all contributed commands are registered by the extension host entrypoint', () => {
  for (const command of manifest.contributes.commands.map((entry) => entry.command)) {
    assert.match(
      extensionSource,
      new RegExp(`registerCommand\\('${escapeRegExp(command)}'`),
      `${command} must be registered in src/extension.ts`
    );
  }
});

test('view title commands are registered before the sidebar provider is constructed', () => {
  const providerIndex = extensionSource.indexOf('new SidebarProvider');
  assert.notEqual(providerIndex, -1, 'expected SidebarProvider construction in src/extension.ts');

  for (const command of ['agents-gui.refreshProviders', 'agents-gui.openProviderSettings']) {
    const commandIndex = extensionSource.indexOf(`registerCommand('${command}'`);
    assert.notEqual(commandIndex, -1, `expected ${command} registration in src/extension.ts`);
    assert.ok(
      commandIndex < providerIndex,
      `${command} must be registered before SidebarProvider construction`
    );
  }
});

test('packaged build includes the tiktoken wasm runtime asset', () => {
  assert.match(esbuildScript, /tiktoken\/lite\/tiktoken_bg\.wasm/);
  assert.match(esbuildScript, /dist\/tiktoken_bg\.wasm/);
  assert.match(esbuildScript, /build\.onEnd/);
  assert.doesNotMatch(vscodeIgnore, /^\s*\*\*\/\*\.wasm\s*$/m);
});
