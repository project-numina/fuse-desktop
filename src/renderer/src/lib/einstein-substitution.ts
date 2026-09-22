import {
  addVectors,
  HAT_OUTLINE,
  IDENTITY,
  intersectPoint,
  matchShapes,
  multiplyMatrices,
  rotateAbout,
  rotationMatrix,
  subtractVectors,
  transformPoint,
  type Matrix,
  type Point,
} from './einstein-geometry';
import {
  addChild,
  createMetaTile,
  evaluateChild,
  initializeMetatiles,
  recentre,
  type MetaTile,
} from './einstein-metatiles';

export interface Hat {
  points: Point[];
  label: string;
}

type TileLabel = 'H' | 'T' | 'P' | 'F';
type ConstructionRule =
  | [TileLabel]
  | [childIndex: number, vertexIndex: number, label: TileLabel, matchIndex: number]
  | [firstChildIndex: number, firstVertexIndex: number,
    secondChildIndex: number, secondVertexIndex: number,
    label: TileLabel, matchIndex: number];

const CONSTRUCTION_RULES: ConstructionRule[] = [
  ['H'],
  [0, 0, 'P', 2], [1, 0, 'H', 2],
  [2, 0, 'P', 2], [3, 0, 'H', 2],
  [4, 4, 'P', 2], [0, 4, 'F', 3],
  [2, 4, 'F', 3], [4, 1, 3, 2, 'F', 0],
  [8, 3, 'H', 0], [9, 2, 'P', 0],
  [10, 2, 'H', 0], [11, 4, 'P', 2],
  [12, 0, 'H', 2], [13, 0, 'F', 3],
  [14, 2, 'F', 1], [15, 3, 'H', 4],
  [8, 2, 'F', 1], [17, 3, 'H', 0],
  [18, 2, 'P', 0], [19, 2, 'H', 2],
  [20, 4, 'F', 3], [20, 0, 'P', 2],
  [22, 0, 'H', 2], [23, 4, 'F', 3],
  [23, 0, 'F', 3], [16, 0, 'P', 2],
  [9, 4, 0, 2, 'T', 2], [4, 0, 'F', 3],
];

function attachAlongChildEdge(
  result: MetaTile,
  rule: Extract<ConstructionRule, [number, number, TileLabel, number]>,
  shapes: Record<TileLabel, MetaTile>,
): void {
  const [childIndex, vertexIndex, label, matchIndex] = rule;
  const child = result.children[childIndex];
  const polygon = child.geometry.shape;
  const point = transformPoint(child.transform, polygon[(vertexIndex + 1) % polygon.length]);
  const target = transformPoint(child.transform, polygon[vertexIndex]);
  const newShape = shapes[label];
  addChild(
    result,
    matchShapes(
      newShape.shape[matchIndex],
      newShape.shape[(matchIndex + 1) % newShape.shape.length],
      point,
      target,
    ),
    newShape,
  );
}

function attachBetweenChildVertices(
  result: MetaTile,
  rule: Extract<ConstructionRule, [number, number, number, number, TileLabel, number]>,
  shapes: Record<TileLabel, MetaTile>,
): void {
  const [firstChildIndex, firstVertexIndex, secondChildIndex, secondVertexIndex,
    label, matchIndex] = rule;
  const firstChild = result.children[firstChildIndex];
  const secondChild = result.children[secondChildIndex];
  const point = transformPoint(
    secondChild.transform,
    secondChild.geometry.shape[secondVertexIndex],
  );
  const target = transformPoint(
    firstChild.transform,
    firstChild.geometry.shape[firstVertexIndex],
  );
  const newShape = shapes[label];
  addChild(
    result,
    matchShapes(
      newShape.shape[matchIndex],
      newShape.shape[(matchIndex + 1) % newShape.shape.length],
      point,
      target,
    ),
    newShape,
  );
}

function applyConstructionRule(
  result: MetaTile,
  rule: ConstructionRule,
  shapes: Record<TileLabel, MetaTile>,
): void {
  if (rule.length === 1) {
    addChild(result, IDENTITY, shapes[rule[0]]);
  } else if (rule.length === 4) {
    attachAlongChildEdge(result, rule, shapes);
  } else {
    attachBetweenChildVertices(result, rule, shapes);
  }
}

function constructPatch(tiles: MetaTile[]): MetaTile {
  const shapes: Record<TileLabel, MetaTile> = {
    H: tiles[0],
    T: tiles[1],
    P: tiles[2],
    F: tiles[3],
  };
  const result = createMetaTile([], tiles[0].width);
  for (const rule of CONSTRUCTION_RULES) {
    applyConstructionRule(result, rule, shapes);
  }
  return result;
}

function copyChildren(target: MetaTile, patch: MetaTile, indices: number[]): void {
  for (const index of indices) {
    const child = patch.children[index];
    addChild(target, child.transform, child.geometry);
  }
}

interface ReferenceGeometry {
  basePoint1: Point;
  basePoint2: Point;
  lowerLeftCorner: Point;
  point72: Point;
  point252: Point;
}

function deriveReferenceGeometry(patch: MetaTile): ReferenceGeometry {
  const basePoint1 = evaluateChild(patch, 8, 2);
  const basePoint2 = evaluateChild(patch, 21, 2);
  const rotatedBasePoint = transformPoint(
    rotateAbout(basePoint1, -2 * Math.PI / 3),
    basePoint2,
  );
  const point72 = evaluateChild(patch, 7, 2);
  const point252 = evaluateChild(patch, 25, 2);
  const lowerLeftCorner = intersectPoint(
    basePoint1,
    rotatedBasePoint,
    evaluateChild(patch, 6, 2),
    point72,
  );
  return { basePoint1, basePoint2, lowerLeftCorner, point72, point252 };
}

function constructH(patch: MetaTile, reference: ReferenceGeometry): MetaTile {
  const { basePoint1, lowerLeftCorner } = reference;
  let widthVector = subtractVectors(evaluateChild(patch, 6, 2), lowerLeftCorner);
  const shape = [lowerLeftCorner, basePoint1];
  widthVector = transformPoint(rotationMatrix(-Math.PI / 3), widthVector);
  shape.push(addVectors(shape[1], widthVector));
  shape.push(evaluateChild(patch, 14, 2));
  widthVector = transformPoint(rotationMatrix(-Math.PI / 3), widthVector);
  shape.push(subtractVectors(shape[3], widthVector));
  shape.push(evaluateChild(patch, 6, 2));

  const metaTile = createMetaTile(shape, patch.width * 2);
  copyChildren(metaTile, patch, [0, 9, 16, 27, 26, 6, 1, 8, 10, 15]);
  return metaTile;
}

function constructP(patch: MetaTile, reference: ReferenceGeometry): MetaTile {
  const { point72, basePoint1, lowerLeftCorner } = reference;
  const metaTile = createMetaTile([
    point72,
    addVectors(point72, subtractVectors(basePoint1, lowerLeftCorner)),
    basePoint1,
    lowerLeftCorner,
  ], patch.width * 2);
  copyChildren(metaTile, patch, [7, 2, 3, 4, 28]);
  return metaTile;
}

function constructF(patch: MetaTile, reference: ReferenceGeometry): MetaTile {
  const { basePoint1, basePoint2, lowerLeftCorner, point252 } = reference;
  const metaTile = createMetaTile([
    basePoint2,
    evaluateChild(patch, 24, 2),
    evaluateChild(patch, 25, 0),
    point252,
    addVectors(point252, subtractVectors(lowerLeftCorner, basePoint1)),
  ], patch.width * 2);
  copyChildren(metaTile, patch, [21, 20, 22, 23, 24, 25]);
  return metaTile;
}

function constructT(patch: MetaTile, hMetaTile: MetaTile): MetaTile {
  const cornerA = hMetaTile.shape[2];
  const cornerB = addVectors(
    hMetaTile.shape[1],
    subtractVectors(hMetaTile.shape[4], hMetaTile.shape[5]),
  );
  const cornerC = transformPoint(rotateAbout(cornerB, -Math.PI / 3), cornerA);
  const metaTile = createMetaTile([cornerB, cornerC, cornerA], patch.width * 2);
  copyChildren(metaTile, patch, [11]);
  return metaTile;
}

function constructMetatiles(patch: MetaTile): MetaTile[] {
  const reference = deriveReferenceGeometry(patch);
  const hMetaTile = constructH(patch, reference);
  const pMetaTile = constructP(patch, reference);
  const fMetaTile = constructF(patch, reference);
  const tMetaTile = constructT(patch, hMetaTile);

  for (const metaTile of [hMetaTile, pMetaTile, fMetaTile, tMetaTile]) {
    recentre(metaTile);
  }
  return [hMetaTile, tMetaTile, pMetaTile, fMetaTile];
}

function collectHats(
  metaTile: MetaTile,
  transform: Matrix,
  level: number,
  output: Hat[],
): void {
  if (metaTile.label) {
    output.push({
      points: HAT_OUTLINE.map(point => transformPoint(transform, point)),
      label: metaTile.label,
    });
    return;
  }
  if (level <= 0) return;

  for (const child of metaTile.children) {
    collectHats(
      child.geometry,
      multiplyMatrices(transform, child.transform),
      level - 1,
      output,
    );
  }
}

export function generateHats(iterations: number): Hat[] {
  let tiles = initializeMetatiles();
  let level = 1;
  for (let index = 0; index < iterations; index++) {
    tiles = constructMetatiles(constructPatch(tiles));
    level++;
  }
  const hats: Hat[] = [];
  collectHats(tiles[0], IDENTITY, level, hats);
  return hats;
}
