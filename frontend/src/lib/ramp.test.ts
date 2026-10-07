import { describe, expect, it } from "vitest";
import { RAMP, bandColor, bandOf, rampColor, timeColor, timeFraction, traceBands } from "./ramp";

describe("time colours", () => {
  it("runs from the oldest colour to the latest", () => {
    expect(rampColor(0)).toBe(RAMP[0]);
    expect(rampColor(0.5)).toBe(RAMP[1]);
    expect(rampColor(1)).toBe(RAMP[2]);
    expect(rampColor(-1)).toBe(RAMP[0]);
    expect(rampColor(2)).toBe(RAMP[2]);
    expect(rampColor(0.25)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("places a moment in the range, the latest colour when there is no range", () => {
    expect(timeFraction(5, 0, 10)).toBe(0.5);
    expect(timeFraction(-5, 0, 10)).toBe(0);
    expect(timeFraction(7, 7, 7)).toBe(1);
    expect(timeColor(7, 7, 7)).toBe(RAMP[2]);
  });

  it("quantises into bands whose ends are the ramp's ends", () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(1)).toBe(19);
    expect(bandColor(0)).toBe(RAMP[0]);
    expect(bandColor(19)).toBe(RAMP[2]);
  });
});

describe("traceBands", () => {
  it("cuts the trace into runs of one band, in order, sharing their ends", () => {
    const times = Array.from({ length: 41 }, (_, i) => i);
    const bands = traceBands(times, 20);
    expect(bands).toHaveLength(20);
    expect(bands[0]).toEqual({ band: 0, from: 0, to: 2 });
    expect(bands.at(-1)).toMatchObject({ band: 19, to: 40 });
    bands.slice(1).forEach((b, k) => {
      expect(b.from).toBe(bands[k].to);
      expect(b.band).toBeGreaterThan(bands[k].band);
    });
  });

  it("colours a step by its middle time: a long gap is one band", () => {
    expect(traceBands([0, 100], 20)).toEqual([{ band: 10, from: 0, to: 1 }]);
    expect(traceBands([0], 20)).toEqual([]);
  });
});
