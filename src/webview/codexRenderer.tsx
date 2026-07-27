import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import {
  compensateScrollOffset,
  computeVirtualRange,
  DEFAULT_TURN_HEIGHT,
  distanceFromBottom,
  isBottomPinned,
  updateMeasuredHeight,
} from './turnVirtualizer';

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
  ensureThread(
    providerId: string,
    threadId: string,
    title?: string,
    updatedAt?: number
  ): void;
  setActiveThread(providerId: string, threadId: string): boolean;
  deleteThread(providerId: string, threadId: string): boolean;
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
  scrollRoot?: HTMLElement;
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
    ensureThread: store.ensureThread,
    setActiveThread: store.setActiveThread,
    deleteThread: store.deleteThread,
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
  scrollRoot,
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
      <VirtualTurnList
        store={store}
        threadId={threadId}
        turnIds={turnIds}
        renderMarkdown={renderMarkdown}
        scrollRoot={scrollRoot}
      />
    </div>
  );
}

export function VirtualTurnList({
  store,
  threadId,
  turnIds,
  renderMarkdown,
  scrollRoot,
}: {
  store: ConversationStore;
  threadId: string;
  turnIds: string[];
  renderMarkdown?: MarkdownRenderer | false;
  scrollRoot?: HTMLElement;
}) {
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const measuredHeightsRef = useRef(measuredHeights);
  const [viewportHeight, setViewportHeight] = useState(
    () => scrollRoot?.clientHeight ?? Number.POSITIVE_INFINITY
  );
  const [scrollOffset, setScrollOffset] = useState(() => scrollRoot?.scrollTop ?? 0);
  const [pinned, setPinned] = useState(() =>
    scrollRoot
      ? isBottomPinned(
          distanceFromBottom({
            scrollHeight: scrollRoot.scrollHeight,
            scrollTop: scrollRoot.scrollTop,
            clientHeight: scrollRoot.clientHeight,
          })
        )
      : true
  );
  const pinnedRef = useRef(pinned);
  const bottomDistanceByThread = useRef(new Map<string, number>());

  useEffect(() => {
    measuredHeightsRef.current = measuredHeights;
  }, [measuredHeights]);

  useEffect(() => {
    if (!scrollRoot) {
      return;
    }
    const syncViewport = () => {
      const distance = distanceFromBottom({
        scrollHeight: scrollRoot.scrollHeight,
        scrollTop: scrollRoot.scrollTop,
        clientHeight: scrollRoot.clientHeight,
      });
      const nextPinned = isBottomPinned(distance);
      pinnedRef.current = nextPinned;
      setPinned(nextPinned);
      setScrollOffset(scrollRoot.scrollTop);
      setViewportHeight(scrollRoot.clientHeight);
      bottomDistanceByThread.current.set(threadId, distance);
    };
    syncViewport();
    scrollRoot.addEventListener('scroll', syncViewport, { passive: true });
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(syncViewport)
        : undefined;
    observer?.observe(scrollRoot);
    return () => {
      scrollRoot.removeEventListener('scroll', syncViewport);
      observer?.disconnect();
    };
  }, [scrollRoot, threadId]);

  useEffect(() => {
    if (!scrollRoot) {
      return;
    }
    const savedDistance = bottomDistanceByThread.current.get(threadId) ?? 0;
    const frame = window.requestAnimationFrame(() => {
      scrollRoot.scrollTop = Math.max(
        0,
        scrollRoot.scrollHeight - scrollRoot.clientHeight - savedDistance
      );
    });
    return () => {
      bottomDistanceByThread.current.set(
        threadId,
        distanceFromBottom({
          scrollHeight: scrollRoot.scrollHeight,
          scrollTop: scrollRoot.scrollTop,
          clientHeight: scrollRoot.clientHeight,
        })
      );
      window.cancelAnimationFrame(frame);
    };
  }, [scrollRoot, threadId]);

  const range = useMemo(
    () =>
      computeVirtualRange({
        turnIds,
        measuredHeights,
        viewportHeight,
        scrollOffset,
      }),
    [measuredHeights, scrollOffset, turnIds, viewportHeight]
  );

  const measureTurn = useCallback(
    (turnId: string, turnIndex: number, nextHeight: number) => {
      const currentHeights = measuredHeightsRef.current;
      const previousHeight = currentHeights[turnId] ?? DEFAULT_TURN_HEIGHT;
      const nextHeights = updateMeasuredHeight(currentHeights, turnId, nextHeight);
      if (nextHeights === currentHeights) {
        return;
      }
      measuredHeightsRef.current = nextHeights;
      setMeasuredHeights(nextHeights);

      if (!scrollRoot) {
        return;
      }
      if (pinnedRef.current) {
        window.requestAnimationFrame(() => {
          scrollRoot.scrollTop = scrollRoot.scrollHeight;
        });
        return;
      }
      scrollRoot.scrollTop = compensateScrollOffset({
        scrollTop: scrollRoot.scrollTop,
        anchorIndex: range.start,
        changedIndex: turnIndex,
        previousHeight,
        nextHeight,
      });
    },
    [range.start, scrollRoot]
  );

  const visibleTurnIds =
    range.end >= range.start ? turnIds.slice(range.start, range.end + 1) : [];

  return (
    <>
      {range.before > 0 ? (
        <div
          className="conversation-virtual-spacer is-before"
          style={{ height: range.before }}
          aria-hidden="true"
        />
      ) : null}
      {visibleTurnIds.map((turnId, visibleIndex) => {
        const turnIndex = range.start + visibleIndex;
        return (
          <MeasuredTurn
            key={turnId}
            turnId={turnId}
            turnIndex={turnIndex}
            onMeasure={measureTurn}
          >
            <TurnSubscriber
              store={store}
              threadId={threadId}
              turnId={turnId}
              renderMarkdown={renderMarkdown}
            />
          </MeasuredTurn>
        );
      })}
      {range.after > 0 ? (
        <div
          className="conversation-virtual-spacer is-after"
          style={{ height: range.after }}
          aria-hidden="true"
        />
      ) : null}
      {!pinned && scrollRoot ? (
        <button
          type="button"
          className="conversation-scroll-bottom"
          aria-label="Scroll to bottom"
          onClick={() => {
            scrollRoot.scrollTop = scrollRoot.scrollHeight;
          }}
        >
          ↓
        </button>
      ) : null}
    </>
  );
}

function MeasuredTurn({
  turnId,
  turnIndex,
  onMeasure,
  children,
}: {
  turnId: string;
  turnIndex: number;
  onMeasure(turnId: string, turnIndex: number, height: number): void;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    const measure = () => onMeasure(turnId, turnIndex, element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver !== 'function') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onMeasure, turnId, turnIndex]);

  return (
    <div className="conversation-turn-measure" data-virtual-turn-id={turnId} ref={elementRef}>
      {children}
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
  ensureThread(
    providerId: string,
    threadId: string,
    title?: string,
    updatedAt?: number
  ): void;
  setActiveThread(providerId: string, threadId: string): boolean;
  deleteThread(providerId: string, threadId: string): boolean;
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
    if (
      mountedRenderer.options.providerId === providerId &&
      mountedRenderer.options.threadId === threadId
    ) {
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
  ensureThread(providerId, threadId, title, updatedAt) {
    mountedRenderer?.controller.ensureThread(providerId, threadId, title, updatedAt);
  },
  setActiveThread(providerId, threadId) {
    return mountedRenderer?.controller.setActiveThread(providerId, threadId) ?? false;
  },
  deleteThread(providerId, threadId) {
    return mountedRenderer?.controller.deleteThread(providerId, threadId) ?? false;
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
        scrollRoot={options.container}
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
