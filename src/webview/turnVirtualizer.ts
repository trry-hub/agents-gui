export const DEFAULT_TURN_HEIGHT = 280;
export const VIRTUALIZATION_THRESHOLD = 30;
export const DEFAULT_OVERSCAN = 6;
export const BOTTOM_PIN_THRESHOLD = 24;

export interface VirtualRangeOptions {
  turnIds: string[];
  measuredHeights: Record<string, number>;
  viewportHeight: number;
  scrollOffset: number;
  estimatedHeight?: number;
  threshold?: number;
  overscan?: number;
}

export interface VirtualRange {
  start: number;
  end: number;
  firstVisible: number;
  before: number;
  after: number;
  total: number;
}

export function computeVirtualRange(options: VirtualRangeOptions): VirtualRange {
  const {
    turnIds,
    measuredHeights,
    viewportHeight,
    scrollOffset,
    estimatedHeight = DEFAULT_TURN_HEIGHT,
    threshold = VIRTUALIZATION_THRESHOLD,
    overscan = DEFAULT_OVERSCAN,
  } = options;
  if (turnIds.length === 0) {
    return {
      start: 0,
      end: -1,
      firstVisible: 0,
      before: 0,
      after: 0,
      total: 0,
    };
  }

  const offsets = buildOffsets(turnIds, measuredHeights, estimatedHeight);
  const total = offsets[offsets.length - 1];
  if (turnIds.length <= threshold || !Number.isFinite(viewportHeight)) {
    return {
      start: 0,
      end: turnIds.length - 1,
      firstVisible: 0,
      before: 0,
      after: 0,
      total,
    };
  }

  const safeScrollOffset = clamp(scrollOffset, 0, Math.max(0, total));
  const viewportEnd = safeScrollOffset + Math.max(0, viewportHeight);
  const firstVisible = firstBottomAfter(offsets, safeScrollOffset);
  const lastVisible = Math.max(firstVisible, firstOffsetAtOrAfter(offsets, viewportEnd) - 1);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(turnIds.length - 1, lastVisible + overscan);
  return {
    start,
    end,
    firstVisible,
    before: offsets[start],
    after: Math.max(0, total - offsets[end + 1]),
    total,
  };
}

export function updateMeasuredHeight(
  measuredHeights: Record<string, number>,
  turnId: string,
  height: number
): Record<string, number> {
  const normalized = Math.max(1, Number(height) || DEFAULT_TURN_HEIGHT);
  const previous = measuredHeights[turnId];
  if (Number.isFinite(previous) && Math.abs(previous - normalized) < 0.5) {
    return measuredHeights;
  }
  return { ...measuredHeights, [turnId]: normalized };
}

export function distanceFromBottom(options: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): number {
  return Math.max(0, options.scrollHeight - options.scrollTop - options.clientHeight);
}

export function isBottomPinned(distance: number): boolean {
  return Math.max(0, distance) <= BOTTOM_PIN_THRESHOLD;
}

export function compensateScrollOffset(options: {
  scrollTop: number;
  anchorIndex: number;
  changedIndex: number;
  previousHeight: number;
  nextHeight: number;
}): number {
  if (options.changedIndex >= options.anchorIndex) {
    return options.scrollTop;
  }
  return Math.max(0, options.scrollTop + options.nextHeight - options.previousHeight);
}

function buildOffsets(
  turnIds: string[],
  measuredHeights: Record<string, number>,
  estimatedHeight: number
): number[] {
  const offsets = [0];
  for (const turnId of turnIds) {
    const measured = measuredHeights[turnId];
    const height = Number.isFinite(measured) && measured > 0 ? measured : estimatedHeight;
    offsets.push(offsets[offsets.length - 1] + height);
  }
  return offsets;
}

function firstBottomAfter(offsets: number[], target: number): number {
  let low = 1;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] > target) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return Math.max(0, low - 1);
}

function firstOffsetAtOrAfter(offsets: number[], target: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] >= target) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
