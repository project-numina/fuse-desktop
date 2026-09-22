/**
 * pdfjs-dist ships no types for its worker bundle; the main process only
 * needs the message handler it exports (see pdf.ts).
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
