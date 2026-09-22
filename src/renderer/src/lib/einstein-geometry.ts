export interface Point {
  x: number;
  y: number;
}

/** Affine transform coefficients for x' = ax + by + tx and y' = cx + dy + ty. */
export type Matrix = [
  a: number,
  b: number,
  tx: number,
  c: number,
  d: number,
  ty: number,
];

export const Y_HEX: Point = { x: 0.5, y: 0.8660254037844386 };
export const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0];

function hexToCartesian(x: number, y: number): Point {
  return { x: x + Y_HEX.x * y, y: Y_HEX.y * y };
}

export const HAT_OUTLINE: Point[] = [
  hexToCartesian(0, 0),
  hexToCartesian(-1, -1),
  hexToCartesian(0, -2),
  hexToCartesian(2, -2),
  hexToCartesian(2, -1),
  hexToCartesian(4, -2),
  hexToCartesian(5, -1),
  hexToCartesian(4, 0),
  hexToCartesian(3, 0),
  hexToCartesian(2, 2),
  hexToCartesian(0, 3),
  hexToCartesian(0, 2),
  hexToCartesian(-1, 2),
];

export function invertMatrix(matrix: Matrix): Matrix {
  const determinant = matrix[0] * matrix[4] - matrix[1] * matrix[3];
  return [
    matrix[4] / determinant,
    -matrix[1] / determinant,
    (matrix[1] * matrix[5] - matrix[2] * matrix[4]) / determinant,
    -matrix[3] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[3] - matrix[0] * matrix[5]) / determinant,
  ];
}

export function multiplyMatrices(first: Matrix, second: Matrix): Matrix {
  return [
    first[0] * second[0] + first[1] * second[3],
    first[0] * second[1] + first[1] * second[4],
    first[0] * second[2] + first[1] * second[5] + first[2],
    first[3] * second[0] + first[4] * second[3],
    first[3] * second[1] + first[4] * second[4],
    first[3] * second[2] + first[4] * second[5] + first[5],
  ];
}

export function addVectors(first: Point, second: Point): Point {
  return { x: first.x + second.x, y: first.y + second.y };
}

export function subtractVectors(first: Point, second: Point): Point {
  return { x: first.x - second.x, y: first.y - second.y };
}

export function rotationMatrix(angle: number): Matrix {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, -sine, 0, sine, cosine, 0];
}

export function translationMatrix(x: number, y: number): Matrix {
  return [1, 0, x, 0, 1, y];
}

export function rotateAbout(point: Point, angle: number): Matrix {
  return multiplyMatrices(
    translationMatrix(point.x, point.y),
    multiplyMatrices(rotationMatrix(angle), translationMatrix(-point.x, -point.y)),
  );
}

export function transformPoint(matrix: Matrix, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[1] * point.y + matrix[2],
    y: matrix[3] * point.x + matrix[4] * point.y + matrix[5],
  };
}

function matchSegment(start: Point, end: Point): Matrix {
  return [
    end.x - start.x,
    start.y - end.y,
    start.x,
    end.y - start.y,
    end.x - start.x,
    start.y,
  ];
}

export function matchShapes(
  sourceStart: Point,
  sourceEnd: Point,
  targetStart: Point,
  targetEnd: Point,
): Matrix {
  return multiplyMatrices(
    matchSegment(targetStart, targetEnd),
    invertMatrix(matchSegment(sourceStart, sourceEnd)),
  );
}

export function intersectPoint(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): Point {
  const denominator = (secondEnd.y - secondStart.y) * (firstEnd.x - firstStart.x)
    - (secondEnd.x - secondStart.x) * (firstEnd.y - firstStart.y);
  const firstParameter = (
    (secondEnd.x - secondStart.x) * (firstStart.y - secondStart.y)
    - (secondEnd.y - secondStart.y) * (firstStart.x - secondStart.x)
  ) / denominator;
  return {
    x: firstStart.x + firstParameter * (firstEnd.x - firstStart.x),
    y: firstStart.y + firstParameter * (firstEnd.y - firstStart.y),
  };
}
