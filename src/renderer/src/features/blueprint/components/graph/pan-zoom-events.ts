import {
  zoomAroundPoint,
  wheelZoomFactor,
  type Translate,
  type ViewTransform,
} from './pan-zoom-math';

export interface PanStart extends Translate {
  tx: number;
  ty: number;
}

export function wheelTarget(
  event: WheelEvent,
  containerRect: DOMRect,
  targetView: ViewTransform,
): ViewTransform {
  const anchor = {
    x: event.clientX - containerRect.left,
    y: event.clientY - containerRect.top,
  };
  return zoomAroundPoint(
    targetView,
    anchor,
    wheelZoomFactor(event.deltaY, event.deltaMode),
  );
}

export function centeredZoomTarget(
  containerRect: DOMRect,
  targetView: ViewTransform,
  factor: number,
): ViewTransform {
  return zoomAroundPoint(
    targetView,
    { x: containerRect.width / 2, y: containerRect.height / 2 },
    factor,
  );
}

export function beginPan(pointer: Translate, translate: Translate): PanStart {
  return {
    x: pointer.x,
    y: pointer.y,
    tx: translate.x,
    ty: translate.y,
  };
}

export function panTranslate(pointer: Translate, start: PanStart): Translate {
  return {
    x: start.tx + pointer.x - start.x,
    y: start.ty + pointer.y - start.y,
  };
}
