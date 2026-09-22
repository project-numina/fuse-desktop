import type { ProviderId } from './agent-events';

/** Picker suggestions, not an allowlist. CLI default and custom IDs remain supported. */
export const MODEL_SUGGESTIONS: Record<ProviderId, string[]> = {
  claude: ['opus', 'sonnet', 'haiku', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  codex: ['gpt-5.6-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
};
