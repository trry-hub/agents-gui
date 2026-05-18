const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

const CONTROL_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const ORPHAN_ANSI_PATTERN =
  /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])/g;

const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
const INTERNAL_PROMPT_END_MARKER =
  '- Risks and caveats: call out assumptions, follow-up work, and edge cases.';

export interface NormalizedCliOutputChunk {
  text: string;
  buffer: string;
  status?: 'thinking';
  thinking?: string;
}

interface RenderedOpenCodeJsonEvent {
  text: string;
  status?: NormalizedCliOutputChunk['status'];
  thinking?: string;
}

interface RenderedClaudeJsonEvent {
  text: string;
  status?: NormalizedCliOutputChunk['status'];
}

export function normalizeCliOutput(text: string, providerId?: string): string {
  const normalized = text
    .replace(ANSI_PATTERN, '')
    .replace(ORPHAN_ANSI_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_PATTERN, '')
    .replace(/\n{4,}/g, '\n\n\n');

  const providerNormalized = normalizeProviderOutput(normalized, providerId);
  return stripInternalPromptEcho(providerNormalized);
}

export function normalizeCliOutputChunk(
  text: string,
  providerId?: string,
  buffer = ''
): NormalizedCliOutputChunk {
  if (providerId === 'claude') {
    const parsed = normalizeClaudeJsonChunk(`${buffer}${text}`);
    if (parsed) {
      return parsed;
    }
    return { text: normalizeCliOutput(text, providerId), buffer: '' };
  }

  if (providerId === 'opencode') {
    const parsed = normalizeOpenCodeJsonChunk(`${buffer}${text}`);
    if (parsed) {
      return parsed;
    }
  }

  return { text: normalizeCliOutput(text, providerId), buffer: '' };
}

export function flushCliOutputBuffer(buffer: string, providerId?: string): string {
  if (!buffer) {
    return '';
  }

  const parsed =
    providerId === 'opencode'
      ? normalizeOpenCodeJsonChunk(`${buffer}\n`)
      : providerId === 'claude'
        ? normalizeClaudeJsonChunk(`${buffer}\n`)
        : undefined;
  return parsed?.text ?? normalizeCliOutput(buffer, providerId);
}

function normalizeProviderOutput(text: string, providerId?: string): string {
  switch (providerId) {
    case 'claude':
      return normalizeClaudeOutput(text);
    case 'codex':
      return normalizeCodexOutput(text);
    case 'opencode':
      return normalizeOpenCodeOutput(text);
    default:
      return text;
  }
}

function normalizeClaudeOutput(text: string): string {
  const jsonOutput = normalizeClaudeJsonChunk(text.endsWith('\n') ? text : `${text}\n`);
  if (jsonOutput) {
    return jsonOutput.text;
  }

  return text;
}

function normalizeCodexOutput(text: string): string {
  const readableError = extractCodexJsonError(text);
  if (readableError) {
    return `Error: ${readableError}\n`;
  }

  if (isCodexHtmlChallenge(text)) {
    return '';
  }

  const kept = text
    .split('\n')
    .filter((line) => !isCodexNoiseLine(line))
    .join('\n');

  return kept.replace(/\n{4,}/g, '\n\n\n');
}

function normalizeClaudeJsonChunk(text: string): NormalizedCliOutputChunk | undefined {
  if (!looksLikeClaudeJsonStream(text)) {
    return undefined;
  }

  const lines = text.split('\n');
  const buffer = text.endsWith('\n') ? '' : lines.pop() ?? '';
  const rendered: string[] = [];
  let parsedAny = false;
  let status: NormalizedCliOutputChunk['status'];

  for (const line of lines) {
    const renderedEvent = renderClaudeJsonEventLine(line);
    if (renderedEvent === undefined) {
      if (line.trim()) {
        rendered.push(`${line}\n`);
      }
      continue;
    }

    parsedAny = true;
    status = renderedEvent.status ?? status;
    rendered.push(renderedEvent.text);
  }

  if (!parsedAny && buffer) {
    const renderedEvent = renderClaudeJsonEventLine(buffer);
    if (renderedEvent !== undefined) {
      const result: NormalizedCliOutputChunk = { text: renderedEvent.text, buffer: '' };
      if (renderedEvent.status) {
        result.status = renderedEvent.status;
      }
      return result;
    }
  }

  if (!parsedAny && !looksLikeJsonPrefix(buffer)) {
    return undefined;
  }

  const result: NormalizedCliOutputChunk = { text: rendered.join(''), buffer };
  if (status) {
    result.status = status;
  }
  return result;
}

function looksLikeClaudeJsonStream(text: string): boolean {
  return (
    looksLikeJsonPrefix(text) ||
    text.includes('"stream_event"') ||
    text.includes('"content_block_delta"') ||
    text.includes('"text_delta"')
  );
}

function renderClaudeJsonEventLine(line: string): RenderedClaudeJsonEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return { text: '' };
  }

  if (!trimmed.startsWith('{')) {
    return undefined;
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isObjectRecord(event)) {
    return { text: '' };
  }

  const eventType = pickString(event.type);
  const streamEvent = firstObject(event.event);
  const streamEventType = pickString(streamEvent.type);
  const delta = firstObject(streamEvent.delta);
  const deltaType = pickString(delta.type);
  const textDelta = pickString(delta.text);

  if (eventType === 'stream_event' && streamEventType === 'content_block_delta') {
    if (deltaType === 'text_delta') {
      return { text: textDelta ?? '' };
    }

    if (deltaType === 'thinking_delta' || deltaType === 'signature_delta') {
      return { text: '', status: 'thinking' };
    }

    return { text: '' };
  }

  if (eventType === 'stream_event') {
    const contentType = pickString(firstObject(streamEvent.content_block).type);
    if (contentType === 'thinking') {
      return { text: '', status: 'thinking' };
    }
    return { text: '' };
  }

  if (eventType === 'assistant' || eventType === 'result' || eventType === 'system' || eventType === 'user') {
    return { text: '' };
  }

  return { text: '' };
}

function normalizeOpenCodeOutput(text: string): string {
  const jsonOutput = normalizeOpenCodeJsonChunk(text.endsWith('\n') ? text : `${text}\n`);
  if (jsonOutput?.text) {
    return jsonOutput.text;
  }
  if (jsonOutput?.status) {
    return '';
  }

  const readableError = extractOpenCodeReadableError(text);
  if (readableError) {
    return `Error: ${readableError}\n`;
  }

  const keptLines: string[] = [];
  let skipToolArgs = false;
  for (const line of text.split('\n')) {
    if (isOpenCodeRunBannerLine(line) || isOpenCodeToolTraceLine(line)) {
      skipToolArgs = true;
      continue;
    }

    if (skipToolArgs && isLikelyJsonObjectLine(line)) {
      skipToolArgs = false;
      continue;
    }

    skipToolArgs = false;
    keptLines.push(line);
  }

  return trimOnlyWhitespaceShell(keptLines.join('\n')).replace(/\n{4,}/g, '\n\n\n');
}

function normalizeOpenCodeJsonChunk(text: string): NormalizedCliOutputChunk | undefined {
  if (!looksLikeOpenCodeJsonStream(text)) {
    return undefined;
  }

  const lines = text.split('\n');
  const buffer = text.endsWith('\n') ? '' : lines.pop() ?? '';
  const rendered: string[] = [];
  const renderedThinking: string[] = [];
  let parsedAny = false;
  let status: NormalizedCliOutputChunk['status'];

  for (const line of lines) {
    const renderedEvent = renderOpenCodeJsonEventLine(line);
    if (renderedEvent === undefined) {
      if (line.trim()) {
        rendered.push(`${line}\n`);
      }
      continue;
    }

    parsedAny = true;
    status = renderedEvent.status ?? status;
    rendered.push(renderedEvent.text);
    if (renderedEvent.thinking) {
      renderedThinking.push(renderedEvent.thinking);
    }
  }

  if (!parsedAny && buffer) {
    const renderedEvent = renderOpenCodeJsonEventLine(buffer);
    if (renderedEvent !== undefined) {
      const result: NormalizedCliOutputChunk = { text: renderedEvent.text, buffer: '' };
      if (renderedEvent.status) {
        result.status = renderedEvent.status;
      }
      if (renderedEvent.thinking) {
        result.thinking = renderedEvent.thinking;
      }
      return result;
    }
  }

  if (!parsedAny && !looksLikeJsonPrefix(buffer)) {
    return undefined;
  }

  const result: NormalizedCliOutputChunk = { text: rendered.join(''), buffer };
  if (status) {
    result.status = status;
  }
  if (renderedThinking.length > 0) {
    result.thinking = renderedThinking.join('');
  }
  return result;
}

function looksLikeOpenCodeJsonStream(text: string): boolean {
  return (
    looksLikeJsonPrefix(text) ||
    text.includes('"message.part.') ||
    text.includes('"session.status"') ||
    text.includes('"session.idle"')
  );
}

function looksLikeJsonPrefix(text: string): boolean {
  return text.trimStart().startsWith('{');
}

function renderOpenCodeJsonEventLine(line: string): RenderedOpenCodeJsonEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return { text: '' };
  }

  if (!trimmed.startsWith('{')) {
    return undefined;
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isObjectRecord(event)) {
    return { text: '' };
  }

  const eventType = pickString(event.type, event.event, event.kind);
  const data = firstObject(event.properties, event.data, event);
  const part = firstObject(data.part, event.part);
  const partType = pickString(part.type, data.partType, event.partType);

  if (eventType?.includes('message.part.updated')) {
    const text = pickString(part.text, data.text, event.text);
    if (partType === 'reasoning') {
      return { text: '', status: 'thinking', ...(text ? { thinking: text } : {}) };
    }

    if (partType === 'text' && text) {
      return { text };
    }

    return { text: '' };
  }

  if (eventType?.includes('message.part.delta')) {
    const delta = pickString(data.delta, data.text, part.delta, part.text, event.delta, event.text);
    if (!delta) {
      return { text: '' };
    }

    if (partType === 'reasoning') {
      return { text: '', status: 'thinking', thinking: delta };
    }

    return { text: delta };
  }

  if (eventType === 'reasoning') {
    const text = pickString(part.text, data.text, event.text);
    return { text: '', status: 'thinking', ...(text ? { thinking: text } : {}) };
  }

  if (eventType === 'text') {
    const text = pickString(event.text, part.text);
    if (!text) {
      return { text: '' };
    }

    return { text };
  }

  if (eventType === 'message.updated') {
    const message = openCodeErrorMessage(firstObject(data.info, event.info));
    return { text: message ? `Error: ${message}\n` : '' };
  }

  if (eventType === 'error') {
    const message = openCodeErrorMessage(firstObject(data.error, event.error, event));
    return { text: message ? `Error: ${message}\n` : '' };
  }

  if (eventType === 'session.error') {
    const message = openCodeErrorMessage(firstObject(data.error, event.error));
    return { text: message ? `Error: ${message}\n` : '' };
  }

  return { text: '' };
}

function openCodeErrorMessage(errorOwner: Record<string, unknown>): string | undefined {
  const error = firstObject(errorOwner.error, errorOwner);
  const data = firstObject(error.data);
  return pickString(data.message, error.message);
}

function extractOpenCodeReadableError(text: string): string | undefined {
  if (text.includes("Failed to run the query 'PRAGMA wal_checkpoint(PASSIVE)'")) {
    return 'OpenCode local database is locked by another running OpenCode server. Close that server or run this workspace from the same OpenCode server, then retry.';
  }

  if (!text.includes('ProviderModelNotFoundError') && !text.includes('Model not found:')) {
    return undefined;
  }

  const modelErrorMatch = /Error:\s*(Model not found:[^\n]+)/.exec(text);
  return modelErrorMatch?.[1]?.trim();
}

function isOpenCodeRunBannerLine(line: string): boolean {
  const trimmed = line.trim().replace(/^[\u200B\uFEFF]+/, '');
  return /^>\s*[\u200B\uFEFF]?[A-Za-z][\w-]*(?:\s+-\s+[\w -]+)?\s+·\s+\S+/.test(trimmed);
}

function isOpenCodeToolTraceLine(line: string): boolean {
  const raw = line.trim();
  const trimmed = raw.replace(/^[^\w@./-]+\s*/, '');
  const hadToolPrefix = raw !== trimmed;
  return (
    (hadToolPrefix && /^(?:[\w.-]+__)?[\w.-]+(?:_[\w.-]+)+(?:\s+\{.*\})?$/.test(trimmed)) ||
    /^(?:read|write|edit|glob|grep|bash|task|todowrite|webfetch)(?:\s+\{.*\})?$/i.test(trimmed)
  );
}

function isLikelyJsonObjectLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

function trimOnlyWhitespaceShell(text: string): string {
  return text.trim().length === 0 ? '' : text.replace(/^\s+/, '');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstObject(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (isObjectRecord(value)) {
      return value;
    }
  }

  return {};
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function extractCodexJsonError(text: string): string | undefined {
  const match = /ERROR:\s*(\{.*"message"\s*:\s*"[^"]+".*\})/.exec(text);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]);
    return parsed?.error?.message;
  } catch {
    const messageMatch = /"message"\s*:\s*"([^"]+)"/.exec(match[1]);
    return messageMatch?.[1];
  }
}

function isCodexHtmlChallenge(text: string): boolean {
  return (
    text.includes('__cf_chl_opt') ||
    text.includes('challenge-error-text') ||
    text.includes('Cloudflare') ||
    /<html[\s>]/i.test(text)
  );
}

function isCodexNoiseLine(line: string): boolean {
  const trimmed = line.trim();

  return (
    trimmed.length === 0 ||
    /^Reading additional input from stdin/.test(trimmed) ||
    /^WARNING: proceeding, even though we could not update PATH/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T.*\b(WARN|ERROR)\b/.test(trimmed) ||
    /^OpenAI Codex v/.test(trimmed) ||
    /^-+$/.test(trimmed) ||
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/.test(
      trimmed
    ) ||
    trimmed === 'user'
  );
}

function stripInternalPromptEcho(text: string): string {
  const firstContentIndex = text.search(/\S/);
  if (firstContentIndex === -1) {
    return text;
  }

  if (!text.slice(firstContentIndex).startsWith(INTERNAL_PROMPT_START)) {
    return text;
  }

  const promptEndIndex = text.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
  if (promptEndIndex === -1) {
    return text;
  }

  return text.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length).replace(/^\s+/, '');
}
