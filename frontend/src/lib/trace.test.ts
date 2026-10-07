import { describe, expect, it } from "vitest";
import { pointAtTap } from "./trace";

// An L-shaped trace: right along y=0, then down along x=100.
const TRACE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe("pointAtTap", () => {
  it("picks the closest point within the tolerance", () => {
    expect(pointAtTap(TRACE, { x: 12, y: 5 }, 24)).toBe(1);
    expect(pointAtTap(TRACE, { x: 95, y: 90 }, 24)).toBe(3);
  });

  it("picks the closer end of the segment tapped between two points", () => {
    expect(pointAtTap(TRACE, { x: 40, y: 6 }, 24)).toBe(1);
    expect(pointAtTap(TRACE, { x: 70, y: -6 }, 24)).toBe(2);
    expect(pointAtTap(TRACE, { x: 104, y: 60 }, 24)).toBe(3);
  });

  it("ignores a tap off the trace", () => {
    expect(pointAtTap(TRACE, { x: 50, y: 50 }, 24)).toBe(-1);
    expect(pointAtTap(TRACE, { x: -30, y: 0 }, 24)).toBe(-1);
    expect(pointAtTap([], { x: 0, y: 0 }, 24)).toBe(-1);
  });

  it("prefers a point over the line it sits on", () => {
    // Closer to the segment 1-2 than to point 1, but point 1 is within reach.
    expect(pointAtTap(TRACE, { x: 25, y: 1 }, 24)).toBe(1);
  });

  it("takes the latest of points at the same place", () => {
    const stayed = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 0, y: 0 },
    ];
    expect(pointAtTap(stayed, { x: 48, y: 52 }, 24)).toBe(2);
  });

  it("works with a single point", () => {
    expect(pointAtTap([{ x: 5, y: 5 }], { x: 0, y: 0 }, 24)).toBe(0);
    expect(pointAtTap([{ x: 5, y: 5 }], { x: 40, y: 40 }, 24)).toBe(-1);
  });
});
