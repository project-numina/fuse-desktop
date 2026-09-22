/**
 * Extraction of inline `<suggest>` blocks from agent output.
 *
 * Agents can embed a suggested follow-up message inside a `<suggest>...
 * </suggest>` tag. This module strips that tag from the displayed text and
 * surfaces the suggestion separately so the chat panel can offer it as a
 * one-click reply.
 */

interface ExtractedSuggestion {
  displayText: string;
  suggestion: string | null;
}

export function extractSuggestion(content: string): ExtractedSuggestion {
  let suggestion: string | null = null;
  let displayText = content.replace(
    /<suggest>\s*([\s\S]*?)\s*<\/suggest>/gi,
    (_match, suggestedText: string) => {
      const trimmed = suggestedText.trim();
      if (trimmed) suggestion = trimmed;
      return '';
    },
  );
  displayText = displayText.replace(/<suggest>[\s\S]*$/i, '');
  return {
    displayText: displayText.trimEnd(),
    suggestion,
  };
}
