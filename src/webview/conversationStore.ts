import type { ThreadEventEnvelope } from '../threadProtocol';
import {
  createEmptyConversationSnapshot,
  migrateLegacyConversations,
  projectConversationHistory,
  projectThreadSummaries,
  reduceConversation,
  type ConversationSnapshot,
  type LegacyThread,
} from './conversationReducer';

const MAX_SEEN_ENVELOPES = 4096;

export interface ConversationStore {
  getSnapshot(): ConversationSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(envelope: ThreadEventEnvelope): boolean;
  hydrate(snapshot: ConversationSnapshot): void;
  hydrateLegacy(
    threadsByProvider: Record<string, LegacyThread[]> | undefined,
    activeThreadByProvider?: Record<string, string>
  ): void;
  getConversationHistory(providerId: string, threadId: string): ReturnType<
    typeof projectConversationHistory
  >;
  getThreadSummaries(): ReturnType<typeof projectThreadSummaries>;
}

export function createConversationStore(
  initialSnapshot: ConversationSnapshot = createEmptyConversationSnapshot()
): ConversationStore {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function hydrate(next: ConversationSnapshot): void {
    snapshot = next?.version === 2 ? next : createEmptyConversationSnapshot();
    seen.clear();
    seenOrder.length = 0;
    notify();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(envelope) {
      if (!envelope || envelope.command !== 'threadEvent') {
        return false;
      }
      const key = `${envelope.providerId}:${envelope.threadId}:${envelope.sequence}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      seenOrder.push(key);
      if (seenOrder.length > MAX_SEEN_ENVELOPES) {
        const oldest = seenOrder.shift();
        if (oldest) {
          seen.delete(oldest);
        }
      }

      const next = reduceConversation(snapshot, envelope);
      if (next === snapshot) {
        return false;
      }
      snapshot = next;
      notify();
      return true;
    },
    hydrate,
    hydrateLegacy(threadsByProvider, activeThreadByProvider) {
      hydrate(migrateLegacyConversations(threadsByProvider, activeThreadByProvider));
    },
    getConversationHistory(providerId, threadId) {
      return projectConversationHistory(snapshot, providerId, threadId);
    },
    getThreadSummaries() {
      return projectThreadSummaries(snapshot);
    },
  };
}

