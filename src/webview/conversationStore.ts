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
  ensureThread(
    providerId: string,
    threadId: string,
    title?: string,
    updatedAt?: number
  ): void;
  setActiveThread(providerId: string, threadId: string): boolean;
  deleteThread(providerId: string, threadId: string): boolean;
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
  const initialSeen = normalizeSeenKeys(initialSnapshot.appliedEnvelopeKeys);
  const seen = new Set<string>(initialSeen);
  const seenOrder: string[] = [...initialSeen];

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function hydrate(next: ConversationSnapshot): void {
    snapshot = next?.version === 2 ? next : createEmptyConversationSnapshot();
    seen.clear();
    seenOrder.length = 0;
    for (const key of normalizeSeenKeys(snapshot.appliedEnvelopeKeys)) {
      seen.add(key);
      seenOrder.push(key);
    }
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
      const sequenceKeys = [
        ...(envelope.coalescedSequences ?? []),
        envelope.sequence,
      ].map(
        (sequence) =>
          `${envelope.providerId}:${envelope.threadId}:${sequence}`
      );
      for (const sequenceKey of sequenceKeys) {
        if (seen.has(sequenceKey)) {
          continue;
        }
        seen.add(sequenceKey);
        seenOrder.push(sequenceKey);
        if (seenOrder.length > MAX_SEEN_ENVELOPES) {
          const oldest = seenOrder.shift();
          if (oldest) {
            seen.delete(oldest);
          }
        }
      }

      const next = reduceConversation(snapshot, envelope);
      if (next === snapshot) {
        return false;
      }
      snapshot = {
        ...next,
        appliedEnvelopeKeys: [...seenOrder],
      };
      notify();
      return true;
    },
    hydrate,
    hydrateLegacy(threadsByProvider, activeThreadByProvider) {
      hydrate(migrateLegacyConversations(threadsByProvider, activeThreadByProvider));
    },
    ensureThread(providerId, threadId, title = 'New session', updatedAt = Date.now()) {
      if (!providerId || !threadId || snapshot.threadsById[threadId]) {
        return;
      }
      const order = snapshot.threadOrderByProvider[providerId] ?? [];
      snapshot = {
        ...snapshot,
        threadsById: {
          ...snapshot.threadsById,
          [threadId]: {
            id: threadId,
            providerId,
            title,
            status: 'idle',
            turnOrder: [],
            turnsById: {},
            updatedAt,
          },
        },
        threadOrderByProvider: {
          ...snapshot.threadOrderByProvider,
          [providerId]: [...order, threadId],
        },
        activeThreadByProvider: snapshot.activeThreadByProvider[providerId]
          ? snapshot.activeThreadByProvider
          : { ...snapshot.activeThreadByProvider, [providerId]: threadId },
      };
      notify();
    },
    setActiveThread(providerId, threadId) {
      const thread = snapshot.threadsById[threadId];
      if (!thread || thread.providerId !== providerId) {
        return false;
      }
      if (snapshot.activeThreadByProvider[providerId] === threadId) {
        return true;
      }
      snapshot = {
        ...snapshot,
        activeThreadByProvider: {
          ...snapshot.activeThreadByProvider,
          [providerId]: threadId,
        },
      };
      notify();
      return true;
    },
    deleteThread(providerId, threadId) {
      const thread = snapshot.threadsById[threadId];
      if (!thread || thread.providerId !== providerId) {
        return false;
      }
      const threadsById = { ...snapshot.threadsById };
      delete threadsById[threadId];
      const order = (snapshot.threadOrderByProvider[providerId] ?? []).filter(
        (id) => id !== threadId
      );
      const activeThreadByProvider = { ...snapshot.activeThreadByProvider };
      if (activeThreadByProvider[providerId] === threadId) {
        if (order[0]) {
          activeThreadByProvider[providerId] = order[0];
        } else {
          delete activeThreadByProvider[providerId];
        }
      }
      snapshot = {
        ...snapshot,
        threadsById,
        threadOrderByProvider: {
          ...snapshot.threadOrderByProvider,
          [providerId]: order,
        },
        activeThreadByProvider,
      };
      notify();
      return true;
    },
    getConversationHistory(providerId, threadId) {
      return projectConversationHistory(snapshot, providerId, threadId);
    },
    getThreadSummaries() {
      return projectThreadSummaries(snapshot);
    },
  };
}

function normalizeSeenKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((key): key is string => typeof key === 'string' && Boolean(key))
    .slice(-MAX_SEEN_ENVELOPES);
}
