/** @fileoverview Shared types for the Settings page components. */

import type { PermissionMode } from '../../lib/types.ts';

export interface NewAgentPayload {
  id: string;
  name: string;
  model: string;
  fallbackModel: null;
  maxBudgetUsd: null;
  maxTurns: number;
  permissionMode: PermissionMode;
  systemPrompt: string;
  channels: string[];
}

export interface ConfigEditor {
  readonly editingField: string | null;
  readonly editingSaving: boolean;
  startEdit: (field: string, currentValue: string | number) => void;
  cancelEdit: () => void;
  saveField: (field: string, value: string, transform?: (v: string) => unknown) => Promise<void>;
  toggleField: (field: string, currentValue: boolean) => Promise<void>;
  saveConfigPatch: (patch: Record<string, unknown>) => Promise<boolean>;
}
