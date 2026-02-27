<script lang="ts">
  import type { ConfigResponse } from '../../lib/types.ts';
  import type { ConfigEditor, NewAgentPayload } from './types.ts';
  import { showConfirm } from '../../lib/confirm.svelte.ts';
  import AgentCard from './AgentCard.svelte';
  import NewAgentForm from './NewAgentForm.svelte';

  interface Props {
    config: ConfigResponse;
    editor: ConfigEditor;
  }

  let { config, editor }: Props = $props();

  let addingAgent = $state(false);

  async function saveAgentField(
    index: number,
    field: string,
    value: string,
    transform?: (v: string) => unknown,
  ): Promise<void> {
    const agents = config.agents.map((a) => ({ ...a }));
    const agent = agents[index];
    if (!agent) return;
    const resolved = transform ? transform(value) : value;
    (agent as Record<string, unknown>)[field] = resolved;
    const ok = await editor.saveConfigPatch({ agents });
    if (ok) editor.cancelEdit();
  }

  async function deleteAgent(index: number): Promise<void> {
    if (config.agents.length <= 1) return;
    const agent = config.agents[index];
    if (!agent) return;
    const confirmed = await showConfirm(`Delete agent "${agent.name}"?`);
    if (!confirmed) return;
    const agents = config.agents.filter((_, i) => i !== index);
    await editor.saveConfigPatch({ agents });
  }

  async function addAgent(agent: NewAgentPayload): Promise<boolean> {
    const agents = [...config.agents, agent];
    const ok = await editor.saveConfigPatch({ agents });
    if (ok) addingAgent = false;
    return ok;
  }
</script>

<div class="section">
  <div class="section-header">
    <h2 class="section-title">Agents</h2>
    {#if !addingAgent}
      <button
        class="btn btn-outline btn-sm"
        onclick={() => {
          addingAgent = true;
        }}>Add Agent</button
      >
    {/if}
  </div>
  {#each config.agents as agent, index (agent.id)}
    <AgentCard
      {agent}
      {index}
      agentCount={config.agents.length}
      {editor}
      onsavefield={(field, value, transform) => saveAgentField(index, field, value, transform)}
      ondelete={() => deleteAgent(index)}
    />
  {/each}
  {#if addingAgent}
    <NewAgentForm
      onsave={addAgent}
      oncancel={() => {
        addingAgent = false;
      }}
    />
  {/if}
</div>
