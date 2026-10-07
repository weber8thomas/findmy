import { describe, expect, it } from "vitest";
import { FLICK, PEEK, cycle, heightOf, settle, step } from "./sheet";

const ROOM = 780;

describe("bottom sheet", () => {
  it("has its stops at the title, half way and the top", () => {
    expect(heightOf("peek", ROOM)).toBe(PEEK);
    expect(heightOf("half", ROOM)).toBe(390);
    expect(heightOf("full", ROOM)).toBe(ROOM);
    expect(heightOf(2000, ROOM)).toBe(ROOM);
    expect(heightOf(10, ROOM)).toBe(PEEK);
  });

  it("rests where it is let go, unless close to a stop", () => {
    expect(settle(560, 0, ROOM)).toBe(560);
    expect(settle(230.4, 0.1, ROOM)).toBe(230);
    expect(settle(ROOM - 20, 0, ROOM)).toBe("full");
    expect(settle(PEEK + 25, 0, ROOM)).toBe("peek");
    expect(settle(400, -0.2, ROOM)).toBe("half");
  });

  it("carries on to the next stop when flicked", () => {
    expect(settle(560, FLICK, ROOM)).toBe("full");
    expect(settle(560, -FLICK, ROOM)).toBe("half");
    expect(settle(300, -1, ROOM)).toBe("peek");
    expect(settle(PEEK, -1, ROOM)).toBe("peek");
    expect(settle(ROOM, 2, ROOM)).toBe("full");
  });

  it("steps and cycles through the stops", () => {
    expect(step(390, 1, ROOM)).toBe("full");
    expect(step(390, -1, ROOM)).toBe("peek");
    expect(cycle(PEEK, ROOM)).toBe("half");
    expect(cycle(200, ROOM)).toBe("half");
    expect(cycle(390, ROOM)).toBe("full");
    expect(cycle(ROOM, ROOM)).toBe("peek");
  });
});
