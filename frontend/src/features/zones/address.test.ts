import { describe, expect, it } from "vitest";
import { splitLabel, zoomForRadius } from "./address";

describe("search result labels", () => {
  it("joins the house number to its street", () => {
    const label = "1, Stephansplatz, Innere Stadt, Wien, 1010, Österreich";
    expect(splitLabel(label)).toEqual({
      title: "1 Stephansplatz",
      detail: "Innere Stadt, Wien, 1010, Österreich",
    });
  });

  it("takes numbers with a suffix or a range", () => {
    expect(splitLabel("12bis, Rue de la Paix, Paris").title).toBe("12bis Rue de la Paix");
    expect(splitLabel("3 A, Hauptstraße, Kehl").title).toBe("3 A Hauptstraße");
    expect(splitLabel("10-12, Downing Street, London").title).toBe("10-12 Downing Street");
  });

  it("keeps a place's name as the title", () => {
    expect(splitLabel("Wien Hauptbahnhof, 1, Am Hauptbahnhof, Wien")).toEqual({
      title: "Wien Hauptbahnhof",
      detail: "1, Am Hauptbahnhof, Wien",
    });
    expect(splitLabel("Wien")).toEqual({ title: "Wien", detail: "" });
    expect(splitLabel("42")).toEqual({ title: "42", detail: "" });
    expect(splitLabel(" Wien ,  ")).toEqual({ title: "Wien", detail: "" });
  });
});

describe("zoomForRadius", () => {
  it("frames the zone circle", () => {
    // Wien: a 200 m house zone opens at street level, a 5 km one shows the town.
    expect(zoomForRadius(200, 48.21)).toBe(15);
    expect(zoomForRadius(50, 48.21)).toBe(17);
    expect(zoomForRadius(5000, 48.21)).toBe(11);
    // Closer to the poles, a metre takes more pixels: zoom out further.
    expect(zoomForRadius(200, 0)).toBeGreaterThan(zoomForRadius(200, 70));
  });

  it("stays within the map's zooms", () => {
    expect(zoomForRadius(0, 48.21)).toBe(17);
    expect(zoomForRadius(5_000_000, 48.21)).toBe(3);
  });
});
