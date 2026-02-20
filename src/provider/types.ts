/** @fileoverview Provider abstraction types for CLI-agnostic subprocess spawning. */

import type { StreamEvent } from './stream.ts';

export type ProviderName = 'claude';

export interface ProviderCommand {
  binary: string;
  args: string[];
}

export interface SpawnOptions {
  message: string;
  sessionId?: string;
  agent: import('../core/types.ts').AgentConfig;
  mcpConfigPath?: string;
}

export interface ProviderModule {
  buildCommand: (options: SpawnOptions) => ProviderCommand;
  parseStreamLine: (line: string) => StreamEvent | null;
}
