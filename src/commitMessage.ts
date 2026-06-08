export type CommitMessageLanguage = 'en' | 'zh-CN';
export type CommitMessageLanguageSetting = 'auto' | CommitMessageLanguage;

export interface CommitMessagePromptRequest {
  diff: string;
  language: CommitMessageLanguage;
  truncated: boolean;
  inputMessage?: string;
}

export interface TruncatedCommitDiff {
  diff: string;
  truncated: boolean;
}

export interface CleanCommitMessageOptions {
  language?: CommitMessageLanguage;
  diff?: string;
  inputMessage?: string;
}

export const DEFAULT_COMMIT_DIFF_MAX_CHARS = 60_000;

export function resolveCommitMessageLanguage(
  vscodeLanguage: string,
  configured: CommitMessageLanguageSetting = 'auto'
): CommitMessageLanguage {
  if (configured === 'en' || configured === 'zh-CN') {
    return configured;
  }

  return vscodeLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function truncateCommitDiff(
  diff: string,
  maxChars = DEFAULT_COMMIT_DIFF_MAX_CHARS
): TruncatedCommitDiff {
  if (diff.length <= maxChars) {
    return { diff, truncated: false };
  }

  return {
    diff: diff.slice(0, Math.max(0, maxChars)),
    truncated: true,
  };
}

export function buildCommitMessagePrompt(request: CommitMessagePromptRequest): string {
  const languageInstruction =
    request.language === 'zh-CN'
      ? 'Language: Simplified Chinese summary after the colon; keep the Conventional Commits type and optional scope in English.'
      : 'Language: English.';
  const truncationInstruction = request.truncated
    ? 'The staged diff was truncated; use only the visible staged diff.'
    : 'The staged diff is complete.';
  const inputMessage = request.inputMessage?.trim();
  const inputContext = inputMessage
    ? [
        '',
        'Existing Source Control input (draft/style only, not change evidence):',
        '```text',
        escapePromptFence(inputMessage),
        '```',
      ]
    : [];

  return [
    'Generate a Git commit message for VS Code Source Control.',
    'Only use the staged Git diff below as the source of truth. Do not mention unstaged or untracked changes.',
    languageInstruction,
    truncationInstruction,
    'Output only a Conventional Commits message: type(optional-scope): summary.',
    'Use one subject line when possible; add a body only for multiple meaningful staged changes.',
    'No Markdown, reasoning, issue numbers, branch names, tests, or invented behavior.',
    ...inputContext,
    '',
    'Staged Git diff:',
    '```diff',
    request.diff,
    '```',
  ].join('\n');
}

function escapePromptFence(text: string): string {
  return text.replace(/```/g, "'''");
}

export function cleanGeneratedCommitMessage(
  text: string,
  options: CleanCommitMessageOptions = {}
): string {
  const fenced = extractFirstFence(text);
  const source = fenced ?? text;
  const lines = source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());

  const start = findCommitMessageStart(lines);
  if (!start) {
    return '';
  }

  const selectedLines = lines.slice(start.lineIndex);
  selectedLines[0] = selectedLines[0].slice(start.columnIndex).trimStart();
  const selected = selectedLines
    .filter((line) => !isFenceLine(line))
    .join('\n')
    .trim();

  return normalizeCommitMessageFormat(stripTrailingExplanation(selected));
}

function extractFirstFence(text: string): string | undefined {
  const match = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/.exec(text);
  return match?.[1];
}

function findCommitMessageStart(
  lines: string[]
): { lineIndex: number; columnIndex: number } | undefined {
  const conventional = /\b[a-z]+(?:\([^)]+\))?!?:\s+\S/;
  const genericSubject = /^(?:revert:|merge\b|initial commit\b)/i;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (genericSubject.test(trimmed)) {
      return { lineIndex, columnIndex: line.indexOf(trimmed) };
    }

    const match = conventional.exec(line);
    if (match) {
      return { lineIndex, columnIndex: match.index };
    }
  }

  return undefined;
}

function isFenceLine(line: string): boolean {
  return /^```/.test(line.trim());
}

function stripTrailingExplanation(message: string): string {
  const lines = message.split('\n');
  const explanationIndex = lines.findIndex((line, index) => {
    if (index === 0) {
      return false;
    }

    return /^(?:This|It|The commit|Explanation|Rationale)\b/i.test(line.trim());
  });

  return (explanationIndex >= 0 ? lines.slice(0, explanationIndex) : lines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeCommitMessageFormat(message: string): string {
  const normalized = message
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  const lines = normalized.split('\n');
  const subject = (lines[0] ?? '').trim();
  const body = lines.slice(1).join('\n').trim();

  if (!subject) {
    return '';
  }

  if (!body) {
    return subject;
  }

  return [subject, '', body.replace(/\n{3,}/g, '\n\n')].join('\n');
}
