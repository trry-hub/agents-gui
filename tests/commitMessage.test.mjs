import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildCommitMessagePrompt,
  cleanGeneratedCommitMessage,
  resolveCommitMessageLanguage,
  truncateCommitDiff,
} = require('../.test-dist/commitMessage.js');

test('resolveCommitMessageLanguage follows VS Code locale by default', () => {
  assert.equal(resolveCommitMessageLanguage('zh-cn'), 'zh-CN');
  assert.equal(resolveCommitMessageLanguage('zh-Hant'), 'zh-CN');
  assert.equal(resolveCommitMessageLanguage('en'), 'en');
  assert.equal(resolveCommitMessageLanguage('fr'), 'en');
});

test('buildCommitMessagePrompt requires staged-only commit messages in Chinese', () => {
  const prompt = buildCommitMessagePrompt({
    diff: 'diff --git a/src/a.ts b/src/a.ts\n+export const ok = true;\n',
    language: 'zh-CN',
    truncated: false,
  });

  assert.match(prompt, /Only use the staged Git diff/);
  assert.match(prompt, /Generate the commit message in Simplified Chinese/);
  assert.match(prompt, /Do not mention unstaged or untracked changes/);
  assert.match(prompt, /diff --git a\/src\/a\.ts b\/src\/a\.ts/);
});

test('buildCommitMessagePrompt calls out truncated staged diffs', () => {
  const prompt = buildCommitMessagePrompt({
    diff: 'diff --git a/src/a.ts b/src/a.ts\n',
    language: 'en',
    truncated: true,
  });

  assert.match(prompt, /The staged diff was truncated/);
});

test('buildCommitMessagePrompt carries existing SCM input as user draft context', () => {
  const prompt = buildCommitMessagePrompt({
    diff: 'diff --git a/src/a.ts b/src/a.ts\n+export const ok = true;\n',
    language: 'en',
    truncated: false,
    inputMessage: 'fix(env): clarify env sample',
  });

  assert.match(prompt, /Existing Source Control input/);
  assert.match(prompt, /fix\(env\): clarify env sample/);
  assert.match(prompt, /Use this input as a user-provided draft or intent/);
  assert.match(prompt, /staged diff remains the source of truth/);
});

test('cleanGeneratedCommitMessage strips markdown fences and explanation', () => {
  const message = cleanGeneratedCommitMessage(
    [
      'Here is the commit message:',
      '```',
      'feat: 支持 AI 生成提交信息',
      '',
      '根据暂存区 diff 生成提交描述。',
      '```',
      'This follows Conventional Commits.',
    ].join('\n')
  );

  assert.equal(message, 'feat: 支持 AI 生成提交信息\n\n根据暂存区 diff 生成提交描述。');
});

test('truncateCommitDiff keeps staged diff under the configured limit', () => {
  const diff = `diff --git a/a b/a\n${'x'.repeat(80)}`;
  const result = truncateCommitDiff(diff, 30);

  assert.equal(result.truncated, true);
  assert.equal(result.diff.length, 30);
});

test('extension contributes SCM title actions for staged AI commit messages', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commitCommand = manifest.contributes.commands.find((command) => command.command === 'agentsHub.generateCommitMessage');
  const cancelCommand = manifest.contributes.commands.find((command) => command.command === 'agentsHub.cancelCommitMessageGeneration');
  const commands = manifest.contributes.commands.map((command) => command.command);
  const scmTitleActions = manifest.contributes.menus['scm/title'] ?? [];
  const scmIdleAction = scmTitleActions.find(
    (item) => item.command === 'agentsHub.generateCommitMessage'
      && item.when === 'scmProvider == git && !agentsHub.commitMessageGenerating'
  );
  const scmGeneratingLogoAction = scmTitleActions.find(
    (item) => item.command === 'agentsHub.generateCommitMessage'
      && item.when === 'scmProvider == git && agentsHub.commitMessageGenerating'
  );
  const scmCancelAction = scmTitleActions.find(
    (item) => item.command === 'agentsHub.cancelCommitMessageGeneration'
  );
  const scmInputBoxCommands = manifest.contributes.menus['scm/inputBox']?.map((item) => item.command) ?? [];
  const properties = manifest.contributes.configuration.properties;

  assert.ok(manifest.extensionDependencies.includes('vscode.git'));
  assert.ok(!manifest.enabledApiProposals?.includes('contribSourceControlInputBoxMenu'));
  assert.ok(manifest.activationEvents.includes('onCommand:agentsHub.generateCommitMessage'));
  assert.ok(manifest.activationEvents.includes('onCommand:agentsHub.cancelCommitMessageGeneration'));
  assert.ok(commands.includes('agentsHub.generateCommitMessage'));
  assert.ok(commands.includes('agentsHub.cancelCommitMessageGeneration'));
  assert.ok(!commands.includes('agentsHub.generateCommitMessage.loading'));
  assert.deepEqual(commitCommand.icon, {
    light: 'media/commit-message-light.svg',
    dark: 'media/commit-message-dark.svg',
  });
  assert.equal(cancelCommand.icon, '$(debug-stop)');
  assert.ok(!scmInputBoxCommands.includes('agentsHub.generateCommitMessage'));
  assert.equal(scmIdleAction.group, 'navigation@-100');
  assert.ok(!scmTitleActions.some((item) => item.command === 'agentsHub.generateCommitMessage.loading'));
  assert.equal(scmCancelAction.when, 'scmProvider == git && agentsHub.commitMessageGenerating');
  assert.equal(scmCancelAction.group, 'navigation@-101');
  assert.equal(scmGeneratingLogoAction, undefined);
  assert.deepEqual(properties['agentsHub.commitMessage.provider'].enum, [
    'default',
    'claude',
    'gemini',
    'codex',
    'opencode',
    'goose',
    'aider',
  ]);
  assert.equal(properties['agentsHub.commitMessage.provider'].default, 'default');
  assert.ok(properties['agentsHub.commitMessage.language']);
  assert.ok(properties['agentsHub.commitMessage.maxDiffChars']);
});

test('commit message command uses staged git diff and writes to repository input box', () => {
  const source = readFileSync(new URL('../src/commitMessageCommand.ts', import.meta.url), 'utf8');

  assert.match(source, /getExtension<GitExtension>\('vscode\.git'\)/);
  assert.match(source, /repository\.state\.indexChanges\.length/);
  assert.match(source, /repository\.diff\(true\)/);
  assert.match(source, /repository\.inputBox\.value = message/);
  assert.match(source, /const inputMessage = repository\.inputBox\.value\.trim\(\)/);
  assert.match(source, /buildCommitMessagePrompt\(\{ diff, language, truncated, inputMessage \}\)/);
  assert.match(source, /getRepository\(rootUri\)/);
  assert.match(source, /generateCommitMessageWithCancellation/);
  assert.match(source, /profile\.id === 'opencode'/);
  assert.match(
    source,
    /runOpenCodePromptViaServer\(\s*prompt,\s*token,\s*repositoryRoot,\s*this\.getStoredOpenCodeModelId\(\)\s*\)/s
  );
  assert.doesNotMatch(source, /\['--pure', \.\.\.args\]/);
  assert.match(source, /isProviderErrorOutput\(output\)/);
  assert.match(source, /getConfiguredProvider\(\)/);
  assert.match(source, /MODEL_STATE_KEY = 'agentsHub\.modelByProvider'/);
  assert.match(source, /this\.state\?\.get<Record<string, string>>\(MODEL_STATE_KEY/);
  assert.match(source, /setContext', 'agentsHub\.commitMessageGenerating'/);
  assert.match(source, /ProgressLocation\.SourceControl/);
  assert.match(source, /cancel\(\): void/);
  assert.match(source, /isLikelyCliError\(normalizedStderr\)/);
  assert.doesNotMatch(source, /diff\(false\)/);
});

test('sidebar persists the selected model so SCM commit generation can reuse it', () => {
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const mediaSource = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(sidebarSource, /MODEL_STATE_KEY = 'agentsHub\.modelByProvider'/);
  assert.match(sidebarSource, /activeModelByProvider: this\.getStoredModelState\(\)/);
  assert.match(sidebarSource, /this\.state\.update\(\s*MODEL_STATE_KEY,\s*this\.normalizeModelState\(payload\.activeModelByProvider\)/s);
  assert.match(mediaSource, /activeModelByProvider,\s*\}\);/);
  assert.match(mediaSource, /activeModelByProvider = hasAppliedPersistentSelection/);
  assert.match(mediaSource, /persist\(\);\s*persistUserSelection\(\);\s*renderAll\(\);\s*refreshActiveContext\(\);/);
  assert.match(mediaSource, /modelSelect\.addEventListener\('change'[\s\S]*persistUserSelection\(\);[\s\S]*renderAll\(\);/);
});

test('extension registers SCM title generation and cancel commands', () => {
  const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

  assert.match(source, /setContext', 'agentsHub\.commitMessageGenerating', false/);
  assert.match(source, /registerCommand\('agentsHub\.generateCommitMessage', \(rootUri, _resourceGroups, token\) =>/);
  assert.match(source, /return commitMessageCommand\.run\(rootUri, token\)/);
  assert.match(source, /registerCommand\('agentsHub\.cancelCommitMessageGeneration', \(\) =>/);
  assert.match(source, /commitMessageCommand\.cancel\(\)/);
  assert.doesNotMatch(source, /registerCommand\('agentsHub\.generateCommitMessage\.loading'/);
  assert.doesNotMatch(source, /void commitMessageCommand\.run\(\)/);
});
