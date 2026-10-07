import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { NIGHT, formatColor, nightStyle, parseColor } from "./night";

const lightness = (c: unknown) => parseColor(String(c))!.l;

const DAY = {
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
    { id: "water", type: "fill", source: "s", "source-layer": "water", paint: { "fill-color": "rgb(158,189,255)" } },
    { id: "landuse_school", type: "fill", source: "s", "source-layer": "landuse", paint: { "fill-color": "#fde" } },
    { id: "road_area_pattern", type: "fill", source: "s", "source-layer": "t", paint: { "fill-pattern": "pedestrian_polygon" } },
    { id: "road_minor_casing", type: "line", source: "s", "source-layer": "t", paint: { "line-color": "#cfcdca", "line-width": 2 } },
    {
      id: "road_minor",
      type: "line",
      source: "s",
      "source-layer": "t",
      paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 12, "#fff", 16, "#fff"] },
    },
    { id: "road_motorway", type: "line", source: "s", "source-layer": "t", paint: { "line-color": "#fc8" } },
    { id: "label_city", type: "symbol", source: "s", "source-layer": "place", paint: { "text-color": "#000", "text-halo-color": "#fff" } },
    { id: "label_village", type: "symbol", source: "s", "source-layer": "place", paint: { "text-color": "#666" } },
    { id: "water_name_line_label", type: "symbol", source: "s", "source-layer": "w", paint: { "text-color": "#495e91" } },
    { id: "label_other", type: "symbol", source: "s", "source-layer": "place", layout: { "text-field": "x" } },
  ],
} as unknown as StyleSpecification;

describe("night map", () => {
  const night = nightStyle(DAY);
  const paint = (id: string) => (night.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> }).paint!;

  it("draws the known layers in night colours", () => {
    expect(paint("background")["background-color"]).toBe(NIGHT.land);
    expect(paint("water")["fill-color"]).toBe(NIGHT.water);
    expect(paint("road_minor_casing")).toEqual({ "line-color": NIGHT.casing, "line-width": 2 });
    expect(paint("road_motorway")["line-color"]).toBe(NIGHT.motorway);
    expect(paint("water_name_line_label")["text-color"]).toBe(NIGHT.waterLabel);
    expect(paint("label_city")["text-halo-color"]).toBe(NIGHT.halo);
  });

  it("keeps roads lighter than the land, and the pedestrian hatching faint", () => {
    expect(lightness(paint("road_minor")["line-color"])).toBeGreaterThan(lightness(NIGHT.land));
    expect(paint("road_area_pattern")).toEqual({ "fill-pattern": "pedestrian_polygon", "fill-opacity": 0.06 });
  });

  it("turns the other colours over, labels light and areas dark, in order", () => {
    const city = lightness(paint("label_city")["text-color"]);
    const village = lightness(paint("label_village")["text-color"]);
    expect(village).toBeGreaterThan(0.6);
    expect(city).toBeGreaterThan(village);
    expect(lightness(paint("landuse_school")["fill-color"])).toBeLessThan(0.2);
  });

  it("leaves the layout, the sources and the day style alone", () => {
    expect(night.layers.find((l) => l.id === "label_other")).toBe(DAY.layers.find((l) => l.id === "label_other"));
    expect(night.sources).toBe(DAY.sources);
    expect((DAY.layers[0] as { paint: Record<string, unknown> }).paint["background-color"]).toBe("#f8f4f0");
  });
});

describe("colours", () => {
  it("reads the forms styles use", () => {
    expect(parseColor("#fff")).toEqual({ h: 0, s: 0, l: 1, a: 1 });
    expect(parseColor("white")).toEqual({ h: 0, s: 0, l: 1, a: 1 });
    expect(parseColor("rgba(255,255,255,0.7)")!.a).toBe(0.7);
    expect(parseColor("hsla(35,57%,88%,0.49)")).toEqual({ h: 35 / 360, s: 0.57, l: 0.88, a: 0.49 });
    expect(parseColor("#00000080")!.a).toBeCloseTo(0.5, 2);
    expect(parseColor("get")).toBeNull();
    expect(parseColor("rgb(1,2)")).toBeNull();
  });

  it("writes them back", () => {
    expect(formatColor({ h: 0.5, s: 0.25, l: 0.125, a: 1 })).toBe("hsla(180, 25%, 12.5%, 1)");
    expect(parseColor(formatColor({ h: 0.1, s: 0.3, l: 0.4, a: 0.5 }))).toEqual({ h: 36 / 360, s: 0.3, l: 0.4, a: 0.5 });
  });
});
