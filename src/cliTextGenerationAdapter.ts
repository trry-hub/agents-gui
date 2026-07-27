import type { AgentRunEvent, StartPromptOptions } from './cliManager';
import {
  getCliAgentMode,
  getCliPermissionMode,
  getCliProfile,
  getCliRuntimeMode,
  type CliAgentMode,
  type CliPermissionMode,
  type CliProfile,
} from './cliProfiles';
import { buildOpenCodeFastGenerationEnv } from './openCodeTaskPolicy';
import {
  flushCliOutputBuffer,
  normalizeCliOutput,
  normalizeCliOutputChunk,
} from './outputFormatter';
import {
  TextGenerationError,
  type DisposableLike,
  type TextGenerationCancellationSignal,
  type TextGenerationEvent,
  type TextGenerationPort,
  type TextGenerationProviderRegistry,
  type TextGenerationRequest,
} from './textGeneration';

const OPENCODE_TEXT_GENERATION_PROMPT_ARGS = ['run', '--format', 'json'];

interface GenerationSession {
  id: string;
  cliId: string;
  onEvent: {
    event(listener: (event: AgentRunEvent) => void): DisposableLike;
  };
}

export interface CliTextGenerationManager {
  checkInstalled(providerId: string): Promise<boolean>;
  startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs?: string[],
    agentModeId?: string,
    optionKey?: string,
    envOverrides?: Record<string, string>,
    options?: StartPromptOptions
  ): Promise<GenerationSession | null>;
  stop(sessionId: string): void;
}

export interface ProviderRuntimeSelection {
  env: Record<string, string>;
  selectionKey: string;
}

export interface CliTextGenerationAdapterOptions {
  resolveProviderRuntime?: (providerId: string) => ProviderRuntimeSelection;
  readOpenCodeConfig?: () => unknown;
  now?: () => number;
}

export class CliTextGenerationAdapter
  implements TextGenerationPort, TextGenerationProviderRegistry
{
  private readonly now: () => number;

  constructor(
    private readonly cliManager: CliTextGenerationManager,
    private readonly options: CliTextGenerationAdapterOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  isAvailable(providerId: string): Promise<boolean> {
    return this.cliManager.checkInstalled(providerId);
  }

  async generate(
    request: TextGenerationRequest,
    signal: TextGenerationCancellationSignal,
    observer?: (event: TextGenerationEvent) => void
  ): Promise<string> {
    const startedAt = this.now();
    let session: GenerationSession | undefined;
    this.emitPhase(observer, 'launch', startedAt);

    try {
      this.throwIfCancelled(signal, request.providerId, 'launch');
      const profile = getCliProfile(request.providerId);
      if (!profile) {
        throw new TextGenerationError(
          'provider-unavailable',
          `Unknown AI provider: ${request.providerId}`,
          request.providerId,
          'launch'
        );
      }

      session = await this.launch(profile, request, signal);
      this.emitPhase(observer, 'wait-first-output', startedAt);
      const output = await this.waitForSessionOutput(session, request, signal, startedAt, observer);
      this.emitPhase(observer, 'cleanup', startedAt);
      this.emitPhase(observer, 'completed', startedAt);
      return output;
    } catch (error) {
      this.emitPhase(observer, 'cleanup', startedAt);
      this.emitPhase(observer, 'failed', startedAt);
      throw normalizeGenerationError(error, request.providerId);
    }
  }

  private async launch(
    profile: CliProfile,
    request: TextGenerationRequest,
    signal: TextGenerationCancellationSignal
  ): Promise<GenerationSession> {
    const agentMode = preferredCommitAgentMode(profile);
    const permissionMode = preferredCommitPermissionMode(profile);
    const runtimeMode = getCliRuntimeMode(profile);
    const runtime = this.options.resolveProviderRuntime?.(profile.id) ?? {
      env: {},
      selectionKey: 'api-provider:none',
    };
    const env =
      profile.id === 'opencode' && requiresFastLaneIsolation(request)
        ? buildOpenCodeFastGenerationEnv(runtime.env, this.options.readOpenCodeConfig?.())
        : runtime.env;
    const agentArgs = [
      ...(runtimeMode.args ?? []),
      ...(permissionMode.args ?? []),
      ...(agentMode.args ?? []),
    ];
    const startOptions: StartPromptOptions = {
      cwd: request.cwd,
      attachBackgroundServer: false,
      ...(profile.id === 'opencode' ? { promptArgs: OPENCODE_TEXT_GENERATION_PROMPT_ARGS } : {}),
    };
    const optionKey = [
      'commitMessage',
      agentMode.id,
      'configured',
      runtimeMode.id,
      permissionMode.id,
      runtime.selectionKey,
    ].join('|');
    const launchPromise = this.cliManager.startPrompt(
      profile.id,
      request.prompt,
      agentArgs,
      agentMode.id,
      optionKey,
      env,
      startOptions
    );
    const session = await this.waitForLaunch(
      launchPromise,
      request.providerId,
      Math.min(request.budgets.launchMs, request.budgets.totalMs),
      signal
    );
    if (!session) {
      throw new TextGenerationError(
        'provider-unavailable',
        `${profile.name} is not installed or could not be started.`,
        profile.id,
        'launch'
      );
    }
    return session;
  }

  private waitForLaunch(
    launchPromise: Promise<GenerationSession | null>,
    providerId: string,
    timeoutMs: number,
    signal: TextGenerationCancellationSignal
  ): Promise<GenerationSession | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancellation: DisposableLike = { dispose() {} };
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        cancellation.dispose();
        callback();
      };
      const timeout = setTimeout(() => {
        finish(() =>
          reject(
            new TextGenerationError(
              'launch-timeout',
              'Timed out while launching the AI provider.',
              providerId,
              'launch'
            )
          )
        );
      }, positiveTimeout(timeoutMs));
      cancellation = signal.onCancellationRequested(() => {
        finish(() =>
          reject(new TextGenerationError('cancelled', 'cancelled', providerId, 'launch'))
        );
      });

      launchPromise.then(
        (session) => {
          if (settled) {
            if (session) {
              this.cliManager.stop(session.id);
            }
            return;
          }
          finish(() => resolve(session));
        },
        (error) => {
          finish(() => reject(error));
        }
      );

      if (signal.isCancellationRequested) {
        finish(() =>
          reject(new TextGenerationError('cancelled', 'cancelled', providerId, 'launch'))
        );
      }
    });
  }

  private waitForSessionOutput(
    session: GenerationSession,
    request: TextGenerationRequest,
    signal: TextGenerationCancellationSignal,
    startedAt: number,
    observer?: (event: TextGenerationEvent) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let stderr = '';
      let buffer = '';
      let settled = false;
      let streaming = false;
      let idleTimeout: ReturnType<typeof setTimeout> | undefined;
      const disposables: DisposableLike[] = [];
      const remainingTotalMs = request.budgets.totalMs - (this.now() - startedAt);

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(firstOutputTimeout);
        clearTimeout(idleTimeout);
        clearTimeout(totalTimeout);
        disposables.forEach((disposable) => disposable.dispose());
        callback();
      };
      const fail = (
        code:
          | 'cancelled'
          | 'first-output-timeout'
          | 'idle-timeout'
          | 'total-timeout'
          | 'provider-error',
        message: string,
        phase: 'wait-first-output' | 'stream'
      ) => {
        this.cliManager.stop(session.id);
        settle(() => reject(new TextGenerationError(code, message, request.providerId, phase)));
      };
      const firstOutputTimeout = setTimeout(
        () =>
          fail(
            'first-output-timeout',
            'Timed out waiting for the AI provider to produce output.',
            'wait-first-output'
          ),
        positiveTimeout(Math.min(request.budgets.firstOutputMs, remainingTotalMs))
      );
      const totalTimeout = setTimeout(
        () => fail('total-timeout', 'Timed out waiting for the AI provider.', 'stream'),
        positiveTimeout(remainingTotalMs)
      );
      const resetIdleTimeout = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(
          () => fail('idle-timeout', 'The AI provider stopped producing output.', 'stream'),
          positiveTimeout(request.budgets.idleMs)
        );
      };

      disposables.push(
        session.onEvent.event((event) => {
          if (event.type === 'output' && event.stream === 'stdout') {
            clearTimeout(firstOutputTimeout);
            if (!streaming) {
              streaming = true;
              this.emitPhase(observer, 'stream', startedAt);
            }
            resetIdleTimeout();
            const normalized = normalizeCliOutputChunk(event.text, session.cliId, buffer);
            buffer = normalized.buffer;
            output += normalized.text;
            observer?.({
              type: 'output',
              text: normalizeCliOutput(output, session.cliId),
            });
            return;
          }

          if (event.type === 'output' && event.stream === 'stderr') {
            stderr += normalizeCliOutput(event.text, session.cliId);
            return;
          }

          if (event.type === 'error') {
            fail('provider-error', event.message, streaming ? 'stream' : 'wait-first-output');
            return;
          }

          if (event.type !== 'end') {
            return;
          }

          output += flushCliOutputBuffer(buffer, session.cliId);
          const normalizedOutput = normalizeCliOutput(output, session.cliId);
          const normalizedStderr = normalizeCliOutput(stderr, session.cliId).trim();
          if (event.exitCode === 0) {
            if (!normalizedOutput.trim() && isLikelyCliError(normalizedStderr)) {
              settle(() =>
                reject(
                  new TextGenerationError(
                    'provider-error',
                    normalizedStderr,
                    request.providerId,
                    streaming ? 'stream' : 'wait-first-output'
                  )
                )
              );
              return;
            }
            if (isProviderErrorOutput(normalizedOutput)) {
              settle(() =>
                reject(
                  new TextGenerationError(
                    'provider-error',
                    normalizedOutput.trim().replace(/^Error:\s*/i, ''),
                    request.providerId,
                    streaming ? 'stream' : 'wait-first-output'
                  )
                )
              );
              return;
            }

            settle(() => resolve(normalizedOutput));
            return;
          }

          const details = (
            normalizedStderr ||
            normalizedOutput ||
            `CLI exited with code ${event.exitCode}`
          ).trim();
          settle(() =>
            reject(
              new TextGenerationError(
                'provider-error',
                details,
                request.providerId,
                streaming ? 'stream' : 'wait-first-output'
              )
            )
          );
        }),
        signal.onCancellationRequested(() => {
          fail('cancelled', 'cancelled', streaming ? 'stream' : 'wait-first-output');
        })
      );

      if (signal.isCancellationRequested) {
        fail('cancelled', 'cancelled', 'wait-first-output');
      }
    });
  }

  private throwIfCancelled(
    signal: TextGenerationCancellationSignal,
    providerId: string,
    phase: 'launch'
  ): void {
    if (signal.isCancellationRequested) {
      throw new TextGenerationError('cancelled', 'cancelled', providerId, phase);
    }
  }

  private emitPhase(
    observer: ((event: TextGenerationEvent) => void) | undefined,
    phase: Extract<TextGenerationEvent, { type: 'phase' }>['phase'],
    startedAt: number
  ): void {
    observer?.({
      type: 'phase',
      phase,
      elapsedMs: Math.max(0, this.now() - startedAt),
    });
  }
}

function requiresFastLaneIsolation(request: TextGenerationRequest): boolean {
  return (
    request.capabilities.tools === 'disabled' &&
    request.capabilities.mcp === 'disabled' &&
    request.capabilities.projectConfig === 'disabled' &&
    request.capabilities.plugins === 'disabled' &&
    request.capabilities.persistence === 'ephemeral'
  );
}

function preferredCommitAgentMode(profile: CliProfile): CliAgentMode {
  return (
    profile.agentModes.find((mode) => mode.id === 'plan' && !mode.disabled) ??
    profile.agentModes.find((mode) => mode.id === 'review' && !mode.disabled) ??
    getCliAgentMode(profile)
  );
}

function preferredCommitPermissionMode(profile: CliProfile): CliPermissionMode {
  return (
    profile.permissionModes?.find((mode) => mode.id === 'readOnly' && !mode.disabled) ??
    profile.permissionModes?.find((mode) => mode.id === 'plan' && !mode.disabled) ??
    getCliPermissionMode(profile)
  );
}

function normalizeGenerationError(error: unknown, providerId: string): TextGenerationError {
  if (error instanceof TextGenerationError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new TextGenerationError(
    message === 'cancelled' ? 'cancelled' : 'provider-error',
    message,
    providerId
  );
}

function positiveTimeout(value: number): number {
  return Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1);
}

function isLikelyCliError(text: string): boolean {
  return /\b(?:error|failed|exception|eperm|eacces|enoent|timeout|timed out|http\s*5\d\d)\b/i.test(
    text
  );
}

function isProviderErrorOutput(text: string): boolean {
  return /^Error:\s+\S/.test(text.trim());
}
