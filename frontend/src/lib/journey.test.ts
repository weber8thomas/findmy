import { describe, expect, it } from "vitest";
import { haversineM } from "./geo";
import {
  buildJourney,
  cadence,
  firstPointOf,
  formatDistance,
  formatDuration,
  placeAt,
  segmentAt,
  type Move,
  type Stop,
  type TracePoint,
} from "./journey";

const T0 = Date.parse("2026-10-07T08:00:00Z");
const MIN = 60_000;
const HOME = { lat: 48.21, lon: 16.37 };
const WORK = { lat: 48.23, lon: 16.37 };
// 0.001° of latitude is about 111 m.
const fix = (minutes: number, lat: number, lon = 16.37, accuracy: number | null = 10): TracePoint => ({
  ts: new Date(T0 + minutes * MIN).toISOString(),
  lat,
  lon,
  accuracy,
});
/** A few metres of GPS jitter around a place. */
const at = (minutes: number, place: { lat: number; lon: number }, k = minutes) =>
  fix(minutes, place.lat + ((k % 3) - 1) * 0.0002, place.lon + ((k % 2) - 0.5) * 0.0002);
const nowAt = (minutes: number) => T0 + minutes * MIN;

const stopsOf = (points: TracePoint[], now: number) => buildJourney(points, [], now).stops;
const kinds = (points: TracePoint[], now: number, places = []) => buildJourney(points, places, now).segments.map((s) => s.kind);

describe("buildJourney", () => {
  it("has nothing to tell without positions", () => {
    expect(buildJourney([], [], nowAt(0))).toEqual({ segments: [], stops: [], distanceM: 0 });
  });

  it("one position: a stop only once it has been there a while", () => {
    expect(buildJourney([fix(0, HOME.lat)], [], nowAt(3)).segments).toEqual([]);
    const [stop] = stopsOf([fix(0, HOME.lat)], nowAt(30));
    expect(stop).toMatchObject({ first: 0, last: 0, start: T0, end: nowAt(30), ongoing: true, n: 1 });
  });

  it("all positions at one place: one ongoing stop, no distance", () => {
    const points = Array.from({ length: 21 }, (_, i) => at(i * 2, HOME));
    const journey = buildJourney(points, [], nowAt(41));
    expect(journey.segments).toHaveLength(1);
    expect(journey.stops[0]).toMatchObject({ first: 0, last: 20, start: T0, end: nowAt(41), ongoing: true });
    expect(haversineM(journey.stops[0].lat, journey.stops[0].lon, HOME.lat, HOME.lon)).toBeLessThan(15);
    expect(journey.distanceM).toBe(0);
  });

  it("two stops and the move between them", () => {
    const points = [
      ...[0, 5, 10, 15, 20, 25, 30].map((m) => at(m, HOME)),
      // North, about 330 m per fix.
      ...[35, 40, 45, 50, 55].map((m, k) => fix(m, HOME.lat + (k + 1) * 0.003)),
      ...[60, 65, 70, 75, 80, 85, 90].map((m) => at(m, WORK)),
    ];
    const journey = buildJourney(points, [], nowAt(95));
    expect(journey.segments.map((s) => s.kind)).toEqual(["stop", "move", "stop"]);
    const [home, move, work] = journey.segments as [Stop, Move, Stop];
    expect(home).toMatchObject({ n: 1, first: 0, last: 6, start: T0, end: nowAt(30), ongoing: false });
    expect(move).toMatchObject({ first: 6, last: 12, start: nowAt(30), end: nowAt(60) });
    expect(work).toMatchObject({ n: 2, first: 12, last: 18, start: nowAt(60), end: nowAt(95), ongoing: true });
    // Home to work is 2.2 km straight north.
    expect(move.distanceM).toBeGreaterThan(2150);
    expect(move.distanceM).toBeLessThan(2350);
    expect(journey.distanceM).toBe(move.distanceM);
  });

  it("a short pause is not a stop", () => {
    const points = [0, 2, 4, 6, 8, 10, 12].map((m, k) => fix(m, HOME.lat + (k === 3 || k === 4 ? 3 : k) * 0.002));
    expect(kinds(points, nowAt(13))).toEqual(["move"]);
  });

  it("sparse positions: one fix then a long silence is a stop until the next fix", () => {
    // OwnTracks "Significant": nothing while at home, fixes on the way, then nothing at work.
    const points = [fix(0, HOME.lat), ...[120, 122, 124].map((m, k) => fix(m, HOME.lat + (k + 1) * 0.005)), fix(126, WORK.lat)];
    const journey = buildJourney(points, [], nowAt(200));
    expect(journey.segments.map((s) => s.kind)).toEqual(["stop", "move", "stop"]);
    expect(journey.stops[0]).toMatchObject({ first: 0, last: 0, start: T0, end: nowAt(120), ongoing: false });
    expect(journey.segments[1]).toMatchObject({ first: 0, last: 4, start: nowAt(120), end: nowAt(126) });
    expect(journey.stops[1]).toMatchObject({ first: 4, start: nowAt(126), end: nowAt(200), ongoing: true });
  });

  it("a device that always reports every 15 minutes is not stopping at each report", () => {
    const points = [0, 15, 30, 45, 60, 75].map((m, k) => fix(m, HOME.lat + k * 0.05));
    expect(kinds(points, nowAt(80))).toEqual(["move"]);
    // Silent for twice as long as usual: there now.
    expect(kinds(points, nowAt(110))).toEqual(["move", "stop"]);
  });

  it("the last place is ongoing once quiet for a while", () => {
    const points = [...[0, 1, 2, 3].map((m, k) => fix(m, HOME.lat + k * 0.003)), fix(4, WORK.lat)];
    expect(kinds(points, nowAt(6))).toEqual(["move"]);
    const journey = buildJourney(points, [], nowAt(30));
    expect(journey.segments.map((s) => s.kind)).toEqual(["move", "stop"]);
    expect(journey.stops[0]).toMatchObject({ first: 4, last: 4, ongoing: true, start: nowAt(4), end: nowAt(30) });
  });

  it("names a stop after the place it is in, with a small margin", () => {
    const points = [...[0, 5, 10, 15].map((m) => at(m, HOME)), ...[20, 25].map((m, k) => fix(m, HOME.lat + (k + 1) * 0.004))];
    const zones = [{ name: "Maison", lat: HOME.lat, lon: HOME.lon, radius_m: 100 }];
    expect(buildJourney(points, zones, nowAt(26)).stops[0].place).toBe("Maison");
    expect(buildJourney(points, [{ ...zones[0], lat: HOME.lat + 0.0012 }], nowAt(26)).stops[0].place).toBe("Maison");
    expect(buildJourney(points, [{ ...zones[0], lat: HOME.lat + 0.003 }], nowAt(26)).stops[0].place).toBeNull();
  });

  it("vague positions neither break a stop nor add distance", () => {
    const points = [0, 5, 10, 15, 20, 25].map((m) => at(m, HOME));
    points.splice(3, 0, fix(12, HOME.lat + 0.02, HOME.lon, 900));
    const journey = buildJourney(points, [], nowAt(26));
    expect(journey.segments).toHaveLength(1);
    expect(journey.stops[0]).toMatchObject({ first: 0, last: 6 });
    expect(journey.distanceM).toBe(0);
  });

  it("a stop at the same place after a stray fix is one stop", () => {
    const points = [0, 3, 6, 9, 12, 15].map((m) => at(m, HOME));
    points.push(fix(16, HOME.lat + 0.002, HOME.lon, 40));
    points.push(...[17, 20, 23, 26, 29].map((m) => at(m, HOME)));
    const journey = buildJourney(points, [], nowAt(31));
    expect(journey.stops).toHaveLength(1);
    expect(journey.stops[0]).toMatchObject({ first: 0, last: 11, ongoing: true });
  });

  it("numbers stops in time order", () => {
    const points = [
      ...[0, 5, 10, 15].map((m) => at(m, HOME)),
      fix(17, HOME.lat + 0.005),
      ...[20, 25, 30, 35].map((m) => at(m, WORK)),
      fix(37, HOME.lat + 0.005),
      ...[40, 45, 50, 55].map((m) => at(m, HOME)),
    ];
    const journey = buildJourney(points, [], nowAt(56));
    expect(journey.stops.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(journey.segments.map((s) => s.kind)).toEqual(["stop", "move", "stop", "move", "stop"]);
  });
});

describe("segments of a position", () => {
  const points = [...[0, 5, 10, 15].map((m) => at(m, HOME)), ...[18, 21].map((m, k) => fix(m, HOME.lat + (k + 1) * 0.004)), fix(24, WORK.lat)];
  const { segments } = buildJourney(points, [], nowAt(60));
  const [home, move, work] = segments;

  it("a stop owns its positions, a move those in between", () => {
    expect(segments.map((s) => s.kind)).toEqual(["stop", "move", "stop"]);
    expect(segmentAt(segments, 3)).toBe(home);
    expect(segmentAt(segments, 4)).toBe(move);
    expect(segmentAt(segments, 6)).toBe(work);
    expect(segmentAt(segments, -1)).toBeNull();
  });

  it("a move starts at its first own position", () => {
    expect(firstPointOf(segments, home)).toBe(0);
    expect(firstPointOf(segments, move)).toBe(4);
    expect(firstPointOf(segments, work)).toBe(6);
  });
});

describe("cadence and places", () => {
  it("is the median interval, once there are enough", () => {
    expect(cadence([0, 1, 2])).toBe(0);
    expect(cadence([0, 10, 20, 30, 1000])).toBe(10);
    expect(cadence([0, 10, 30, 60, 100, 150])).toBe(30);
  });

  it("picks the nearest of the places holding a point", () => {
    const zones = [
      { name: "Far", lat: HOME.lat + 0.001, lon: HOME.lon, radius_m: 500 },
      { name: "Near", lat: HOME.lat, lon: HOME.lon, radius_m: 80 },
    ];
    expect(placeAt(HOME.lat, HOME.lon, zones)).toBe("Near");
    expect(placeAt(HOME.lat + 0.007, HOME.lon, zones)).toBeNull();
  });
});

describe("formatting", () => {
  const s = (x: string) => x.replace(/ /g, " ");

  it("durations", () => {
    expect(s(formatDuration(20_000, "fr"))).toBe("< 1 min");
    expect(s(formatDuration(12 * MIN, "fr"))).toBe("12 min");
    expect(s(formatDuration(158 * MIN, "fr"))).toBe("2 h 38");
    expect(s(formatDuration(158 * MIN, "en"))).toBe("2 h 38");
    expect(s(formatDuration(125 * MIN, "en"))).toBe("2 h 05");
    expect(s(formatDuration(180 * MIN, "en"))).toBe("3 h");
    expect(s(formatDuration(26 * 60 * MIN, "fr"))).toBe("1 j 2 h");
    expect(s(formatDuration(48 * 60 * MIN, "en"))).toBe("2 d");
  });

  it("distances", () => {
    expect(s(formatDistance(3240, "fr"))).toBe("3,2 km");
    expect(s(formatDistance(3240, "en"))).toBe("3.2 km");
    expect(s(formatDistance(3000, "en"))).toBe("3 km");
    expect(s(formatDistance(12_480, "fr"))).toBe("12 km");
    expect(s(formatDistance(453, "fr"))).toBe("450 m");
    expect(s(formatDistance(45.4, "en"))).toBe("45 m");
    expect(s(formatDistance(998, "en"))).toBe("1 km");
  });
});
