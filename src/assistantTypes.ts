export type AssistantMode = 'agent';

export interface AssistantAgentModeRef {
  id: string;
  label: string;
  instruction: string;
}

export type AssistantActionId =
  | 'freeform'
  | 'explainSelection'
  | 'reviewFile'
  | 'generateTests'
  | 'refactorSelection';

export interface AssistantProviderRef {
  id: string;
  name: string;
}

export interface AssistantContextOptions {
  includeWorkspace: boolean;
  includeCurrentFile: boolean;
  includeSelection: boolean;
  includeDiagnostics: boolean;
}

export interface AssistantWorkspaceContext {
  name: string;
  rootPath: string;
  activeFolderName?: string;
  activeFolderRootPath?: string;
  folders?: AssistantWorkspaceFolderContext[];
}

export interface AssistantWorkspaceFolderContext {
  name: string;
  rootPath: string;
  active?: boolean;
}

export interface AssistantFileContext {
  relativePath: string;
  languageId: string;
  lineCount: number;
  text?: string;
  truncated: boolean;
}

export interface AssistantSelectionContext {
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface AssistantDiagnosticContext {
  severity: 'Error' | 'Warning' | 'Information' | 'Hint';
  message: string;
  relativePath: string;
  line: number;
}

export interface AssistantContextSnapshot {
  workspace?: AssistantWorkspaceContext;
  activeFile?: AssistantFileContext;
  selection?: AssistantSelectionContext;
  diagnostics: AssistantDiagnosticContext[];
}

export interface AssistantImageAttachment {
  kind: 'image';
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export interface AssistantImageAttachmentInput {
  kind: 'image';
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface AssistantConversationHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantPromptRequest {
  provider: AssistantProviderRef;
  mode: AssistantMode;
  agentMode: AssistantAgentModeRef;
  runtime?: AssistantRuntimeSelection;
  action: AssistantActionId;
  message: string;
  attachments?: AssistantImageAttachment[];
  conversationHistory?: AssistantConversationHistoryMessage[];
  context: AssistantContextSnapshot;
  locale?: string;
}

export interface AssistantRuntimeSelection {
  modelId?: string;
  modelLabel?: string;
  modelVariant?: string;
  runtimeId?: string;
  runtimeLabel?: string;
  permissionModeId?: string;
  permissionModeLabel?: string;
}

export interface AssistantWebviewRequest {
  cliId?: string;
  providerId?: string;
  text?: string;
  mode?: AssistantMode;
  agentMode?: string;
  model?: string;
  modelVariant?: string;
  customModel?: string;
  runtime?: string;
  permissionMode?: string;
  workflowMode?: string;
  action?: AssistantActionId;
  attachments?: AssistantImageAttachmentInput[];
  conversationHistory?: AssistantConversationHistoryMessage[];
  contextOptions?: Partial<AssistantContextOptions>;
}

export interface AssistantContextSummary {
  workspace?: string;
  workspacePath?: string;
  workspaceFolders?: AssistantWorkspaceFolderContext[];
  workspaceBranch?: string;
  openCodeProject?: AssistantOpenCodeProject;
  mcpServers?: AssistantMcpServerStatus[];
  mcpStatusPending?: boolean;
  lspServers?: AssistantLspServerStatus[];
  activeFile?: string;
  selection?: string;
  diagnostics: number;
  tokenUsage?: AssistantTokenUsage;
  contextWindowTokens?: number;
}

export interface AssistantOpenCodeStatus {
  project?: AssistantOpenCodeProject;
  mcpServers?: AssistantMcpServerStatus[];
  lspServers?: AssistantLspServerStatus[];
}

export type AssistantOpenCodeNativeCommand =
  | 'share'
  | 'unshare'
  | 'compact'
  | 'fork'
  | 'undo'
  | 'redo';

export interface AssistantOpenCodeNativeCommandResult {
  command: AssistantOpenCodeNativeCommand;
  ok: boolean;
  message?: string;
  url?: string;
  newOpenCodeSessionId?: string;
  title?: string;
}

export interface AssistantOpenCodeProject {
  id?: string;
  worktree?: string;
  vcs?: string;
}

export interface AssistantMcpServerStatus {
  name: string;
  status: string;
  error?: string;
}

export interface AssistantLspServerStatus {
  name: string;
  status?: string;
  error?: string;
}

export type AssistantTokenPrecision = 'exact' | 'estimated' | 'unavailable';

export interface AssistantTokenUsage {
  precision: AssistantTokenPrecision;
  tokens?: number;
  tokenizer?: string;
  reason?: string;
}
