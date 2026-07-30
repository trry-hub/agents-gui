import * as vscode from 'vscode';
import type { AgentRuntime, AgentSession } from './agentRuntime';
import {
  filterPromptEchoChunk,
  flushCliOutputBuffer,
  normalizeCliOutput,
  normalizeCliOutputChunk,
} from './outputFormatter';
import { runtimeT, type RuntimeLocale } from './localization';
import type { HostToWebviewMessage } from './webviewProtocol';

const DEFAULT_NO_OUTPUT_NOTICE_MS = 45_000;
export const DEFAULT_MAX_SESSION_STDOUT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_SESSION_STDERR_BYTES = 512 * 1024;

export interface AgentSessionControllerOptions {
  agentRuntime: AgentRuntime;
  locale: RuntimeLocale;
  postToWebview(message: HostToWebviewMessage): void;
  noOutputNoticeMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export class AgentSessionController {
  private readonly activeSessions = new Map<string, AgentSession>();
  private readonly wiredSessionIds = new Set<string>();
  private readonly outputBuffers = new Map<string, string>();
  private readonly promptEchoBuffers = new Map<string, string>();
  private readonly stdoutBytes = new Map<string, number>();
  private readonly stderrBytes = new Map<string, number>();
  private readonly noOutputNoticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly eventDisposables = new Map<string, vscode.Disposable>();
  private readonly noOutputNoticeMs: number;
  private readonly maxStdoutBytes: number;
  private readonly maxStderrBytes: number;

  constructor(private readonly options: AgentSessionControllerOptions) {
    this.noOutputNoticeMs = options.noOutputNoticeMs ?? DEFAULT_NO_OUTPUT_NOTICE_MS;
    this.maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_SESSION_STDOUT_BYTES;
    this.maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_SESSION_STDERR_BYTES;
  }

  active(cliId: string): AgentSession | undefined {
    return this.activeSessions.get(cliId);
  }

  /**
   * Register a new session and wire its event handlers.
   * This method ONLY registers - stopping old sessions is the caller's
   * responsibility via replace(). This separation ensures:
   * - Single responsibility: register() only registers, replace() only stops
   * - No duplicate 'stopped' messages to the webview
   * - Clear control flow for the caller
   */
  register(session: AgentSession): void {
    this.activeSessions.set(session.cliId, session);
    this.wire(session);
  }

  replace(cliId: string): void {
    const session = this.activeSessions.get(cliId);
    if (!session) {
      return;
    }

    this.options.agentRuntime.stop(session.id);
    this.cleanup(session);
    this.options.postToWebview({ command: 'stopped', cliId, sessionId: session.id });
  }

  armNoOutputNotice(session: AgentSession): void {
    this.clearNoOutputNoticeTimer(session.id);
    const timer = setTimeout(() => {
      this.noOutputNoticeTimers.delete(session.id);
      if (session.process.exitCode !== null || session.process.killed) {
        return;
      }

      this.options.postToWebview({
        command: 'sessionNotice',
        cliId: session.cliId,
        sessionId: session.id,
        text: runtimeT(this.options.locale, 'warning.noOutput', {
          provider: session.profile.name,
          seconds: String(Math.round(this.noOutputNoticeMs / 1000)),
        }),
      });
    }, this.noOutputNoticeMs);
    this.noOutputNoticeTimers.set(session.id, timer);
  }

  stop(cliId: string): void {
    const session = this.activeSessions.get(cliId);
    if (!session) {
      return;
    }

    this.options.agentRuntime.stop(session.id);
    this.cleanup(session);
    this.options.postToWebview({ command: 'stopped', cliId, sessionId: session.id });
  }

  stopAll(): void {
    for (const session of Array.from(this.activeSessions.values())) {
      const cliId = session.cliId;
      this.options.agentRuntime.stop(session.id);
      this.cleanup(session);
      this.options.postToWebview({ command: 'stopped', cliId, sessionId: session.id });
    }
    this.options.agentRuntime.stopAll();
    this.activeSessions.clear();
    this.wiredSessionIds.clear();
    this.clearNoOutputNoticeTimers();
  }

  dispose(): void {
    this.clearNoOutputNoticeTimers();
    this.outputBuffers.clear();
    this.promptEchoBuffers.clear();
    this.stdoutBytes.clear();
    this.stderrBytes.clear();
    for (const session of Array.from(this.activeSessions.values())) {
      this.options.agentRuntime.stop(session.id);
      this.cleanup(session);
    }
    this.activeSessions.clear();
    this.wiredSessionIds.clear();
    this.eventDisposables.forEach((disposable) => disposable.dispose());
    this.eventDisposables.clear();
  }

  private wire(session: AgentSession): void {
    if (this.wiredSessionIds.has(session.id)) {
      return;
    }

    this.wiredSessionIds.add(session.id);

    const eventDisposable = session.onEvent.event((event) => {
      this.clearNoOutputNoticeTimer(session.id);

      if (event.type === 'output' && event.stream === 'stdout') {
        if (!this.recordOutputBytes(session, event.stream, event.text)) {
          return;
        }
        try {
          this.forwardStdout(session, event.text, event.stream);
        } catch (error) {
          if (this.isCliOutputBufferLimitError(error)) {
            this.failOutputLimit(session, error.message);
            return;
          }
          throw error;
        }
        return;
      }

      if (event.type === 'output' && event.stream === 'stderr') {
        if (!this.recordOutputBytes(session, event.stream, event.text)) {
          return;
        }
        this.forwardStderr(session, event.text, event.stream);
        return;
      }

      if (event.type === 'error') {
        this.options.postToWebview({
          command: 'error',
          cliId: session.cliId,
          text: normalizeCliOutput(event.message, session.cliId),
          sessionId: session.id,
        });
        return;
      }

      if (event.type === 'end') {
        this.forwardEnd(session, event.exitCode);
      }
    });

    this.eventDisposables.set(session.id, eventDisposable);
  }

  private forwardStdout(session: AgentSession, text: string, stream: 'stdout'): void {
    const normalized = normalizeCliOutputChunk(
      text,
      session.cliId,
      this.outputBuffers.get(session.id) ?? ''
    );
    this.outputBuffers.set(session.id, normalized.buffer);
    const filtered = filterPromptEchoChunk(
      normalized.text,
      session.cliId,
      this.promptEchoBuffers.get(session.id) ?? ''
    );
    if (filtered.buffer) {
      this.promptEchoBuffers.set(session.id, filtered.buffer);
    } else {
      this.promptEchoBuffers.delete(session.id);
    }
    if (
      !filtered.text &&
      !normalized.thinking &&
      !normalized.activities?.length &&
      normalized.status !== 'thinking'
    ) {
      return;
    }

    this.options.postToWebview({
      command: 'output',
      cliId: session.cliId,
      text: filtered.text,
      thinking: normalized.thinking,
      activities: normalized.activities,
      status: normalized.status,
      sessionId: session.id,
      stream,
    });
  }

  private forwardStderr(session: AgentSession, text: string, stream: 'stderr'): void {
    const normalizedText = normalizeCliOutput(text, session.cliId);
    if (!normalizedText) {
      return;
    }

    this.options.postToWebview({
      command: 'output',
      cliId: session.cliId,
      text: normalizedText,
      sessionId: session.id,
      stream,
    });
  }

  private forwardEnd(session: AgentSession, exitCode: number): void {
    const buffered = this.outputBuffers.get(session.id);
    const flushed = flushCliOutputBuffer(buffered ?? '', session.cliId);
    this.outputBuffers.delete(session.id);
    const filtered = filterPromptEchoChunk(
      flushed,
      session.cliId,
      this.promptEchoBuffers.get(session.id) ?? ''
    );
    this.promptEchoBuffers.delete(session.id);
    if (filtered.text) {
      this.options.postToWebview({
        command: 'output',
        cliId: session.cliId,
        text: filtered.text,
        sessionId: session.id,
        stream: 'stdout',
      });
    }

    this.options.postToWebview({
      command: 'sessionEnd',
      cliId: session.cliId,
      exitCode,
      sessionId: session.id,
    });
    this.cleanup(session);
  }

  private cleanup(session: AgentSession): void {
    this.clearNoOutputNoticeTimer(session.id);
    this.outputBuffers.delete(session.id);
    this.promptEchoBuffers.delete(session.id);
    this.stdoutBytes.delete(session.id);
    this.stderrBytes.delete(session.id);
    this.activeSessions.delete(session.cliId);
    this.wiredSessionIds.delete(session.id);
    this.disposeSessionEvents(session.id);
  }

  private recordOutputBytes(
    session: AgentSession,
    stream: 'stdout' | 'stderr',
    text: string
  ): boolean {
    const counters = stream === 'stdout' ? this.stdoutBytes : this.stderrBytes;
    const limit = stream === 'stdout' ? this.maxStdoutBytes : this.maxStderrBytes;
    const total = (counters.get(session.id) ?? 0) + Buffer.byteLength(text, 'utf8');
    if (total > limit) {
      this.failOutputLimit(
        session,
        `${session.profile.name} ${stream} exceeded the ${limit}-byte output limit.`
      );
      return false;
    }
    counters.set(session.id, total);
    return true;
  }

  private isCliOutputBufferLimitError(error: unknown): error is Error {
    return error instanceof Error && 'code' in error && error.code === 'CLI_OUTPUT_BUFFER_LIMIT';
  }

  private failOutputLimit(session: AgentSession, message: string): void {
    this.cleanup(session);
    this.options.agentRuntime.stop(session.id);
    this.options.postToWebview({
      command: 'error',
      cliId: session.cliId,
      sessionId: session.id,
      text: message,
    });
  }

  private disposeSessionEvents(sessionId: string): void {
    const disposable = this.eventDisposables.get(sessionId);
    if (!disposable) {
      return;
    }

    disposable.dispose();
    this.eventDisposables.delete(sessionId);
  }

  private clearNoOutputNoticeTimer(sessionId: string): void {
    const timer = this.noOutputNoticeTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.noOutputNoticeTimers.delete(sessionId);
  }

  private clearNoOutputNoticeTimers(): void {
    for (const timer of this.noOutputNoticeTimers.values()) {
      clearTimeout(timer);
    }
    this.noOutputNoticeTimers.clear();
  }
}
