import type {
  ThreadActivity,
  ThreadEvent,
  ThreadEventEnvelope,
  ThreadItem,
  ThreadItemType,
} from './threadProtocol';

interface LegacyLifecycleMessage {
  command: string;
  cliId?: string;
  threadId?: string;
  sessionId?: string;
  text?: string;
  thinking?: string;
  activities?: ThreadActivity[];
  exitCode?: number;
  attachments?: unknown[];
  actionLabel?: string;
  agentModeLabel?: string;
  agentMode?: string;
}

interface ActiveTurnBinding {
  providerId: string;
  threadId: string;
  turnId: string;
  assistantItemId: string;
  reasoningItemId: string;
}

export interface ThreadEventAdapterOptions {
  now?: () => number;
}

export class ThreadEventAdapter {
  private readonly now: () => number;
  private readonly sequenceByThread = new Map<string, number>();
  private readonly activeTurnBySession = new Map<string, ActiveTurnBinding>();
  private turnCounter = 0;

  constructor(options: ThreadEventAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  accept(message: LegacyLifecycleMessage): ThreadEventEnvelope[] {
    switch (message.command) {
      case 'requestStarted':
        return this.startTurn(message);
      case 'output':
        return this.forwardOutput(message);
      case 'sessionEnd':
        return this.completeTurn(
          message,
          Number(message.exitCode) === 0 ? 'completed' : 'failed'
        );
      case 'stopped':
        return this.completeTurn(message, 'stopped');
      case 'error':
        return this.failTurn(message);
      default:
        return [];
    }
  }

  private startTurn(message: LegacyLifecycleMessage): ThreadEventEnvelope[] {
    const providerId = clean(message.cliId);
    const threadId = clean(message.threadId);
    const sessionId = clean(message.sessionId);
    if (!providerId || !threadId || !sessionId) {
      return [];
    }

    const startedAt = this.now();
    const turnId = `${sessionId}:${startedAt.toString(36)}:${++this.turnCounter}`;
    const binding: ActiveTurnBinding = {
      providerId,
      threadId,
      turnId,
      assistantItemId: `${turnId}:assistant`,
      reasoningItemId: `${turnId}:reasoning`,
    };
    this.activeTurnBySession.set(sessionId, binding);

    const userItem: ThreadItem = {
      id: `${turnId}:user`,
      turnId,
      type: 'user-message',
      status: 'completed',
      content: String(message.text ?? ''),
      meta: [message.actionLabel, message.agentModeLabel ?? message.agentMode]
        .map(clean)
        .filter(Boolean)
        .join(' · ') || undefined,
      attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
      startedAt,
      completedAt: startedAt,
    };
    const assistantItem: ThreadItem = {
      id: binding.assistantItemId,
      turnId,
      type: 'assistant-message',
      status: 'running',
      content: '',
      startedAt,
    };

    return [
      this.envelope(binding, {
        type: 'thread/started',
        thread: {
          id: threadId,
          providerId,
          title: titleFrom(message.text),
          status: 'running',
          updatedAt: startedAt,
        },
      }),
      this.envelope(binding, {
        type: 'turn/started',
        turn: { id: turnId, status: 'running', startedAt },
      }),
      this.envelope(binding, { type: 'item/started', item: userItem }),
      this.envelope(binding, { type: 'item/started', item: assistantItem }),
    ];
  }

  private forwardOutput(message: LegacyLifecycleMessage): ThreadEventEnvelope[] {
    const binding = this.bindingFor(message);
    if (!binding) {
      return [];
    }

    const envelopes: ThreadEventEnvelope[] = [];
    if (message.text) {
      envelopes.push(
        this.envelope(binding, {
          type: 'item/assistantMessage/delta',
          turnId: binding.turnId,
          itemId: binding.assistantItemId,
          delta: message.text,
        })
      );
    }
    if (message.thinking) {
      envelopes.push(
        this.envelope(binding, {
          type: 'item/reasoning/delta',
          turnId: binding.turnId,
          itemId: binding.reasoningItemId,
          delta: message.thinking,
        })
      );
    }
    for (const activity of message.activities ?? []) {
      const activityKey = clean(activity.id) || activityIdentity(activity);
      const itemId = `${binding.turnId}:activity:${activityKey}`;
      const item: ThreadItem = {
        id: itemId,
        turnId: binding.turnId,
        type: itemTypeForActivity(activity.kind),
        status: 'completed',
        label: clean(activity.name) || clean(activity.target) || activity.kind,
        content: clean(activity.detail),
        activity,
        startedAt: this.now(),
        completedAt: this.now(),
      };
      envelopes.push(
        this.envelope(binding, {
          type: 'item/activity/updated',
          turnId: binding.turnId,
          itemId,
          item,
          activity,
        })
      );
    }
    return envelopes;
  }

  private completeTurn(
    message: LegacyLifecycleMessage,
    status: 'completed' | 'failed' | 'stopped'
  ): ThreadEventEnvelope[] {
    const sessionId = clean(message.sessionId);
    const binding = this.bindingFor(message);
    if (!binding || !sessionId) {
      return [];
    }

    const completedAt = this.now();
    const result = [
      this.envelope(binding, {
        type: 'turn/completed',
        turnId: binding.turnId,
        status,
        completedAt,
      }),
      this.envelope(binding, {
        type: 'thread/status/changed',
        status,
      }),
    ];
    this.activeTurnBySession.delete(sessionId);
    return result;
  }

  private failTurn(message: LegacyLifecycleMessage): ThreadEventEnvelope[] {
    const binding = this.bindingFor(message);
    if (!binding) {
      return [];
    }
    const now = this.now();
    const item: ThreadItem = {
      id: `${binding.turnId}:error:${now.toString(36)}`,
      turnId: binding.turnId,
      type: 'system-error',
      status: 'failed',
      content: String(message.text ?? ''),
      startedAt: now,
      completedAt: now,
    };
    const errorEnvelope = this.envelope(binding, { type: 'item/started', item });
    return [errorEnvelope, ...this.completeTurn(message, 'failed')];
  }

  private bindingFor(message: LegacyLifecycleMessage): ActiveTurnBinding | undefined {
    const sessionId = clean(message.sessionId);
    return sessionId ? this.activeTurnBySession.get(sessionId) : undefined;
  }

  private envelope(binding: ActiveTurnBinding, event: ThreadEvent): ThreadEventEnvelope {
    const key = `${binding.providerId}:${binding.threadId}`;
    const sequence = (this.sequenceByThread.get(key) ?? 0) + 1;
    this.sequenceByThread.set(key, sequence);
    return {
      command: 'threadEvent',
      providerId: binding.providerId,
      threadId: binding.threadId,
      sequence,
      event,
    };
  }
}

function itemTypeForActivity(kind: ThreadActivity['kind']): ThreadItemType {
  switch (kind) {
    case 'command':
      return 'command-execution';
    case 'file':
      return 'file-change';
    case 'search':
    case 'tool':
      return 'mcp-tool-call';
  }
}

function activityIdentity(activity: ThreadActivity): string {
  return [activity.kind, activity.name, activity.target]
    .map((value) => clean(value).replace(/[^a-zA-Z0-9_.-]+/g, '-'))
    .filter(Boolean)
    .join(':') || 'activity';
}

function titleFrom(value: unknown): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/\s+/g, ' ')
    .slice(0, 42) || 'New session';
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
