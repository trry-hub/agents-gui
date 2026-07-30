import * as http from 'http';
import * as https from 'https';
import type * as vscode from 'vscode';
import type {
  AssistantLspServerStatus,
  AssistantMcpServerStatus,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeProject,
  AssistantOpenCodeStatus,
} from './assistantTypes';
import type { CliConfiguredModel } from './cliProfiles';
import { parseOpenCodeModelId, parseOpenCodeProviderModels } from './opencodeAgents';
import { normalizeCliOutput } from './outputFormatter';

const OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS = 1000;
const OPEN_CODE_PROMPT_TIMEOUT_MS = 90_000;
const OPEN_CODE_REQUEST_TIMEOUT_MS = 30_000;
const OPEN_CODE_SERVER_READY_TIMEOUT_MS = 20_000;

export interface OpenCodeEventStream {
  close(): void;
  failed(): boolean;
  hasOutput(): boolean;
  setSessionId(sessionId: string): void;
  sessionId(): string | undefined;
}

interface OpenCodeSseConnection {
  close(): void;
  failed(): boolean;
  ready: Promise<boolean>;
  onEvent(handler: (event: Record<string, unknown>, block: string) => void): { dispose(): void };
}

interface OpenCodePromptEventStream {
  close(): void;
  error(): string | undefined;
  failed(): boolean;
  ready: Promise<boolean>;
  completed: Promise<void>;
  outputText(): string;
}

interface OpenCodeServerClientOptions {
  resolveServerUrl(): Promise<string | undefined>;
  workspaceRoot(): string;
}

export class OpenCodeServerClient {
  constructor(private readonly options: OpenCodeServerClientOptions) {}

  async runPrompt(
    prompt: string,
    token: vscode.CancellationToken,
    directory = this.options.workspaceRoot(),
    modelId?: string,
    onPartial?: (text: string) => void
  ): Promise<string> {
    const serverUrl = await this.options.resolveServerUrl();
    if (!serverUrl) {
      throw new Error('OpenCode server is not available.');
    }
    await this.waitForServerReady(serverUrl, directory);

    const session = this.objectRecord(
      await this.requestJson(this.apiUrl(serverUrl, '/session', directory), {
        method: 'POST',
        timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,
        body: { title: 'Generate commit message' },
      })
    );
    const sessionId = this.pickString(session.id);
    if (!sessionId?.startsWith('ses')) {
      throw new Error('OpenCode did not return a session.');
    }

    const eventStream = this.openPromptEventStream(serverUrl, sessionId, onPartial);

    try {
      const model = parseOpenCodeModelId(modelId);
      await this.requestJson(
        this.apiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/prompt_async`, directory),
        {
          method: 'POST',
          timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,
          body: {
            parts: [{ type: 'text', text: prompt }],
            tools: { '*': false },
            ...(model ? { model } : {}),
          },
        }
      );

      return await this.waitForServerText(
        serverUrl,
        sessionId,
        directory,
        token,
        onPartial,
        eventStream
      );
    } catch (error) {
      await this.abortSession(serverUrl, sessionId, directory);
      throw error;
    } finally {
      eventStream?.close();
    }
  }

  async getStatus(): Promise<AssistantOpenCodeStatus | undefined> {
    const serverUrl = await this.options.resolveServerUrl();
    if (!serverUrl) {
      return undefined;
    }

    const [mcpPayload, lspPayload, projectPayload] = await Promise.all([
      this.fetchJson(new URL('/mcp', serverUrl)),
      this.fetchJson(new URL('/lsp', serverUrl)),
      this.fetchJson(new URL('/project/current', serverUrl)),
    ]);

    return {
      mcpServers: this.normalizeMcpStatus(mcpPayload),
      lspServers: this.normalizeLspStatus(lspPayload),
      project: this.normalizeProject(projectPayload),
    };
  }

  async executeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    if (!sessionId || !sessionId.startsWith('ses')) {
      return {
        command,
        ok: false,
        message: 'No active OpenCode session is available yet.',
      };
    }

    const serverUrl = await this.options.resolveServerUrl();
    if (!serverUrl) {
      return {
        command,
        ok: false,
        message: 'OpenCode server is not available.',
      };
    }

    if (command === 'share') {
      const payload = await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/share'), {
        method: 'POST',
      });
      const payloadRecord = this.objectRecord(payload);
      const dataRecord = this.objectRecord(payloadRecord.data);
      const shareRecord = this.objectRecord(payloadRecord.share);
      const dataShareRecord = this.objectRecord(dataRecord.share);
      const url = this.pickString(shareRecord.url, dataShareRecord.url);
      return {
        command,
        ok: true,
        ...(url
          ? { url, message: `OpenCode session shared: ${url}` }
          : { message: 'OpenCode session shared.' }),
      };
    }

    if (command === 'unshare') {
      await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/share'), {
        method: 'DELETE',
      });
      return { command, ok: true, message: 'OpenCode session unpublished.' };
    }

    if (command === 'compact') {
      const session = this.objectRecord(
        await this.requestJson(this.sessionUrl(serverUrl, sessionId), { method: 'GET' })
      );
      const model = this.objectRecord(session.model);
      const providerID = this.pickString(model.providerID);
      const modelID = this.pickString(model.id, model.modelID);
      if (!providerID || !modelID) {
        return {
          command,
          ok: false,
          message: 'OpenCode did not expose a model for this session.',
        };
      }

      await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/summarize'), {
        method: 'POST',
        body: { providerID, modelID },
      });
      return { command, ok: true, message: 'OpenCode session compacted.' };
    }

    if (command === 'fork') {
      const payload = this.objectRecord(
        await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/fork'), {
          method: 'POST',
          body: {},
        })
      );
      const forkedSessionId = this.pickString(payload.id);
      if (!forkedSessionId?.startsWith('ses')) {
        return {
          command,
          ok: false,
          message: 'OpenCode did not return a forked session.',
        };
      }

      return {
        command,
        ok: true,
        message: 'OpenCode session forked.',
        newOpenCodeSessionId: forkedSessionId,
        title: this.pickString(payload.title),
      };
    }

    if (command === 'undo' || command === 'redo') {
      return await this.executeRevertCommand(serverUrl, command, sessionId);
    }

    return {
      command,
      ok: false,
      message: `Unsupported OpenCode command: ${command}`,
    };
  }

  async deleteSession(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId?.startsWith('ses')) {
      return false;
    }

    const serverUrl = await this.options.resolveServerUrl();
    if (!serverUrl) {
      return false;
    }

    await this.requestJson(this.sessionUrl(serverUrl, sessionId), {
      method: 'DELETE',
      timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,
    });
    return true;
  }

  async fetchModelOptions(cwd: string): Promise<CliConfiguredModel[]> {
    const serverUrl = await this.options.resolveServerUrl();
    if (!serverUrl) {
      return [];
    }

    const payload = await this.fetchJson(this.apiUrl(serverUrl, '/config/providers', cwd), 2400);
    return parseOpenCodeProviderModels(payload);
  }

  async isServerAvailable(serverUrl: string, cwd: string, timeoutMs: number): Promise<boolean> {
    const status = await this.fetchJson(
      this.apiUrl(serverUrl, '/session/status', cwd),
      Math.max(600, timeoutMs)
    );
    return Boolean(status && typeof status === 'object' && !Array.isArray(status));
  }

  openEventStream(
    serverUrl: string,
    output: { fire(text: string): void } | ((text: string, sessionId?: string) => void)
  ): OpenCodeEventStream | undefined {
    let closed = false;
    let outputSeen = false;
    let targetSessionId: string | undefined;
    const connection = this.openSseConnection(serverUrl);
    if (!connection) {
      return undefined;
    }
    const renderStateBySession = new Map<
      string,
      {
        partTypes: Map<string, string>;
        partTexts: Map<string, string>;
      }
    >();
    const pendingBySession = new Map<string, string[]>();
    const renderStateForSession = (sessionId: string) => {
      let state = renderStateBySession.get(sessionId);
      if (!state) {
        state = {
          partTypes: new Map<string, string>(),
          partTexts: new Map<string, string>(),
        };
        renderStateBySession.set(sessionId, state);
      }

      return state;
    };
    const emitOutput = (text: string, sessionId?: string) => {
      if (typeof output === 'function') {
        output(text, sessionId);
      } else {
        output.fire(text);
      }
    };
    const emitRendered = (rendered: string, sessionId: string) => {
      outputSeen = outputSeen || this.isRenderedTextOutput(rendered);
      emitOutput(rendered, sessionId);
    };
    const flushPending = (sessionId: string) => {
      const pending = pendingBySession.get(sessionId) ?? [];
      pendingBySession.clear();
      for (const rendered of pending) {
        emitRendered(rendered, sessionId);
      }
    };

    const subscription = connection.onEvent((event, block) => {
      const blockSessionId = this.eventSessionId(event);
      if (!blockSessionId || (targetSessionId && blockSessionId !== targetSessionId)) {
        return;
      }

      const state = renderStateForSession(blockSessionId);
      const rendered = this.renderSseBlock(block, state.partTypes, state.partTexts);
      if (!rendered) {
        return;
      }

      if (targetSessionId) {
        emitRendered(rendered, blockSessionId);
        return;
      }

      const pending = pendingBySession.get(blockSessionId) ?? [];
      pending.push(rendered);
      pendingBySession.set(blockSessionId, pending);
    });

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        subscription.dispose();
        connection.close();
      },
      failed: () => connection.failed(),
      hasOutput: () => outputSeen,
      setSessionId: (sessionId: string) => {
        if (!sessionId.startsWith('ses')) {
          return;
        }

        if (targetSessionId && targetSessionId !== sessionId) {
          return;
        }

        targetSessionId = sessionId;
        flushPending(sessionId);
      },
      sessionId: () => targetSessionId,
    };
  }

  renderSseBlock(
    block: string,
    partTypes: Map<string, string>,
    partTexts: Map<string, string>
  ): string {
    const event = this.parseSseBlock(block);
    if (!event) {
      return '';
    }

    const type = typeof event.type === 'string' ? event.type : '';
    const properties = this.objectRecord(event.properties);

    if (type === 'message.updated') {
      const info = this.firstObject(properties.info, event.info, event);
      if (info.error) {
        return `${JSON.stringify(event)}\n`;
      }

      return '';
    }

    if (type === 'error') {
      return `${JSON.stringify(event)}\n`;
    }

    if (type === 'session.error') {
      return `${JSON.stringify(event)}\n`;
    }

    if (type.includes('message.part.updated')) {
      const part = this.firstObject(properties.part, event.part);
      const partId = this.pickString(part.id, properties.partID, event.partID);
      const partType = this.pickString(part.type, properties.partType, event.partType);
      if (partId && partType) {
        partTypes.set(partId, partType);
      }

      if (partType === 'tool') {
        return `${JSON.stringify({
          type: 'message.part.updated',
          properties: {
            part: this.compactToolPart(part, properties, event),
          },
        })}\n`;
      }

      if (partType === 'reasoning') {
        return this.renderUpdatedTextDelta(part, partTexts, 'reasoning');
      }

      if (partType === 'text') {
        return this.renderUpdatedTextDelta(part, partTexts, 'text');
      }

      return '';
    }

    if (!type.includes('message.part.delta')) {
      return '';
    }

    const part = this.firstObject(properties.part, event.part);
    const partId = this.pickString(properties.partID, event.partID, part.id);
    const field = this.pickString(properties.field, event.field) ?? 'text';
    if (field !== 'text') {
      return '';
    }

    const partType =
      (partId ? partTypes.get(partId) : undefined) ??
      this.pickString(part.type, properties.partType, event.partType);
    if (partType === 'tool') {
      return `${JSON.stringify({
        type: 'message.part.delta',
        properties: {
          part: this.compactToolPart(part, properties, event),
        },
      })}\n`;
    }

    const delta = this.pickString(properties.delta, event.delta, properties.text, event.text);
    if (!delta) {
      return '';
    }

    const eventWithPart = {
      ...event,
      properties: {
        ...properties,
        delta,
        ...(partType ? { part: { ...part, type: partType } } : {}),
      },
    };

    return `${JSON.stringify(eventWithPart)}\n`;
  }

  extractSessionIdFromJsonText(text: string): string | undefined {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) {
        continue;
      }

      try {
        const event = this.objectRecord(JSON.parse(trimmed));
        const sessionId = this.eventSessionId(event);
        if (sessionId) {
          return sessionId;
        }
      } catch {
        // Ignore partial JSON chunks. The next stdout chunk may complete the event.
      }
    }

    return undefined;
  }

  private async waitForServerText(
    serverUrl: string,
    sessionId: string,
    directory: string,
    token: vscode.CancellationToken,
    onPartial?: (text: string) => void,
    eventStream?: OpenCodePromptEventStream
  ): Promise<string> {
    const startedAt = Date.now();
    let eventStreamReady = await (eventStream?.ready ?? Promise.resolve(false));
    if (eventStream && !eventStreamReady) {
      eventStream.close();
    }

    while (Date.now() - startedAt < OPEN_CODE_PROMPT_TIMEOUT_MS) {
      if (token.isCancellationRequested) {
        throw new Error('cancelled');
      }

      const streamedError = eventStreamReady ? eventStream?.error() : undefined;
      if (streamedError) {
        throw new Error(streamedError);
      }

      if (eventStreamReady && eventStream) {
        if (eventStream.failed()) {
          eventStream.close();
          eventStreamReady = false;
        } else {
          const completed = await this.waitForEventCompletion(eventStream, token);
          if (completed) {
            const finalText = await this.fetchSessionText(serverUrl, sessionId, directory);
            return finalText ?? eventStream.outputText();
          }
        }
      }

      const [statusPayload, messages] = await Promise.all([
        this.fetchJson(this.apiUrl(serverUrl, '/session/status', directory)),
        this.fetchJson(
          this.apiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/message`, directory)
        ),
      ]);
      const status = this.objectRecord(this.objectRecord(statusPayload)[sessionId]);
      const statusError = this.statusError(status);
      if (statusError) {
        throw new Error(statusError);
      }

      const textState = this.extractAssistantTextState(messages);
      if (textState) {
        if (textState.text.trim()) {
          onPartial?.(textState.text);
        }
        if (textState.completed) {
          return textState.text;
        }
      }

      await this.sleep(OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS);
    }

    const streamedError = eventStreamReady ? eventStream?.error() : undefined;
    if (streamedError) {
      throw new Error(streamedError);
    }

    throw new Error('OpenCode server timed out while generating a commit message.');
  }

  private async waitForEventCompletion(
    eventStream: OpenCodePromptEventStream,
    token: vscode.CancellationToken
  ): Promise<boolean> {
    if (token.isCancellationRequested) {
      throw new Error('cancelled');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(false), OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS);
      const disposable = token.onCancellationRequested(() => {
        clearTimeout(timeout);
        reject(new Error('cancelled'));
      });
      eventStream.completed.then(
        () => {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(true);
        },
        (error) => {
          clearTimeout(timeout);
          disposable.dispose();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  private async fetchSessionText(
    serverUrl: string,
    sessionId: string,
    directory: string
  ): Promise<string | undefined> {
    const messages = await this.fetchJson(
      this.apiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/message`, directory)
    );
    const textState = this.extractAssistantTextState(messages);
    return textState?.completed ? textState.text : undefined;
  }

  private statusError(status: Record<string, unknown>): string | undefined {
    const statusMessage = this.pickString(status.message);
    if (statusMessage) {
      const normalized = this.normalizeProviderError(statusMessage);
      if (normalized !== statusMessage) {
        return normalized;
      }
      if (this.pickString(status.type) === 'error') {
        return statusMessage;
      }
    }

    const errorMessage = this.errorMessage(status);
    return errorMessage ? this.normalizeProviderError(errorMessage) : undefined;
  }

  private async waitForServerReady(serverUrl: string, directory: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < OPEN_CODE_SERVER_READY_TIMEOUT_MS) {
      const status = await this.fetchJson(
        this.apiUrl(serverUrl, '/session/status', directory),
        1800
      );
      if (status && typeof status === 'object') {
        return;
      }

      await this.sleep(OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS);
    }

    throw new Error('OpenCode server is still starting. Retry once it is ready.');
  }

  private async abortSession(
    serverUrl: string,
    sessionId: string,
    directory: string
  ): Promise<void> {
    try {
      await this.requestJson(
        this.apiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/abort`, directory),
        { method: 'POST', timeoutMs: 2000 }
      );
    } catch {
      // Best-effort cleanup only.
    }
  }

  private extractAssistantTextState(
    payload: unknown
  ): { text: string; completed: boolean } | undefined {
    if (!Array.isArray(payload)) {
      return undefined;
    }

    for (const item of payload.slice().reverse()) {
      const record = this.objectRecord(item);
      const info = this.objectRecord(record.info);
      if (this.pickString(info.role) !== 'assistant') {
        continue;
      }

      const error = this.errorMessage(info);
      if (error) {
        throw new Error(error);
      }

      const completed = this.isAssistantMessageCompleted(info);
      const parts = Array.isArray(record.parts) ? record.parts : [];
      const text = parts
        .map((part) => {
          const partRecord = this.objectRecord(part);
          return this.pickString(partRecord.type) === 'text'
            ? (this.pickString(partRecord.text) ?? '')
            : '';
        })
        .join('');
      if (text.trim() && completed) {
        return { text, completed };
      }

      if (completed) {
        return { text: '', completed };
      }

      return { text, completed };
    }

    return undefined;
  }

  private isAssistantMessageCompleted(info: Record<string, unknown>): boolean {
    const time = this.objectRecord(info.time);
    const status = this.pickString(info.status, info.state, info.phase);
    return (
      typeof time.completed === 'number' ||
      status === 'completed' ||
      status === 'done' ||
      status === 'idle'
    );
  }

  private async executeRevertCommand(
    serverUrl: string | URL,
    command: 'undo' | 'redo',
    sessionId: string
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    const session = this.objectRecord(
      await this.requestJson(this.sessionUrl(serverUrl, sessionId), { method: 'GET' })
    );
    const messagesPayload = await this.requestJson(
      this.sessionUrl(serverUrl, sessionId, '/message'),
      { method: 'GET' }
    );
    const messages = Array.isArray(messagesPayload)
      ? messagesPayload
          .map((entry) => this.objectRecord(this.objectRecord(entry).info))
          .filter((entry) => this.pickString(entry.id))
      : [];
    const revert = this.objectRecord(session.revert);
    const revertMessageId = this.pickString(revert.messageID);

    if (command === 'undo') {
      const target = messages
        .slice()
        .reverse()
        .find((message) => {
          const id = this.pickString(message.id);
          return id && (!revertMessageId || id < revertMessageId);
        });
      const messageID = this.pickString(target?.id);
      if (!messageID) {
        return { command, ok: false, message: 'No OpenCode message is available to undo.' };
      }

      await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/revert'), {
        method: 'POST',
        body: { messageID },
      });
      return { command, ok: true, message: 'OpenCode session moved back one message.' };
    }

    if (!revertMessageId) {
      return { command, ok: false, message: 'No OpenCode undo point is available to redo.' };
    }

    const target = messages.find((message) => {
      const id = this.pickString(message.id);
      return id && id > revertMessageId;
    });
    const messageID = this.pickString(target?.id);
    if (messageID) {
      await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/revert'), {
        method: 'POST',
        body: { messageID },
      });
      return { command, ok: true, message: 'OpenCode session moved forward one message.' };
    }

    await this.requestJson(this.sessionUrl(serverUrl, sessionId, '/unrevert'), {
      method: 'POST',
    });
    return { command, ok: true, message: 'OpenCode session restored to the latest message.' };
  }

  private openSseConnection(serverUrl: string): OpenCodeSseConnection | undefined {
    let closed = false;
    let streamFailed = false;
    let request: http.ClientRequest | undefined;
    // eslint-disable-next-line prefer-const
    let readyTimer: NodeJS.Timeout | undefined;
    let resolveReady: (ready: boolean) => void = () => {};
    let readySettled = false;
    const handlers = new Set<(event: Record<string, unknown>, block: string) => void>();
    const ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    });
    const markReady = (value: boolean) => {
      if (readySettled) {
        return;
      }

      readySettled = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
      }
      resolveReady(value);
    };
    const markFailed = () => {
      streamFailed = true;
      markReady(false);
    };
    const emitBlock = (block: string) => {
      const event = this.parseSseBlock(block);
      if (!event) {
        return;
      }

      for (const handler of handlers) {
        handler(event, block);
      }
    };

    const timer = setTimeout(() => markReady(false), 1000);
    readyTimer = timer;

    try {
      const eventUrl = new URL('/event', serverUrl);
      const client = eventUrl.protocol === 'https:' ? https : http;
      request = client.get(eventUrl, { headers: { Accept: 'text/event-stream' } }, (response) => {
        if ((response.statusCode ?? 200) >= 400) {
          markFailed();
          response.resume();
          return;
        }

        markReady(true);
        response.setEncoding('utf8');
        let buffer = '';

        response.on('data', (chunk: string) => {
          buffer += chunk.replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            emitBlock(block);
            boundary = buffer.indexOf('\n\n');
          }
        });
        response.on('end', () => {
          if (!closed) {
            streamFailed = true;
          }
        });
      });

      request.on('error', markFailed);
    } catch {
      if (readyTimer) {
        clearTimeout(readyTimer);
      }
      return undefined;
    }

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        if (readyTimer) {
          clearTimeout(readyTimer);
        }
        handlers.clear();
        request?.destroy();
      },
      failed: () => streamFailed,
      ready,
      onEvent: (handler) => {
        handlers.add(handler);
        return {
          dispose: () => {
            handlers.delete(handler);
          },
        };
      },
    };
  }

  private openPromptEventStream(
    serverUrl: string,
    sessionId: string,
    onPartial?: (text: string) => void
  ): OpenCodePromptEventStream | undefined {
    let closed = false;
    let lastError: string | undefined;
    let renderedOutput = '';
    let resolveCompleted: () => void = () => {};
    let completedSettled = false;
    const connection = this.openSseConnection(serverUrl);
    if (!connection) {
      return undefined;
    }
    const partTypes = new Map<string, string>();
    const partTexts = new Map<string, string>();
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    const markCompleted = () => {
      if (completedSettled) {
        return;
      }

      completedSettled = true;
      resolveCompleted();
    };
    const emitRendered = (rendered: string) => {
      if (!rendered) {
        return;
      }

      renderedOutput += rendered;
      const normalized = normalizeCliOutput(renderedOutput, 'opencode');
      if (normalized.trim()) {
        onPartial?.(normalized);
      }
    };
    const subscription = connection.onEvent((event, block) => {
      if (!this.eventBelongsToSession(event, sessionId)) {
        return;
      }

      const eventError = this.eventErrorMessage(event);
      if (eventError) {
        lastError = this.normalizeProviderError(eventError);
      }

      emitRendered(this.renderSseBlock(block, partTypes, partTexts));
      if (this.eventIsAssistantCompleted(event)) {
        markCompleted();
      }
    });

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        subscription.dispose();
        connection.close();
      },
      error: () => lastError,
      failed: () => connection.failed(),
      ready: connection.ready,
      completed,
      outputText: () => normalizeCliOutput(renderedOutput, 'opencode'),
    };
  }

  private requestJson(
    url: URL,
    options: {
      method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
      body?: unknown;
      timeoutMs?: number;
    } = {}
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      let settled = false;
      const finish = (error: Error | undefined, value?: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };

      const request = client.request(
        url,
        {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(body
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
              : {}),
          },
        },
        (response) => {
          response.setEncoding('utf8');
          let responseBody = '';
          response.on('data', (chunk: string) => {
            responseBody += chunk;
            if (responseBody.length > 1024 * 1024) {
              request.destroy();
              finish(new Error('OpenCode response was too large.'));
            }
          });
          response.on('end', () => {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              finish(new Error(this.httpErrorMessage(response.statusCode, responseBody)));
              return;
            }

            if (!responseBody.trim()) {
              finish(undefined, undefined);
              return;
            }

            try {
              finish(undefined, JSON.parse(responseBody));
            } catch {
              finish(undefined, responseBody);
            }
          });
        }
      );
      request.setTimeout(options.timeoutMs ?? 6000, () => {
        request.destroy();
        finish(new Error(`OpenCode request to ${url.pathname} timed out.`));
      });
      request.on('error', (error) =>
        finish(error instanceof Error ? error : new Error(String(error)))
      );
      if (body) {
        request.write(body);
      }
      request.end();
    });
  }

  private async fetchJson(url: URL, timeoutMs = 1600): Promise<unknown> {
    return new Promise((resolve) => {
      const client = url.protocol === 'https:' ? https : http;
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };

      const request = client.get(url, { headers: { Accept: 'application/json' } }, (response) => {
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 1024 * 1024) {
            request.destroy();
            finish(undefined);
          }
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            finish(undefined);
            return;
          }

          try {
            finish(JSON.parse(body));
          } catch {
            finish(undefined);
          }
        });
      });
      request.setTimeout(timeoutMs, () => {
        request.destroy();
        finish(undefined);
      });
      request.on('error', () => finish(undefined));
    });
  }

  private httpErrorMessage(statusCode: number | undefined, responseBody: string): string {
    const fallback = `OpenCode request failed with HTTP ${statusCode ?? 'unknown'}.`;
    const rawMessage = this.httpErrorBodyMessage(responseBody);
    if (!rawMessage) {
      return fallback;
    }

    const normalized = this.normalizeProviderError(rawMessage);
    if (normalized !== rawMessage) {
      return normalized;
    }

    return rawMessage.length > 240 ? `${rawMessage.slice(0, 240).trim()}...` : rawMessage;
  }

  private httpErrorBodyMessage(responseBody: string): string | undefined {
    const trimmed = responseBody.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = this.parseHttpErrorObject(trimmed);
    if (parsed) {
      const message = this.httpErrorObjectMessage(parsed);
      if (message) {
        return message;
      }
    }

    const jsonStart = trimmed.indexOf('{');
    if (jsonStart > 0) {
      const embedded = this.parseHttpErrorObject(trimmed.slice(jsonStart));
      if (embedded) {
        const message = this.httpErrorObjectMessage(embedded);
        if (message) {
          return `${trimmed.slice(0, jsonStart).replace(/:\s*$/, '')}: ${message}`;
        }
      }
    }

    return trimmed;
  }

  private httpErrorObjectMessage(record: Record<string, unknown>): string | undefined {
    const error = this.objectRecord(record.error);
    const data = this.objectRecord(error.data);
    return (
      this.errorMessage(record) ??
      this.pickString(
        data.message,
        data.code,
        error.message,
        error.code,
        record.message,
        record.code
      )
    );
  }

  private parseHttpErrorObject(text: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(text);
      const record = this.objectRecord(parsed);
      return Object.keys(record).length > 0 ? record : undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeMcpStatus(payload: unknown): AssistantMcpServerStatus[] | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined;
    }

    return Object.entries(payload as Record<string, unknown>)
      .map(([name, value]) => {
        const record =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        const status = typeof record.status === 'string' ? record.status : 'unknown';
        const error =
          typeof record.error === 'string'
            ? record.error
            : typeof record.message === 'string'
              ? record.message
              : undefined;

        return {
          name,
          status,
          ...(error ? { error } : {}),
        };
      })
      .filter((item) => item.name.trim().length > 0);
  }

  private normalizeLspStatus(payload: unknown): AssistantLspServerStatus[] | undefined {
    if (!payload) {
      return undefined;
    }

    if (Array.isArray(payload)) {
      return payload
        .map((value, index) => this.normalizeLspEntry(String(index + 1), value))
        .filter((item): item is AssistantLspServerStatus => Boolean(item));
    }

    if (typeof payload !== 'object') {
      return undefined;
    }

    return Object.entries(payload as Record<string, unknown>)
      .map(([name, value]) => this.normalizeLspEntry(name, value))
      .filter((item): item is AssistantLspServerStatus => Boolean(item));
  }

  private normalizeLspEntry(
    fallbackName: string,
    value: unknown
  ): AssistantLspServerStatus | undefined {
    if (typeof value === 'string') {
      const name = value.trim();
      return name ? { name } : undefined;
    }

    const record = this.objectRecord(value);
    const name =
      this.pickString(record.name, record.id, record.language, record.server, record.extension) ??
      fallbackName;
    const status = this.pickString(record.status, record.state);
    const error = this.pickString(record.error, record.message);

    if (!name.trim()) {
      return undefined;
    }

    return {
      name,
      ...(status ? { status } : {}),
      ...(error ? { error } : {}),
    };
  }

  private normalizeProject(payload: unknown): AssistantOpenCodeProject | undefined {
    const record = this.objectRecord(payload);
    const id = this.pickString(record.id);
    const worktree = this.pickString(record.worktree, record.path, record.root);
    const vcs = this.pickString(record.vcs);

    if (!id && !worktree && !vcs) {
      return undefined;
    }

    return {
      ...(id ? { id } : {}),
      ...(worktree ? { worktree } : {}),
      ...(vcs ? { vcs } : {}),
    };
  }

  private isRenderedTextOutput(rendered: string): boolean {
    for (const line of rendered.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let event: unknown;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return true;
      }

      const object = this.objectRecord(event);
      const type = typeof object.type === 'string' ? object.type : '';
      if (type === 'message.updated' || type === 'session.error' || type === 'error') {
        return true;
      }

      const properties = this.objectRecord(object.properties);
      const part = this.firstObject(properties.part, object.part);
      const partType = this.pickString(part.type, properties.partType, object.partType);
      if (partType === 'reasoning') {
        return true;
      }
      if (partType === 'tool') {
        continue;
      }

      const delta = this.pickString(properties.delta, object.delta);
      if (delta && delta.length > 0) {
        return true;
      }
      const text = this.pickString(part.text, properties.text, object.text);
      if (text && text.length > 0) {
        return true;
      }
    }

    return false;
  }

  private compactToolPart(
    part: Record<string, unknown>,
    properties: Record<string, unknown>,
    event: Record<string, unknown>
  ): Record<string, unknown> {
    const state = this.firstObject(part.state, properties.state, event.state);
    const input = this.firstObject(
      part.input,
      part.args,
      part.params,
      state.input,
      state.args,
      state.params,
      properties.input,
      properties.args,
      properties.params,
      event.input,
      event.args,
      event.params
    );
    const compact: Record<string, unknown> = { type: 'tool' };
    const id = this.pickString(part.id, properties.partID, event.partID, event.id);
    const name = this.pickString(
      part.tool,
      part.name,
      part.title,
      properties.tool,
      properties.name,
      event.tool,
      event.name
    );
    const status = this.pickString(
      state.status,
      state.state,
      part.status,
      properties.status,
      event.status
    );
    const output = this.compactToolText(
      this.pickString(
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
        properties.output,
        properties.stdout,
        properties.stderr,
        properties.result,
        properties.error,
        properties.message,
        event.output,
        event.stdout,
        event.stderr,
        event.result,
        event.error,
        event.message
      )
    );

    if (id) {
      compact.id = id;
    }
    if (name) {
      compact.tool = name;
      compact.name = name;
    }
    if (status) {
      compact.status = status;
    }
    if (Object.keys(input).length > 0) {
      compact.input = input;
    }
    if (output) {
      compact.output = output;
    }

    return compact;
  }

  private compactToolText(value: string | undefined): string | undefined {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }

    return normalized.length > 6000 ? `${normalized.slice(0, 6000)}\n...` : normalized;
  }

  private renderUpdatedTextDelta(
    part: Record<string, unknown>,
    partTexts: Map<string, string>,
    partType: 'text' | 'reasoning'
  ): string {
    const text = typeof part.text === 'string' ? part.text : '';
    if (!text) {
      return '';
    }

    const partId = typeof part.id === 'string' ? part.id : `last-${partType}`;
    const previousText = partTexts.get(partId) ?? '';
    partTexts.set(partId, text);

    const delta = text.startsWith(previousText) ? text.slice(previousText.length) : text;
    if (!delta) {
      return '';
    }

    return `${JSON.stringify({
      type: 'message.part.delta',
      properties: {
        part: { type: partType },
        delta,
      },
    })}\n`;
  }

  private parseSseBlock(block: string): Record<string, unknown> | undefined {
    const trimmed = block.trim();
    if (!trimmed) {
      return undefined;
    }

    const lines = trimmed.split('\n');
    const eventName = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    const data = dataLines.length > 0 ? dataLines.join('\n') : trimmed;

    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }

      const event = parsed as Record<string, unknown>;
      return typeof event.type === 'string' || !eventName ? event : { ...event, type: eventName };
    } catch {
      return undefined;
    }
  }

  private eventSessionId(event: Record<string, unknown>): string | undefined {
    const properties = this.objectRecord(event.properties);
    const data = this.objectRecord(event.data);
    const info = this.objectRecord(properties.info || data.info || event.info);
    const sessionId = this.pickString(
      properties.sessionID,
      data.sessionID,
      info.sessionID,
      event.sessionID
    );
    return sessionId?.startsWith('ses') ? sessionId : undefined;
  }

  private eventBelongsToSession(event: Record<string, unknown>, sessionId: string): boolean {
    return this.eventSessionId(event) === sessionId;
  }

  private eventErrorMessage(event: Record<string, unknown>): string | undefined {
    const type = this.pickString(event.type);
    const properties = this.objectRecord(event.properties);
    const data = this.objectRecord(event.data);

    if (type === 'message.updated') {
      return this.errorMessage(this.firstObject(properties.info, data.info, event.info));
    }

    if (type === 'error' || type === 'session.error') {
      return this.errorMessage(this.firstObject(properties.error, data.error, event.error, event));
    }

    return undefined;
  }

  private eventIsAssistantCompleted(event: Record<string, unknown>): boolean {
    if (this.pickString(event.type) !== 'message.updated') {
      return false;
    }

    const properties = this.objectRecord(event.properties);
    const data = this.objectRecord(event.data);
    const info = this.firstObject(properties.info, data.info, event.info);
    const role = this.pickString(info.role);
    return (!role || role === 'assistant') && this.isAssistantMessageCompleted(info);
  }

  private errorMessage(errorOwner: Record<string, unknown>): string | undefined {
    const error = this.firstObject(errorOwner.error, errorOwner);
    const data = this.firstObject(error.data);
    const message = this.pickString(data.message, error.message);
    const responseMessage = this.responseBodyMessage(
      this.pickString(data.responseBody, error.responseBody)
    );
    if (responseMessage && (!message || this.isGenericServerError(message))) {
      return responseMessage;
    }

    return message ?? responseMessage;
  }

  private responseBodyMessage(responseBody: string | undefined): string | undefined {
    if (!responseBody) {
      return undefined;
    }

    const record = this.parseHttpErrorObject(responseBody);
    if (!record) {
      return undefined;
    }

    return this.httpErrorObjectMessage(record);
  }

  private isGenericServerError(message: string): boolean {
    return /^Unexpected server error\. Check server logs for details\.?$/i.test(message.trim());
  }

  private normalizeProviderError(message: string): string {
    if (/FreeUsageLimitError|rate limit exceeded|quota exhausted/i.test(message)) {
      return 'OpenCode provider rate limit exceeded. Switch model/provider or wait before retrying.';
    }

    if (
      /model[_ -]?not[_ -]?found|model_not_found|unsupported model|unknown model/i.test(message)
    ) {
      return 'OpenCode model is not available in the current provider. Choose Configured or another listed OpenCode model, then retry.';
    }

    if (/No context found for instance/i.test(message)) {
      return 'OpenCode did not receive the workspace directory for this attached session. Reload the window or retry after Agents GUI reconnects to OpenCode.';
    }

    if (/unhashable type: 'dict'|tool schema|tools schema/i.test(message)) {
      return 'OpenCode provider rejected the tool schema. Use a no-tool OpenCode agent or switch to a provider with tool-calling support.';
    }

    return message;
  }

  private sessionUrl(serverUrl: string | URL, sessionId: string, suffix = ''): URL {
    const encodedSessionId = encodeURIComponent(sessionId);
    return new URL(`/session/${encodedSessionId}${suffix}`, serverUrl);
  }

  private apiUrl(serverUrl: string | URL, pathname: string, directory?: string): URL {
    const url = new URL(pathname, serverUrl);
    if (directory) {
      url.searchParams.set('directory', directory);
    }
    return url;
  }

  private objectRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private firstObject(...values: unknown[]): Record<string, unknown> {
    for (const value of values) {
      const object = this.objectRecord(value);
      if (Object.keys(object).length > 0) {
        return object;
      }

      const parsed = this.parseObjectString(value);
      if (parsed) {
        return parsed;
      }
    }

    return {};
  }

  private parseObjectString(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const object = this.objectRecord(parsed);
      return Object.keys(object).length > 0 ? object : undefined;
    } catch {
      return undefined;
    }
  }

  private pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string') {
        return value;
      }
    }

    return undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
