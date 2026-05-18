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
      ? 'Generate the commit message in Simplified Chinese, but keep the Conventional Commits type and optional scope in English.'
      : 'Generate the commit message in English.';
  const truncationInstruction = request.truncated
    ? 'The staged diff was truncated. Generate the best commit message from the visible staged diff only.'
    : 'The staged diff is complete.';
  const inputMessage = request.inputMessage?.trim();
  const inputContext = inputMessage
    ? [
        '',
        'Existing Source Control input:',
        'Use this input as a user-provided draft or intent. The staged diff remains the source of truth; preserve useful scope or wording only when supported by the staged diff.',
        '```text',
        escapePromptFence(inputMessage),
        '```',
      ]
    : [];

  return [
    'You are generating a Git commit message for VS Code Source Control.',
    'Only use the staged Git diff below as the source of truth. Do not mention unstaged or untracked changes.',
    languageInstruction,
    truncationInstruction,
    '',
    'Rules:',
    '- Output only the commit message. Do not wrap it in Markdown fences.',
    '- Prefer Conventional Commits: type(scope): summary.',
    '- Use one concise subject line when possible.',
    '- Add a short body only when the staged diff contains multiple meaningful changes.',
    '- Do not invent issue numbers, branch names, tests, or unstaged behavior.',
    '- If Existing Source Control input is provided, treat it as draft wording or user intent, not as extra change evidence.',
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

export function cleanGeneratedCommitMessage(text: string): string {
  const fenced = extractFirstFence(text);
  const source = fenced ?? text;
  const lines = source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());

  const startIndex = findCommitMessageStart(lines);
  const selected = (startIndex >= 0 ? lines.slice(startIndex) : lines)
    .filter((line) => !isFenceLine(line))
    .join('\n')
    .trim();

  return stripTrailingExplanation(selected);
}

function extractFirstFence(text: string): string | undefined {
  const match = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/.exec(text);
  return match?.[1];
}

function findCommitMessageStart(lines: string[]): number {
  const conventional = /^[a-z]+(?:\([^)]+\))?!?:\s+\S/;
  const genericSubject = /^(?:revert:|merge\b|initial commit\b)/i;

  return lines.findIndex((line) => {
    const trimmed = line.trim();
    return conventional.test(trimmed) || genericSubject.test(trimmed);
  });
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
