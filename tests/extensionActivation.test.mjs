import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
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

test('refresh providers title action reloads the full sidebar state', () => {
  assert.match(
    extensionSource,
    /registerCommand\('agents-gui\.refreshProviders', async \(\) => \{[\s\S]*await provider\.refreshProviders\(\);[\s\S]*\}\)/
  );
  assert.match(
    sidebarSource,
    /async refreshProviders\(\): Promise<void> \{\s*await this\.sendProfiles\(\);\s*await this\.sendContextSummary\(\);\s*await this\.sendHomeAgentSettings\(\);\s*await this\.sendApiProviderSettings\(\);\s*await this\.sendCommitMessageSettings\(\);\s*\}/s
  );
});

test('packaged build avoids tokenizer wasm runtime assets', () => {
  assert.doesNotMatch(esbuildScript, /tiktoken/);
  assert.doesNotMatch(esbuildScript, /dist\/tiktoken_bg\.wasm/);
  assert.doesNotMatch(esbuildScript, /copy-runtime-assets/);
  assert.doesNotMatch(vscodeIgnore, /^\s*!\s*dist\/tiktoken_bg\.wasm\s*$/m);
});
