import { cleanGeneratedCommitMessage, type CommitMessageLanguage } from './commitMessage';

export type TextGenerationTask = 'commit-message' | 'title' | 'summary' | 'explanation';
export type TextGenerationCapabilityState = 'enabled' | 'disabled';
export type TextGenerationPersistence = 'ephemeral' | 'persistent';

export interface TextGenerationCapabilityPolicy {
  tools: TextGenerationCapabilityState;
  mcp: TextGenerationCapabilityState;
  projectConfig: TextGenerationCapabilityState;
  plugins: TextGenerationCapabilityState;
  persistence: TextGenerationPersistence;
}

export interface TextGenerationTimeBudgets {
  launchMs: number;
  firstOutputMs: number;
  idleMs: number;
  totalMs: number;
}

export interface TextGenerationRequest {
  task: TextGenerationTask;
  providerId: string;
  prompt: string;
  cwd: string;
  capabilities: TextGenerationCapabilityPolicy;
  budgets: TextGenerationTimeBudgets;
}

export type TextGenerationPhase =
  'launch' | 'wait-first-output' | 'stream' | 'cleanup' | 'completed' | 'failed';

export type TextGenerationEvent =
  | {
      type: 'phase';
      phase: TextGenerationPhase;
      elapsedMs: number;
    }
  | {
      type: 'output';
      text: string;
    };

export interface DisposableLike {
  dispose(): void;
}

export interface TextGenerationCancellationSignal {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): DisposableLike;
}

export interface TextGenerationPort {
  generate(
    request: TextGenerationRequest,
    signal: TextGenerationCancellationSignal,
    observer?: (event: TextGenerationEvent) => void
  ): Promise<string>;
}

export interface TextGenerationProviderRegistry {
  isAvailable(providerId: string): Promise<boolean>;
}

export type TextGenerationErrorCode =
  | 'cancelled'
  | 'provider-unavailable'
  | 'invalid-output'
  | 'launch-timeout'
  | 'first-output-timeout'
  | 'idle-timeout'
  | 'total-timeout'
  | 'provider-error';

export class TextGenerationError extends Error {
  constructor(
    public readonly code: TextGenerationErrorCode,
    message: string,
    public readonly providerId?: string,
    public readonly phase?: TextGenerationPhase
  ) {
    super(message);
    this.name = 'TextGenerationError';
  }
}

export const COMMIT_MESSAGE_CAPABILITY_POLICY: Readonly<TextGenerationCapabilityPolicy> =
  Object.freeze({
    tools: 'disabled',
    mcp: 'disabled',
    projectConfig: 'disabled',
    plugins: 'disabled',
    persistence: 'ephemeral',
  });

export const COMMIT_MESSAGE_TIME_BUDGETS: Readonly<TextGenerationTimeBudgets> = Object.freeze({
  launchMs: 10_000,
  firstOutputMs: 45_000,
  idleMs: 30_000,
  totalMs: 90_000,
});

export interface GenerateCommitMessageRequest {
  primaryProviderId: string;
  resolveFallbackProviderIds: () => Promise<string[]>;
  prompt: string;
  repositoryRoot: string;
  language: CommitMessageLanguage;
  diff: string;
  inputMessage: string;
  signal: TextGenerationCancellationSignal;
  onAttemptStart?: (providerId: string) => void;
  onPartial?: (message: string, providerId: string) => void;
}

export interface GenerateCommitMessageResult {
  message: string;
  providerId: string;
  fallbackFrom?: string;
}

export class GenerateCommitMessageUseCase {
  constructor(private readonly generator: TextGenerationPort) {}

  async execute(request: GenerateCommitMessageRequest): Promise<GenerateCommitMessageResult> {
    const providerIds = [request.primaryProviderId];
    const seen = new Set(providerIds);
    let fallbacksLoaded = false;
    let lastError: Error | undefined;

    for (let index = 0; index < providerIds.length; index += 1) {
      const providerId = providerIds[index];
      this.throwIfCancelled(request.signal, providerId);
      request.onAttemptStart?.(providerId);

      try {
        const output = await this.generator.generate(
          {
            task: 'commit-message',
            providerId,
            prompt: request.prompt,
            cwd: request.repositoryRoot,
            capabilities: COMMIT_MESSAGE_CAPABILITY_POLICY,
            budgets: COMMIT_MESSAGE_TIME_BUDGETS,
          },
          request.signal,
          (event) => {
            if (event.type !== 'output') {
              return;
            }
            const partial = cleanGeneratedCommitMessage(event.text, {
              language: request.language,
              diff: request.diff,
              inputMessage: request.inputMessage,
            });
            if (partial) {
              request.onPartial?.(partial, providerId);
            }
          }
        );
        const message = cleanGeneratedCommitMessage(output, {
          language: request.language,
          diff: request.diff,
          inputMessage: request.inputMessage,
        });
        if (!message) {
          throw new TextGenerationError(
            'invalid-output',
            'The AI provider did not return a valid commit message.',
            providerId
          );
        }

        return {
          message,
          providerId,
          ...(index > 0 ? { fallbackFrom: request.primaryProviderId } : {}),
        };
      } catch (error) {
        if (isCancellationError(error) || request.signal.isCancellationRequested) {
          throw normalizeCancellationError(error, providerId);
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        if (!fallbacksLoaded) {
          fallbacksLoaded = true;
          for (const fallbackId of await request.resolveFallbackProviderIds()) {
            if (!fallbackId || seen.has(fallbackId)) {
              continue;
            }
            seen.add(fallbackId);
            providerIds.push(fallbackId);
          }
        }

        if (index >= providerIds.length - 1) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new TextGenerationError('invalid-output', 'No provider returned output.');
  }

  private throwIfCancelled(signal: TextGenerationCancellationSignal, providerId: string): void {
    if (signal.isCancellationRequested) {
      throw new TextGenerationError('cancelled', 'cancelled', providerId);
    }
  }
}

function isCancellationError(error: unknown): boolean {
  return (
    (error instanceof TextGenerationError && error.code === 'cancelled') ||
    (error instanceof Error && error.message === 'cancelled')
  );
}

function normalizeCancellationError(error: unknown, providerId: string): TextGenerationError {
  return error instanceof TextGenerationError && error.code === 'cancelled'
    ? error
    : new TextGenerationError('cancelled', 'cancelled', providerId);
}
