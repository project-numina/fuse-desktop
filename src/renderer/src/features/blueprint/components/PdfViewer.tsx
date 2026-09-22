/** App-styled PDF.js viewer used by blueprint source previews. */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { cn } from '@/lib/utils';

// Keep the worker same-origin so the production CSP does not need to allow
// blob or data scripts. The query also prevents stale worker MIME metadata.
const workerQuerySeparator = PdfWorker.includes('?') ? '&' : '?';
GlobalWorkerOptions.workerSrc = `${PdfWorker}${workerQuerySeparator}v=javascript-mime`;

const PDF_HORIZONTAL_PADDING = 48;
const PDF_MAX_WIDTH = 800;
const PAGE_INDICATOR_DURATION = 1500;
const DEFAULT_PAGE_ASPECT_RATIO = 4 / 3;
const VIRTUAL_PAGE_ROOT_MARGIN = '100% 0px';

export interface PdfViewerProps {
  url: string;
  title: string;
}

interface PdfPageProps {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}

function useNearViewport(
  pageRef: RefObject<HTMLDivElement | null>,
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const pageElement = pageRef.current;
    if (!pageElement) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      entries => setNearViewport(entries[0]?.isIntersecting ?? false),
      { root: scrollRef.current, rootMargin: VIRTUAL_PAGE_ROOT_MARGIN },
    );
    observer.observe(pageElement);
    return () => observer.disconnect();
  }, [pageRef, scrollRef]);

  return nearViewport;
}

function PdfPageComponent({ pdfDocument, pageNumber, width, scrollRef }: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nearViewport = useNearViewport(pageRef, scrollRef);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_PAGE_ASPECT_RATIO);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!nearViewport) return undefined;
    let active = true;
    let pdfPage: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    let canvas: HTMLCanvasElement | null = null;
    setFailed(false);

    void pdfDocument.getPage(pageNumber).then((page) => {
      if (!active || !canvasRef.current) return;
      pdfPage = page;
      const initialViewport = page.getViewport({ scale: 1 });
      setAspectRatio(initialViewport.height / initialViewport.width);
      const viewport = page.getViewport({ scale: width / initialViewport.width });
      const outputScale = window.devicePixelRatio || 1;
      canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable');

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1
          ? undefined
          : [outputScale, 0, 0, outputScale, 0, 0],
      });
      return renderTask.promise;
    }).catch(() => {
      if (!active) return;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      pdfPage?.cleanup();
      setFailed(true);
    });

    return () => {
      active = false;
      renderTask?.cancel();
      pdfPage?.cleanup();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [nearViewport, pageNumber, pdfDocument, width]);

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      className="mb-4 flex items-center justify-center overflow-hidden bg-white shadow-[var(--numina-shadow)] last:mb-0"
      style={{ width, minHeight: Math.round(width * aspectRatio) }}
    >
      {failed ? (
        <p className="m-0 text-sm text-gray-500">Page {pageNumber} is unavailable.</p>
      ) : nearViewport ? (
        <canvas ref={canvasRef} className="block max-w-full" aria-label={`Page ${pageNumber}`} />
      ) : null}
    </div>
  );
}

const PdfPage = memo(PdfPageComponent);

export default function PdfViewer({ url, title }: PdfViewerProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showPageIndicator, setShowPageIndicator] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorTimer = useRef<number | null>(null);
  const scrollFrame = useRef(0);

  const clearIndicatorTimer = useCallback(() => {
    if (indicatorTimer.current === null) return;
    window.clearTimeout(indicatorTimer.current);
    indicatorTimer.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    setPdfDocument(null);
    setCurrentPage(1);
    setLoading(true);
    setLoadFailed(false);
    setShowPageIndicator(false);
    clearIndicatorTimer();
    window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = 0;

    const loadingTask = getDocument({ url, withCredentials: true });
    void loadingTask.promise.then((loadedPdfDocument) => {
      if (!active) return;
      setPdfDocument(loadedPdfDocument);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoadFailed(true);
      setLoading(false);
    });

    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [clearIndicatorTimer, url]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;
    let frame = 0;
    const updateWidth = () => {
      const availableWidth = scrollElement.clientWidth - PDF_HORIZONTAL_PADDING;
      setPageWidth(Math.max(1, Math.min(Math.floor(availableWidth), PDF_MAX_WIDTH)));
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateWidth);
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleUpdate);
    observer?.observe(scrollElement);
    window.addEventListener('resize', scheduleUpdate);
    updateWidth();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      observer?.disconnect();
    };
  }, []);

  const updateCurrentPage = useCallback(() => {
    scrollFrame.current = 0;
    const scrollElement = scrollRef.current;
    if (!scrollElement || !pdfDocument) return;
    const pages = scrollElement.querySelectorAll<HTMLElement>('[data-pdf-page]');
    const readingLine = scrollElement.scrollTop + scrollElement.clientHeight / 3;
    let visiblePage = 1;
    pages.forEach((page) => {
      if (page.offsetTop <= readingLine) {
        visiblePage = Number(page.dataset.pdfPage) || visiblePage;
      }
    });
    setCurrentPage(visiblePage);
    setShowPageIndicator(true);
    clearIndicatorTimer();
    indicatorTimer.current = window.setTimeout(() => {
      setShowPageIndicator(false);
      indicatorTimer.current = null;
    }, PAGE_INDICATOR_DURATION);
  }, [clearIndicatorTimer, pdfDocument]);

  const handleScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(updateCurrentPage);
  }, [updateCurrentPage]);

  useEffect(() => () => {
    clearIndicatorTimer();
    window.cancelAnimationFrame(scrollFrame.current);
  }, [clearIndicatorTimer]);

  return (
    <div className="relative h-full min-w-0" aria-label={title}>
      <div
        ref={scrollRef}
        className="relative h-full min-w-0 overflow-auto px-6 pb-6 pt-12 [scrollbar-gutter:stable]"
        onScroll={handleScroll}
      >
        {loadFailed ? (
          <div className="mx-auto flex min-h-[320px] max-w-[800px] items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
            <p className="m-0">PDF preview is unavailable.</p>
          </div>
        ) : loading || !pdfDocument || !pageWidth ? (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
            Loading PDF…
          </div>
        ) : (
          <div className="mx-auto w-max max-w-none">
            {Array.from({ length: pdfDocument.numPages }, (_, index) => (
              <PdfPage
                key={index + 1}
                pdfDocument={pdfDocument}
                pageNumber={index + 1}
                width={pageWidth}
                scrollRef={scrollRef}
              />
            ))}
          </div>
        )}
      </div>
      {pdfDocument && !loadFailed ? (
        <div
          className={cn(
            'pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2',
            'rounded-full bg-[var(--dark-tooltip-bg)] px-4 py-1 text-xs font-medium',
            'text-[var(--dark-tooltip-text)] shadow-[0_2px_8px_rgb(0_0_0/20%)]',
            'transition-opacity',
            showPageIndicator ? 'opacity-100 duration-200' : 'opacity-0 duration-700',
          )}
        >
          {currentPage} / {pdfDocument.numPages}
        </div>
      ) : null}
    </div>
  );
}
