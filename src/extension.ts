import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { CliManager } from './cliManager';
import { CliAgentRuntime } from './agentRuntime';
import { CliOpenCodeAgentCapability } from './openCodeAgentCapability';
import { CommitMessageCommand } from './commitMessageCommand';
import { runExtensionSmokeProbe } from './extensionSmokeHarness';
import { resolveRuntimeLocale, runtimeT } from './localization';
import { SYNCED_GLOBAL_STATE_KEYS } from './syncedState';

export function activate(context: vscode.ExtensionContext) {
  const locale = resolveRuntimeLocale(vscode.env.language);
  context.globalState.setKeysForSync(SYNCED_GLOBAL_STATE_KEYS);
  const cliManager = new CliManager();
  const agentRuntime = new CliAgentRuntime(cliManager);
  const openCodeCapability = new CliOpenCodeAgentCapability(cliManager);
  const commitMessageCommand = new CommitMessageCommand(cliManager);
  let sidebarProvider: SidebarProvider | undefined;

  const getSidebarProvider = (showWarning = true): SidebarProvider | undefined => {
    if (!sidebarProvider && showWarning) {
      void vscode.window.showWarningMessage(runtimeT(locale, 'warning.starting'));
    }
    return sidebarProvider;
  };

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  void vscode.commands.executeCommand('setContext', 'agents-gui.commitMessageGenerating', false);
  void vscode.commands.executeCommand('setContext', 'agents-gui.commitMessageGeneratingRoots', []);
  void vscode.commands.executeCommand('setContext', 'agents-gui.commitMessageStagedRoots', []);
  commitMessageCommand.watchStagedChangesContext(context);
  statusBar.text = runtimeT(locale, 'statusBar.text');
  statusBar.tooltip = runtimeT(locale, 'statusBar.tooltip');
  statusBar.command = 'agents-gui.openPanel';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.openPanel', () => {
      void vscode.commands.executeCommand('agents-gui.sidebar.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.reloadWindow', async () => {
      getSidebarProvider(false)?.stopAll();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.refreshProviders', async () => {
      const provider = getSidebarProvider();
      if (!provider) {
        return;
      }
      await provider.refreshProviders();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.openProviderSettings', async (section = 'agents') => {
      const provider = getSidebarProvider(false);
      if (!provider) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'agents-gui');
        return;
      }
      await provider.openProviderSettings(section);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'agents-gui');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.stopAll', () => {
      const provider = getSidebarProvider(false);
      if (provider) {
        provider.stopAll();
      } else {
        cliManager.stopAll();
      }
      vscode.window.showInformationMessage(runtimeT(locale, 'notification.stoppedAll'));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.explainSelection', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('explainSelection');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.reviewFile', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('reviewFile');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.generateTests', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('generateTests');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.refactorSelection', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('refactorSelection');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.generateCommitMessage', (rootUri, _resourceGroups, token) => {
      return commitMessageCommand.run(rootUri, token);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.cancelCommitMessageGeneration', (rootUri) => {
      commitMessageCommand.cancel(rootUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-gui.setupCommitMessage', () => {
      return vscode.commands.executeCommand('agents-gui.openProviderSettings', 'commitMessage');
    })
  );

  if (context.extensionMode !== vscode.ExtensionMode.Production) {
    context.subscriptions.push(
      vscode.commands.registerCommand('agents-gui.internal.runSmoke', () => (
        runExtensionSmokeProbe(context.extensionUri, { storageUri: context.globalStorageUri })
      ))
    );
  }

  try {
    sidebarProvider = new SidebarProvider(context.extensionUri, agentRuntime, {
      extensionMode: context.extensionMode,
      openCodeCapability,
      state: context.globalState,
      storageUri: context.globalStorageUri,
    });

    // Register sidebar webview provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        SidebarProvider.viewType,
        sidebarProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(runtimeT(locale, 'error.activationFailed', { message }));
  }

  // Clean up on deactivate
  context.subscriptions.push({
    dispose: () => {
      cliManager.stopAll();
      sidebarProvider?.dispose({ disposeContextCollector: true });
    },
  });
}

export function deactivate() {
  // cleanup handled by disposables
}
