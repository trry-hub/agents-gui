import * as path from 'path';
import * as vscode from 'vscode';
import {
  AssistantContextOptions,
  AssistantContextSnapshot,
  AssistantContextSummary,
  AssistantDiagnosticContext,
} from './assistantTypes';

export interface ContextCollectionLimits {
  maxFileChars: number;
  maxSelectionChars: number;
  maxDiagnostics: number;
}

const DEFAULT_LIMITS: ContextCollectionLimits = {
  maxFileChars: 12000,
  maxSelectionChars: 8000,
  maxDiagnostics: 12,
};

export class AssistantContextCollector {
  private lastActiveEditor?: vscode.TextEditor;
  private readonly activeEditorDisposable: vscode.Disposable;

  constructor() {
    this.rememberEditor(vscode.window.activeTextEditor);
    this.activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.rememberEditor(editor);
    });
  }

  async collect(
    options: AssistantContextOptions,
    limits: Partial<ContextCollectionLimits> = {}
  ): Promise<AssistantContextSnapshot> {
    const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
    const editor = this.getCurrentEditor();
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const workspaceFolder = editor
      ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
      : workspaceFolders[0];
    const workspaceName = vscode.workspace.name ?? workspaceFolder?.name ?? workspaceFolders[0]?.name;

    const snapshot: AssistantContextSnapshot = {
      diagnostics: [],
    };

    if (options.includeWorkspace && (workspaceFolder || workspaceFolders.length > 0)) {
      snapshot.workspace = {
        name: workspaceName ?? workspaceFolder?.name ?? 'Workspace',
        rootPath: workspaceFolder?.uri.fsPath ?? workspaceFolders[0]?.uri.fsPath ?? '',
        activeFolderName: workspaceFolder?.name,
        activeFolderRootPath: workspaceFolder?.uri.fsPath,
        folders: workspaceFolders.map((folder) => ({
          name: folder.name,
          rootPath: folder.uri.fsPath,
          active: Boolean(workspaceFolder && folder.uri.fsPath === workspaceFolder.uri.fsPath),
        })),
      };
    }

    if (!editor) {
      return snapshot;
    }

    const document = editor.document;
    const relativePath = this.getRelativePath(document.uri, workspaceFolder);

    if (options.includeCurrentFile) {
      const bounded = boundText(document.getText(), resolvedLimits.maxFileChars);
      snapshot.activeFile = {
        relativePath,
        languageId: document.languageId,
        lineCount: document.lineCount,
        text: bounded.text,
        truncated: bounded.truncated,
      };
    } else {
      snapshot.activeFile = {
        relativePath,
        languageId: document.languageId,
        lineCount: document.lineCount,
        truncated: false,
      };
    }

    if (options.includeSelection && !editor.selection.isEmpty) {
      const bounded = boundText(document.getText(editor.selection), resolvedLimits.maxSelectionChars);
      snapshot.selection = {
        text: bounded.text,
        startLine: editor.selection.start.line + 1,
        endLine: editor.selection.end.line + 1,
        truncated: bounded.truncated,
      };
    }

    if (options.includeDiagnostics) {
      snapshot.diagnostics = vscode.languages
        .getDiagnostics(document.uri)
        .slice(0, resolvedLimits.maxDiagnostics)
        .map((diagnostic): AssistantDiagnosticContext => ({
          severity: severityName(diagnostic.severity),
          message: diagnostic.message,
          relativePath,
          line: diagnostic.range.start.line + 1,
        }));
    }

    return snapshot;
  }

  dispose(): void {
    this.activeEditorDisposable.dispose();
  }

  summarize(snapshot: AssistantContextSnapshot): AssistantContextSummary {
    const summary: AssistantContextSummary = {
      diagnostics: snapshot.diagnostics.length,
    };

    if (snapshot.workspace) {
      summary.workspace = snapshot.workspace.name;
      summary.workspacePath = snapshot.workspace.rootPath;
      summary.workspaceFolders = snapshot.workspace.folders;
    }
    if (snapshot.activeFile) {
      summary.activeFile = snapshot.activeFile.relativePath;
    }
    if (snapshot.selection) {
      summary.selection =
        snapshot.selection.startLine === snapshot.selection.endLine
          ? `line ${snapshot.selection.startLine}`
          : `lines ${snapshot.selection.startLine}-${snapshot.selection.endLine}`;
    }

    return summary;
  }

  private getRelativePath(uri: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder): string {
    if (!workspaceFolder) {
      return uri.fsPath;
    }

    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath) || path.basename(uri.fsPath);
  }

  private getCurrentEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor ?? this.lastActiveEditor;
    if (!editor || editor.document.isClosed) {
      return undefined;
    }

    return editor;
  }

  private rememberEditor(editor: vscode.TextEditor | undefined): void {
    if (editor && !editor.document.isClosed) {
      this.lastActiveEditor = editor;
    }
  }
}

function boundText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n\n[Truncated after ${maxChars} characters]`,
    truncated: true,
  };
}

function severityName(severity: vscode.DiagnosticSeverity): AssistantDiagnosticContext['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'Error';
    case vscode.DiagnosticSeverity.Warning:
      return 'Warning';
    case vscode.DiagnosticSeverity.Information:
      return 'Information';
    case vscode.DiagnosticSeverity.Hint:
      return 'Hint';
  }
}
