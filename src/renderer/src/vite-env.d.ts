/// <reference types="vite/client" />

// `highlightjs-lean` ships no type declarations; it resolves to a
// so consumers can import it without a per-site @ts-expect-error.
declare module 'highlightjs-lean' {
  import type { LanguageFn } from 'highlight.js';
  const lean: LanguageFn;
  export default lean;
}
