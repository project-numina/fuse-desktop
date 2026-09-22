import { useParams } from 'react-router-dom';

/**
 * Reads the splat (`*`) route param as a plain file path.
 */
export function useFileParam(): string {
  return useParams()['*'] ?? '';
}
