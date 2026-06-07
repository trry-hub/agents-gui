import * as path from 'path';
import * as vscode from 'vscode';
import {
  resolveApiProviderRuntime,
  sanitizeApiProviderSettings,
  type ApiProviderSettings,
  type CustomApiProviderConfig,
} from './apiProviders';
import { CliManager, Session } from './cliManager';
import {
  buildCliOptionArgs,
  CLI_PROFILES,
  getCliAgentMode,
  getCliModelOption,
  getCliPermissionMode,
  getCliProfile,
  getCliRuntimeMode,
  type CliAgentMode,
  type CliPermissionMode,
  type CliProfile,
} from './cliProfiles';
import {
  buildCommitMessagePrompt,
  cleanGeneratedCommitMessage,
  resolveCommitMessageLanguage,
  truncateCommitDiff,
  type CommitMessageLanguage,
  type CommitMessageLanguageSetting,
} from './commitMessage';
import {
  flushCliOutputBuffer,
  normalizeCliOutput,
  normalizeCliOutputChunk,
} from './outputFormatter';

interface GitInputBox {
  value: string;
}

interface GitChange {
  readonly uri: vscode.Uri;
}

interface GitRepositoryState {
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges?: GitChange[];
  readonly onDidChange?: vscode.Event<void>;
}

interface GitRepositoryUIState {
  readonly selected: boolean;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: GitInputBox;
  readonly state: GitRepositoryState;
  readonly ui: GitRepositoryUIState;
  diff(cached?: boolean): Promise<string>;
}

interface GitApi {
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository?: vscode.Event<GitRepository>;
  readonly onDidCloseRepository?: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

type RuntimeLocale = 'en' | 'zh-CN';

interface CommitMessageGenerationResult {
  message: string;
  profile: CliProfile;
  fallbackFrom?: CliProfile;
}

const DEFAULT_CLI_ID = 'opencode';
const DEFAULT_COMMIT_MESSAGE_PROVIDER = 'default';
const ASK_COMMIT_MESSAGE_PROVIDER = 'ask';
const MODEL_STATE_KEY = 'agents-gui.modelByProvider';
const OPENCODE_COMMIT_MESSAGE_MODEL_PREFERENCES = [
  'mimo/mimo-v2.5-pro',
  'opencode/mimo-v2.5-free',
  'opencode/deepseek-v4-flash-free',
  'opencode/big-pickle',
];
const COMMIT_MESSAGE_TIMEOUT_MS = 90_000;
const HAS_STAGED_CHANGES_CONTEXT = 'agents-gui.hasStagedChanges';
const STAGED_CHANGE_ROOTS_CONTEXT = 'agents-gui.commitMessageStagedRoots';
const COMMIT_MESSAGE_GENERATING_CONTEXT = 'agents-gui.commitMessageGenerating';
const COMMIT_MESSAGE_GENERATING_ROOTS_CONTEXT = 'agents-gui.commitMessageGeneratingRoots';

const MESSAGES: Record<RuntimeLocale, Record<string, string>> = {
  en: {
    progress: 'Generating commit message...',
    alreadyGenerating: 'A commit message is already being generated for this repository.',
    noGitExtension: 'The built-in Git extension is not available.',
    gitDisabled: 'The built-in Git extension is disabled.',
    noRepository: 'No Git repository was found in this workspace.',
    chooseRepository: 'Choose a repository for the staged commit message',
    noStagedChanges: 'No staged changes found. Stage the files you want to commit first.',
    openSourceControl: 'Open Source Control',
    stageAllAndGenerate: 'Stage All and Generate',
    providerUnavailable: '{provider} is not installed or cannot be started.',
    chooseInstalledProvider: '{provider} is not installed. Choose an installed provider for commit messages.',
    chooseCommitCli: 'Choose a CLI for this commit message',
    useProviderForCommitMessage: 'Use for Git commit messages',
    useOnceForCommitMessage: 'Use once for this commit message',
    openCommitSettings: 'Open Commit Message Settings',
    openCommitSettingsDescription: 'Configure CLI, language, and diff limits',
    providerSelected: '{provider} will be used for Git commit messages.',
    providerSetupRequired: '{provider} is not installed. Install or configure a CLI to generate commit messages.',
    openSetup: 'Open Setup',
    copyInstallCommand: 'Copy Install Command',
    installCommandCopied: 'Install command copied.',
    emptyOutput: 'The CLI did not return a commit message.',
    generated: 'Commit message generated from staged changes.',
    generatedTruncated: 'Commit message generated from truncated staged changes.',
    generatedWithFallback: 'Commit message generated with {provider} after {fallbackProvider} was unavailable.',
    generatedTruncatedWithFallback: 'Commit message generated from truncated staged changes with {provider} after {fallbackProvider} was unavailable.',
    cancelled: 'Commit message generation was cancelled.',
    failed: 'Failed to generate commit message: {message}',
  },
  'zh-CN': {
    progress: '正在生成提交信息...',
    alreadyGenerating: '该仓库正在生成提交信息，请稍候。',
    noGitExtension: '内置 Git 扩展不可用。',
    gitDisabled: '内置 Git 扩展已禁用。',
    noRepository: '当前工作区没有找到 Git 仓库。',
    chooseRepository: '选择要生成暂存区提交信息的仓库',
    noStagedChanges: '暂存区没有变更，请先 git add 需要提交的文件。',
    openSourceControl: '打开源代码管理',
    stageAllAndGenerate: '暂存全部并生成',
    providerUnavailable: '{provider} 未安装或无法启动。',
    chooseInstalledProvider: '{provider} 未安装。选择一个已安装提供方用于提交信息生成。',
    chooseCommitCli: '选择本次提交信息生成使用的 CLI',
    useProviderForCommitMessage: '用于 Git 提交信息生成',
    useOnceForCommitMessage: '仅用于本次提交信息生成',
    openCommitSettings: '打开提交信息设置',
    openCommitSettingsDescription: '配置 CLI、语言和 diff 限制',
    providerSelected: '将使用 {provider} 生成 Git 提交信息。',
    providerSetupRequired: '{provider} 未安装。请安装或配置一个 CLI 后再生成提交信息。',
    openSetup: '打开配置',
    copyInstallCommand: '复制安装命令',
    installCommandCopied: '安装命令已复制。',
    emptyOutput: 'CLI 没有返回提交信息。',
    generated: '已根据暂存区变更生成提交信息。',
    generatedTruncated: '已根据截断后的暂存区变更生成提交信息。',
    generatedWithFallback: '已在 {fallbackProvider} 不可用后，降级使用 {provider} 生成提交信息。',
    generatedTruncatedWithFallback: '已根据截断后的暂存区变更生成提交信息，并在 {fallbackProvider} 不可用后降级使用 {provider}。',
    cancelled: '已取消生成提交信息。',
    failed: '生成提交信息失败：{message}',
  },
};

export class CommitMessageCommand {
  private readonly cancellationsByRoot = new Map<string, vscode.CancellationTokenSource>();

  constructor(
    private readonly cliManager: CliManager,
    private readonly state?: vscode.Memento
  ) {}

  watchStagedChangesContext(context: vscode.ExtensionContext): void {
    void vscode.commands.executeCommand('setContext', HAS_STAGED_CHANGES_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', STAGED_CHANGE_ROOTS_CONTEXT, []);
    void this.setGeneratingContext();
    void this.bindStagedChangesContext(context).catch(() => {
      void vscode.commands.executeCommand('setContext', HAS_STAGED_CHANGES_CONTEXT, false);
      void vscode.commands.executeCommand('setContext', STAGED_CHANGE_ROOTS_CONTEXT, []);
    });
  }

  async run(
    rootUri?: vscode.Uri | { readonly rootUri?: vscode.Uri },
    externalToken?: vscode.CancellationToken
  ): Promise<void> {
    const locale = this.getRuntimeLocale();
    let cancellation: vscode.CancellationTokenSource | undefined;
    let repositoryRootKey: string | undefined;
    let streamingRepository: GitRepository | undefined;
    let originalInputValue = '';
    let completedGeneration = false;

    try {
      const repository = await this.pickRepository(locale, resolveRepositoryRootUri(rootUri));
      if (!repository) {
        return;
      }

      repositoryRootKey = repository.rootUri.toString();
      if (this.cancellationsByRoot.has(repositoryRootKey)) {
        vscode.window.showInformationMessage(this.t(locale, 'alreadyGenerating'));
        return;
      }

      cancellation = new vscode.CancellationTokenSource();
      this.cancellationsByRoot.set(repositoryRootKey, cancellation);
      await this.setGeneratingContext();

      let rawDiff = repository.state.indexChanges.length > 0
        ? await repository.diff(true)
        : '';
      if (!rawDiff.trim()) {
        const shouldContinue = await this.handleNoStagedChanges(repository, locale);
        if (!shouldContinue) {
          return;
        }

        rawDiff = await repository.diff(true);
        if (!rawDiff.trim()) {
          vscode.window.showInformationMessage(this.t(locale, 'noStagedChanges'));
          return;
        }
      }

      const { diff, truncated } = truncateCommitDiff(rawDiff, this.getMaxDiffChars());
      const language = resolveCommitMessageLanguage(
        vscode.env.language,
        this.getConfiguredLanguage()
      );
      const inputMessage = repository.inputBox.value.trim();
      const prompt = buildCommitMessagePrompt({ diff, language, truncated, inputMessage });
      const primaryProfile = await this.resolveReadyProfile(locale);
      if (!primaryProfile) {
        return;
      }

      streamingRepository = repository;
      originalInputValue = repository.inputBox.value;
      repository.inputBox.value = '';
      const streamCommitMessage = (output: string) => {
        const partialMessage = this.cleanCommitMessageOutput(output, language, diff, inputMessage, true);
        if (partialMessage) {
          repository.inputBox.value = partialMessage;
        }
      };
      const result = await this.generateCommitMessageWithFallback(
        primaryProfile,
        () => this.resolveFallbackGenerationProfiles(primaryProfile),
        prompt,
        repository.rootUri.fsPath,
        language,
        diff,
        streamCommitMessage,
        () => {
          repository.inputBox.value = '';
        },
        inputMessage,
        cancellation.token,
        externalToken
      );

      completedGeneration = true;
      repository.inputBox.value = result.message;
      await vscode.commands.executeCommand('workbench.view.scm');
      const messageKey = result.fallbackFrom
        ? (truncated ? 'generatedTruncatedWithFallback' : 'generatedWithFallback')
        : (truncated ? 'generatedTruncated' : 'generated');
      vscode.window.showInformationMessage(this.t(locale, messageKey, {
        provider: result.profile.name,
        fallbackProvider: result.fallbackFrom?.name ?? '',
      }));
    } catch (error) {
      if (!completedGeneration && streamingRepository) {
        streamingRepository.inputBox.value = originalInputValue;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled') {
        vscode.window.showInformationMessage(this.t(locale, 'cancelled'));
        return;
      }

      vscode.window.showErrorMessage(this.t(locale, 'failed', { message }));
    } finally {
      if (repositoryRootKey && this.cancellationsByRoot.get(repositoryRootKey) === cancellation) {
        this.cancellationsByRoot.delete(repositoryRootKey);
      }
      cancellation?.dispose();
      await this.setGeneratingContext();
    }
  }

  cancel(rootUri?: vscode.Uri | { readonly rootUri?: vscode.Uri }): void {
    const rootKey = resolveRepositoryRootUri(rootUri)?.toString();
    if (rootKey) {
      this.cancellationsByRoot.get(rootKey)?.cancel();
      return;
    }

    for (const cancellation of this.cancellationsByRoot.values()) {
      cancellation.cancel();
    }
  }

  private async setGeneratingContext(): Promise<void> {
    const generatingRoots = Array.from(this.cancellationsByRoot.keys());
    await vscode.commands.executeCommand(
      'setContext',
      COMMIT_MESSAGE_GENERATING_CONTEXT,
      generatingRoots.length > 0
    );
    await vscode.commands.executeCommand(
      'setContext',
      COMMIT_MESSAGE_GENERATING_ROOTS_CONTEXT,
      generatingRoots
    );
  }

  private async bindStagedChangesContext(context: vscode.ExtensionContext): Promise<void> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      return;
    }

    const extension = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    if (!extension.enabled) {
      return;
    }

    const git = extension.getAPI(1);
    const repositoryStateDisposables: vscode.Disposable[] = [];
    const disposeRepositoryStateWatchers = () => {
      while (repositoryStateDisposables.length > 0) {
        repositoryStateDisposables.pop()?.dispose();
      }
    };
    const updateHasStagedChanges = () => {
      const stagedRoots = git.repositories
        .filter((repository) => repository.state.indexChanges.length > 0)
        .map((repository) => repository.rootUri.toString());
      void vscode.commands.executeCommand(
        'setContext',
        HAS_STAGED_CHANGES_CONTEXT,
        stagedRoots.length > 0
      );
      void vscode.commands.executeCommand(
        'setContext',
        STAGED_CHANGE_ROOTS_CONTEXT,
        stagedRoots
      );
    };
    const watchRepositories = () => {
      disposeRepositoryStateWatchers();
      for (const repository of git.repositories) {
        const onDidChange = repository.state.onDidChange;
        if (onDidChange) {
          repositoryStateDisposables.push(onDidChange(updateHasStagedChanges));
        }
      }
      updateHasStagedChanges();
    };

    watchRepositories();
    context.subscriptions.push({ dispose: disposeRepositoryStateWatchers });
    if (git.onDidOpenRepository) {
      context.subscriptions.push(git.onDidOpenRepository(watchRepositories));
    }
    if (git.onDidCloseRepository) {
      context.subscriptions.push(git.onDidCloseRepository(watchRepositories));
    }
  }

  private async pickRepository(
    locale: RuntimeLocale,
    rootUri?: vscode.Uri
  ): Promise<GitRepository | undefined> {
    const git = await this.getGitApi(locale);
    if (!git) {
      return undefined;
    }

    const repositories = git.repositories;
    if (repositories.length === 0) {
      vscode.window.showWarningMessage(this.t(locale, 'noRepository'));
      return undefined;
    }

    if (rootUri) {
      const sourceControlRepository = git.getRepository(rootUri);
      if (sourceControlRepository) {
        return sourceControlRepository;
      }
    }

    const selected = repositories.find((repository) => repository.ui.selected);
    if (selected) {
      return selected;
    }

    const activeEditorRepository = vscode.window.activeTextEditor
      ? git.getRepository(vscode.window.activeTextEditor.document.uri)
      : undefined;
    if (activeEditorRepository) {
      return activeEditorRepository;
    }

    if (repositories.length === 1) {
      return repositories[0];
    }

    const picked = await vscode.window.showQuickPick(
      repositories.map((repository) => ({
        label: path.basename(repository.rootUri.fsPath),
        description: repository.rootUri.fsPath,
        repository,
      })),
      {
        placeHolder: this.t(locale, 'chooseRepository'),
        matchOnDescription: true,
      }
    );

    return picked?.repository;
  }

  private async getGitApi(locale: RuntimeLocale): Promise<GitApi | undefined> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      vscode.window.showErrorMessage(this.t(locale, 'noGitExtension'));
      return undefined;
    }

    const extension = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    if (!extension.enabled) {
      vscode.window.showErrorMessage(this.t(locale, 'gitDisabled'));
      return undefined;
    }

    return extension.getAPI(1);
  }

  private async handleNoStagedChanges(
    repository: GitRepository,
    locale: RuntimeLocale
  ): Promise<boolean> {
    const openSourceControl = this.t(locale, 'openSourceControl');
    const hasWorkingTreeChanges = (repository.state.workingTreeChanges?.length ?? 0) > 0;
    if (!hasWorkingTreeChanges) {
      void vscode.window.showInformationMessage(
        this.t(locale, 'noStagedChanges'),
        openSourceControl
      ).then(async (choice) => {
        if (choice === openSourceControl) {
          await vscode.commands.executeCommand('workbench.view.scm');
        }
      });

      return false;
    }

    const stageAllAndGenerate = this.t(locale, 'stageAllAndGenerate');
    const choice = await vscode.window.showInformationMessage(
      this.t(locale, 'noStagedChanges'),
      stageAllAndGenerate,
      openSourceControl
    );
    if (choice === stageAllAndGenerate) {
      await vscode.commands.executeCommand('git.stageAll');
      return true;
    }

    if (choice === openSourceControl) {
      await vscode.commands.executeCommand('workbench.view.scm');
    }

    return false;
  }

  private async resolveReadyProfile(locale: RuntimeLocale): Promise<CliProfile | undefined> {
    const preferred = this.getDefaultProfile();

    if (this.usesAskCommitMessageProvider()) {
      const installedProfiles = await this.getInstalledProfiles();
      if (installedProfiles.length === 0) {
        await this.promptProviderSetup(locale, preferred);
        return undefined;
      }

      return this.pickInstalledProfile(
        locale,
        this.t(locale, 'chooseCommitCli'),
        false,
        installedProfiles
      );
    }

    if (await this.cliManager.checkInstalled(preferred.id)) {
      return preferred;
    }

    const installedProfiles = await this.getInstalledProfiles();
    if (installedProfiles.length === 0) {
      await this.promptProviderSetup(locale, preferred);
      return undefined;
    }

    const picked = await this.pickInstalledProfile(
      locale,
      this.t(locale, 'chooseInstalledProvider', { provider: preferred.name }),
      true,
      installedProfiles
    );
    if (picked) {
      return picked;
    }

    return undefined;
  }

  private async promptProviderSetup(locale: RuntimeLocale, preferred: CliProfile): Promise<void> {
    const openSetup = this.t(locale, 'openSetup');
    const copyInstallCommand = this.t(locale, 'copyInstallCommand');
    const choice = await vscode.window.showWarningMessage(
      this.t(locale, 'providerSetupRequired', { provider: preferred.name }),
      openSetup,
      copyInstallCommand
    );
    if (choice === openSetup) {
      await this.openCommitMessageSettings();
    }
    if (choice === copyInstallCommand) {
      await vscode.env.clipboard.writeText(preferred.installHint);
      vscode.window.showInformationMessage(this.t(locale, 'installCommandCopied'));
    }
  }

  private async pickInstalledProfile(
    locale: RuntimeLocale,
    placeHolder: string,
    persistSelection: boolean,
    installedProfiles: CliProfile[]
  ): Promise<CliProfile | undefined> {
    const providerItems = [
      ...installedProfiles.map((profile) => ({
        label: profile.name,
        description: this.t(
          locale,
          persistSelection ? 'useProviderForCommitMessage' : 'useOnceForCommitMessage'
        ),
        profile,
      })),
      {
        label: this.t(locale, 'openCommitSettings'),
        description: this.t(locale, 'openCommitSettingsDescription'),
        profile: undefined,
      },
    ];
    const picked = await vscode.window.showQuickPick(providerItems, {
      placeHolder,
    });
    if (!picked) {
      return undefined;
    }

    if (!picked.profile) {
      await this.openCommitMessageSettings();
      return undefined;
    }

    if (persistSelection) {
      await vscode.workspace.getConfiguration('agents-gui.commitMessage').update(
        'provider',
        picked.profile.id,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage(
        this.t(locale, 'providerSelected', { provider: picked.profile.name })
      );
    }

    return picked.profile;
  }

  private async getInstalledProfiles(): Promise<CliProfile[]> {
    const results = await Promise.all(
      CLI_PROFILES.map(async (profile) => ({
        profile,
        installed: await this.cliManager.checkInstalled(profile.id),
      }))
    );

    return results.filter((result) => result.installed).map((result) => result.profile);
  }

  private async resolveFallbackGenerationProfiles(primaryProfile: CliProfile): Promise<CliProfile[]> {
    if (!this.usesDefaultCommitMessageProvider()) {
      return [];
    }

    const seen = new Set<string>([primaryProfile.id]);
    const profiles: CliProfile[] = [];
    for (const profile of await this.getInstalledProfiles()) {
      if (seen.has(profile.id)) {
        continue;
      }

      seen.add(profile.id);
      profiles.push(profile);
    }

    return profiles;
  }

  private async openCommitMessageSettings(): Promise<void> {
    await vscode.commands.executeCommand('agents-gui.openProviderSettings', 'commitMessage');
  }

  private async generateCommitMessage(
    profile: CliProfile,
    prompt: string,
    repositoryRoot: string,
    language: CommitMessageLanguage,
    diff: string,
    onPartial: (output: string) => void,
    inputMessage: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    if (profile.id === 'opencode') {
      return this.cleanCommitMessageOutput(
        await this.cliManager.runOpenCodePromptViaServer(
          prompt,
          token,
          repositoryRoot,
          await this.getOpenCodeCommitMessageModelId(repositoryRoot),
          onPartial
        ),
        language,
        diff,
        inputMessage
      );
    }

    const agentMode = preferredCommitAgentMode(profile);
    const permissionMode = preferredCommitPermissionMode(profile);
    const modelOption = getCliModelOption(profile);
    const runtimeMode = getCliRuntimeMode(profile);
    const apiProviderRuntime = resolveApiProviderRuntime(
      this.getApiProviderSettings(),
      profile.id,
      process.env
    );
    const optionArgs = buildCliOptionArgs(profile, {
      model: modelOption.id,
      runtime: runtimeMode.id,
      permissionMode: permissionMode.id,
    });
    const session = await this.cliManager.startPrompt(
      profile.id,
      prompt,
      [...optionArgs, ...(agentMode.args ?? [])],
      agentMode.id,
      [
        'commitMessage',
        agentMode.id,
        modelOption.id,
        runtimeMode.id,
        permissionMode.id,
        apiProviderRuntime.selectionKey,
      ].join('|'),
      apiProviderRuntime.env
    );

    if (!session) {
      throw new Error(
        this.t(this.getRuntimeLocale(), 'providerUnavailable', { provider: profile.name })
      );
    }

    const output = await this.waitForSessionOutput(session, token, onPartial);
    if (isProviderErrorOutput(output)) {
      throw new Error(output.trim().replace(/^Error:\s*/i, ''));
    }

    return this.cleanCommitMessageOutput(output, language, diff, inputMessage);
  }

  private cleanCommitMessageOutput(
    output: string,
    language: CommitMessageLanguage,
    diff: string,
    inputMessage: string,
    allowEmpty = false
  ): string {
    const message = cleanGeneratedCommitMessage(output, { language, diff, inputMessage });
    if (!message && !allowEmpty) {
      throw new Error(this.t(this.getRuntimeLocale(), 'emptyOutput'));
    }

    return message;
  }

  private waitForSessionOutput(
    session: Session,
    token: vscode.CancellationToken,
    onPartial: (output: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (token.isCancellationRequested) {
        this.cliManager.stop(session.id);
        reject(new Error('cancelled'));
        return;
      }

      let output = '';
      let stderr = '';
      let buffer = '';
      let settled = false;

      const disposables: vscode.Disposable[] = [];
      let timeout: ReturnType<typeof setTimeout>;
      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        disposables.forEach((disposable) => disposable.dispose());
        callback();
      };
      timeout = setTimeout(() => {
        this.cliManager.stop(session.id);
        settle(() => reject(new Error('Timed out waiting for the AI provider.')));
      }, COMMIT_MESSAGE_TIMEOUT_MS);

      disposables.push(
        session.onEvent.event((event) => {
          if (event.type === 'output' && event.stream === 'stdout') {
            const normalized = normalizeCliOutputChunk(event.text, session.cliId, buffer);
            buffer = normalized.buffer;
            output += normalized.text;
            onPartial(normalizeCliOutput(output, session.cliId));
            return;
          }

          if (event.type === 'output' && event.stream === 'stderr') {
            stderr += normalizeCliOutput(event.text, session.cliId);
            return;
          }

          if (event.type === 'error') {
            settle(() => reject(new Error(event.message)));
            return;
          }

          if (event.type !== 'end') {
            return;
          }

          output += flushCliOutputBuffer(buffer, session.cliId);
          if (event.exitCode === 0) {
            const normalizedOutput = normalizeCliOutput(output, session.cliId);
            const normalizedStderr = normalizeCliOutput(stderr, session.cliId).trim();
            if (!normalizedOutput.trim() && isLikelyCliError(normalizedStderr)) {
              settle(() => reject(new Error(normalizedStderr)));
              return;
            }

            settle(() => resolve(normalizedOutput));
            return;
          }

          const details = (stderr || output || `CLI exited with code ${event.exitCode}`).trim();
          settle(() => reject(new Error(details)));
        }),
        token.onCancellationRequested(() => {
          this.cliManager.stop(session.id);
          settle(() => reject(new Error('cancelled')));
        })
      );
    });
  }

  private getDefaultProfile(): CliProfile {
    const configured = this.getConfiguredProvider();

    return (
      (configured ? getCliProfile(configured) : undefined) ??
      getCliProfile(DEFAULT_CLI_ID) ??
      CLI_PROFILES[0]
    );
  }

  private getConfiguredProvider(): string {
    const commitProvider = this.getConfiguredCommitMessageProvider();
    if (
      commitProvider
      && commitProvider !== DEFAULT_COMMIT_MESSAGE_PROVIDER
      && commitProvider !== ASK_COMMIT_MESSAGE_PROVIDER
    ) {
      return commitProvider;
    }

    return vscode.workspace
      .getConfiguration('agents-gui')
      .get<string>('defaultProvider', DEFAULT_CLI_ID);
  }

  private getConfiguredCommitMessageProvider(): string {
    const commitProvider = vscode.workspace
      .getConfiguration('agents-gui.commitMessage')
      .get<string>('provider', DEFAULT_COMMIT_MESSAGE_PROVIDER);
    return commitProvider?.trim() || DEFAULT_COMMIT_MESSAGE_PROVIDER;
  }

  private usesDefaultCommitMessageProvider(): boolean {
    return this.getConfiguredCommitMessageProvider() === DEFAULT_COMMIT_MESSAGE_PROVIDER;
  }

  private usesAskCommitMessageProvider(): boolean {
    return this.getConfiguredCommitMessageProvider() === ASK_COMMIT_MESSAGE_PROVIDER;
  }

  private getConfiguredLanguage(): CommitMessageLanguageSetting {
    return vscode.workspace
      .getConfiguration('agents-gui.commitMessage')
      .get<CommitMessageLanguageSetting>('language', 'auto');
  }

  private getStoredOpenCodeModelId(): string | undefined {
    const models = this.state?.get<Record<string, string>>(MODEL_STATE_KEY, {});
    const modelId = models?.opencode;
    return typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined;
  }

  private async getOpenCodeCommitMessageModelId(repositoryRoot: string): Promise<string | undefined> {
    const storedModelId = this.getStoredOpenCodeModelId();
    if (storedModelId) {
      return storedModelId;
    }

    const availableModels = await this.cliManager
      .getOpenCodeModelOptions(repositoryRoot)
      .catch(() => []);
    const availableModelIds = new Set(availableModels.map((model) => model.id));

    return OPENCODE_COMMIT_MESSAGE_MODEL_PREFERENCES.find((modelId) =>
      availableModelIds.has(modelId)
    );
  }

  private getMaxDiffChars(): number {
    return vscode.workspace
      .getConfiguration('agents-gui.commitMessage')
      .get<number>('maxDiffChars', 60_000);
  }

  private getApiProviderSettings(): ApiProviderSettings {
    const config = vscode.workspace.getConfiguration('agents-gui.apiProviders');
    return sanitizeApiProviderSettings({
      customProviders: config.get<CustomApiProviderConfig[]>('customProviders', []),
      defaultProviderId: config.get<string>('defaultProviderId', ''),
      agentProviderByCliId: config.get<Record<string, string>>('agentProviderByCliId', {}),
    });
  }

  private getRuntimeLocale(): RuntimeLocale {
    return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  }

  private async generateCommitMessageWithCancellation(
    profile: CliProfile,
    prompt: string,
    repositoryRoot: string,
    language: CommitMessageLanguage,
    diff: string,
    onPartial: (output: string) => void,
    inputMessage: string,
    token: vscode.CancellationToken,
    externalToken?: vscode.CancellationToken
  ): Promise<string> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl },
      async () => {
        if (!externalToken) {
          if (token.isCancellationRequested) {
            throw new Error('cancelled');
          }

          return this.generateCommitMessage(
            profile,
            prompt,
            repositoryRoot,
            language,
            diff,
            onPartial,
            inputMessage,
            token
          );
        }

        const linkedCancellation = new vscode.CancellationTokenSource();
        const disposables = [
          token.onCancellationRequested(() => linkedCancellation.cancel()),
          externalToken.onCancellationRequested(() => linkedCancellation.cancel()),
        ];
        if (token.isCancellationRequested || externalToken.isCancellationRequested) {
          linkedCancellation.cancel();
        }

        try {
          if (linkedCancellation.token.isCancellationRequested) {
            throw new Error('cancelled');
          }

          return await this.generateCommitMessage(
            profile,
            prompt,
            repositoryRoot,
            language,
            diff,
            onPartial,
            inputMessage,
            linkedCancellation.token
          );
        } finally {
          disposables.forEach((disposable) => disposable.dispose());
          linkedCancellation.dispose();
        }
      }
    );
  }

  private async generateCommitMessageWithFallback(
    primaryProfile: CliProfile,
    resolveFallbackProfiles: () => Promise<CliProfile[]>,
    prompt: string,
    repositoryRoot: string,
    language: CommitMessageLanguage,
    diff: string,
    onPartial: (output: string) => void,
    onAttemptStart: (profile: CliProfile) => void,
    inputMessage: string,
    token: vscode.CancellationToken,
    externalToken?: vscode.CancellationToken
  ): Promise<CommitMessageGenerationResult> {
    const profiles = [primaryProfile];
    let fallbackProfilesLoaded = false;
    let lastError: Error | undefined;

    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      onAttemptStart(profile);

      try {
        const message = await this.generateCommitMessageWithCancellation(
          profile,
          prompt,
          repositoryRoot,
          language,
          diff,
          onPartial,
          inputMessage,
          token,
          externalToken
        );

        return {
          message,
          profile,
          ...(index > 0 && primaryProfile ? { fallbackFrom: primaryProfile } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'cancelled') {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(message);
        if (!fallbackProfilesLoaded) {
          fallbackProfilesLoaded = true;
          profiles.push(...await resolveFallbackProfiles());
        }

        if (index >= profiles.length - 1) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error(this.t(this.getRuntimeLocale(), 'emptyOutput'));
  }

  private t(locale: RuntimeLocale, key: string, values: Record<string, string> = {}): string {
    let message = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
    for (const [name, value] of Object.entries(values)) {
      message = message.replace(`{${name}}`, value);
    }
    return message;
  }
}

function preferredCommitAgentMode(profile: CliProfile): CliAgentMode {
  return (
    profile.agentModes.find((mode) => mode.id === 'plan' && !mode.disabled) ??
    profile.agentModes.find((mode) => mode.id === 'review' && !mode.disabled) ??
    getCliAgentMode(profile)
  );
}

function preferredCommitPermissionMode(profile: CliProfile): CliPermissionMode {
  return (
    profile.permissionModes?.find((mode) => mode.id === 'readOnly' && !mode.disabled) ??
    profile.permissionModes?.find((mode) => mode.id === 'plan' && !mode.disabled) ??
    getCliPermissionMode(profile)
  );
}

function isLikelyCliError(text: string): boolean {
  return /\b(?:error|failed|exception|eperm|eacces|enoent|timeout|timed out|http\s*5\d\d)\b/i.test(text);
}

function isProviderErrorOutput(text: string): boolean {
  return /^Error:\s+\S/.test(text.trim());
}

function resolveRepositoryRootUri(
  value?: vscode.Uri | { readonly rootUri?: vscode.Uri }
): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value;
  }

  return value?.rootUri;
}
