export type ThreadStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
export type ThreadItemStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type ThreadItemType =
  | 'user-message'
  | 'assistant-message'
  | 'reasoning'
  | 'command-execution'
  | 'file-change'
  | 'turn-diff'
  | 'proposed-plan'
  | 'todo-list'
  | 'mcp-tool-call'
  | 'approval-request'
  | 'system-error';

export interface ThreadDescriptor {
  id: string;
  providerId: string;
  title: string;
  status: ThreadStatus;
  updatedAt: number;
}

export interface TurnDescriptor {
  id: string;
  status: ThreadItemStatus;
  startedAt: number;
}

export interface ThreadActivity {
  id?: string;
  kind: 'file' | 'search' | 'command' | 'tool';
  name?: string;
  target?: string;
  detail?: string;
}

export interface ThreadItem {
  id: string;
  turnId: string;
  type: ThreadItemType;
  status: ThreadItemStatus;
  content?: string;
  label?: string;
  meta?: string;
  attachments?: unknown[];
  choices?: Array<{ label: string; prompt: string }>;
  activity?: ThreadActivity;
  startedAt: number;
  completedAt?: number;
}

export type ThreadEvent =
  | { type: 'thread/started'; thread: ThreadDescriptor }
  | { type: 'turn/started'; turn: TurnDescriptor }
  | { type: 'item/started'; item: ThreadItem }
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
    }
  | {
      type: 'item/activity/updated';
      turnId: string;
      itemId: string;
      item: ThreadItem;
      activity: ThreadActivity;
    }
  | { type: 'item/completed'; item: ThreadItem }
  | {
      type: 'turn/completed';
      turnId: string;
      status: Exclude<ThreadItemStatus, 'running'>;
      completedAt: number;
    }
  | { type: 'thread/status/changed'; status: ThreadStatus };

export interface ThreadEventEnvelope {
  command: 'threadEvent';
  providerId: string;
  threadId: string;
  sequence: number;
  coalescedSequences?: number[];
  event: ThreadEvent;
}
