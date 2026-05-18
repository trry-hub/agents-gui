import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('Agents Hub uses the three-node mark as the global logo', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.equal(manifest.icon, 'media/icon.svg');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].icon, 'media/icon.svg');
  assert.deepEqual(
    manifest.contributes.commands.find((command) => command.command === 'agentsHub.generateCommitMessage')?.icon,
    {
      light: 'media/commit-message-light.svg',
      dark: 'media/commit-message-dark.svg',
    }
  );
  assert.ok(existsSync(new URL('../media/commit-message-light.svg', import.meta.url)));
  assert.ok(existsSync(new URL('../media/commit-message-dark.svg', import.meta.url)));
  assert.match(html, /<symbol id="agentsHubLogo"/);
  assert.match(html, /<div class="brand-mark"[^>]*aria-label="Agents Hub"/);
  assert.match(html, /<div class="brand-mark settings-brand-mark"[^>]*aria-label="Agents Hub"/);
  assert.match(css, /\.brand-mark\s*\{/);
  assert.match(css, /\.brand-logo\s*\{/);
});

test('SCM title command uses the Agents Hub mark as a toolbar-sized icon', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commitCommand = manifest.contributes.commands.find((command) => command.command === 'agentsHub.generateCommitMessage');
  const lightIcon = readFileSync(new URL('../media/commit-message-light.svg', import.meta.url), 'utf8');
  const darkIcon = readFileSync(new URL('../media/commit-message-dark.svg', import.meta.url), 'utf8');

  assert.deepEqual(commitCommand.icon, {
    light: 'media/commit-message-light.svg',
    dark: 'media/commit-message-dark.svg',
  });
  assert.match(lightIcon, /width="16" height="16" viewBox="0 0 16 16"/);
  assert.match(darkIcon, /width="16" height="16" viewBox="0 0 16 16"/);
  assert.match(lightIcon, /<circle cx="4\.2" cy="5\.2"/);
  assert.match(lightIcon, /<circle cx="11\.8" cy="5\.2"/);
  assert.match(lightIcon, /<circle cx="8" cy="12"/);
});
