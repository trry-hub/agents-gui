import { memo, useEffect, useRef } from 'react';
import type { ThreadItem } from '../threadProtocol';
import type { TurnState } from './conversationReducer';

export type MarkdownRenderer = (container: HTMLElement, item: ThreadItem) => void;

export interface ThreadItemRendererProps {
  item: ThreadItem;
  renderMarkdown?: MarkdownRenderer | false;
}

export interface TurnViewProps {
  turn: TurnState;
  renderMarkdown?: MarkdownRenderer | false;
}

export const ThreadItemRenderer = memo(function ThreadItemRenderer({
  item,
  renderMarkdown,
}: ThreadItemRendererProps) {
  switch (item.type) {
    case 'user-message':
      return <MessageItem item={item} role="user" renderMarkdown={renderMarkdown} />;
    case 'assistant-message':
      return <MessageItem item={item} role="assistant" renderMarkdown={renderMarkdown} />;
    case 'reasoning':
      return <ReasoningItem item={item} />;
    case 'command-execution':
      return <ActivityItem item={item} kind="command" />;
    case 'file-change':
    case 'turn-diff':
      return <ActivityItem item={item} kind="file" />;
    case 'mcp-tool-call':
      return <ActivityItem item={item} kind="tool" />;
    case 'approval-request':
      return <ApprovalItem item={item} />;
    case 'system-error':
      return <ErrorItem item={item} />;
    case 'proposed-plan':
    case 'todo-list':
      return <StructuredTextItem item={item} renderMarkdown={renderMarkdown} />;
  }
});

export const TurnView = memo(function TurnView({ turn, renderMarkdown }: TurnViewProps) {
  return (
    <section
      className={`conversation-turn is-${turn.status}`}
      data-turn-id={turn.id}
      data-turn-status={turn.status}
    >
      {turn.itemOrder.map((itemId) => {
        const item = turn.itemsById[itemId];
        return item ? (
          <ThreadItemRenderer key={item.id} item={item} renderMarkdown={renderMarkdown} />
        ) : null;
      })}
    </section>
  );
});

function MessageItem({
  item,
  role,
  renderMarkdown,
}: {
  item: ThreadItem;
  role: 'user' | 'assistant';
  renderMarkdown?: MarkdownRenderer | false;
}) {
  return (
    <article
      className={`message ${role}${item.status === 'running' ? ' is-running' : ''}`}
      data-item-id={item.id}
      data-item-type={item.type}
    >
      <div className="message-bubble">
        {item.meta ? <div className="message-meta">{item.meta}</div> : null}
        <MarkdownContent item={item} renderMarkdown={renderMarkdown} />
        {item.status === 'running' ? (
          <div className="message-status is-running" aria-live="polite">
            <span className="message-spinner" aria-hidden="true" />
            <span className="message-status-label">Working</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MarkdownContent({
  item,
  renderMarkdown,
}: {
  item: ThreadItem;
  renderMarkdown?: MarkdownRenderer | false;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof renderMarkdown !== 'function' || !containerRef.current) {
      return;
    }
    containerRef.current.replaceChildren();
    renderMarkdown(containerRef.current, item);
  }, [item, renderMarkdown]);

  return (
    <div className="message-content" ref={containerRef}>
      {renderMarkdown === false || typeof renderMarkdown !== 'function'
        ? item.content ?? ''
        : null}
    </div>
  );
}

function ReasoningItem({ item }: { item: ThreadItem }) {
  return (
    <details
      className="message-thinking"
      data-item-id={item.id}
      data-item-type={item.type}
    >
      <summary className="message-thinking-summary">
        <span className="message-thinking-label">
          {item.status === 'running' ? 'Thinking' : 'Reasoning'}
        </span>
      </summary>
      <div className="message-thinking-content">{item.content ?? ''}</div>
    </details>
  );
}

function ActivityItem({
  item,
  kind,
}: {
  item: ThreadItem;
  kind: 'command' | 'file' | 'tool';
}) {
  return (
    <article
      className={`thread-activity thread-activity-${kind}`}
      data-item-id={item.id}
      data-item-type={item.type}
      data-item-status={item.status}
    >
      <span className="thread-activity-label">{item.label ?? item.activity?.name ?? kind}</span>
      {item.content || item.activity?.detail ? (
        <pre className="thread-activity-detail">
          {item.content ?? item.activity?.detail}
        </pre>
      ) : null}
    </article>
  );
}

function ApprovalItem({ item }: { item: ThreadItem }) {
  return (
    <section
      className="claude-approval-panel"
      data-item-id={item.id}
      data-item-type={item.type}
    >
      <div className="claude-approval-title">{item.content ?? item.label}</div>
      <div className="message-choice-actions" role="group" aria-label="Approval choices">
        {(item.choices ?? []).map((choice) => (
          <button
            key={`${choice.label}:${choice.prompt}`}
            type="button"
            className="message-choice-button"
            data-claude-approval-prompt={choice.prompt}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ErrorItem({ item }: { item: ThreadItem }) {
  return (
    <article
      className="message error"
      data-item-id={item.id}
      data-item-type={item.type}
      role="alert"
    >
      <div className="message-bubble">
        <div className="message-content">{item.content ?? item.label}</div>
      </div>
    </article>
  );
}

function StructuredTextItem({
  item,
  renderMarkdown,
}: {
  item: ThreadItem;
  renderMarkdown?: MarkdownRenderer | false;
}) {
  return (
    <article
      className={`thread-structured-item thread-${item.type}`}
      data-item-id={item.id}
      data-item-type={item.type}
    >
      {item.label ? <h3>{item.label}</h3> : null}
      <MarkdownContent item={item} renderMarkdown={renderMarkdown} />
    </article>
  );
}

