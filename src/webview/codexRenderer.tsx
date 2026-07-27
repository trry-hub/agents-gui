import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useSyncExternalStore,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ThreadEventEnvelope } from '../threadProtocol';
import type {
  ConversationSnapshot,
  LegacyThread,
  TurnState,
} from './conversationReducer';
import {
  createConversationStore,
  type ConversationStore,
} from './conversationStore';
import { createDeltaScheduler } from './deltaScheduler';
import { createPersistenceCoordinator } from './persistenceCoordinator';
import {
  TurnView,
  type MarkdownRenderer,
} from './threadItems';

const EMPTY_TURN_IDS: string[] = [];

export interface CodexRendererControllerOptions {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
  persist(snapshot: ConversationSnapshot): void;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export interface CodexRendererController {
  store: ConversationStore;
  dispatch(envelope: ThreadEventEnvelope): void;
  hydrate(snapshot: ConversationSnapshot): void;
  hydrateLegacy(
    threadsByProvider: Record<string, LegacyThread[]> | undefined,
    activeThreadByProvider?: Record<string, string>
  ): void;
  getConversationHistory(
    providerId: string,
    threadId: string
  ): ReturnType<ConversationStore['getConversationHistory']>;
  getThreadSummaries(): ReturnType<ConversationStore['getThreadSummaries']>;
  serialize(): ConversationSnapshot;
  onThreadSwitch(): void;
  onHidden(): void;
  dispose(): void;
}

export interface ConversationRootProps {
  store: ConversationStore;
  providerId: string;
  threadId: string;
  renderMarkdown?: MarkdownRenderer | false;
}

export function createCodexRendererController(
  options: CodexRendererControllerOptions
): CodexRendererController {
  const store = createConversationStore();
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const persistence = createPersistenceCoordinator({
    getSnapshot: store.getSnapshot,
    persist: options.persist,
    now: options.now,
    setTimer,
    clearTimer,
    checkpointMs: 500,
  });
  const scheduler = createDeltaScheduler({
    dispatch: (envelope) => {
      store.dispatch(envelope);
    },
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
    isHidden: options.isHidden,
  });

  return {
    store,
    dispatch(envelope) {
      scheduler.schedule(envelope);
      persistence.onEvent(envelope);
    },
    hydrate: store.hydrate,
    hydrateLegacy: store.hydrateLegacy,
    getConversationHistory: store.getConversationHistory,
    getThreadSummaries: store.getThreadSummaries,
    serialize: store.getSnapshot,
    onThreadSwitch: persistence.onThreadSwitch,
    onHidden: persistence.onHidden,
    dispose() {
      scheduler.dispose();
      persistence.dispose();
    },
  };
}

export function ConversationRoot({
  store,
  providerId,
  threadId,
  renderMarkdown,
}: ConversationRootProps) {
  const turnIds = useStoreSelection(
    store,
    useCallback(
      (snapshot: ConversationSnapshot) => {
        const thread = snapshot.threadsById[threadId];
        return thread?.providerId === providerId ? thread.turnOrder : EMPTY_TURN_IDS;
      },
      [providerId, threadId]
    )
  );

  return (
    <div
      className="conversation-thread"
      data-provider-id={providerId}
      data-thread-id={threadId}
    >
      {turnIds.map((turnId) => (
        <TurnSubscriber
          key={turnId}
          store={store}
          threadId={threadId}
          turnId={turnId}
          renderMarkdown={renderMarkdown}
        />
      ))}
    </div>
  );
}

function TurnSubscriber({
  store,
  threadId,
  turnId,
  renderMarkdown,
}: {
  store: ConversationStore;
  threadId: string;
  turnId: string;
  renderMarkdown?: MarkdownRenderer | false;
}) {
  const turn = useStoreSelection(
    store,
    useCallback(
      (snapshot: ConversationSnapshot): TurnState | undefined =>
        snapshot.threadsById[threadId]?.turnsById[turnId],
      [threadId, turnId]
    )
  );
  return turn ? <TurnView turn={turn} renderMarkdown={renderMarkdown} /> : null;
}

function useStoreSelection<T>(
  store: ConversationStore,
  selector: (snapshot: ConversationSnapshot) => T
): T {
  const getSelection = useCallback(() => selector(store.getSnapshot()), [selector, store]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

interface RendererErrorBoundaryProps {
  children: ReactNode;
  onDisable?: () => void;
}

interface RendererErrorBoundaryState {
  error?: Error;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[CodexRenderer] transcript render failed', {
      name: error.name,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <section className="codex-renderer-error" role="alert">
          <strong>Conversation renderer unavailable</strong>
          <p>Reload with the experimental renderer disabled.</p>
          {this.props.onDisable ? (
            <button type="button" onClick={this.props.onDisable}>
              Use legacy renderer
            </button>
          ) : null}
        </section>
      );
    }
    return this.props.children;
  }
}

export interface MountCodexRendererOptions {
  container: HTMLElement;
  providerId: string;
  threadId: string;
  legacyThreads?: Record<string, LegacyThread[]>;
  activeThreadByProvider?: Record<string, string>;
  snapshot?: ConversationSnapshot;
  renderMarkdown?: MarkdownRenderer | false;
  persist(snapshot: ConversationSnapshot): void;
  onDisable?: () => void;
}

interface MountedRenderer {
  root: Root;
  controller: CodexRendererController;
  options: MountCodexRendererOptions;
}

export interface CodexRendererGlobalApi {
  mount(options: MountCodexRendererOptions): void;
  dispatch(envelope: ThreadEventEnvelope): void;
  setActiveContext(providerId: string, threadId: string): void;
  getConversationHistory(providerId: string, threadId: string): ReturnType<
    ConversationStore['getConversationHistory']
  >;
  getThreadSummaries(): ReturnType<ConversationStore['getThreadSummaries']>;
  serialize(): ConversationSnapshot | undefined;
  onHidden(): void;
  dispose(): void;
}

let mountedRenderer: MountedRenderer | undefined;

export const codexRendererApi: CodexRendererGlobalApi = {
  mount(options) {
    mountedRenderer?.controller.dispose();
    mountedRenderer?.root.unmount();
    const controller = createCodexRendererController({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      isHidden: () => document.hidden,
      persist: options.persist,
    });
    if (options.snapshot?.version === 2) {
      controller.hydrate(options.snapshot);
    } else {
      controller.hydrateLegacy(options.legacyThreads, options.activeThreadByProvider);
    }
    const root = createRoot(options.container, {
      onCaughtError(error, info) {
        console.error('[CodexRenderer] caught render error', {
          name: error instanceof Error ? error.name : 'UnknownError',
          componentStack: info.componentStack,
        });
      },
    });
    mountedRenderer = { root, controller, options };
    renderMountedRenderer();
  },
  dispatch(envelope) {
    mountedRenderer?.controller.dispatch(envelope);
  },
  setActiveContext(providerId, threadId) {
    if (!mountedRenderer) {
      return;
    }
    mountedRenderer.options.providerId = providerId;
    mountedRenderer.options.threadId = threadId;
    mountedRenderer.controller.onThreadSwitch();
    renderMountedRenderer();
  },
  getConversationHistory(providerId, threadId) {
    return (
      mountedRenderer?.controller.getConversationHistory(providerId, threadId) ?? []
    );
  },
  getThreadSummaries() {
    return mountedRenderer?.controller.getThreadSummaries() ?? [];
  },
  serialize() {
    return mountedRenderer?.controller.serialize();
  },
  onHidden() {
    mountedRenderer?.controller.onHidden();
  },
  dispose() {
    mountedRenderer?.controller.dispose();
    mountedRenderer?.root.unmount();
    mountedRenderer = undefined;
  },
};

function renderMountedRenderer(): void {
  if (!mountedRenderer) {
    return;
  }
  const { controller, options, root } = mountedRenderer;
  root.render(
    <RendererErrorBoundary onDisable={options.onDisable}>
      <ConversationRoot
        store={controller.store}
        providerId={options.providerId}
        threadId={options.threadId}
        renderMarkdown={options.renderMarkdown}
      />
    </RendererErrorBoundary>
  );
}

if (typeof window !== 'undefined') {
  (
    window as typeof window & {
      AgentsGuiCodexRenderer?: CodexRendererGlobalApi;
    }
  ).AgentsGuiCodexRenderer = codexRendererApi;
}

