/**
 * Turns an ELK edge polyline into a smooth SVG path.
 *
 * ELK's layered algorithm routes each edge as a polyline of right-angle
 * bends. Rendering those verbatim looks mechanical, so each interior point
 * becomes a quadratic-Bézier control with the segment ending at the midpoint
 * to the next point. That rounds the corners into a single flowing curve
 * while preserving the routing ELK chose around the nodes.
 */

export interface EdgePoint {
  x: number;
  y: number;
}

export function smoothEdgePath(points: EdgePoint[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
  const parts = [`M${points[0].x},${points[0].y}`];
  for (let index = 1; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    parts.push(`Q${current.x},${current.y} ${midX},${midY}`);
  }
  const last = points[points.length - 1];
  parts.push(`L${last.x},${last.y}`);
  return parts.join(' ');
}
