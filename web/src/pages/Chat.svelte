<script lang="ts">
  import type {
    ChatStreamEvent,
    ChatStreamChunk,
    ChatTaskUpdate,
    SessionDetail,
  } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { onChatStream } from '../lib/sse.ts';

  interface ChatMessage {
    role: 'user' | 'agent';
    text: string;
    timestamp: number;
  }

  interface TaskState {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'complete' | 'error';
    details?: string;
    output?: string;
  }

  interface Props {
    initialSessionUid?: string;
  }

  let { initialSessionUid }: Props = $props();

  let sessionUid: string | null = $state(null);
  let threadId: string | null = $state(null);
  let messages: ChatMessage[] = $state([]);
  let historyLoaded = $state(false);
  let tasks: Map<string, TaskState> = $state(new Map());
  let planTitle: string | null = $state(null);
  let streaming = $state(false);
  let statusText = $state('');
  let inputText = $state('');
  let sending = $state(false);
  let error: string | null = $state(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let msgListEl: HTMLDivElement | undefined = $state();
  let userScrolledUp = $state(false);

  const canSend = $derived(historyLoaded && !sending && !streaming && inputText.trim().length > 0);

  function appendToAgent(content: string): void {
    const last = messages[messages.length - 1];
    if (last && last.role === 'agent') {
      messages[messages.length - 1] = { ...last, text: last.text + content };
    } else {
      messages = [...messages, { role: 'agent', text: content, timestamp: Date.now() }];
    }
  }

  function scrollToBottom(): void {
    if (msgListEl && !userScrolledUp) {
      msgListEl.scrollTop = msgListEl.scrollHeight;
    }
  }

  function handleScroll(): void {
    if (!msgListEl) return;
    const threshold = 80;
    const atBottom =
      msgListEl.scrollHeight - msgListEl.scrollTop - msgListEl.clientHeight < threshold;
    userScrolledUp = !atBottom;
  }

  function jumpToBottom(): void {
    userScrolledUp = false;
    scrollToBottom();
  }

  $effect(() => {
    if (messages.length > 0 || streaming) {
      scrollToBottom();
    }
  });

  $effect(() => {
    return () => {
      if (errorTimer) clearTimeout(errorTimer);
    };
  });

  $effect(() => {
    const uid = initialSessionUid;
    if (!uid) {
      historyLoaded = true;
      return;
    }
    const ac = new AbortController();
    api<SessionDetail>(`/api/sessions/${uid}?perPage=1000`)
      .then((detail) => {
        if (ac.signal.aborted) return;
        sessionUid = detail.session.uid;
        threadId = detail.session.thread_id;
        messages = detail.messages.items
          .filter((m) => m.content)
          .map((m) => ({
            role: m.direction === 'in' ? ('user' as const) : ('agent' as const),
            text: m.content!,
            timestamp: new Date(m.created_at).getTime(),
          }));
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) historyLoaded = true;
      });
    return () => ac.abort();
  });

  $effect(() => {
    const unsubscribe = onChatStream((event: ChatStreamEvent) => {
      if (event.sessionUid !== threadId) return;

      switch (event.subtype) {
        case 'append': {
          streaming = true;
          if (event.markdownText) {
            appendToAgent(event.markdownText);
          }
          if (event.chunks) {
            processChunks(event.chunks);
          }
          break;
        }
        case 'stop':
          streaming = false;
          statusText = '';
          if (event.chunks) {
            processChunks(event.chunks);
          }
          break;
        case 'message':
          if (event.text) {
            messages = [...messages, { role: 'agent', text: event.text, timestamp: Date.now() }];
          }
          break;
        case 'status':
          statusText = event.status ?? '';
          break;
        case 'image':
          if (event.imageData) {
            const fname = event.imageFilename ?? '';
            const ext = fname.endsWith('.jpg') || fname.endsWith('.jpeg') ? 'jpeg' : 'png';
            const src = `data:image/${ext};base64,${event.imageData}`;
            appendToAgent(`\n\n![${event.imageFilename ?? 'screenshot'}](${src})\n`);
          }
          break;
        case 'error':
          streaming = false;
          statusText = '';
          showError(event.text ?? 'An error occurred');
          break;
      }
    });

    return unsubscribe;
  });

  function processChunks(chunks: ChatStreamChunk[]): void {
    let tasksChanged = false;
    for (const chunk of chunks) {
      if (chunk.type === 'task_update') {
        const t = chunk as ChatTaskUpdate;
        tasks.set(t.id, {
          id: t.id,
          title: t.title,
          status: t.status,
          details: t.details,
          output: t.output,
        });
        tasksChanged = true;
      } else if (chunk.type === 'plan_update') {
        planTitle = chunk.title;
      }
    }
    if (tasksChanged) tasks = new Map(tasks);
  }

  function showError(msg: string): void {
    if (errorTimer) clearTimeout(errorTimer);
    error = msg;
    errorTimer = setTimeout(() => {
      error = null;
      errorTimer = null;
    }, 5000);
  }

  function clearError(): void {
    error = null;
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
  }

  async function sendMessage(): Promise<void> {
    const text = inputText.trim();
    if (!text || sending || streaming) return;

    clearError();
    sending = true;
    messages = [...messages, { role: 'user', text, timestamp: Date.now() }];
    inputText = '';
    tasks = new Map();
    planTitle = null;

    try {
      const result = await api<{ threadId: string }>('/api/chat/send', {
        method: 'POST',
        body: { sessionUid, message: text },
      });
      if (!threadId) {
        threadId = result.threadId;
        history.replaceState(null, '', `#/session-detail?id=${result.threadId}`);
      }
      streaming = true;
    } catch (err) {
      showError((err as Error).message);
      streaming = false;
    } finally {
      sending = false;
    }
  }

  async function stopSession(): Promise<void> {
    if (!sessionUid && !threadId) return;
    try {
      await api('/api/chat/stop', {
        method: 'POST',
        body: sessionUid ? { sessionUid } : { channelId: 'web', threadId },
      });
    } catch {
      /* best-effort */
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const activeTasks = $derived(
    [...tasks.values()].filter((t) => t.status === 'in_progress' || t.status === 'pending'),
  );
  const completedTasks = $derived(
    [...tasks.values()].filter((t) => t.status === 'complete' || t.status === 'error'),
  );

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderText(text: string): string {
    const escaped = escapeHtml(text);
    const parts: string[] = [];
    let remaining = escaped;

    while (remaining.length > 0) {
      const codeStart = remaining.indexOf('```');
      if (codeStart === -1) {
        parts.push(renderInline(remaining));
        break;
      }

      if (codeStart > 0) {
        parts.push(renderInline(remaining.slice(0, codeStart)));
      }

      const afterFence = remaining.slice(codeStart + 3);
      const codeEnd = afterFence.indexOf('```');
      if (codeEnd === -1) {
        parts.push(renderInline(remaining.slice(codeStart)));
        break;
      }

      const codeContent = afterFence.slice(0, codeEnd);
      const newlineIdx = codeContent.indexOf('\n');
      const code = newlineIdx === -1 ? codeContent : codeContent.slice(newlineIdx + 1);
      parts.push(`<pre class="code-block"><code>${code}</code></pre>`);
      remaining = afterFence.slice(codeEnd + 3);
    }

    return parts.join('');
  }

  function renderInline(text: string): string {
    return text
      .replace(/`([^`]+)`/g, '<code class="code-inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  }
</script>

<div class="chat-container">
  <div class="msg-list" bind:this={msgListEl} onscroll={handleScroll}>
    {#if !historyLoaded}
      <div class="empty-state">
        <p>Loading...</p>
      </div>
    {:else if messages.length === 0}
      <div class="empty-state">
        <p>Send a message to start a conversation with the agent.</p>
      </div>
    {/if}

    {#each messages as msg, i (i)}
      <div class="msg" class:msg-user={msg.role === 'user'} class:msg-agent={msg.role === 'agent'}>
        <div class="msg-bubble">
          {#if msg.role === 'user'}
            <div class="msg-text">{msg.text}</div>
          {:else}
            <div class="msg-text">{@html renderText(msg.text)}</div>
          {/if}
        </div>
      </div>
    {/each}

    {#if tasks.size > 0}
      <div class="task-list">
        {#if planTitle}
          <div class="plan-header">{planTitle}</div>
        {/if}
        {#each activeTasks as task}
          <div class="task-item task-active">
            <span class="task-spinner"></span>
            <span class="task-title">{task.title}</span>
          </div>
        {/each}
        {#each completedTasks as task}
          <div class="task-item" class:task-error={task.status === 'error'}>
            <svg
              class="task-icon-svg"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              {#if task.status === 'complete'}
                <polyline points="3 8 6.5 11.5 13 5" />
              {:else}
                <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
              {/if}
            </svg>
            <span class="task-title">{task.title}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if streaming}
      <div class="streaming-indicator">
        <span class="streaming-dot"></span>
        <span class="streaming-label">{statusText || 'Thinking...'}</span>
      </div>
    {/if}
  </div>

  {#if userScrolledUp}
    <button class="scroll-to-bottom" onclick={jumpToBottom} aria-label="Scroll to bottom">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  {/if}

  {#if error}
    <div class="chat-error">
      <span>{error}</span>
      <button class="error-dismiss" onclick={clearError}>Dismiss</button>
    </div>
  {/if}

  <div class="chat-input-area">
    <textarea
      class="chat-input"
      bind:value={inputText}
      onkeydown={handleKeydown}
      placeholder="Send a message..."
      rows="1"
      disabled={streaming || sending || !historyLoaded}
    ></textarea>
    {#if streaming}
      <button class="btn btn-sm btn-danger chat-send-btn" onclick={stopSession}>Stop</button>
    {:else}
      <button
        class="btn btn-sm btn-primary chat-send-btn"
        onclick={() => void sendMessage()}
        disabled={!canSend}>Send</button
      >
    {/if}
  </div>
</div>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 800px;
    margin: 0 auto;
    position: relative;
  }

  .msg-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .msg {
    display: flex;
    flex-direction: column;
  }

  .msg-user {
    align-items: flex-end;
  }

  .msg-agent {
    align-items: flex-start;
  }

  .msg-bubble {
    max-width: 85%;
    padding: var(--space-2-5) var(--space-3);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    line-height: 1.6;
    word-break: break-word;
  }

  .msg-user .msg-bubble {
    background: var(--color-accent);
    color: var(--color-bg-deep);
    border-bottom-right-radius: var(--radius-sm);
  }

  .msg-agent .msg-bubble {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    border-bottom-left-radius: var(--radius-sm);
  }

  .msg-text {
    white-space: pre-wrap;
  }

  .msg-text :global(.code-block) {
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2-5) var(--space-3);
    margin: var(--space-2) 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre;
  }

  .msg-text :global(.code-inline) {
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 1px 4px;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  .msg-user .msg-text :global(.code-block),
  .msg-user .msg-text :global(.code-inline) {
    background: color-mix(in srgb, var(--color-accent) 80%, black);
    border-color: transparent;
  }

  .task-list {
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    font-size: var(--text-sm);
    align-self: flex-start;
    max-width: 85%;
  }

  .plan-header {
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-1-5);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    color: var(--color-text-muted);
  }

  .task-active {
    color: var(--color-text-secondary);
  }

  .task-error {
    color: var(--color-error);
  }

  .task-icon-svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .task-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .streaming-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    animation: pulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .streaming-label {
    font-style: italic;
  }

  .scroll-to-bottom {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--color-text-muted);
    box-shadow: var(--shadow-sm);
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
  }

  .scroll-to-bottom:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-secondary);
  }

  .chat-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2);
  }

  .error-dismiss {
    background: none;
    border: none;
    color: var(--color-error);
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: 500;
    padding: 0 var(--space-1);
    text-decoration: underline;
  }

  .chat-input-area {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .chat-input {
    flex: 1;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2-5) var(--space-3);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    line-height: 1.5;
    resize: none;
    min-height: 40px;
    max-height: 200px;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .chat-input:focus {
    border-color: var(--color-accent);
  }

  .chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-send-btn {
    flex-shrink: 0;
    min-width: 60px;
    height: 40px;
  }

  @media (max-width: 768px) {
    .chat-container {
      height: 100%;
    }
  }
</style>
