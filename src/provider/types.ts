/** @fileoverview Provider abstraction types for CLI-agnostic subprocess spawning. */

import type { StreamEvent } from './stream.ts';

export type ProviderName = 'claude' | 'opencode';

export interface ProviderCommand {
  binary: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpawnOptions {
  message: string;
  sessionId?: string;
  agent: import('../core/types.ts').AgentConfig;
  mcpConfigPath?: string;
  timezone?: string;
}

export interface ProviderModule {
  buildCommand: (options: SpawnOptions) => ProviderCommand;
  parseStreamLine: (line: string) => StreamEvent[];
}
