const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

const CONTROL_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const ORPHAN_ANSI_PATTERN =
  /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])(?![A-Za-z0-9_-])/g;

const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
const INTERNAL_PROMPT_END_MARKER =
  '- Risks and caveats: call out assumptions, follow-up work, and edge cases.';
const INTERNAL_PROMPT_START_MARKERS = [
  INTERNAL_PROMPT_START,
  '[search-mode]',
  'search-mode]',
  'earch-mode]',
  '[analyze-mode]',
  'Recent conversation in this thread:',
  'IDE context, use only if relevant:',
  'IDE context:',
  'Response requirements:',
];

export interface NormalizedCliOutputChunk {
  text: string;
  buffer: string;
  status?: 'thinking';
  thinking?: string;
  activities?: NormalizedCliActivity[];
}

export interface PromptEchoChunkFilterResult {
  text: string;
  buffer: string;
}

export interface NormalizedCliActivity {
  id?: string;
  kind: 'file' | 'search' | 'command' | 'tool';
  name?: string;
  target?: string;
  detail?: string;
}

interface RenderedOpenCodeJsonEvent {
  text: string;
  status?: NormalizedCliOutputChunk['status'];
  thinking?: string;
  activities?: NormalizedCliActivity[];
}

interface RenderedClaudeJsonEvent {
  text: string;
  status?: NormalizedCliOutputChunk['status'];
}

export function normalizeCliOutput(text: string, providerId?: string): string {
  const normalized = normalizeDisplayText(text);

  const providerNormalized = normalizeProviderOutput(normalized, providerId);
  return stripInternalPromptEcho(providerNormalized, providerId);
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

export function filterPromptEchoChunk(
  text: string,
  providerId?: string,
  buffer = ''
): PromptEchoChunkFilterResult {
  if (providerId !== 'opencode' || !text) {
    return { text, buffer: '' };
  }

  const combined = `${buffer}${text}`;
  const stripped = stripInternalPromptEchoWithState(combined, providerId);
  if (stripped.pending) {
    return { text: '', buffer: combined.slice(-65_536) };
  }

  if (stripped.matched) {
    return { text: stripped.text, buffer: '' };
  }

  if (buffer) {
    return { text: combined, buffer: '' };
  }

  return { text, buffer: '' };
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
  const buffer = text.endsWith('\n') ? '' : (lines.pop() ?? '');
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
  const subtype = pickString(event.subtype);
  const isError = event.is_error === true;
  const errorText = pickString(event.error, event.message, event.result);
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

  if (eventType === 'error' || isError) {
    return { text: errorText ? `Error: ${errorText}\n` : '' };
  }

  if (eventType === 'result') {
    if (subtype && subtype !== 'success' && errorText) {
      return { text: `Error: ${errorText}\n` };
    }
    return { text: '' };
  }

  if (eventType === 'assistant' || eventType === 'system' || eventType === 'user') {
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
  const buffer = text.endsWith('\n') ? '' : (lines.pop() ?? '');
  const rendered: string[] = [];
  const renderedThinking: string[] = [];
  const renderedActivities: NormalizedCliActivity[] = [];
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
    if (renderedEvent.activities?.length) {
      renderedActivities.push(...renderedEvent.activities);
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
      if (renderedEvent.activities?.length) {
        result.activities = renderedEvent.activities;
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
  if (renderedActivities.length > 0) {
    result.activities = renderedActivities;
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
    if (partType === 'tool') {
      const activity = openCodeToolActivity(event, data, part);
      return { text: '', status: 'thinking', ...(activity ? { activities: [activity] } : {}) };
    }

    if (partType === 'reasoning') {
      const thinking = sanitizeThinkingForDisplay(text);
      return { text: '', status: 'thinking', ...(thinking ? { thinking } : {}) };
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

    if (partType === 'tool') {
      const activity = openCodeToolActivity(event, data, part);
      return { text: '', status: 'thinking', ...(activity ? { activities: [activity] } : {}) };
    }

    if (partType === 'reasoning') {
      const thinking = sanitizeThinkingForDisplay(delta);
      return { text: '', status: 'thinking', ...(thinking ? { thinking } : {}) };
    }

    return { text: delta };
  }

  if (eventType === 'reasoning') {
    const text = pickString(part.text, data.text, event.text);
    const thinking = sanitizeThinkingForDisplay(text);
    return { text: '', status: 'thinking', ...(thinking ? { thinking } : {}) };
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
  const message = pickString(data.message, error.message);
  const responseMessage = openCodeResponseBodyMessage(
    pickString(data.responseBody, error.responseBody)
  );
  if (responseMessage && (!message || isGenericOpenCodeServerError(message))) {
    return responseMessage;
  }

  return message ?? responseMessage;
}

function openCodeResponseBodyMessage(responseBody: string | undefined): string | undefined {
  const record = firstObject(responseBody);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const error = firstObject(record.error, record);
  const data = firstObject(error.data);
  return pickString(
    data.message,
    error.message,
    record.message,
    data.code,
    error.code,
    record.code
  );
}

function isGenericOpenCodeServerError(message: string): boolean {
  return /^Unexpected server error\. Check server logs for details\.?$/i.test(message.trim());
}

function openCodeToolActivity(
  event: Record<string, unknown>,
  data: Record<string, unknown>,
  part: Record<string, unknown>
): NormalizedCliActivity | undefined {
  const state = firstObject(part.state, data.state, event.state);
  const input = firstObject(
    part.input,
    part.args,
    part.params,
    state.input,
    state.args,
    state.params,
    data.input,
    data.args,
    data.params,
    event.input,
    event.args,
    event.params
  );
  const name = pickString(
    part.tool,
    part.name,
    part.title,
    data.tool,
    data.name,
    data.title,
    event.tool,
    event.name,
    event.title
  );
  const command = pickString(
    input.command,
    input.cmd,
    input.script,
    part.command,
    data.command,
    event.command
  );
  const path = pickString(
    input.file,
    input.filePath,
    input.filename,
    input.path,
    input.absolutePath,
    input.relativePath,
    part.file,
    part.filePath,
    part.path,
    data.file,
    data.filePath,
    data.path,
    event.file,
    event.filePath,
    event.path
  );
  const query = pickString(
    input.query,
    input.pattern,
    input.glob,
    input.regex,
    part.query,
    part.pattern,
    data.query,
    data.pattern,
    event.query,
    event.pattern
  );
  const detail = normalizeActivityDetail(
    pickString(
      input.output,
      input.stdout,
      input.stderr,
      input.result,
      input.error,
      input.message,
      state.output,
      state.stdout,
      state.stderr,
      state.result,
      state.error,
      state.message,
      part.output,
      part.stdout,
      part.stderr,
      part.result,
      part.error,
      part.message,
      data.output,
      data.stdout,
      data.stderr,
      data.result,
      data.error,
      data.message,
      event.output,
      event.stdout,
      event.stderr,
      event.result,
      event.error,
      event.message
    )
  );
  const target = path || command || query || name;

  if (!name && !target) {
    return undefined;
  }

  return {
    ...(pickString(part.id, data.partID, event.partID, event.id)
      ? { id: pickString(part.id, data.partID, event.partID, event.id) }
      : {}),
    kind: classifyOpenCodeToolActivity(name, target, command, path, query),
    ...(name ? { name } : {}),
    ...(target ? { target } : {}),
    ...(detail ? { detail } : {}),
  };
}

function normalizeActivityDetail(value: string | undefined): string | undefined {
  const normalized = normalizeDisplayText(String(value || '')).trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > 6000 ? `${normalized.slice(0, 6000)}\n...` : normalized;
}

function classifyOpenCodeToolActivity(
  name: string | undefined,
  target: string | undefined,
  command: string | undefined,
  path: string | undefined,
  query: string | undefined
): NormalizedCliActivity['kind'] {
  const normalizedName = String(name || '').toLowerCase();
  if (
    command ||
    /(?:^|[_.-])(?:bash|shell|terminal|exec|run|command)(?:$|[_.-])/.test(normalizedName)
  ) {
    return 'command';
  }

  if (query || /(?:^|[_.-])(?:grep|rg|glob|search|find|list|ls)(?:$|[_.-])/.test(normalizedName)) {
    return 'search';
  }

  if (
    path ||
    /(?:^|[_.-])(?:read|view|open|edit|write|patch|file|multiedit)(?:$|[_.-])/.test(normalizedName)
  ) {
    return 'file';
  }

  if (target && /(?:^|\/)[^/\s]+\.[A-Za-z0-9]{1,8}$/.test(target)) {
    return 'file';
  }

  return 'tool';
}

function extractOpenCodeReadableError(text: string): string | undefined {
  if (text.includes("Failed to run the query 'PRAGMA wal_checkpoint(PASSIVE)'")) {
    return 'OpenCode local database is locked by another running OpenCode server. Close that server or run this workspace from the same OpenCode server, then retry.';
  }

  if (/No context found for instance/i.test(text)) {
    return 'OpenCode did not receive the workspace directory for this attached session. Reload the window or retry after Agents GUI reconnects to OpenCode.';
  }

  if (/unhashable type: 'dict'|tool schema|tools schema/i.test(text)) {
    return 'OpenCode provider rejected the tool schema. Use a no-tool OpenCode agent or switch to a provider with tool-calling support.';
  }

  const unsupportedFormatMatch =
    /(?:^|\n)(?:Error:\s*)?Model\s+([^\s]+)\s+not supported for format\s+([^\s\n]+)/i.exec(text);
  if (unsupportedFormatMatch) {
    return `Model ${unsupportedFormatMatch[1]} is not supported for format ${unsupportedFormatMatch[2]}. Switch to another OpenCode model/provider and retry.`;
  }

  if (text.includes('ProviderModelNotFoundError') || text.includes('Model not found:')) {
    const modelErrorMatch = /Error:\s*(Model not found:[^\n]+)/.exec(text);
    if (modelErrorMatch) {
      return modelErrorMatch[1].trim();
    }
  }

  if (/model[_ -]?not[_ -]?found|unsupported model|unknown model/i.test(text)) {
    return 'OpenCode model is not available in the current provider. Choose Configured or another listed OpenCode model, then retry.';
  }

  return undefined;
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

    const parsed = parseObjectString(value);
    if (parsed) {
      return parsed;
    }
  }

  return {};
}

function parseObjectString(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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

function stripInternalPromptEcho(text: string, providerId?: string): string {
  const stripped = stripInternalPromptEchoWithState(text, providerId);
  if (stripped.pending || stripped.matched) {
    return stripped.text;
  }

  return text;
}

function stripInternalPromptEchoWithState(
  text: string,
  providerId?: string
): { text: string; matched: boolean; pending: boolean } {
  const firstContentIndex = text.search(/\S/);
  if (firstContentIndex === -1) {
    return { text, matched: false, pending: false };
  }

  const candidate = text.slice(firstContentIndex);
  if (providerId === 'opencode' && isPotentialQuotedOpenCodePromptPrefix(candidate)) {
    const promptEndIndex = text.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
    if (promptEndIndex === -1) {
      return { text: '', matched: true, pending: true };
    }

    return {
      text: stripPromptBoundary(text.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length)),
      matched: true,
      pending: false,
    };
  }

  if (!startsWithInternalPromptEcho(text, firstContentIndex)) {
    return { text, matched: false, pending: false };
  }

  const promptEndIndex = text.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
  if (promptEndIndex === -1) {
    return isIncompleteInternalPromptEcho(candidate, providerId)
      ? { text: '', matched: true, pending: true }
      : { text, matched: false, pending: false };
  }

  return {
    text: stripPromptBoundary(text.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length)),
    matched: true,
    pending: false,
  };
}

function isIncompleteInternalPromptEcho(candidate: string, providerId?: string): boolean {
  if (providerId === 'opencode' && isOpenCodeRuntimePromptEcho(candidate)) {
    return true;
  }

  return (
    candidate.includes('Reply in Chinese (简体中文). Do not mix languages.') ||
    candidate.includes(
      'Keep the answer concise. Do not inspect the project unless the request needs it.'
    ) ||
    candidate.includes('IDE context, use only if relevant:') ||
    candidate.includes('Response requirements:')
  );
}

function startsWithInternalPromptEcho(text: string, firstContentIndex: number): boolean {
  const candidate = text.slice(firstContentIndex);
  return (
    INTERNAL_PROMPT_START_MARKERS.some((marker) => candidate.startsWith(marker)) ||
    isOpenCodeRuntimePromptEcho(candidate)
  );
}

function isOpenCodeRuntimePromptEcho(candidate: string): boolean {
  const runtimeIndex = candidate.indexOf('Runtime selection from Agents GUI:');
  if (runtimeIndex < 0 || runtimeIndex > 500) {
    return false;
  }

  return (
    candidate.includes('- Provider:') ||
    candidate.includes('- Agent/mode:') ||
    candidate.includes('- Selected model:') ||
    candidate.includes('IDE context, use only if relevant:') ||
    candidate.includes('Keep the answer concise.')
  );
}

function isPotentialQuotedOpenCodePromptPrefix(candidate: string): boolean {
  const trimmed = candidate.trimStart();
  if (!/^["'“”]/.test(trimmed)) {
    return false;
  }

  if (isOpenCodeRuntimePromptEcho(trimmed)) {
    return true;
  }

  return trimmed.length < 500 && !trimmed.includes('\n\n\n');
}

function stripPromptBoundary(text: string): string {
  return text.replace(/^[\s"'“”]+/, '');
}

function sanitizeThinkingForDisplay(text: string | undefined): string {
  return stripInternalPromptEcho(normalizeDisplayText(String(text || '')), 'opencode').trim();
}

function normalizeDisplayText(text: string): string {
  return text
    .replace(ANSI_PATTERN, '')
    .replace(ORPHAN_ANSI_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_PATTERN, '')
    .replace(/\n{4,}/g, '\n\n\n');
}
