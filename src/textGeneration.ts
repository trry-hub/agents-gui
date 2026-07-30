import { cleanGeneratedCommitMessage, type CommitMessageLanguage } from './commitMessage';

export type TextGenerationTask = 'commit-message' | 'title' | 'summary' | 'explanation';

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

export const COMMIT_MESSAGE_TIME_BUDGETS: Readonly<TextGenerationTimeBudgets> = Object.freeze({
  launchMs: 10_000,
  firstOutputMs: 45_000,
  idleMs: 30_000,
  totalMs: 90_000,
});

export interface GenerateCommitMessageRequest {
  providerId: string;
  prompt: string;
  repositoryRoot: string;
  language: CommitMessageLanguage;
  diff: string;
  inputMessage: string;
  signal: TextGenerationCancellationSignal;
  onPartial?: (message: string, providerId: string) => void;
}

export interface GenerateCommitMessageResult {
  message: string;
  providerId: string;
}

export class GenerateCommitMessageUseCase {
  constructor(private readonly generator: TextGenerationPort) {}

  async execute(request: GenerateCommitMessageRequest): Promise<GenerateCommitMessageResult> {
    this.throwIfCancelled(request.signal, request.providerId);
    const output = await this.generator.generate(
      {
        task: 'commit-message',
        providerId: request.providerId,
        prompt: request.prompt,
        cwd: request.repositoryRoot,
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
          request.onPartial?.(partial, request.providerId);
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
        'The selected CLI did not return a valid commit message.',
        request.providerId
      );
    }
    return { message, providerId: request.providerId };
  }

  private throwIfCancelled(signal: TextGenerationCancellationSignal, providerId: string): void {
    if (signal.isCancellationRequested) {
      throw new TextGenerationError('cancelled', 'cancelled', providerId);
    }
  }
}
