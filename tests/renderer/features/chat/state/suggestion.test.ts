import { describe, expect, it } from 'vitest';
import { extractSuggestion } from '@/features/chat/state/suggestion';

describe('extractSuggestion', () => {
  it('returns trimmed ordinary text', () => {
    expect(extractSuggestion('Here is the plan.\n')).toEqual({ displayText: 'Here is the plan.', suggestion: null });
  });
  it('extracts the final complete suggestion', () => {
    expect(extractSuggestion('<suggest>first</suggest> middle <suggest>second</suggest>')).toEqual({
      displayText: ' middle', suggestion: 'second',
    });
  });
  it('ignores empty suggestions', () => {
    expect(extractSuggestion('text <suggest>   </suggest>')).toEqual({ displayText: 'text', suggestion: null });
  });
  it('strips an unterminated streaming tail', () => {
    expect(extractSuggestion('partial answer <suggest>half')).toEqual({ displayText: 'partial answer', suggestion: null });
  });
});
