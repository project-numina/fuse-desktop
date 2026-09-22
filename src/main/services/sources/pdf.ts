/**
 * PDF validation for uploads. pdf.js (already shipped for the renderer's
 * viewer) parses the page tree in the main process so corrupt or
 * mislabelled bytes are rejected at upload time, as the web does with
 * PyMuPDF.
 *
 * The main process has no Web Worker, so pdf.js falls back to running the
 * worker code in-thread. Left to itself it would ``import('./pdf.worker.mjs')``
 * next to its own file — a path that exists in node_modules but not in the
 * bundled ``out/main`` — so the worker module is imported here through the
 * bundler and handed over on ``globalThis.pdfjsWorker``, the hook pdf.js
 * checks before resolving that path.
 */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJs> | null = null;

async function importPdfJs(): Promise<PdfJs> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return pdfjs;
}

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = importPdfJs().catch((error: unknown) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

export const PDF_UNREADABLE_DETAIL = 'Could not read PDF file. It may be corrupt or not a PDF.';

/** Total page count; throws when the bytes are not a parseable PDF. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await loadPdfJs();
  // pdf.js keeps a reference to the buffer it is handed; copy so callers can
  // reuse their view, and disable everything that would reach for a worker,
  // fonts or eval in the main process.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    return document.numPages;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Validate a PDF upload for parseability; resolves to the same bytes. */
export async function validatePdfUpload(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    await pdfPageCount(bytes);
  } catch {
    throw new Error(PDF_UNREADABLE_DETAIL);
  }
  return bytes;
}
