export type XY = { x: number; y: number };

const dist2 = (a: XY, b: XY) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Squared distance from p to the segment ab. */
function segmentDist2(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist2(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * Index of the trace point a tap designates, or -1 when the tap is off the trace.
 * Works in screen pixels so a finger gets the same tolerance at every zoom. A tap near points
 * picks the closest one (the latest on a tie: when the device was last there); a tap on the line
 * between two points picks the closer end of that segment.
 */
export function pointAtTap(points: XY[], tap: XY, tolerance: number): number {
  const tol2 = tolerance * tolerance;
  let best = -1;
  let bestD = tol2;
  points.forEach((p, i) => {
    const d = dist2(p, tap);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  if (best >= 0) return best;

  let seg = -1;
  let segD = tol2;
  for (let i = 1; i < points.length; i++) {
    const d = segmentDist2(tap, points[i - 1], points[i]);
    if (d <= segD) [seg, segD] = [i, d];
  }
  if (seg < 0) return -1;
  return dist2(tap, points[seg - 1]) < dist2(tap, points[seg]) ? seg - 1 : seg;
}

/** A direction mark on a line: where, and the heading in degrees (0: rightwards, clockwise). */
export type Arrow = XY & { angle: number };

const lengthOf = (line: readonly XY[]) => line.slice(1).reduce((sum, p, i) => sum + Math.sqrt(dist2(line[i], p)), 0);

function arrowAt(line: readonly XY[], at: number): Arrow {
  let left = at;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const len = Math.sqrt(dist2(a, b));
    if (len === 0) continue;
    if (left <= len || i === line.length - 1) {
      const t = Math.min(1, left / len);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
    }
    left -= len;
  }
  return { ...line[0], angle: 0 };
}

/**
 * Direction marks along lines (in screen pixels): evenly spread, about `spacing` apart, at least
 * one on any line `minLength` long, and no more than `max` in all (they spread out instead).
 */
export function arrowsAlong(lines: readonly (readonly XY[])[], spacing: number, minLength: number, max: number): Arrow[] {
  const lengths = lines.map(lengthOf);
  const total = lengths.reduce((sum, len) => sum + (len >= minLength ? len : 0), 0);
  const step = Math.max(spacing, total / max);
  const out: Arrow[] = [];
  lines.forEach((line, k) => {
    const len = lengths[k];
    if (len < minLength) return;
    const count = Math.max(1, Math.floor(len / step));
    for (let j = 0; j < count; j++) out.push(arrowAt(line, ((j + 0.5) * len) / count));
  });
  return out.slice(0, max);
}
