import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { CliManager } from './cliManager';
import { CommitMessageCommand } from './commitMessageCommand';
import { resolveRuntimeLocale, runtimeT } from './localization';
import { SYNCED_GLOBAL_STATE_KEYS } from './syncedState';

export function activate(context: vscode.ExtensionContext) {
  const locale = resolveRuntimeLocale(vscode.env.language);
  context.globalState.setKeysForSync(SYNCED_GLOBAL_STATE_KEYS);
  const cliManager = new CliManager();
  const commitMessageCommand = new CommitMessageCommand(cliManager, context.globalState);
  let sidebarProvider: SidebarProvider | undefined;

  const getSidebarProvider = (showWarning = true): SidebarProvider | undefined => {
    if (!sidebarProvider && showWarning) {
      void vscode.window.showWarningMessage(runtimeT(locale, 'warning.starting'));
    }
    return sidebarProvider;
  };

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  void vscode.commands.executeCommand('setContext', 'agent-hub.commitMessageGenerating', false);
  statusBar.text = runtimeT(locale, 'statusBar.text');
  statusBar.tooltip = runtimeT(locale, 'statusBar.tooltip');
  statusBar.command = 'agent-hub.openPanel';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.openPanel', () => {
      void vscode.commands.executeCommand('agent-hub.sidebar.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.reloadWindow', async () => {
      getSidebarProvider(false)?.stopAll();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.refreshProviders', async () => {
      const provider = getSidebarProvider();
      if (!provider) {
        return;
      }
      await provider.refreshProviders();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.openProviderSettings', async (section = 'agents') => {
      const provider = getSidebarProvider(false);
      if (!provider) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'agent-hub');
        return;
      }
      await provider.openProviderSettings(section);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'agent-hub');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.stopAll', () => {
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
    vscode.commands.registerCommand('agent-hub.explainSelection', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('explainSelection');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.reviewFile', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('reviewFile');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.generateTests', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('generateTests');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.refactorSelection', () => {
      const provider = getSidebarProvider();
      if (provider) {
        void provider.runEditorAction('refactorSelection');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.generateCommitMessage', (rootUri, _resourceGroups, token) => {
      return commitMessageCommand.run(rootUri, token);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.cancelCommitMessageGeneration', () => {
      commitMessageCommand.cancel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agent-hub.setupCommitMessage', () => {
      return vscode.commands.executeCommand('agent-hub.openProviderSettings', 'commitMessage');
    })
  );

  try {
    sidebarProvider = new SidebarProvider(context.extensionUri, cliManager, {
      extensionMode: context.extensionMode,
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
