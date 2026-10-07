import { describe, expect, it } from "vitest";
import { centerSquare } from "./photo";

describe("profile photo crop", () => {
  it("keeps the centre of landscape and portrait pictures", () => {
    expect(centerSquare(4032, 3024)).toEqual({ sx: 504, sy: 0, side: 3024 });
    expect(centerSquare(1080, 1920)).toEqual({ sx: 0, sy: 420, side: 1080 });
    expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });
});
