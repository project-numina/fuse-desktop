import { beginPan, panTranslate, type PanStart } from './pan-zoom-events';
import {
  cloneView,
  smoothView,
  type Translate,
  type ViewTransform,
} from './pan-zoom-math';

interface EngineState {
  view: ViewTransform;
  target: ViewTransform;
  rafId: number | null;
  isPanning: boolean;
  panStart: PanStart;
}

const INITIAL_VIEW: ViewTransform = {
  scale: 1,
  translate: { x: 0, y: 0 },
};

export class PanZoomEngine {
  private state: EngineState = {
    view: cloneView(INITIAL_VIEW),
    target: cloneView(INITIAL_VIEW),
    rafId: null,
    isPanning: false,
    panStart: { x: 0, y: 0, tx: 0, ty: 0 },
  };

  private getViewport: () => HTMLElement | null;

  constructor(getViewport: () => HTMLElement | null) {
    this.getViewport = getViewport;
  }

  setViewportAccessor(getViewport: () => HTMLElement | null): void {
    this.getViewport = getViewport;
  }

  getTargetView(): ViewTransform {
    return cloneView(this.state.target);
  }

  setView(view: ViewTransform): void {
    this.state.view = cloneView(view);
    this.state.target = cloneView(view);
    this.applyTransform();
  }

  setTarget(view: ViewTransform): void {
    this.state.target = cloneView(view);
    this.scheduleTick();
  }

  startPan(pointer: Translate): void {
    this.state.isPanning = true;
    this.state.panStart = beginPan(pointer, this.state.view.translate);
    document.body.style.cursor = 'grabbing';
  }

  movePan(pointer: Translate): void {
    if (!this.state.isPanning) return;
    this.setView({
      scale: this.state.view.scale,
      translate: panTranslate(pointer, this.state.panStart),
    });
  }

  endPan(): void {
    if (!this.state.isPanning) return;
    this.state.isPanning = false;
    document.body.style.cursor = '';
  }

  cleanup(ownedViewport: HTMLElement | null): void {
    this.cancelTick();
    this.endPan();
    if (!ownedViewport) return;
    ownedViewport.style.willChange = '';
    ownedViewport.style.backfaceVisibility = '';
  }

  private scheduleTick(): void {
    this.setZooming(true);
    if (this.state.rafId == null) {
      this.state.rafId = requestAnimationFrame(this.tickZoom);
    }
  }

  private tickZoom = (): void => {
    this.state.rafId = null;
    const next = smoothView(this.state.view, this.state.target);
    this.state.view = next.view;
    this.applyTransform();
    if (next.settled) {
      this.setZooming(false);
      return;
    }
    this.state.rafId = requestAnimationFrame(this.tickZoom);
  };

  private cancelTick(): void {
    if (this.state.rafId == null) return;
    cancelAnimationFrame(this.state.rafId);
    this.state.rafId = null;
  }

  private applyTransform(): void {
    const viewport = this.getViewport();
    if (!viewport) return;
    const { scale, translate } = this.state.view;
    viewport.style.transform = `translate(${translate.x}px, ${translate.y}px) scale(${scale})`;
  }

  private setZooming(active: boolean): void {
    const viewport = this.getViewport();
    if (!viewport) return;
    viewport.style.willChange = active ? 'transform' : '';
    viewport.style.backfaceVisibility = active ? 'hidden' : '';
  }
}
