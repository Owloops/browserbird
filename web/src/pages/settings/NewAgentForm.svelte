<script lang="ts">
  import type { PermissionMode } from '../../lib/types.ts';
  import { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } from '../../lib/types.ts';
  import type { NewAgentPayload } from './types.ts';

  interface Props {
    onsave: (agent: NewAgentPayload) => Promise<boolean>;
    oncancel: () => void;
  }

  let { onsave, oncancel }: Props = $props();

  let newAgent: {
    name: string;
    model: string;
    maxTurns: string;
    permissionMode: PermissionMode;
    systemPrompt: string;
    channels: string;
  } = $state({
    name: '',
    model: '',
    maxTurns: '50',
    permissionMode: DEFAULT_PERMISSION_MODE,
    systemPrompt: '',
    channels: '*',
  });

  function slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async function handleSave(): Promise<void> {
    const id = slugify(newAgent.name) || 'agent';
    const channels = newAgent.channels
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const agent: NewAgentPayload = {
      id,
      name: newAgent.name,
      model: newAgent.model,
      fallbackModel: null,
      maxBudgetUsd: null,
      maxTurns: Number(newAgent.maxTurns) || 50,
      permissionMode: newAgent.permissionMode,
      systemPrompt:
        newAgent.systemPrompt ||
        'You are responding in a Slack workspace. Be concise, helpful, and natural.',
      channels: channels.length > 0 ? channels : ['*'],
    };
    const ok = await onsave(agent);
    if (ok) {
      newAgent = {
        name: '',
        model: '',
        maxTurns: '50',
        permissionMode: DEFAULT_PERMISSION_MODE,
        systemPrompt: '',
        channels: '*',
      };
    }
  }
</script>

<div class="agent-card agent-card-new">
  <div class="agent-bar agent-bar-new"></div>
  <div class="agent-top">
    <span class="agent-name" style="color: var(--color-accent)">New Agent</span>
    <button class="btn btn-outline btn-sm" onclick={oncancel}>Cancel</button>
  </div>
  <div class="new-agent-form">
    <div class="form-row">
      <label class="form-lbl" for="new-agent-name">Name</label>
      <input
        id="new-agent-name"
        class="form-field"
        type="text"
        bind:value={newAgent.name}
        placeholder="Agent name"
      />
    </div>
    <div class="form-row">
      <label class="form-lbl" for="new-agent-model">Model</label>
      <input
        id="new-agent-model"
        class="form-field mono"
        type="text"
        bind:value={newAgent.model}
        placeholder="sonnet"
      />
    </div>
    <div class="form-row">
      <label class="form-lbl" for="new-agent-turns">Max Turns</label>
      <input
        id="new-agent-turns"
        class="form-field mono"
        type="text"
        bind:value={newAgent.maxTurns}
        placeholder="50"
      />
    </div>
    <div class="form-row">
      <label class="form-lbl" for="new-agent-channels">Channels</label>
      <input
        id="new-agent-channels"
        class="form-field mono"
        type="text"
        bind:value={newAgent.channels}
        placeholder="* (comma-separated)"
      />
    </div>
    <div class="form-row">
      <label class="form-lbl" for="new-agent-permission">Permissions</label>
      <select
        id="new-agent-permission"
        class="form-field mono"
        bind:value={newAgent.permissionMode}
      >
        {#each PERMISSION_MODES as mode (mode)}
          <option value={mode}>{mode}</option>
        {/each}
      </select>
    </div>
    <div class="form-row form-row-full">
      <label class="form-lbl" for="new-agent-prompt">System Prompt</label>
      <textarea
        id="new-agent-prompt"
        class="form-field form-field-textarea"
        bind:value={newAgent.systemPrompt}
        placeholder="Optional system prompt"
      ></textarea>
    </div>
    <div class="form-row form-row-actions">
      <button
        class="btn btn-primary btn-sm"
        disabled={!newAgent.name.trim() || !newAgent.model.trim()}
        onclick={handleSave}>Create Agent</button
      >
    </div>
  </div>
</div>

<style>
  .agent-card {
    position: relative;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-3);
  }

  .agent-card-new {
    border-color: rgba(62, 201, 122, 0.2);
  }

  .agent-bar {
    height: 2px;
  }

  .agent-bar-new {
    background: linear-gradient(90deg, var(--color-success), transparent);
  }

  .agent-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    gap: var(--space-2);
  }

  .agent-name {
    font-size: var(--text-base);
    font-weight: 600;
  }

  .new-agent-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2-5) var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-row-full {
    grid-column: 1 / -1;
  }

  .form-row-actions {
    grid-column: 1 / -1;
    align-items: flex-end;
  }

  .form-lbl {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .form-field {
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
  }

  .form-field:focus {
    outline: none;
    border-color: var(--color-accent-dim);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.15);
  }

  .form-field-textarea {
    resize: none;
    height: 5rem;
    line-height: 1.5;
  }

  @media (max-width: 640px) {
    .agent-top {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
    }

    .new-agent-form {
      grid-template-columns: 1fr;
    }
  }
</style>
