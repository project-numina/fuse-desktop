import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PdfViewer from '@/features/blueprint/components/PdfViewer';

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  workerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => ({
  getDocument: pdfMocks.getDocument,
  GlobalWorkerOptions: pdfMocks.workerOptions,
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: '/assets/pdf.worker.min.mjs',
}));

let previewWidth = 900;
let resizeCallback: ResizeObserverCallback | null = null;

function pdfPage() {
  const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: vi.fn(() => renderTask),
    cleanup: vi.fn(),
  };
}

function pdfDocument(pageCount = 2) {
  const page = pdfPage();
  return {
    numPages: pageCount,
    getPage: vi.fn().mockResolvedValue(page),
  };
}

function loadWith(document: ReturnType<typeof pdfDocument>) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  pdfMocks.getDocument.mockReturnValue({
    promise: Promise.resolve(document),
    destroy,
  });
  return destroy;
}

describe('PdfViewer', () => {
  beforeEach(() => {
    previewWidth = 900;
    resizeCallback = null;
    pdfMocks.getDocument.mockReset();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe() {}

      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('overflow-auto') ? previewWidth : 0;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      { clearRect: vi.fn() } as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads authenticated PDF pages and caps their width', async () => {
    const document = pdfDocument();
    loadWith(document);

    render(<PdfViewer url="/source.pdf" title="Paper PDF" />);

    await waitFor(() => expect(document.getPage).toHaveBeenCalledTimes(2));
    expect(pdfMocks.getDocument).toHaveBeenCalledWith({
      url: '/source.pdf',
      withCredentials: true,
    });
    const pages = screen.getAllByLabelText(/^Page \d$/);
    expect(pages).toHaveLength(2);
    expect(pages[0].parentElement).toHaveStyle({ width: '800px' });
    expect(pdfMocks.workerOptions.workerSrc).toBe(
      '/assets/pdf.worker.min.mjs?v=javascript-mime',
    );
  });

  it('resizes pages with the source workspace', async () => {
    previewWidth = 700;
    const document = pdfDocument(1);
    loadWith(document);
    render(<PdfViewer url="/source.pdf" title="Paper PDF" />);

    const page = await screen.findByLabelText('Page 1');
    expect(page.parentElement).toHaveStyle({ width: '652px' });

    previewWidth = 420;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    await waitFor(() => expect(page.parentElement).toHaveStyle({ width: '372px' }));
  });

  it('shows the current page while scrolling', async () => {
    const document = pdfDocument();
    loadWith(document);
    render(<PdfViewer url="/source.pdf" title="Paper PDF" />);
    await screen.findByLabelText('Page 2');
    vi.useFakeTimers();

    const scrollElement = screen.getByLabelText('Paper PDF').firstElementChild as HTMLElement;
    const pages = scrollElement.querySelectorAll<HTMLElement>('[data-pdf-page]');
    Object.defineProperty(scrollElement, 'scrollTop', { configurable: true, value: 500 });
    Object.defineProperty(scrollElement, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(pages[0], 'offsetTop', { configurable: true, value: 48 });
    Object.defineProperty(pages[1], 'offsetTop', { configurable: true, value: 650 });
    fireEvent.scroll(scrollElement);
    act(() => vi.advanceTimersByTime(16));

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByText('2 / 2')).toHaveClass('opacity-0');
  });

  it('shows a safe fallback when the PDF cannot load', async () => {
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('broken PDF')),
      destroy: vi.fn().mockResolvedValue(undefined),
    });

    render(<PdfViewer url="/broken.pdf" title="Broken PDF" />);

    expect(await screen.findByText('PDF preview is unavailable.')).toBeInTheDocument();
  });

  it('rasterizes only pages near the viewport and cleans them up afterward', async () => {
    const intersections = new Map<Element, {
      callback: IntersectionObserverCallback;
      observer: IntersectionObserver;
    }>();
    vi.stubGlobal('IntersectionObserver', class {
      private callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe(element: Element) {
        intersections.set(element, {
          callback: this.callback,
          observer: this as unknown as IntersectionObserver,
        });
      }

      disconnect() {}
    });
    const page = pdfPage();
    const document = {
      numPages: 3,
      getPage: vi.fn().mockResolvedValue(page),
    };
    loadWith(document);
    render(<PdfViewer url="/long-paper.pdf" title="Long paper" />);

    const scrollElement = screen.getByLabelText('Long paper').firstElementChild as HTMLElement;
    await waitFor(() => {
      expect(scrollElement.querySelectorAll('[data-pdf-page]')).toHaveLength(3);
    });
    expect(document.getPage).not.toHaveBeenCalled();

    const secondPage = scrollElement.querySelector<HTMLElement>('[data-pdf-page="2"]')!;
    await waitFor(() => expect(intersections.has(secondPage)).toBe(true));
    const intersection = intersections.get(secondPage)!;
    act(() => intersection.callback(
      [{ target: secondPage, isIntersecting: true } as unknown as IntersectionObserverEntry],
      intersection.observer,
    ));
    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(2));
    expect(document.getPage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));

    act(() => intersection.callback(
      [{ target: secondPage, isIntersecting: false } as unknown as IntersectionObserverEntry],
      intersection.observer,
    ));
    await waitFor(() => expect(page.cleanup).toHaveBeenCalled());
    expect(screen.queryByLabelText('Page 2')).not.toBeInTheDocument();
  });

  it('keeps other pages visible when one page cannot render', async () => {
    const brokenPage = pdfPage();
    brokenPage.render.mockImplementation(() => ({
      promise: Promise.reject(new Error('bad page')),
      cancel: vi.fn(),
    }));
    const workingPage = pdfPage();
    const document = {
      numPages: 2,
      getPage: vi.fn((pageNumber: number) => Promise.resolve(
        pageNumber === 1 ? brokenPage : workingPage,
      )),
    };
    loadWith(document);

    render(<PdfViewer url="/partly-broken.pdf" title="Partly broken PDF" />);

    expect(await screen.findByText('Page 1 is unavailable.')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 2')).toBeInTheDocument();
    expect(screen.queryByText('PDF preview is unavailable.')).not.toBeInTheDocument();
  });
});
