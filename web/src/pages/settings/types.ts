/** @fileoverview Shared types for the Settings page components. */

export interface NewAgentPayload {
  id: string;
  name: string;
  model: string;
  fallbackModel: null;
  maxTurns: number;
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
