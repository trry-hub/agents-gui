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
  assert.match(prompt, /The first line must be a Conventional Commits subject/);
  assert.match(prompt, /Use exactly one of these formats/);
  assert.match(prompt, /subject line, one blank line, then body/);
  assert.doesNotMatch(prompt, /Always include a scope in parentheses/);
  assert.match(prompt, /For Simplified Chinese output, the summary after the colon must be Simplified Chinese/);
  assert.match(prompt, /Do not output analysis, reasoning, rationale, or explanations/);
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
  assert.match(prompt, /format or style instruction/);
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

test('cleanGeneratedCommitMessage rewrites English summaries to Chinese fallback for zh locale', () => {
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

  assert.equal(message, 'chore(env): 在 .env.dev 末尾添加空行');
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

test('cleanGeneratedCommitMessage applies emoji style requested by SCM input', () => {
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

  const message = cleanGeneratedCommitMessage('chore(env): 在 .env.dev 末尾添加空行', {
    language: 'zh-CN',
    diff,
    inputMessage: '要带上表情图标',
  });

  assert.equal(message, 'chore(env): 🔧 在 .env.dev 末尾添加空行');
});

test('truncateCommitDiff keeps staged diff under the configured limit', () => {
  const diff = `diff --git a/a b/a\n${'x'.repeat(80)}`;
  const result = truncateCommitDiff(diff, 30);

  assert.equal(result.truncated, true);
  assert.equal(result.diff.length, 30);
});

test('extension contributes SCM title actions for staged AI commit messages', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commitCommand = manifest.contributes.commands.find((command) => command.command === 'agents-gui.generateCommitMessage');
  const cancelCommand = manifest.contributes.commands.find((command) => command.command === 'agents-gui.cancelCommitMessageGeneration');
  const commands = manifest.contributes.commands.map((command) => command.command);
  const scmTitleActions = manifest.contributes.menus['scm/title'] ?? [];
  const scmIdleAction = scmTitleActions.find(
    (item) => item.command === 'agents-gui.generateCommitMessage'
      && item.when === 'scmProvider == git && scmProviderRootUri in agents-gui.commitMessageStagedRoots && !agents-gui.commitMessageGenerating'
  );
  const scmCancelAction = scmTitleActions.find(
    (item) => item.command === 'agents-gui.cancelCommitMessageGeneration'
      && item.when === 'scmProvider == git && scmProviderRootUri in agents-gui.commitMessageGeneratingRoots'
  );
  const scmInputBoxCommands = manifest.contributes.menus['scm/inputBox']?.map((item) => item.command) ?? [];
  const properties = manifest.contributes.configuration.properties;

  assert.ok(manifest.extensionDependencies.includes('vscode.git'));
  assert.ok(!manifest.enabledApiProposals?.includes('contribSourceControlInputBoxMenu'));
  assert.ok(manifest.activationEvents.includes('onCommand:agents-gui.generateCommitMessage'));
  assert.ok(manifest.activationEvents.includes('onCommand:agents-gui.cancelCommitMessageGeneration'));
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
  assert.match(scmIdleAction.when, /scmProviderRootUri in agents-gui\.commitMessageStagedRoots/);
  assert.match(scmIdleAction.when, /!agents-gui\.commitMessageGenerating/);
  assert.ok(!scmTitleActions.some((item) => item.command === 'agents-gui.generateCommitMessage.loading'));
  assert.equal(scmCancelAction.group, 'navigation@-100');
  assert.match(scmCancelAction.when, /scmProviderRootUri in agents-gui\.commitMessageGeneratingRoots/);
  assert.deepEqual(properties['agents-gui.commitMessage.provider'].enum, [
    'default',
    'claude',
    'gemini',
    'codex',
    'opencode',
    'goose',
    'aider',
  ]);
  assert.equal(properties['agents-gui.commitMessage.provider'].default, 'default');
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
  assert.match(source, /void vscode\.window\.showInformationMessage\(\s*this\.t\(locale, 'noStagedChanges'\),\s*openSourceControl\s*\)\.then\(async \(choice\) =>/s);
  assert.match(source, /executeCommand\('git\.stageAll'\)/);
  assert.match(source, /executeCommand\('workbench\.view\.scm'\)/);
  assert.match(source, /const streamCommitMessage = \(output: string\) =>/);
  assert.match(source, /repository\.inputBox\.value = '';/);
  assert.match(source, /repository\.inputBox\.value = partialMessage;/);
  assert.match(source, /repository\.inputBox\.value = result\.message/);
  assert.match(source, /const inputMessage = repository\.inputBox\.value\.trim\(\)/);
  assert.match(source, /buildCommitMessagePrompt\(\{ diff, language, truncated, inputMessage \}\)/);
  assert.match(source, /cleanCommitMessageOutput\(output, language, diff, inputMessage, true\)/);
  assert.match(source, /const profiles = await this\.resolveGenerationProfiles\(primaryProfile\);/);
  assert.match(source, /generateCommitMessageWithFallback\(\s*profiles,\s*prompt,\s*repository\.rootUri\.fsPath,\s*language,\s*diff,\s*streamCommitMessage,/s);
  assert.match(source, /repository\.inputBox\.value = '';\s*\},\s*inputMessage,/s);
  assert.match(source, /cleanGeneratedCommitMessage\(output, \{ language, diff, inputMessage \}\)/);
  assert.match(source, /getRepository\(rootUri\)/);
  assert.match(source, /generateCommitMessageWithCancellation/);
  assert.match(source, /generateCommitMessageWithFallback/);
  assert.match(source, /profile\.id === 'opencode'/);
  assert.match(
    source,
    /runOpenCodePromptViaServer\(\s*prompt,\s*token,\s*repositoryRoot,\s*this\.getStoredOpenCodeModelId\(\),\s*onPartial\s*\)/s
  );
  assert.match(source, /return this\.cleanCommitMessageOutput\(\s*await this\.cliManager\.runOpenCodePromptViaServer/s);
  assert.match(source, /private cleanCommitMessageOutput\(\s*output: string,\s*language: CommitMessageLanguage,\s*diff: string/s);
  assert.doesNotMatch(source, /resolveInputValue/);
  assert.doesNotMatch(source, /existingMessage/);
  assert.doesNotMatch(source, /\['--pure', \.\.\.args\]/);
  assert.match(source, /isProviderErrorOutput\(output\)/);
  assert.match(source, /getConfiguredProvider\(\)/);
  assert.match(source, /resolveReadyProfile\(locale\)/);
  assert.match(source, /resolveGenerationProfiles\(primaryProfile: CliProfile\)/);
  assert.match(source, /usesDefaultCommitMessageProvider\(\)/);
  assert.match(source, /profiles = \[primaryProfile\]/);
  assert.match(source, /if \(!this\.usesDefaultCommitMessageProvider\(\) \|\| index >= profiles\.length - 1\)/);
  assert.match(source, /fallbackFrom: primaryProfile/);
  assert.match(source, /generatedWithFallback/);
  assert.match(source, /getInstalledProfiles\(\)/);
  assert.match(source, /showQuickPick\(providerItems/);
  assert.match(source, /commitMessage'\)\.update\(\s*'provider'/);
  assert.match(source, /executeCommand\('agents-gui\.openProviderSettings', 'commitMessage'\)/);
  assert.match(source, /clipboard\.writeText\(preferred\.installHint\)/);
  assert.match(source, /MODEL_STATE_KEY = 'agents-gui\.modelByProvider'/);
  assert.match(source, /this\.state\?\.get<Record<string, string>>\(MODEL_STATE_KEY/);
  assert.match(source, /COMMIT_MESSAGE_GENERATING_CONTEXT = 'agents-gui\.commitMessageGenerating'/);
  assert.match(source, /STAGED_CHANGE_ROOTS_CONTEXT = 'agents-gui\.commitMessageStagedRoots'/);
  assert.match(source, /COMMIT_MESSAGE_GENERATING_ROOTS_CONTEXT = 'agents-gui\.commitMessageGeneratingRoots'/);
  assert.match(source, /setGeneratingContext\(true,\s*repository\.rootUri\)/);
  assert.match(source, /rootUri\.toString\(\)/);
  assert.match(source, /setContext',\s*HAS_STAGED_CHANGES_CONTEXT,\s*stagedRoots\.length > 0/s);
  assert.match(source, /setContext',\s*STAGED_CHANGE_ROOTS_CONTEXT,\s*stagedRoots/s);
  assert.match(source, /repository\.state\.indexChanges\.length > 0/);
  assert.match(source, /repository\.rootUri\.toString\(\)/);
  assert.match(source, /ProgressLocation\.SourceControl/);
  assert.match(source, /let completedGeneration = false;/);
  assert.match(source, /if \(!completedGeneration && streamingRepository\)/);
  assert.match(source, /cancel\(\): void/);
  assert.match(source, /isLikelyCliError\(normalizedStderr\)/);
  assert.doesNotMatch(source, /diff\(false\)/);
});

test('OpenCode server commit generation waits for completed text parts only', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /onPartial\?: \(text: string\) => void/);
  assert.match(source, /waitForOpenCodeServerText\(\s*serverUrl,\s*sessionId,\s*directory,\s*token,\s*onPartial,\s*errorStream\s*\)/s);
  assert.match(source, /const textState = this\.extractOpenCodeAssistantTextState\(messages\);/);
  assert.match(source, /tools:\s*\{ '\*': false \}/);
  assert.match(source, /onPartial\?\.\(textState\.text\);/);
  assert.match(source, /const completed = this\.isOpenCodeAssistantMessageCompleted\(info\);/);
  assert.match(source, /this\.pickString\(partRecord\.type\) === 'text'/);
  assert.match(source, /if \(textState\.completed\) \{/);
  assert.doesNotMatch(source, /\.map\(\(part\) => this\.pickString\(this\.objectRecord\(part\)\.text\) \?\? ''\)/);
});

test('sidebar persists the selected model so SCM commit generation can reuse it', () => {
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const mediaSource = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const syncedStateSource = readFileSync(new URL('../src/syncedState.ts', import.meta.url), 'utf8');

  assert.match(syncedStateSource, /MODEL_STATE_KEY = 'agents-gui\.modelByProvider'/);
  assert.match(sidebarSource, /MODEL_STATE_KEY,\n/);
  assert.match(sidebarSource, /activeModelByProvider: this\.getStoredModelState\(\)/);
  assert.match(sidebarSource, /this\.state\.update\(\s*MODEL_STATE_KEY,\s*this\.normalizeModelState\(payload\.activeModelByProvider\)/s);
  assert.match(mediaSource, /activeModelByProvider,\s*recentModelByProvider,/);
  assert.match(mediaSource, /activeModelByProvider = hasAppliedPersistentSelection/);
  assert.match(mediaSource, /function persist\(\)[\s\S]*vscode\.setState[\s\S]*schedulePersistUserSelection\(\);/);
  assert.match(mediaSource, /modelSelect\.addEventListener\('change'[\s\S]*persistUserSelection\(\);[\s\S]*renderAll\(\);/);
});

test('extension registers SCM title generation and cancel commands', () => {
  const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

  assert.match(source, /setContext', 'agents-gui\.commitMessageGenerating', false/);
  assert.match(source, /setContext', 'agents-gui\.commitMessageGeneratingRoots', \[\]/);
  assert.match(source, /setContext', 'agents-gui\.commitMessageStagedRoots', \[\]/);
  assert.match(source, /registerCommand\('agents-gui\.generateCommitMessage', \(rootUri, _resourceGroups, token\) =>/);
  assert.match(source, /return commitMessageCommand\.run\(rootUri, token\)/);
  assert.match(source, /registerCommand\('agents-gui\.cancelCommitMessageGeneration', \(\) =>/);
  assert.match(source, /commitMessageCommand\.cancel\(\)/);
  assert.match(source, /registerCommand\('agents-gui\.setupCommitMessage', \(\) =>/);
  assert.match(source, /executeCommand\('agents-gui\.openProviderSettings', 'commitMessage'\)/);
  assert.doesNotMatch(source, /registerCommand\('agents-gui\.generateCommitMessage\.loading'/);
  assert.doesNotMatch(source, /void commitMessageCommand\.run\(\)/);
});
