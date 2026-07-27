import type {
  ThreadEventEnvelope,
  ThreadItem,
  ThreadItemStatus,
  ThreadStatus,
} from '../threadProtocol';

export interface TurnState {
  id: string;
  status: ThreadItemStatus;
  itemOrder: string[];
  itemsById: Record<string, ThreadItem>;
  startedAt: number;
  completedAt?: number;
}

export interface ThreadState {
  id: string;
  providerId: string;
  title: string;
  status: ThreadStatus;
  turnOrder: string[];
  turnsById: Record<string, TurnState>;
  updatedAt: number;
}

export interface ConversationSnapshot {
  version: 2;
  threadsById: Record<string, ThreadState>;
  threadOrderByProvider: Record<string, string[]>;
  activeThreadByProvider: Record<string, string>;
  appliedEnvelopeKeys?: string[];
}

export interface LegacyMessage {
  role?: string;
  text?: string;
  thinking?: string;
  running?: boolean;
  meta?: string;
  attachments?: unknown[];
  startedAt?: number;
  durationMs?: number;
}

export interface LegacyThread {
  id?: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  messages?: LegacyMessage[];
}

export interface ConversationHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface ThreadSummary {
  id: string;
  providerId: string;
  title: string;
  status: ThreadStatus;
  updatedAt: number;
  turnCount: number;
}

export function createEmptyConversationSnapshot(): ConversationSnapshot {
  return {
    version: 2,
    threadsById: {},
    threadOrderByProvider: {},
    activeThreadByProvider: {},
  };
}

export function reduceConversation(
  snapshot: ConversationSnapshot,
  envelope: ThreadEventEnvelope
): ConversationSnapshot {
  const event = envelope.event;
  if (!event || typeof event.type !== 'string') {
    return snapshot;
  }

  if (event.type === 'thread/started') {
    const existing = snapshot.threadsById[envelope.threadId];
    const thread: ThreadState = existing
      ? {
          ...existing,
          providerId: envelope.providerId,
          title: event.thread.title || existing.title,
          status: event.thread.status,
          updatedAt: event.thread.updatedAt,
        }
      : {
          id: envelope.threadId,
          providerId: envelope.providerId,
          title: event.thread.title,
          status: event.thread.status,
          turnOrder: [],
          turnsById: {},
          updatedAt: event.thread.updatedAt,
        };
    return withThread(snapshot, thread, true);
  }

  if (event.type === 'thread/status/changed') {
    const existing = snapshot.threadsById[envelope.threadId];
    if (!existing) {
      return snapshot;
    }
    return withThread(snapshot, { ...existing, status: event.status }, false);
  }

  if (event.type === 'turn/started') {
    const thread = cloneThread(ensureThread(snapshot, envelope));
    const existingTurn = thread.turnsById[event.turn.id];
    thread.turnsById[event.turn.id] = existingTurn
      ? { ...existingTurn, status: event.turn.status, startedAt: event.turn.startedAt }
      : {
          id: event.turn.id,
          status: event.turn.status,
          itemOrder: [],
          itemsById: {},
          startedAt: event.turn.startedAt,
        };
    if (!existingTurn) {
      thread.turnOrder = [...thread.turnOrder, event.turn.id];
    }
    thread.status = 'running';
    thread.updatedAt = event.turn.startedAt;
    return withThread(snapshot, thread, true);
  }

  if (
    event.type === 'item/started' ||
    event.type === 'item/completed' ||
    event.type === 'item/activity/updated'
  ) {
    const item = event.item;
    if (!item?.turnId || !item.id) {
      return snapshot;
    }
    const { thread, turn } = cloneAddress(snapshot, envelope, item.turnId, item.startedAt);
    const existed = Boolean(turn.itemsById[item.id]);
    turn.itemsById[item.id] = item;
    if (!existed) {
      turn.itemOrder = [...turn.itemOrder, item.id];
    }
    thread.turnsById[turn.id] = turn;
    return withThread(snapshot, thread, true);
  }

  if (
    event.type === 'item/assistantMessage/delta' ||
    event.type === 'item/reasoning/delta'
  ) {
    if (!event.turnId || !event.itemId || !event.delta) {
      return snapshot;
    }
    const { thread, turn } = cloneAddress(snapshot, envelope, event.turnId, 0);
    const existing = turn.itemsById[event.itemId];
    const item: ThreadItem = existing
      ? { ...existing, content: `${existing.content ?? ''}${event.delta}` }
      : {
          id: event.itemId,
          turnId: event.turnId,
          type:
            event.type === 'item/reasoning/delta' ? 'reasoning' : 'assistant-message',
          status: 'running',
          content: event.delta,
          startedAt: turn.startedAt,
        };
    turn.itemsById[event.itemId] = item;
    if (!existing) {
      turn.itemOrder = [...turn.itemOrder, event.itemId];
    }
    thread.turnsById[turn.id] = turn;
    return withThread(snapshot, thread, true);
  }

  if (event.type === 'turn/completed') {
    const existingThread = snapshot.threadsById[envelope.threadId];
    const existingTurn = existingThread?.turnsById[event.turnId];
    if (!existingThread || !existingTurn) {
      return snapshot;
    }
    const thread = cloneThread(existingThread);
    const itemsById = { ...existingTurn.itemsById };
    let itemsChanged = false;
    for (const itemId of existingTurn.itemOrder) {
      const item = itemsById[itemId];
      if (item?.status === 'running') {
        itemsById[itemId] = {
          ...item,
          status: event.status,
          completedAt: event.completedAt,
        };
        itemsChanged = true;
      }
    }
    thread.turnsById[event.turnId] = {
      ...existingTurn,
      status: event.status,
      completedAt: event.completedAt,
      itemsById: itemsChanged ? itemsById : existingTurn.itemsById,
    };
    thread.status = event.status;
    thread.updatedAt = event.completedAt;
    return withThread(snapshot, thread, false);
  }

  return snapshot;
}

export function migrateLegacyConversations(
  source: Record<string, LegacyThread[]> | undefined,
  activeThreadByProvider: Record<string, string> = {}
): ConversationSnapshot {
  const snapshot = createEmptyConversationSnapshot();
  snapshot.activeThreadByProvider = { ...activeThreadByProvider };

  for (const [providerId, legacyThreads] of Object.entries(source ?? {})) {
    const order: string[] = [];
    for (const [threadIndex, legacyThread] of (legacyThreads ?? []).entries()) {
      const threadId = clean(legacyThread?.id) || `legacy:${providerId}:${threadIndex}`;
      const createdAt = finiteNumber(legacyThread?.createdAt) ?? 0;
      const updatedAt = finiteNumber(legacyThread?.updatedAt) ?? createdAt;
      const thread: ThreadState = {
        id: threadId,
        providerId,
        title: clean(legacyThread?.title) || 'New session',
        status: 'idle',
        turnOrder: [],
        turnsById: {},
        updatedAt,
      };

      let currentTurn: TurnState | undefined;
      let turnIndex = -1;
      for (const [messageIndex, message] of (legacyThread?.messages ?? []).entries()) {
        if (!message || typeof message !== 'object') {
          continue;
        }
        if (!currentTurn || message.role === 'user') {
          turnIndex += 1;
          const turnId = `legacy:${threadId}:turn:${turnIndex}`;
          currentTurn = {
            id: turnId,
            status: 'completed',
            itemOrder: [],
            itemsById: {},
            startedAt: finiteNumber(message.startedAt) ?? createdAt,
          };
          thread.turnOrder.push(turnId);
          thread.turnsById[turnId] = currentTurn;
        }

        const status: ThreadItemStatus = message.running ? 'stopped' : 'completed';
        if (message.running) {
          currentTurn.status = 'stopped';
          thread.status = 'stopped';
        }
        const type =
          message.role === 'user'
            ? 'user-message'
            : message.role === 'error'
              ? 'system-error'
              : 'assistant-message';
        const itemId = `${currentTurn.id}:message:${messageIndex}`;
        const item: ThreadItem = {
          id: itemId,
          turnId: currentTurn.id,
          type,
          status,
          content: String(message.text ?? ''),
          meta: clean(message.meta) || undefined,
          attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
          startedAt: finiteNumber(message.startedAt) ?? currentTurn.startedAt,
          completedAt: status === 'completed' ? updatedAt : undefined,
        };
        currentTurn.itemOrder.push(itemId);
        currentTurn.itemsById[itemId] = item;

        if (clean(message.thinking)) {
          const reasoningId = `${currentTurn.id}:reasoning:${messageIndex}`;
          currentTurn.itemOrder.push(reasoningId);
          currentTurn.itemsById[reasoningId] = {
            id: reasoningId,
            turnId: currentTurn.id,
            type: 'reasoning',
            status,
            content: message.thinking,
            startedAt: item.startedAt,
            completedAt: item.completedAt,
          };
        }
      }

      if (thread.status === 'idle' && thread.turnOrder.length > 0) {
        thread.status = lastTurn(thread)?.status ?? 'completed';
      }
      snapshot.threadsById[threadId] = thread;
      order.push(threadId);
    }
    snapshot.threadOrderByProvider[providerId] = order;
    if (!snapshot.activeThreadByProvider[providerId] && order[0]) {
      snapshot.activeThreadByProvider[providerId] = order[0];
    }
  }

  return snapshot;
}

export function projectConversationHistory(
  snapshot: ConversationSnapshot,
  providerId: string,
  threadId: string,
  limit = 8
): ConversationHistoryEntry[] {
  const thread = snapshot.threadsById[threadId];
  if (!thread || thread.providerId !== providerId) {
    return [];
  }
  const entries: ConversationHistoryEntry[] = [];
  for (const turnId of thread.turnOrder) {
    const turn = thread.turnsById[turnId];
    for (const itemId of turn?.itemOrder ?? []) {
      const item = turn.itemsById[itemId];
      const role =
        item?.type === 'user-message'
          ? 'user'
          : item?.type === 'assistant-message'
            ? 'assistant'
            : undefined;
      const text = clean(item?.content);
      if (role && item.status === 'completed' && text) {
        entries.push({ role, text });
      }
    }
  }
  return entries.slice(-Math.max(0, limit));
}

export function projectThreadSummaries(snapshot: ConversationSnapshot): ThreadSummary[] {
  const summaries: ThreadSummary[] = [];
  for (const [providerId, threadOrder] of Object.entries(snapshot.threadOrderByProvider)) {
    for (const threadId of threadOrder) {
      const thread = snapshot.threadsById[threadId];
      if (!thread) {
        continue;
      }
      summaries.push({
        id: thread.id,
        providerId,
        title: thread.title,
        status: thread.status,
        updatedAt: thread.updatedAt,
        turnCount: thread.turnOrder.length,
      });
    }
  }
  return summaries;
}

function ensureThread(
  snapshot: ConversationSnapshot,
  envelope: ThreadEventEnvelope
): ThreadState {
  return (
    snapshot.threadsById[envelope.threadId] ?? {
      id: envelope.threadId,
      providerId: envelope.providerId,
      title: 'New session',
      status: 'running',
      turnOrder: [],
      turnsById: {},
      updatedAt: 0,
    }
  );
}

function cloneAddress(
  snapshot: ConversationSnapshot,
  envelope: ThreadEventEnvelope,
  turnId: string,
  startedAt: number
): { thread: ThreadState; turn: TurnState } {
  const thread = cloneThread(ensureThread(snapshot, envelope));
  const existingTurn = thread.turnsById[turnId];
  const turn: TurnState = existingTurn
    ? {
        ...existingTurn,
        itemOrder: existingTurn.itemOrder,
        itemsById: { ...existingTurn.itemsById },
      }
    : {
        id: turnId,
        status: 'running',
        itemOrder: [],
        itemsById: {},
        startedAt,
      };
  if (!existingTurn) {
    thread.turnOrder = [...thread.turnOrder, turnId];
  }
  return { thread, turn };
}

function cloneThread(thread: ThreadState): ThreadState {
  return {
    ...thread,
    turnOrder: thread.turnOrder,
    turnsById: { ...thread.turnsById },
  };
}

function withThread(
  snapshot: ConversationSnapshot,
  thread: ThreadState,
  setActive: boolean
): ConversationSnapshot {
  const currentOrder = snapshot.threadOrderByProvider[thread.providerId] ?? [];
  const order = currentOrder.includes(thread.id)
    ? currentOrder
    : [...currentOrder, thread.id];
  const activeThreadByProvider =
    setActive && !snapshot.activeThreadByProvider[thread.providerId]
      ? { ...snapshot.activeThreadByProvider, [thread.providerId]: thread.id }
      : snapshot.activeThreadByProvider;
  return {
    ...snapshot,
    threadsById: { ...snapshot.threadsById, [thread.id]: thread },
    threadOrderByProvider:
      order === currentOrder
        ? snapshot.threadOrderByProvider
        : { ...snapshot.threadOrderByProvider, [thread.providerId]: order },
    activeThreadByProvider,
  };
}

function lastTurn(thread: ThreadState): TurnState | undefined {
  const turnId = thread.turnOrder.at(-1);
  return turnId ? thread.turnsById[turnId] : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
