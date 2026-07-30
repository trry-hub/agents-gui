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

export const CONVERSATION_LIMITS = Object.freeze({
  maxThreadsPerProvider: 100,
  maxTurnsPerThread: 100,
  maxItemsPerTurn: 100,
  maxItemContentChars: 200_000,
  maxTitleChars: 500,
  maxAttachmentsPerItem: 8,
  maxPersistedBytes: 4 * 1024 * 1024,
});

function boundText(
  value: unknown,
  maxChars: number = CONVERSATION_LIMITS.maxItemContentChars
): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function boundActivity(activity: ThreadItem['activity']): ThreadItem['activity'] {
  if (!activity || typeof activity !== 'object') {
    return undefined;
  }
  return {
    kind: ['file', 'search', 'command', 'tool'].includes(activity.kind) ? activity.kind : 'tool',
    id: activity.id === undefined ? undefined : boundText(activity.id, 256),
    name: activity.name === undefined ? undefined : boundText(activity.name, 512),
    target: activity.target === undefined ? undefined : boundText(activity.target, 2_048),
    detail: activity.detail === undefined ? undefined : boundText(activity.detail, 4_096),
  };
}

function boundAttachments(attachments: unknown): unknown[] | undefined {
  if (!Array.isArray(attachments)) {
    return undefined;
  }
  return attachments
    .filter((attachment) => attachment && typeof attachment === 'object')
    .slice(0, CONVERSATION_LIMITS.maxAttachmentsPerItem)
    .map((attachment) => {
      const value = attachment as Record<string, unknown>;
      return {
        kind: boundText(value.kind, 32),
        name: boundText(value.name, 256),
        mimeType: boundText(value.mimeType, 128),
        size: Number.isFinite(Number(value.size)) ? Number(value.size) : 0,
        path: boundText(value.path, 2_048),
      };
    });
}

function boundItem(item: ThreadItem): ThreadItem {
  return {
    id: boundText(item.id, 512),
    turnId: boundText(item.turnId, 512),
    type: item.type,
    status: item.status,
    content:
      item.content === undefined
        ? undefined
        : boundText(item.content, CONVERSATION_LIMITS.maxItemContentChars),
    label: item.label === undefined ? undefined : boundText(item.label, 1_000),
    meta: item.meta === undefined ? undefined : boundText(item.meta, 2_000),
    attachments: boundAttachments(item.attachments),
    choices: Array.isArray(item.choices)
      ? item.choices.slice(0, 20).map((choice) => ({
          label: boundText(choice?.label, 512),
          prompt: boundText(choice?.prompt, 2_048),
        }))
      : undefined,
    activity: boundActivity(item.activity),
    startedAt: Number.isFinite(Number(item.startedAt)) ? Number(item.startedAt) : 0,
    completedAt:
      item.completedAt === undefined || !Number.isFinite(Number(item.completedAt))
        ? undefined
        : Number(item.completedAt),
  };
}

export function createEmptyConversationSnapshot(): ConversationSnapshot {
  return {
    version: 2,
    threadsById: {},
    threadOrderByProvider: {},
    activeThreadByProvider: {},
  };
}

export function boundConversationSnapshot(source: ConversationSnapshot): ConversationSnapshot {
  if (!source || source.version !== 2) {
    return createEmptyConversationSnapshot();
  }
  const bounded = createEmptyConversationSnapshot();
  bounded.appliedEnvelopeKeys = Array.isArray(source.appliedEnvelopeKeys)
    ? source.appliedEnvelopeKeys
        .filter((key): key is string => typeof key === 'string')
        .slice(-4096)
        .map((key) => boundText(key, 512))
    : undefined;

  for (const [providerId, sourceOrder] of Object.entries(source.threadOrderByProvider ?? {})) {
    if (!providerId || providerId.length > 128) {
      continue;
    }
    const order = (Array.isArray(sourceOrder) ? sourceOrder : [])
      .filter(
        (threadId) =>
          typeof threadId === 'string' &&
          threadId.length <= 512 &&
          Boolean(source.threadsById?.[threadId])
      )
      .slice(-CONVERSATION_LIMITS.maxThreadsPerProvider);
    bounded.threadOrderByProvider[providerId] = [];
    for (const threadId of order) {
      const sourceThread = source.threadsById[threadId];
      if (!sourceThread) continue;
      const turnOrder = sourceThread.turnOrder
        .filter(
          (turnId) =>
            typeof turnId === 'string' &&
            turnId.length <= 512 &&
            Boolean(sourceThread.turnsById[turnId])
        )
        .slice(-CONVERSATION_LIMITS.maxTurnsPerThread);
      const turnsById: Record<string, TurnState> = {};
      for (const turnId of turnOrder) {
        const sourceTurn = sourceThread.turnsById[turnId];
        const itemOrder = sourceTurn.itemOrder
          .filter(
            (itemId) =>
              typeof itemId === 'string' &&
              itemId.length <= 512 &&
              Boolean(sourceTurn.itemsById[itemId])
          )
          .slice(-CONVERSATION_LIMITS.maxItemsPerTurn);
        const itemsById: Record<string, ThreadItem> = {};
        for (const itemId of itemOrder) {
          itemsById[itemId] = boundItem(sourceTurn.itemsById[itemId]);
        }
        turnsById[turnId] = {
          ...sourceTurn,
          itemOrder,
          itemsById,
        };
      }
      bounded.threadsById[threadId] = {
        ...sourceThread,
        title: boundText(sourceThread.title, CONVERSATION_LIMITS.maxTitleChars),
        turnOrder,
        turnsById,
      };
      bounded.threadOrderByProvider[providerId].push(threadId);
    }
    const activeThreadId = source.activeThreadByProvider?.[providerId];
    if (activeThreadId && bounded.threadsById[activeThreadId]) {
      bounded.activeThreadByProvider[providerId] = activeThreadId;
    } else if (bounded.threadOrderByProvider[providerId][0]) {
      bounded.activeThreadByProvider[providerId] = bounded.threadOrderByProvider[providerId][0];
    }
  }

  enforceSnapshotByteBudget(bounded);
  return bounded;
}

export function reduceConversation(
  snapshot: ConversationSnapshot,
  envelope: ThreadEventEnvelope
): ConversationSnapshot {
  const event = envelope.event;
  if (
    !event ||
    typeof event.type !== 'string' ||
    !isBoundedIdentifier(envelope.providerId, 128) ||
    !isBoundedIdentifier(envelope.threadId, 512) ||
    (envelope.streamId !== undefined && !isBoundedIdentifier(envelope.streamId, 128))
  ) {
    return snapshot;
  }

  if (event.type === 'thread/started') {
    const existing = snapshot.threadsById[envelope.threadId];
    const thread: ThreadState = existing
      ? {
          ...existing,
          providerId: envelope.providerId,
          title:
            existing.turnOrder.length > 0
              ? existing.title
              : boundText(event.thread.title || existing.title, CONVERSATION_LIMITS.maxTitleChars),
          status: event.thread.status,
          updatedAt: event.thread.updatedAt,
        }
      : {
          id: envelope.threadId,
          providerId: envelope.providerId,
          title: boundText(event.thread.title, CONVERSATION_LIMITS.maxTitleChars),
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
    if (!isBoundedIdentifier(event.turn.id, 512)) {
      return snapshot;
    }
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
      trimTurns(thread);
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
    if (!isBoundedIdentifier(item?.turnId, 512) || !isBoundedIdentifier(item?.id, 512)) {
      return snapshot;
    }
    const { thread, turn } = cloneAddress(snapshot, envelope, item.turnId, item.startedAt);
    const existed = Boolean(turn.itemsById[item.id]);
    turn.itemsById[item.id] = boundItem(item);
    if (!existed) {
      turn.itemOrder = [...turn.itemOrder, item.id];
      trimItems(turn);
    }
    thread.turnsById[turn.id] = turn;
    return withThread(snapshot, thread, true);
  }

  if (event.type === 'item/assistantMessage/delta' || event.type === 'item/reasoning/delta') {
    if (
      !isBoundedIdentifier(event.turnId, 512) ||
      !isBoundedIdentifier(event.itemId, 512) ||
      !event.delta
    ) {
      return snapshot;
    }
    const { thread, turn } = cloneAddress(snapshot, envelope, event.turnId, 0);
    const existing = turn.itemsById[event.itemId];
    const item: ThreadItem = existing
      ? {
          ...existing,
          content: boundText(
            `${existing.content ?? ''}${event.delta}`,
            CONVERSATION_LIMITS.maxItemContentChars
          ),
        }
      : {
          id: event.itemId,
          turnId: event.turnId,
          type: event.type === 'item/reasoning/delta' ? 'reasoning' : 'assistant-message',
          status: 'running',
          content: boundText(event.delta, CONVERSATION_LIMITS.maxItemContentChars),
          startedAt: turn.startedAt,
        };
    turn.itemsById[event.itemId] = item;
    if (!existing) {
      turn.itemOrder = [...turn.itemOrder, event.itemId];
      trimItems(turn);
    }
    thread.turnsById[turn.id] = turn;
    return withThread(snapshot, thread, true);
  }

  if (event.type === 'turn/completed') {
    if (!isBoundedIdentifier(event.turnId, 512)) {
      return snapshot;
    }
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
              : message.role === 'system'
                ? 'system-message'
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

  return boundConversationSnapshot(snapshot);
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

export function projectLegacyThreads(
  snapshot: ConversationSnapshot
): Record<string, LegacyThread[]> {
  const projected: Record<string, LegacyThread[]> = {};
  for (const [providerId, threadOrder] of Object.entries(snapshot.threadOrderByProvider)) {
    projected[providerId] = threadOrder.flatMap((threadId) => {
      const thread = snapshot.threadsById[threadId];
      if (!thread || thread.providerId !== providerId) {
        return [];
      }
      const messages: LegacyMessage[] = [];
      for (const turnId of thread.turnOrder) {
        const turn = thread.turnsById[turnId];
        let lastAssistant: LegacyMessage | undefined;
        for (const itemId of turn?.itemOrder ?? []) {
          const item = turn.itemsById[itemId];
          if (!item) {
            continue;
          }
          const running = item.status === 'running';
          if (item.type === 'reasoning') {
            if (lastAssistant) {
              lastAssistant.thinking = [lastAssistant.thinking, item.content]
                .map(clean)
                .filter(Boolean)
                .join('\n');
            }
            continue;
          }
          const role =
            item.type === 'user-message'
              ? 'user'
              : item.type === 'assistant-message'
                ? 'assistant'
                : item.type === 'system-error'
                  ? 'error'
                  : 'system';
          const message: LegacyMessage = {
            role,
            text: item.content ?? item.label ?? '',
            running,
            meta: item.meta,
            attachments: item.attachments,
            startedAt: item.startedAt,
            durationMs:
              item.completedAt === undefined
                ? undefined
                : Math.max(0, item.completedAt - item.startedAt),
          };
          messages.push(message);
          lastAssistant = role === 'assistant' ? message : undefined;
        }
      }
      return [
        {
          id: thread.id,
          title: thread.title,
          createdAt:
            thread.turnOrder
              .map((turnId) => thread.turnsById[turnId]?.startedAt)
              .find((value): value is number => Number.isFinite(value)) ?? thread.updatedAt,
          updatedAt: thread.updatedAt,
          messages,
        },
      ];
    });
  }
  return projected;
}

function ensureThread(snapshot: ConversationSnapshot, envelope: ThreadEventEnvelope): ThreadState {
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

function trimTurns(thread: ThreadState): void {
  if (thread.turnOrder.length <= CONVERSATION_LIMITS.maxTurnsPerThread) {
    return;
  }
  const removed = thread.turnOrder.slice(
    0,
    thread.turnOrder.length - CONVERSATION_LIMITS.maxTurnsPerThread
  );
  thread.turnOrder = thread.turnOrder.slice(-CONVERSATION_LIMITS.maxTurnsPerThread);
  for (const turnId of removed) {
    delete thread.turnsById[turnId];
  }
}

function trimItems(turn: TurnState): void {
  if (turn.itemOrder.length <= CONVERSATION_LIMITS.maxItemsPerTurn) {
    return;
  }
  const removed = turn.itemOrder.slice(
    0,
    turn.itemOrder.length - CONVERSATION_LIMITS.maxItemsPerTurn
  );
  turn.itemOrder = turn.itemOrder.slice(-CONVERSATION_LIMITS.maxItemsPerTurn);
  for (const itemId of removed) {
    delete turn.itemsById[itemId];
  }
}

function snapshotByteLength(snapshot: ConversationSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}

function enforceSnapshotByteBudget(snapshot: ConversationSnapshot): void {
  while (snapshotByteLength(snapshot) > CONVERSATION_LIMITS.maxPersistedBytes) {
    const providerWithExtraThread = Object.entries(snapshot.threadOrderByProvider).find(
      ([, order]) => order.length > 1
    );
    if (providerWithExtraThread) {
      const [providerId, order] = providerWithExtraThread;
      const removed = order.shift();
      if (removed) delete snapshot.threadsById[removed];
      if (snapshot.activeThreadByProvider[providerId] === removed) {
        snapshot.activeThreadByProvider[providerId] = order[0];
      }
      continue;
    }

    const allThreadEntries = Object.entries(snapshot.threadOrderByProvider).flatMap(
      ([providerId, order]) => order.map((threadId) => ({ providerId, threadId }))
    );
    if (allThreadEntries.length > 1) {
      const { providerId, threadId } = allThreadEntries[0];
      snapshot.threadOrderByProvider[providerId] = snapshot.threadOrderByProvider[
        providerId
      ].filter((id) => id !== threadId);
      delete snapshot.threadsById[threadId];
      if (snapshot.activeThreadByProvider[providerId] === threadId) {
        const replacement = snapshot.threadOrderByProvider[providerId][0];
        if (replacement) {
          snapshot.activeThreadByProvider[providerId] = replacement;
        } else {
          delete snapshot.activeThreadByProvider[providerId];
        }
      }
      continue;
    }

    const threadWithExtraTurn = Object.values(snapshot.threadsById).find(
      (thread) => thread.turnOrder.length > 1
    );
    if (threadWithExtraTurn) {
      const removed = threadWithExtraTurn.turnOrder.shift();
      if (removed) delete threadWithExtraTurn.turnsById[removed];
      continue;
    }

    const turnWithExtraItem = Object.values(snapshot.threadsById)
      .flatMap((thread) => Object.values(thread.turnsById))
      .find((turn) => turn.itemOrder.length > 1);
    if (turnWithExtraItem) {
      const removed = turnWithExtraItem.itemOrder.shift();
      if (removed) delete turnWithExtraItem.itemsById[removed];
      continue;
    }

    const finalItem = Object.values(snapshot.threadsById)
      .flatMap((thread) => Object.values(thread.turnsById))
      .flatMap((turn) => Object.values(turn.itemsById))[0];
    if (finalItem) {
      finalItem.content = '';
      finalItem.meta = undefined;
      finalItem.label = undefined;
      finalItem.attachments = undefined;
      finalItem.choices = undefined;
      finalItem.activity = undefined;
      snapshot.appliedEnvelopeKeys = [];
      if (snapshotByteLength(snapshot) <= CONVERSATION_LIMITS.maxPersistedBytes) {
        break;
      }
    }

    snapshot.threadsById = {};
    snapshot.threadOrderByProvider = {};
    snapshot.activeThreadByProvider = {};
    snapshot.appliedEnvelopeKeys = [];
    break;
  }
}

function withThread(
  snapshot: ConversationSnapshot,
  thread: ThreadState,
  setActive: boolean
): ConversationSnapshot {
  const currentOrder = snapshot.threadOrderByProvider[thread.providerId] ?? [];
  const order = (
    currentOrder.includes(thread.id) ? currentOrder : [...currentOrder, thread.id]
  ).slice(-CONVERSATION_LIMITS.maxThreadsPerProvider);
  const activeThreadByProvider =
    setActive && !snapshot.activeThreadByProvider[thread.providerId]
      ? { ...snapshot.activeThreadByProvider, [thread.providerId]: thread.id }
      : snapshot.activeThreadByProvider;
  return {
    ...snapshot,
    threadsById: Object.fromEntries(
      Object.entries({ ...snapshot.threadsById, [thread.id]: thread }).filter(
        ([threadId, candidate]) =>
          candidate.providerId !== thread.providerId || order.includes(threadId)
      )
    ),
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

function isBoundedIdentifier(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars;
}
