import {
  AssistantActionId,
  AssistantConversationHistoryMessage,
  AssistantContextSnapshot,
  AssistantImageAttachment,
  AssistantPromptRequest,
} from './assistantTypes';

const ACTION_LABELS: Record<AssistantActionId, string> = {
  freeform: 'Freeform request',
  explainSelection: 'Explain selected code',
  reviewFile: 'Review current file',
  generateTests: 'Generate tests',
  refactorSelection: 'Refactor selected code',
};

const ACTION_INSTRUCTIONS: Record<AssistantActionId, string> = {
  freeform:
    'Answer the user request using the provided IDE context. Be concrete and reference files when useful.',
  explainSelection:
    'Explain the selected code clearly. Cover intent, important control flow, edge cases, and any risky assumptions.',
  reviewFile:
    'Review the current file for correctness, maintainability, type-safety, missing tests, and likely regressions. Lead with findings. Do not review the whole workspace when current file context is unavailable; ask the user to open a file instead.',
  generateTests:
    'Propose or implement focused tests for the selected code or current file. Prefer existing project patterns and explain how to run them.',
  refactorSelection:
    'Refactor the selected code while preserving behavior. Keep changes scoped and explain the resulting improvement.',
};

const DELIVERY_REQUIREMENTS = [
  'If the request involves code changes, include a compact delivery checklist:',
  '- Files changed: list each file path and the exact change.',
  '- Verification: commands or checks that confirm the change is correct (or explain why verification is not possible).',
  '- Risks and caveats: call out assumptions, follow-up work, and edge cases.',
].join('\n');

export function buildAssistantPrompt(request: AssistantPromptRequest): string {
  if (request.provider.id === 'opencode' && request.action === 'freeform') {
    return buildOpenCodeFreeformPrompt(request);
  }

  const agentMode = request.agentMode;
  const lines: string[] = [
    'You are an AI coding assistant embedded in VS Code.',
    `Provider: ${request.provider.name}`,
    'Mode: Agent',
    `Provider agent/mode: ${agentMode.label} (${agentMode.id})`,
    renderRuntimeSelection(request),
    `Action: ${ACTION_LABELS[request.action]}`,
    '',
    'Agent mode is always enabled. Reason across files when helpful and be explicit about assumptions, edits, and verification.',
    agentMode.instruction,
    ACTION_INSTRUCTIONS[request.action],
    '',
    'User request:',
    request.message.trim() || defaultMessageForAction(request.action),
    '',
    renderConversationHistory(request.conversationHistory),
    '',
    renderAssistantAttachments(request.attachments),
    '',
    renderAssistantContext(request.context),
    '',
    'Response requirements:',
    '- Be specific to the provided project context.',
    '- Use concise Markdown.',
    '- When suggesting code changes, include file paths and minimal patches or snippets.',
    '- If context is missing, say what is missing and proceed with the best available information.',
    '- Only when progress is blocked until the user chooses among discrete options, first ask the user to choose, then put each choice on its own line as "Option N — label" or "选项 N — 标签" so the UI can render quick replies. Do not use that format for optional follow-up suggestions after a completed answer.',
    DELIVERY_REQUIREMENTS,
    languageInstructionForLocale(request.locale),
  ];

  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

function buildOpenCodeFreeformPrompt(request: AssistantPromptRequest): string {
  const message = request.message.trim() || defaultMessageForAction(request.action);
  const languageDirective = languageInstructionForLocale(request.locale);
  const hasAttachments = Boolean(request.attachments?.length);
  const hasContext = hasSubstantialContext(request.context);
  const hasHistory = Boolean(request.conversationHistory?.length);
  const runtimeSelection = renderRuntimeSelection(request);
  const hasRuntimeSelection = Boolean(runtimeSelection);

  if (!hasAttachments && !hasContext && !hasHistory && !hasRuntimeSelection) {
    if (!languageDirective) {
      return message;
    }
    return `${message}\n\n${languageDirective}`;
  }

  const lines: string[] = [message, ''];

  if (runtimeSelection) {
    lines.push(runtimeSelection, '');
  }

  const history = renderConversationHistory(request.conversationHistory);
  if (history) {
    lines.push(history, '');
  }

  const attachments = renderAssistantAttachments(request.attachments);
  if (attachments) {
    lines.push(attachments, '');
  }

  if (hasContext) {
    lines.push('IDE context, use only if relevant:');
    lines.push(renderAssistantContext(request.context));
    lines.push('');
  }

  if (languageDirective) {
    lines.push(languageDirective);
    lines.push('');
  }

  lines.push('Keep the answer concise. Do not inspect the project unless the request needs it.');
  lines.push(
    'Only when progress is blocked until the user chooses among discrete options, first ask the user to choose, then put each choice on its own line as "Option N — label" or "选项 N — 标签" so the UI can render quick replies. Do not use that format for optional follow-up suggestions after a completed answer.'
  );
  lines.push('');
  lines.push(DELIVERY_REQUIREMENTS);

  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

function renderRuntimeSelection(request: AssistantPromptRequest): string {
  const runtime = request.runtime;
  if (!runtime) {
    return '';
  }

  const lines = ['Runtime selection from Agents GUI:'];
  lines.push(`- Provider: ${request.provider.name}`);
  lines.push(`- Agent/mode: ${request.agentMode.label} (${request.agentMode.id})`);
  if (runtime.modelId || runtime.modelLabel) {
    lines.push(
      `- Selected model: ${runtime.modelLabel || runtime.modelId}${runtime.modelId ? ` (${runtime.modelId})` : ''}`
    );
  }
  if (runtime.modelVariant) {
    lines.push(`- Reasoning depth: ${runtime.modelVariant}`);
  }
  if (runtime.runtimeId || runtime.runtimeLabel) {
    lines.push(
      `- Runtime mode: ${runtime.runtimeLabel || runtime.runtimeId}${runtime.runtimeId ? ` (${runtime.runtimeId})` : ''}`
    );
  }
  if (runtime.permissionModeId || runtime.permissionModeLabel) {
    lines.push(
      `- Permission mode: ${runtime.permissionModeLabel || runtime.permissionModeId}${runtime.permissionModeId ? ` (${runtime.permissionModeId})` : ''}`
    );
  }
  lines.push(
    'If the user asks which model, reasoning depth, agent, runtime, or permission mode is selected, answer from this Agents GUI runtime selection instead of guessing from prior conversation, provider memory, or model self-knowledge.'
  );
  return lines.join('\n');
}

export function getAssistantActionLabel(action: AssistantActionId): string {
  return ACTION_LABELS[action];
}

function defaultMessageForAction(action: AssistantActionId): string {
  switch (action) {
    case 'explainSelection':
      return 'Explain the selected code.';
    case 'reviewFile':
      return 'Review the current file.';
    case 'generateTests':
      return 'Generate focused tests.';
    case 'refactorSelection':
      return 'Refactor the selected code.';
    case 'freeform':
      return 'Help with the current coding task.';
  }
}

export function renderAssistantContext(context: AssistantContextSnapshot): string {
  const sections: string[] = ['IDE context:'];

  if (context.workspace) {
    sections.push(`Workspace: ${context.workspace.name}`);
    if (Array.isArray(context.workspace.folders) && context.workspace.folders.length > 1) {
      sections.push('VS Code multi-root workspace folders:');
      for (const folder of context.workspace.folders) {
        sections.push(
          `- ${folder.name}${folder.active ? ' (active file folder)' : ''}: ${folder.rootPath}`
        );
      }
      if (context.workspace.activeFolderName && context.workspace.activeFolderRootPath) {
        sections.push(`Active workspace folder: ${context.workspace.activeFolderName}`);
        sections.push(`Active workspace folder root: ${context.workspace.activeFolderRootPath}`);
      }
      sections.push('Do not treat the active file folder as the whole VS Code workspace.');
    } else {
      sections.push(`Workspace root: ${context.workspace.rootPath}`);
    }
  }

  if (context.activeFile) {
    sections.push('');
    sections.push(`Current file: ${context.activeFile.relativePath}`);
    sections.push(`Language: ${context.activeFile.languageId}`);
    sections.push(`Line count: ${context.activeFile.lineCount}`);

    if (context.activeFile.text) {
      sections.push(fencedBlock(context.activeFile.languageId, context.activeFile.text));
      if (context.activeFile.truncated) {
        sections.push('Current file context was truncated.');
      }
    }
  }

  if (context.selection) {
    sections.push('');
    sections.push(`Selection: lines ${context.selection.startLine}-${context.selection.endLine}`);
    sections.push(fencedBlock('', context.selection.text));
    if (context.selection.truncated) {
      sections.push('Selection context was truncated.');
    }
  }

  if (context.diagnostics.length > 0) {
    sections.push('');
    sections.push('Diagnostics:');
    for (const diagnostic of context.diagnostics) {
      sections.push(
        `- ${diagnostic.severity} ${diagnostic.relativePath}:${diagnostic.line} ${diagnostic.message}`
      );
    }
  }

  if (sections.length === 1) {
    sections.push('No IDE context was attached.');
  }

  return sections.join('\n');
}

function hasSubstantialContext(context: AssistantContextSnapshot): boolean {
  return Boolean(
    context.workspace || context.activeFile || context.selection || context.diagnostics.length > 0
  );
}

function renderConversationHistory(history: AssistantConversationHistoryMessage[] = []): string {
  const entries = history
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant'))
    .map((entry) => ({
      role: entry.role === 'user' ? 'User' : 'Assistant',
      text: compactHistoryText(entry.text),
    }))
    .filter((entry) => entry.text)
    .slice(-8);

  if (entries.length === 0) {
    return '';
  }

  const lines = [
    'Recent conversation in this thread:',
    'Use this to answer follow-up questions and avoid asking the user to repeat prior details.',
  ];
  for (const entry of entries) {
    lines.push(`- ${entry.role}: ${entry.text}`);
  }
  return lines.join('\n');
}

function compactHistoryText(value: string): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 1200 ? `${safeSlice(text, 1197)}...` : text;
}

function safeSlice(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let end = max;
  const preceding = text.charCodeAt(end - 1);
  if (preceding >= 0xd800 && preceding <= 0xdbff) {
    end -= 1;
  }
  return text.slice(0, end);
}

export function renderAssistantAttachments(attachments: AssistantImageAttachment[] = []): string {
  const images = attachments.filter((attachment) => attachment.kind === 'image' && attachment.path);
  if (images.length === 0) {
    return '';
  }

  const sections = ['Attached images:'];
  for (const image of images) {
    sections.push(`- ${image.name} (${image.mimeType}, ${formatBytes(image.size)}): ${image.path}`);
  }
  sections.push(
    'Use these local image paths when the selected provider can inspect image files. If image inspection is unavailable, say so clearly and work from the user request.'
  );
  return sections.join('\n');
}

function fencedBlock(languageId: string, text: string): string {
  const fenceLanguage = languageId && /^[a-zA-Z0-9_-]+$/.test(languageId) ? languageId : '';
  const fence = chooseFenceMarker(text);
  return `${fence}${fenceLanguage}\n${text}\n${fence}`;
}

function chooseFenceMarker(text: string): string {
  let maxRun = 2;
  const backtickRuns = text.match(/`{3,}/g);
  if (backtickRuns) {
    for (const run of backtickRuns) {
      maxRun = Math.max(maxRun, run.length);
    }
  }
  const tildeRuns = text.match(/~{3,}/g);
  if (tildeRuns) {
    for (const run of tildeRuns) {
      maxRun = Math.max(maxRun, run.length);
    }
  }
  return '~'.repeat(maxRun + 1);
}

function formatBytes(size: number): string {
  const bytes = Math.max(0, Math.round(Number(size) || 0));
  if (bytes >= 1024 * 1024) {
    const value = bytes / (1024 * 1024);
    return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function languageInstructionForLocale(locale?: string): string {
  if (!locale) {
    return '';
  }
  if (locale.startsWith('zh')) {
    return 'Reply in Chinese (简体中文). Do not mix languages.';
  }
  return 'Reply in English. Do not mix languages.';
}
