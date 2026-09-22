import { describe, expect, it } from 'vitest';
import { assistantTurnId } from '@main/services/sessions/turn-id';

describe('assistantTurnId', () => {
  it('names the first assistant row of the first turn', () => {
    expect(assistantTurnId([{ role: 'user' }])).toBe('turn-0:assistant-0');
  });

  it('counts assistant rows within a turn and restarts per user turn', () => {
    const messages = [{ role: 'user' as const }, { role: 'agent' as const }, { role: 'agent' as const }];
    expect(assistantTurnId(messages)).toBe('turn-0:assistant-2');
    expect(assistantTurnId([...messages, { role: 'user' }])).toBe('turn-3:assistant-0');
    expect(assistantTurnId([...messages, { role: 'user' }, { role: 'agent' }])).toBe('turn-3:assistant-1');
  });

  it('uses turn-agent ids when no user message precedes the assistant', () => {
    expect(assistantTurnId([])).toBe('turn-agent-0:assistant-0');
    expect(assistantTurnId([{ role: 'agent' }])).toBe('turn-agent-0:assistant-1');
    expect(assistantTurnId([{ role: 'agent' }, { role: 'agent' }, { role: 'user' }])).toBe('turn-2:assistant-0');
  });

  it('adds the streaming block offset', () => {
    expect(assistantTurnId([{ role: 'user' }, { role: 'agent' }], 1)).toBe('turn-0:assistant-2');
  });
});
