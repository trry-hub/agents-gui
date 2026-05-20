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
      ? 'Generate the commit message in Simplified Chinese, but keep the Conventional Commits type and optional scope in English. For Simplified Chinese output, the summary after the colon must be Simplified Chinese.'
      : 'Generate the commit message in English.';
  const truncationInstruction = request.truncated
    ? 'The staged diff was truncated. Generate the best commit message from the visible staged diff only.'
    : 'The staged diff is complete.';
  const inputMessage = request.inputMessage?.trim();
  const inputContext = inputMessage
    ? [
        '',
        'Existing Source Control input:',
        'Use this input as a user-provided draft or intent, including format or style instruction. The staged diff remains the source of truth; preserve useful scope, wording, or style only when it does not contradict the staged diff.',
        'If the input asks for emoji, keep the Conventional Commits type at the start and put the emoji inside the summary after the colon.',
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
    '- The first line must be a Conventional Commits subject: type(optional-scope): summary.',
    '- Use exactly one of these formats: a single subject line, or a subject line, one blank line, then body.',
    '- Use one concise subject line when possible.',
    '- Add a body only when the staged diff contains multiple meaningful changes.',
    '- When adding a body, put exactly one empty line between the subject and the body.',
    '- Keep the body to at most two short lines; each line must describe a concrete staged change.',
    '- Do not output analysis, reasoning, rationale, or explanations.',
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

  return normalizeCommitMessageFormat(
    applyInputPreferences(
      enforceCommitMessageLanguage(stripTrailingExplanation(selected), options),
      options
    )
  );
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

function enforceCommitMessageLanguage(
  message: string,
  options: CleanCommitMessageOptions
): string {
  if (options.language !== 'zh-CN') {
    return message;
  }

  const firstLine = message.split('\n')[0] ?? '';
  const summary = conventionalSummary(firstLine);
  if (summary && containsCjk(summary)) {
    return message;
  }

  return buildCommitMessageFallback(options.diff, options.language, firstLine);
}

function conventionalSummary(line: string): string | undefined {
  return /^[a-z]+(?:\([^)]+\))?!?:\s+(.+)$/.exec(line.trim())?.[1];
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9FFF]/.test(text);
}

function buildCommitMessageFallback(
  diff: string | undefined,
  language: CommitMessageLanguage | undefined,
  candidateSubject: string
): string {
  if (!diff) {
    return '';
  }

  const file = changedFiles(diff)[0];
  if (!file) {
    return '';
  }

  const scope = conventionalScope(candidateSubject) ?? inferCommitScope(file);
  const displayName = displayFileName(file);
  const change = classifyDiffChange(diff);
  if (change === 'addedBlankLines') {
    return language === 'zh-CN'
      ? `chore(${scope}): 在 ${displayName} 末尾添加空行`
      : `chore(${scope}): add trailing blank lines to ${displayName}`;
  }

  return language === 'zh-CN'
    ? `chore(${scope}): 更新 ${displayName}`
    : `chore(${scope}): update ${displayName}`;
}

function applyInputPreferences(message: string, options: CleanCommitMessageOptions): string {
  if (!message || !inputRequestsEmoji(options.inputMessage)) {
    return message;
  }

  return ensureSubjectEmoji(message);
}

function inputRequestsEmoji(inputMessage: string | undefined): boolean {
  if (!inputMessage) {
    return false;
  }

  const input = inputMessage.trim();
  if (!input) {
    return false;
  }

  if (/(?:不要|不用|不需要|无需|without|no)\s*.*(?:emoji|gitmoji|表情|图标)/i.test(input)) {
    return false;
  }

  return /(?:emoji|gitmoji|表情|表情图标|带上.*图标|带.*表情)/i.test(input);
}

function ensureSubjectEmoji(message: string): string {
  const lines = message.split('\n');
  const subject = lines[0] ?? '';
  if (!subject || containsEmoji(subject)) {
    return message;
  }

  const match = /^([a-z]+(?:\([^)]+\))?!?:\s+)(.+)$/.exec(subject.trim());
  if (!match) {
    return message;
  }

  lines[0] = `${match[1]}${emojiForCommitType(match[1])} ${match[2].trimStart()}`;
  return lines.join('\n');
}

function emojiForCommitType(prefix: string): string {
  const type = /^([a-z]+)/.exec(prefix)?.[1] ?? '';
  const emojiByType: Record<string, string> = {
    feat: '✨',
    fix: '🛠️',
    docs: '📝',
    style: '💄',
    refactor: '♻️',
    perf: '⚡',
    test: '✅',
    build: '🏗️',
    ci: '💚',
    chore: '🔧',
    revert: '⏪',
  };

  return emojiByType[type] ?? '✨';
}

function containsEmoji(text: string): boolean {
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
}

function changedFiles(diff: string): string[] {
  const files: string[] = [];
  const pushFile = (file: string | undefined) => {
    if (!file || file === '/dev/null' || files.includes(file)) {
      return;
    }

    files.push(file);
  };

  for (const line of diff.split('\n')) {
    const trimmed = line.trim();
    const gitMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(trimmed);
    if (gitMatch) {
      pushFile(gitMatch[2]);
      continue;
    }

    const plusMatch = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(trimmed);
    if (plusMatch) {
      pushFile(plusMatch[1]);
      continue;
    }

    const indexMatch = /^Index:\s+(.+)$/.exec(trimmed);
    if (indexMatch) {
      pushFile(indexMatch[1]);
    }
  }

  return files;
}


function conventionalScope(line: string): string | undefined {
  return /^[a-z]+\(([^)]+)\)!?:\s+\S/.exec(line.trim())?.[1];
}

function inferCommitScope(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  if (/^\.?env(?:\.|$)/.test(base)) {
    return 'env';
  }

  const directory = normalized.split('/').filter(Boolean)[0];
  return sanitizeScope(directory || base.replace(/\.[^.]+$/, '')) || 'misc';
}

function sanitizeScope(scope: string): string {
  return scope.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function displayFileName(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  return normalized.split('/').pop() || normalized;
}

function classifyDiffChange(diff: string): 'addedBlankLines' | 'updated' {
  const changes = diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'));
  const additions = changes.filter((line) => line.startsWith('+'));
  const removals = changes.filter((line) => line.startsWith('-'));

  if (
    additions.length > 0 &&
    removals.length === 0 &&
    changes.every((line) => line.slice(1).trim() === '')
  ) {
    return 'addedBlankLines';
  }

  return 'updated';
}
