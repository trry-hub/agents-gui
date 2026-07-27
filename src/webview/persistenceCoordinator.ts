import type { ThreadEventEnvelope } from '../threadProtocol';
import type { ConversationSnapshot } from './conversationReducer';

type TimerHandle = unknown;

export interface PersistenceCoordinatorOptions {
  getSnapshot(): ConversationSnapshot;
  persist(snapshot: ConversationSnapshot): void;
  now?: () => number;
  setTimer(callback: () => void, delay: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  checkpointMs?: number;
}

export interface PersistenceCoordinator {
  onEvent(envelope: ThreadEventEnvelope): void;
  onThreadSwitch(): void;
  onHidden(): void;
  dispose(): void;
}

export function createPersistenceCoordinator(
  options: PersistenceCoordinatorOptions
): PersistenceCoordinator {
  const now = options.now ?? Date.now;
  const checkpointMs = options.checkpointMs ?? 500;
  let timer: TimerHandle | undefined;
  let lastPersistedAt = now();
  let disposed = false;

  function cancelTimer(): void {
    if (timer === undefined) {
      return;
    }
    options.clearTimer(timer);
    timer = undefined;
  }

  function persistNow(): void {
    if (disposed) {
      return;
    }
    cancelTimer();
    options.persist(options.getSnapshot());
    lastPersistedAt = now();
  }

  function scheduleCheckpoint(): void {
    if (timer !== undefined || disposed) {
      return;
    }
    const elapsed = Math.max(0, now() - lastPersistedAt);
    const delay = Math.max(0, checkpointMs - elapsed);
    timer = options.setTimer(() => {
      timer = undefined;
      persistNow();
    }, delay);
  }

  return {
    onEvent(envelope) {
      if (envelope.event.type === 'turn/completed') {
        persistNow();
        return;
      }
      if (isRunningLifecycle(envelope)) {
        scheduleCheckpoint();
      }
    },
    onThreadSwitch: persistNow,
    onHidden: persistNow,
    dispose() {
      if (disposed) {
        return;
      }
      persistNow();
      disposed = true;
    },
  };
}

function isRunningLifecycle(envelope: ThreadEventEnvelope): boolean {
  switch (envelope.event.type) {
    case 'turn/started':
    case 'item/started':
    case 'item/assistantMessage/delta':
    case 'item/reasoning/delta':
    case 'item/activity/updated':
      return true;
    default:
      return false;
  }
}

