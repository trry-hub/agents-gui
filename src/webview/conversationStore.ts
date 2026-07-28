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
  ensureThread(providerId: string, threadId: string, title?: string, updatedAt?: number): void;
  setActiveThread(providerId: string, threadId: string): boolean;
  deleteThread(providerId: string, threadId: string): boolean;
  getConversationHistory(
    providerId: string,
    threadId: string
  ): ReturnType<typeof projectConversationHistory>;
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
      const effectiveEnvelope = filterSeenDeltaSegments(envelope, seen);
      if (!effectiveEnvelope) {
        return false;
      }
      const sequenceKeys = Array.from(
        new Set([...(effectiveEnvelope.coalescedSequences ?? []), effectiveEnvelope.sequence])
      ).map((sequence) => envelopeKey(effectiveEnvelope, sequence));
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

      const next = reduceConversation(snapshot, effectiveEnvelope);
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

function filterSeenDeltaSegments(
  envelope: ThreadEventEnvelope,
  seen: Set<string>
): ThreadEventEnvelope | undefined {
  if (!isDelta(envelope)) {
    return hasSeenSequence(seen, envelope, envelope.sequence) ? undefined : envelope;
  }
  const segments = envelope.deltaSegments ?? [
    { sequence: envelope.sequence, delta: envelope.event.delta },
  ];
  const unseenSegments = segments.filter(
    ({ sequence }) => !hasSeenSequence(seen, envelope, sequence)
  );
  if (unseenSegments.length === 0) {
    return undefined;
  }
  const lastSegment = unseenSegments[unseenSegments.length - 1];
  return {
    ...envelope,
    sequence: lastSegment.sequence,
    coalescedSequences: unseenSegments.map(({ sequence }) => sequence),
    deltaSegments: unseenSegments,
    event: {
      ...envelope.event,
      delta: unseenSegments.map(({ delta }) => delta).join(''),
    },
  };
}

function envelopeKey(envelope: ThreadEventEnvelope, sequence: number): string {
  return [envelope.providerId, envelope.threadId, envelope.streamId ?? 'legacy', sequence].join(
    ':'
  );
}

function hasSeenSequence(
  seen: Set<string>,
  envelope: ThreadEventEnvelope,
  sequence: number
): boolean {
  if (seen.has(envelopeKey(envelope, sequence))) {
    return true;
  }
  return (
    !envelope.streamId && seen.has([envelope.providerId, envelope.threadId, sequence].join(':'))
  );
}

function isDelta(envelope: ThreadEventEnvelope): envelope is ThreadEventEnvelope & {
  event:
    | {
        type: 'item/assistantMessage/delta';
        turnId: string;
        itemId: string;
        delta: string;
      }
    | {
        type: 'item/reasoning/delta';
        turnId: string;
        itemId: string;
        delta: string;
      };
} {
  return (
    envelope.event.type === 'item/assistantMessage/delta' ||
    envelope.event.type === 'item/reasoning/delta'
  );
}
