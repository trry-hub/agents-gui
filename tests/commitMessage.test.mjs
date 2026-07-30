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
  assert.match(prompt, /Language: Simplified Chinese summary after the colon/);
  assert.match(prompt, /Output only a Conventional Commits message/);
  assert.match(prompt, /Use one subject line when possible/);
  assert.doesNotMatch(prompt, /Always include a scope in parentheses/);
  assert.match(prompt, /No Markdown, reasoning/);
  assert.match(prompt, /Do not mention unstaged or untracked changes/);
  assert.match(prompt, /diff --git a\/src\/a\.ts b\/src\/a\.ts/);
  assert.ok(prompt.length < 800);
});

test('buildCommitMessagePrompt calls out truncated staged diffs', () => {
  const prompt = buildCommitMessagePrompt({
    diff: 'diff --git a/src/a.ts b/src/a.ts\n',
    language: 'en',
    truncated: true,
  });

  assert.match(prompt, /The staged diff was truncated; use only the visible staged diff/);
});

test('buildCommitMessagePrompt carries existing SCM input as user draft context', () => {
  const prompt = buildCommitMessagePrompt({
    diff: 'diff --git a/src/a.ts b/src/a.ts\n+export const ok = true;\n',
    language: 'en',
    truncated: false,
    inputMessage: 'fix(env): clarify env sample',
  });

  assert.match(prompt, /Existing Source Control input \(draft\/style only, not change evidence\)/);
  assert.match(prompt, /fix\(env\): clarify env sample/);
  assert.match(prompt, /Only use the staged Git diff/);
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

test('cleanGeneratedCommitMessage inserts a blank line before the body', () => {
  const message = cleanGeneratedCommitMessage(
    [
      'fix(vscode): 完善设置保存反馈并修复提交信息生成交互',
      '为首页 Agent、API 供应商和提交信息设置增加保存中、成功、失败状态提示。',
      '修复 OpenCode 会话串流、限额错误处理和停止态清理。',
    ].join('\n')
  );

  assert.equal(
    message,
    [
      'fix(vscode): 完善设置保存反馈并修复提交信息生成交互',
      '',
      '为首页 Agent、API 供应商和提交信息设置增加保存中、成功、失败状态提示。',
      '修复 OpenCode 会话串流、限额错误处理和停止态清理。',
    ].join('\n')
  );
});

test('cleanGeneratedCommitMessage rejects reasoning prose without a conventional subject', () => {
  const message = cleanGeneratedCommitMessage(
    [
      'The user wants me to generate a Git commit message based on the staged diff.',
      '',
      'The staged diff only shows trailing blank lines being added to `web/pc/.env.dev`.',
      '',
      'Since the change is just whitespace at the end of a config file, this is essentially a formatting change.',
    ].join('\n')
  );

  assert.equal(message, '');
});

test('cleanGeneratedCommitMessage extracts an embedded conventional subject after prose', () => {
  const message = cleanGeneratedCommitMessage(
    [
      'The staged diff shows only trailing blank lines being added to `web/pc/.env.dev`.',
      '',
      'I need to generate a concise Conventional Commits message in Simplified Chinese.',
      '',
      'Let me generate a simple commit message.chore(pc): 在 .env.dev 末尾添加空行',
    ].join('\n')
  );

  assert.equal(message, 'chore(pc): 在 .env.dev 末尾添加空行');
});

test('cleanGeneratedCommitMessage preserves CLI output without language or emoji rewrites', () => {
  const diff = [
    'diff --git a/.env.dev b/.env.dev',
    'index 1111111..2222222 100644',
    '--- a/.env.dev',
    '+++ b/.env.dev',
    '@@ -1 +1,3 @@',
    ' VITE_APP_NAME=agents-gui',
    '+',
    '+',
  ].join('\n');

  const message = cleanGeneratedCommitMessage(
    [
      'The staged diff shows only whitespace changes. Let me generate an appropriate commit message.',
      'chore(env): add trailing newlines to .env.dev',
    ].join(''),
    { language: 'zh-CN', diff }
  );

  assert.equal(message, 'chore(env): add trailing newlines to .env.dev');
  assert.doesNotMatch(message, /更新|🔧/);
});

test('cleanGeneratedCommitMessage keeps a valid conventional subject when scope is omitted', () => {
  const diff = [
    'diff --git a/.env.dev b/.env.dev',
    'index 1111111..2222222 100644',
    '--- a/.env.dev',
    '+++ b/.env.dev',
    '@@ -1 +1,3 @@',
    ' VITE_APP_NAME=agents-gui',
    '+',
    '+',
  ].join('\n');

  const message = cleanGeneratedCommitMessage('chore: 在 .env.dev 文件末尾添加空行', {
    language: 'zh-CN',
    diff,
  });

  assert.equal(message, 'chore: 在 .env.dev 文件末尾添加空行');
});

test('cleanGeneratedCommitMessage does not force scope from non-git diff headers', () => {
  const diff = [
    '--- .env.dev',
    '+++ .env.dev',
    '@@ -1 +1,2 @@',
    ' VITE_APP_NAME=agents-gui',
    '+',
  ].join('\n');

  const message = cleanGeneratedCommitMessage('chore: 在 .env.dev 文件末尾添加空行', {
    language: 'zh-CN',
    diff,
  });

  assert.equal(message, 'chore: 在 .env.dev 文件末尾添加空行');
});

test('cleanGeneratedCommitMessage preserves CLI output even when SCM input asks for emoji', () => {
  const diff = [
    'diff --git a/.env.dev b/.env.dev',
    'index 1111111..2222222 100644',
    '--- a/.env.dev',
    '+++ b/.env.dev',
    '@@ -1 +1,3 @@',
    ' VITE_APP_NAME=agents-gui',
    '+',
    '+',
  ].join('\n');

  const message = cleanGeneratedCommitMessage('chore(env): add trailing newlines to .env.dev', {
    language: 'zh-CN',
    diff,
    inputMessage: '要带上表情图标',
  });

  assert.equal(message, 'chore(env): add trailing newlines to .env.dev');
});

test('truncateCommitDiff keeps staged diff under the configured limit', () => {
  const diff = `diff --git a/a b/a\n${'x'.repeat(80)}`;
  const result = truncateCommitDiff(diff, 30);

  assert.equal(result.truncated, true);
  assert.equal(result.diff.length, 30);
});

test('extension contributes SCM title actions for staged AI commit messages', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commitCommand = manifest.contributes.commands.find(
    (command) => command.command === 'agents-gui.generateCommitMessage'
  );
  const cancelCommand = manifest.contributes.commands.find(
    (command) => command.command === 'agents-gui.cancelCommitMessageGeneration'
  );
  const commands = manifest.contributes.commands.map((command) => command.command);
  const scmTitleActions = manifest.contributes.menus['scm/title'] ?? [];
  const scmIdleAction = scmTitleActions.find(
    (item) =>
      item.command === 'agents-gui.generateCommitMessage' &&
      item.when ===
        'scmProvider == git && scmProviderRootUri not in agents-gui.commitMessageGeneratingRoots'
  );
  const scmCancelAction = scmTitleActions.find(
    (item) =>
      item.command === 'agents-gui.cancelCommitMessageGeneration' &&
      item.when ===
        'scmProvider == git && scmProviderRootUri in agents-gui.commitMessageGeneratingRoots'
  );
  const scmInputBoxCommands =
    manifest.contributes.menus['scm/inputBox']?.map((item) => item.command) ?? [];
  const properties = manifest.contributes.configuration.properties;

  assert.ok(manifest.extensionDependencies.includes('vscode.git'));
  assert.ok(!manifest.enabledApiProposals?.includes('contribSourceControlInputBoxMenu'));
  assert.ok(manifest.activationEvents.includes('onCommand:agents-gui.generateCommitMessage'));
  assert.ok(
    manifest.activationEvents.includes('onCommand:agents-gui.cancelCommitMessageGeneration')
  );
  assert.ok(manifest.activationEvents.includes('onCommand:agents-gui.setupCommitMessage'));
  assert.ok(commands.includes('agents-gui.generateCommitMessage'));
  assert.ok(commands.includes('agents-gui.cancelCommitMessageGeneration'));
  assert.ok(commands.includes('agents-gui.setupCommitMessage'));
  assert.ok(!commands.includes('agents-gui.generateCommitMessage.loading'));
  assert.deepEqual(commitCommand.icon, {
    light: 'media/commit-message-light.svg',
    dark: 'media/commit-message-dark.svg',
  });
  assert.equal(cancelCommand.icon, '$(debug-stop)');
  assert.ok(!scmInputBoxCommands.includes('agents-gui.generateCommitMessage'));
  assert.equal(scmIdleAction.group, 'navigation@-100');
  assert.match(scmIdleAction.when, /scmProvider == git/);
  assert.match(
    scmIdleAction.when,
    /scmProviderRootUri not in agents-gui\.commitMessageGeneratingRoots/
  );
  assert.ok(!scmIdleAction.when.includes('commitMessageStagedRoots'));
  assert.ok(
    !scmTitleActions.some((item) => item.command === 'agents-gui.generateCommitMessage.loading')
  );
  assert.equal(scmCancelAction.group, 'navigation@-100');
  assert.match(
    scmCancelAction.when,
    /scmProviderRootUri in agents-gui\.commitMessageGeneratingRoots/
  );
  assert.equal(properties['agents-gui.commitMessage.provider'].enum, undefined);
  assert.equal(properties['agents-gui.commitMessage.provider'].default, 'default');
  assert.match(
    properties['agents-gui.commitMessage.provider'].description,
    /commitMessage\.provider/
  );
  assert.ok(properties['agents-gui.commitMessage.language']);
  assert.ok(properties['agents-gui.commitMessage.maxDiffChars']);
});

test('commit message command uses staged git diff and writes to repository input box', () => {
  const source = readFileSync(new URL('../src/commitMessageCommand.ts', import.meta.url), 'utf8');

  assert.match(source, /getExtension<GitExtension>\('vscode\.git'\)/);
  assert.match(source, /repository\.state\.indexChanges\.length/);
  assert.match(source, /repository\.state\.workingTreeChanges\?\./);
  assert.match(source, /repository\.diff\(true\)/);
  assert.match(source, /handleNoStagedChanges\(repository, locale\)/);
  assert.match(
    source,
    /void vscode\.window\s*\.showInformationMessage\(this\.t\(locale, 'noStagedChanges'\), openSourceControl\)\s*\.then\(async \(choice\) =>/s
  );
  assert.match(source, /executeCommand\('git\.stageAll'\)/);
  assert.match(source, /executeCommand\('workbench\.view\.scm'\)/);
  assert.match(source, /const streamCommitMessage = \(message: string\) =>/);
  assert.match(source, /repository\.inputBox\.value = '';/);
  assert.match(source, /repository\.inputBox\.value = message;/);
  assert.match(source, /repository\.inputBox\.value = result\.message/);
  assert.match(source, /const inputMessage = repository\.inputBox\.value\.trim\(\)/);
  assert.match(source, /buildCommitMessagePrompt\(\{ diff, language, truncated, inputMessage \}\)/);
  assert.doesNotMatch(source, /this\.cleanCommitMessageOutput\(/);
  assert.match(
    source,
    /generateCommitMessageWithCancellation\(\s*primaryProfile,\s*prompt,\s*repository\.rootUri\.fsPath,\s*language,\s*diff,\s*streamCommitMessage,/s
  );
  assert.match(source, /repository\.inputBox\.value = '';\s*\},\s*inputMessage,/s);
  assert.match(source, /getRepository\(rootUri\)/);
  assert.match(source, /generateCommitMessageWithCancellation/);
  assert.match(source, /this\.commitMessageUseCase\.execute\(\{/);
  assert.match(source, /resolveFallbackProviderIds:/);
  assert.match(source, /onPartial: \(message\) => onPartial\(message\)/);
  assert.match(source, /getConfiguredProvider\(\)/);
  assert.match(source, /ASK_COMMIT_MESSAGE_PROVIDER = 'ask'/);
  assert.match(source, /usesAskCommitMessageProvider\(\)/);
  assert.match(source, /chooseCommitCli/);
  assert.match(source, /useOnceForCommitMessage/);
  assert.match(source, /resolveReadyProfile\(locale\)/);
  assert.match(source, /resolveFallbackGenerationProfiles\(/);
  assert.match(source, /generatedWithFallback/);
  assert.match(source, /getInstalledProfiles\(\)/);
  assert.match(source, /const installedProfiles = await this\.getInstalledProfiles\(\);/);
  assert.match(
    source,
    /if \(installedProfiles\.length === 0\) \{\s*await this\.promptProviderSetup\(locale, preferred\);\s*return undefined;\s*\}/s
  );
  assert.match(
    source,
    /pickInstalledProfile\(\s*locale,\s*this\.t\(locale, 'chooseCommitCli'\),\s*false,\s*installedProfiles\s*\)/s
  );
  assert.match(
    source,
    /private async promptProviderSetup\(locale: RuntimeLocale, preferred: CliProfile\): Promise<void>/
  );
  assert.match(source, /await this\.openProviderSetup\(\);/);
  assert.match(source, /private async openProviderSetup\(\): Promise<void>/);
  assert.match(source, /executeCommand\('agents-gui\.openPanel'\)/);
  assert.match(source, /executeCommand\('agents-gui\.refreshProviders'\)/);
  assert.match(
    source,
    /persistSelection \? 'useProviderForCommitMessage' : 'useOnceForCommitMessage'/
  );
  assert.match(source, /installedProfiles: CliProfile\[\]/);
  assert.match(source, /showQuickPick\(providerItems/);
  assert.match(source, /commitMessage'\)\s*\.update\('provider'/);
  assert.match(source, /executeCommand\('agents-gui\.openProviderSettings', 'commitMessage'\)/);
  assert.doesNotMatch(source, /FOLLOW_DEFAULT_COMMIT_MESSAGE_PROVIDER/);
  assert.match(source, /DEFAULT_COMMIT_MESSAGE_PROVIDER = 'default'/);
  assert.match(source, /clipboard\.writeText\(resolveCliInstallHint\(preferred\)\)/);
  assert.doesNotMatch(source, /MODEL_STATE_KEY = 'agents-gui\.modelByProvider'/);
  assert.doesNotMatch(source, /CUSTOM_MODEL_STATE_KEY/);
  assert.match(source, /COMMIT_MESSAGE_GENERATING_CONTEXT = 'agents-gui\.commitMessageGenerating'/);
  assert.match(source, /STAGED_CHANGE_ROOTS_CONTEXT = 'agents-gui\.commitMessageStagedRoots'/);
  assert.match(
    source,
    /COMMIT_MESSAGE_GENERATING_ROOTS_CONTEXT = 'agents-gui\.commitMessageGeneratingRoots'/
  );
  assert.match(
    source,
    /private readonly cancellationsByRoot = new Map<string, vscode\.CancellationTokenSource>\(\)/
  );
  assert.match(source, /repositoryRootKey = repository\.rootUri\.toString\(\)/);
  assert.match(source, /this\.cancellationsByRoot\.has\(repositoryRootKey\)/);
  assert.match(source, /this\.cancellationsByRoot\.set\(repositoryRootKey, cancellation\)/);
  assert.match(source, /await this\.setGeneratingContext\(\)/);
  assert.match(source, /this\.cancellationsByRoot\.delete\(repositoryRootKey\)/);
  assert.match(source, /Array\.from\(this\.cancellationsByRoot\.keys\(\)\)/);
  assert.match(source, /generatingRoots\.length > 0/);
  assert.doesNotMatch(source, /private isGenerating = false/);
  assert.doesNotMatch(source, /currentCancellation/);
  assert.match(source, /rootUri\.toString\(\)/);
  assert.match(source, /setContext',\s*HAS_STAGED_CHANGES_CONTEXT,\s*stagedRoots\.length > 0/s);
  assert.match(source, /setContext',\s*STAGED_CHANGE_ROOTS_CONTEXT,\s*stagedRoots/s);
  assert.match(source, /repository\.state\.indexChanges\.length > 0/);
  assert.match(source, /repository\.rootUri\.toString\(\)/);
  assert.match(source, /ProgressLocation\.SourceControl/);
  assert.match(source, /let completedGeneration = false;/);
  assert.match(source, /if \(!completedGeneration && streamingRepository\)/);
  assert.match(
    source,
    /cancel\(rootUri\?: vscode\.Uri \| \{ readonly rootUri\?: vscode\.Uri \}\): void/
  );
  assert.match(source, /this\.cancellationsByRoot\.get\(rootKey\)\?\.cancel\(\)/);
  assert.match(source, /for \(const cancellation of this\.cancellationsByRoot\.values\(\)\)/);
  assert.doesNotMatch(source, /diff\(false\)/);
  assert.doesNotMatch(source, /usesDefaultCommitMessageProvider\(\)/);
});

test('commit message command depends on the text-generation use case instead of CliManager', () => {
  const source = readFileSync(new URL('../src/commitMessageCommand.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /import \{[\s\S]*GenerateCommitMessageUseCase[\s\S]*TextGenerationProviderRegistry[\s\S]*\} from '\.\/textGeneration';/
  );
  assert.doesNotMatch(source, /import \{ CliManager, Session \} from '\.\/cliManager';/);
  assert.doesNotMatch(source, /resolveApiProviderRuntime/);
  assert.doesNotMatch(source, /normalizeCliOutputChunk/);
  assert.doesNotMatch(source, /this\.cliManager\./);
  assert.doesNotMatch(source, /startPrompt\(/);
  assert.match(source, /this\.commitMessageUseCase\.execute\(\{/);
  assert.match(source, /repositoryRoot: repositoryRoot/);
  assert.match(source, /primaryProviderId: primaryProfile\.id/);
  assert.match(source, /resolveFallbackProviderIds:/);
});


test('sidebar keeps execution overrides out of persisted composer state', () => {
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const mediaSource = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const syncedStateSource = readFileSync(new URL('../src/syncedState.ts', import.meta.url), 'utf8');
  const protocolSource = readFileSync(
    new URL('../src/webviewProtocol.ts', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(syncedStateSource, /MODEL_STATE_KEY = 'agents-gui\.modelByProvider'/);
  assert.doesNotMatch(protocolSource, /activeModelByProvider\?:/);
  assert.doesNotMatch(sidebarSource, /^  MODEL_STATE_KEY,$/m);
  assert.doesNotMatch(sidebarSource, /this\.state\.update\(\s*MODEL_STATE_KEY,/s);
  assert.doesNotMatch(sidebarSource, /activeModelByProvider: this\.getStoredModelState\(\)/);
  assert.doesNotMatch(sidebarSource, /normalizeModelState\(payload\.activeModelByProvider\)/);
  assert.doesNotMatch(mediaSource, /activeModelByProvider|recentModelByProvider|favoriteModelByProvider/);
  assert.doesNotMatch(mediaSource, /customModel|modelVariant|activeRuntime|activePermission/);
  assert.match(mediaSource, /let activeAgentModeByProvider = persistableAgentModeMap\(saved\.activeAgentModeByProvider\);/);
  assert.match(
    mediaSource,
    /function persist\(\)[\s\S]*vscode\.setState[\s\S]*schedulePersistUserSelection\(\);/
  );
  assert.doesNotMatch(mediaSource, /modelSelect|runtimeSelect|permissionSelect/);
});

test('extension registers SCM title generation and cancel commands', () => {
  const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

  assert.match(source, /setContext', 'agents-gui\.commitMessageGenerating', false/);
  assert.match(source, /setContext', 'agents-gui\.commitMessageGeneratingRoots', \[\]/);
  assert.match(source, /setContext', 'agents-gui\.commitMessageStagedRoots', \[\]/);
  assert.match(source, /registerCommand\(\s*'agents-gui\.generateCommitMessage',/s);
  assert.match(source, /return commitMessageCommand\.run\(rootUri, token\)/);
  assert.match(
    source,
    /registerCommand\('agents-gui\.cancelCommitMessageGeneration', \(rootUri\) =>/
  );
  assert.match(source, /commitMessageCommand\.cancel\(rootUri\)/);
  assert.match(source, /registerCommand\('agents-gui\.setupCommitMessage', \(\) =>/);
  assert.match(source, /executeCommand\('agents-gui\.openProviderSettings', 'commitMessage'\)/);
  assert.doesNotMatch(source, /registerCommand\('agents-gui\.generateCommitMessage\.loading'/);
  assert.doesNotMatch(source, /void commitMessageCommand\.run\(\)/);
});
