import type { ThreadEventEnvelope } from '../threadProtocol';

type FrameHandle = number;
type RequestFrame = (callback: (time: number) => void) => FrameHandle;
type CancelFrame = (handle: FrameHandle) => void;

export interface DeltaSchedulerOptions {
  dispatch(envelope: ThreadEventEnvelope): void;
  requestFrame: RequestFrame;
  cancelFrame: CancelFrame;
  isHidden(): boolean;
}

export interface DeltaScheduler {
  schedule(envelope: ThreadEventEnvelope): void;
  flush(): void;
  dispose(): void;
}

export function createDeltaScheduler(options: DeltaSchedulerOptions): DeltaScheduler {
  const pending = new Map<string, ThreadEventEnvelope>();
  let frameHandle: FrameHandle | undefined;
  let disposed = false;

  function dispatchPending(): void {
    const envelopes = Array.from(pending.values());
    pending.clear();
    for (const envelope of envelopes) {
      options.dispatch(envelope);
    }
  }

  function cancelScheduledFrame(): void {
    if (frameHandle === undefined) {
      return;
    }
    options.cancelFrame(frameHandle);
    frameHandle = undefined;
  }

  function flush(): void {
    cancelScheduledFrame();
    dispatchPending();
  }

  function requestFlush(): void {
    if (frameHandle !== undefined) {
      return;
    }
    frameHandle = options.requestFrame(() => {
      frameHandle = undefined;
      dispatchPending();
    });
  }

  return {
    schedule(envelope) {
      if (disposed) {
        return;
      }
      if (!isDelta(envelope)) {
        if (isCompletion(envelope)) {
          flush();
        }
        options.dispatch(envelope);
        return;
      }
      if (options.isHidden()) {
        flush();
        options.dispatch(envelope);
        return;
      }

      const key = deltaKey(envelope);
      const existing = pending.get(key);
      if (existing && isDelta(existing)) {
        pending.set(key, {
          ...envelope,
          event: {
            ...envelope.event,
            delta: `${existing.event.delta}${envelope.event.delta}`,
          },
        });
      } else {
        pending.set(key, envelope);
      }
      requestFlush();
    },
    flush,
    dispose() {
      if (disposed) {
        return;
      }
      flush();
      disposed = true;
    },
  };
}

function isDelta(
  envelope: ThreadEventEnvelope
): envelope is ThreadEventEnvelope & {
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

function isCompletion(envelope: ThreadEventEnvelope): boolean {
  return (
    envelope.event.type === 'item/completed' ||
    envelope.event.type === 'turn/completed'
  );
}

function deltaKey(envelope: ThreadEventEnvelope & { event: { turnId: string; itemId: string } }): string {
  return [
    envelope.providerId,
    envelope.threadId,
    envelope.event.turnId,
    envelope.event.itemId,
    envelope.event.type,
  ].join(':');
}

