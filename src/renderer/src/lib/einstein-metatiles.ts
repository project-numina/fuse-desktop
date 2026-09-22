import {
  addVectors,
  HAT_OUTLINE,
  matchShapes,
  multiplyMatrices,
  transformPoint,
  translationMatrix,
  Y_HEX,
  type Matrix,
  type Point,
} from './einstein-geometry';

export interface MetaTileChild {
  transform: Matrix;
  geometry: MetaTile;
}

export interface MetaTile {
  shape: Point[];
  width: number;
  children: MetaTileChild[];
  label?: string;
}

export function createMetaTile(shape: Point[], width: number): MetaTile {
  return { shape, width, children: [] };
}

function createLeafTile(label: string): MetaTile {
  return { shape: HAT_OUTLINE, width: 0, children: [], label };
}

export function addChild(
  metaTile: MetaTile,
  transform: Matrix,
  geometry: MetaTile,
): void {
  metaTile.children.push({ transform, geometry });
}

export function evaluateChild(metaTile: MetaTile, childIndex: number, vertexIndex: number): Point {
  const child = metaTile.children[childIndex];
  return transformPoint(
    child.transform,
    child.geometry.shape[vertexIndex % child.geometry.shape.length],
  );
}

export function recentre(metaTile: MetaTile): void {
  const center = metaTile.shape.reduce(addVectors, { x: 0, y: 0 });
  center.x /= metaTile.shape.length;
  center.y /= metaTile.shape.length;
  const translation = { x: -center.x, y: -center.y };
  metaTile.shape = metaTile.shape.map(point => addVectors(point, translation));

  const matrix = translationMatrix(translation.x, translation.y);
  metaTile.children = metaTile.children.map(child => ({
    transform: multiplyMatrices(matrix, child.transform),
    geometry: child.geometry,
  }));
}

function initializeH(): MetaTile {
  const outline = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4.5, y: Y_HEX.y },
    { x: 2.5, y: 5 * Y_HEX.y },
    { x: 1.5, y: 5 * Y_HEX.y },
    { x: -Y_HEX.x, y: Y_HEX.y },
  ];
  const metaTile = createMetaTile(outline, 2);
  addChild(metaTile, matchShapes(HAT_OUTLINE[5], HAT_OUTLINE[7], outline[5], outline[0]), createLeafTile('H'));
  addChild(metaTile, matchShapes(HAT_OUTLINE[9], HAT_OUTLINE[11], outline[1], outline[2]), createLeafTile('H'));
  addChild(metaTile, matchShapes(HAT_OUTLINE[5], HAT_OUTLINE[7], outline[3], outline[4]), createLeafTile('H'));
  addChild(
    metaTile,
    multiplyMatrices(
      translationMatrix(2.5, Y_HEX.y),
      multiplyMatrices(
        [-Y_HEX.x, -Y_HEX.y, 0, Y_HEX.y, -Y_HEX.x, 0],
        [Y_HEX.x, 0, 0, 0, -Y_HEX.x, 0],
      ),
    ),
    createLeafTile('H1'),
  );
  return metaTile;
}

function initializeT(): MetaTile {
  const outline = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 1.5, y: 3 * Y_HEX.y },
  ];
  const metaTile = createMetaTile(outline, 2);
  addChild(metaTile, [Y_HEX.x, 0, Y_HEX.x, 0, Y_HEX.x, Y_HEX.y], createLeafTile('T'));
  return metaTile;
}

function addParallelogramLeaves(metaTile: MetaTile, label: string): void {
  addChild(metaTile, [Y_HEX.x, 0, 1.5, 0, Y_HEX.x, Y_HEX.y], createLeafTile(label));
  addChild(
    metaTile,
    multiplyMatrices(
      translationMatrix(0, 2 * Y_HEX.y),
      multiplyMatrices(
        [Y_HEX.x, Y_HEX.y, 0, -Y_HEX.y, Y_HEX.x, 0],
        [Y_HEX.x, 0, 0, 0, Y_HEX.x, 0],
      ),
    ),
    createLeafTile(label),
  );
}

function initializeP(): MetaTile {
  const metaTile = createMetaTile([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 3, y: 2 * Y_HEX.y },
    { x: -1, y: 2 * Y_HEX.y },
  ], 2);
  addParallelogramLeaves(metaTile, 'P');
  return metaTile;
}

function initializeF(): MetaTile {
  const metaTile = createMetaTile([
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3.5, y: Y_HEX.y },
    { x: 3, y: 2 * Y_HEX.y },
    { x: -1, y: 2 * Y_HEX.y },
  ], 2);
  addParallelogramLeaves(metaTile, 'F');
  return metaTile;
}

export function initializeMetatiles(): MetaTile[] {
  return [initializeH(), initializeT(), initializeP(), initializeF()];
}
