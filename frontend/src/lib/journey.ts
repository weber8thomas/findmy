import type { LocationPoint, Zone } from "../api/types";
import { haversineM } from "./geo";

/*
 * A trace told as a journey, like a timeline: where the device stopped (numbered, named after a
 * place when it is one) and the moves in between, with their distance.
 */

/** Positions that stay within this distance (m) of their centre are at one place. */
export const STOP_RADIUS_M = 120;
/** At one place for at least this long: a stop. */
export const STOP_MIN_MS = 10 * 60_000;
/** One place, then no position for at least this long: a stop too, until the next position.
 * Phones that only report when they move (OwnTracks "Significant") say nothing while they stay. */
export const SILENCE_MS = 10 * 60_000;
/** A silence must also be this many times the trace's usual interval between positions: a device
 * reporting every 15 minutes while it drives does not stop at each report. */
export const SILENCE_CADENCE_FACTOR = 2;
/** Intervals needed to tell a trace's usual one. */
const CADENCE_MIN_INTERVALS = 4;
/** Positions vaguer than this (m) are drawn, but neither make nor break a stop nor add distance. */
export const MAX_ACCURACY_M = 250;
/** A stop is named after the place (zone) whose circle, widened by this (m), holds its centre. */
export const ZONE_MARGIN_M = 50;

export type TracePoint = Pick<LocationPoint, "ts" | "lat" | "lon" | "accuracy">;
export type NamedPlace = Pick<Zone, "name" | "lat" | "lon" | "radius_m">;

export type Stop = {
  kind: "stop";
  /** Indices of its first and last positions in the trace. */
  first: number;
  last: number;
  /** Its centre. */
  lat: number;
  lon: number;
  /** Arrival and departure (ms). Still there (`ongoing`): `end` is now. */
  start: number;
  end: number;
  ongoing: boolean;
  /** The place it is at, if one of the owner's places. */
  place: string | null;
  /** 1, 2, 3… in time order. */
  n: number;
};

export type Move = {
  kind: "move";
  /** From the last position of the stop it leaves to the first of the stop it reaches. */
  first: number;
  last: number;
  distanceM: number;
  start: number;
  end: number;
};

export type Segment = Stop | Move;

export type Journey = {
  /** Stops and moves, in time order. */
  segments: Segment[];
  stops: Stop[];
  /** Sum of the moves: a stay's jitter is not distance. */
  distanceM: number;
};

type Cluster = { first: number; last: number; count: number; latSum: number; lonSum: number };
type Draft = Cluster & { start: number; end: number; ongoing: boolean };

const centre = (c: Cluster) => ({ lat: c.latSum / c.count, lon: c.lonSum / c.count });
const usableFix = (p: TracePoint) => p.accuracy == null || p.accuracy <= MAX_ACCURACY_M;

/** Consecutive (usable) positions within the radius of their running centre. */
function clusterPlaces(points: readonly TracePoint[], usable: number[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const i of usable) {
    const p = points[i];
    const c = clusters.at(-1);
    if (c) {
      const { lat, lon } = centre(c);
      if (haversineM(lat, lon, p.lat, p.lon) <= STOP_RADIUS_M) {
        c.last = i;
        c.count += 1;
        c.latSum += p.lat;
        c.lonSum += p.lon;
        continue;
      }
    }
    clusters.push({ first: i, last: i, count: 1, latSum: p.lat, lonSum: p.lon });
  }
  return clusters;
}

/** The usual interval between positions (median), 0 when there are too few to tell. */
export function cadence(times: readonly number[]): number {
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  if (gaps.length < CADENCE_MIN_INTERVALS) return 0;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/** The place holding a point, the nearest one when several do. */
export function placeAt(lat: number, lon: number, places: readonly NamedPlace[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const z of places) {
    const d = haversineM(lat, lon, z.lat, z.lon);
    if (d <= z.radius_m + ZONE_MARGIN_M && d < bestD) [best, bestD] = [z.name, d];
  }
  return best;
}

/**
 * Stops and moves of a trace (positions in ascending time). A stop is a run of positions within
 * STOP_RADIUS_M of their centre that lasts STOP_MIN_MS, or that is followed by a silence (the next
 * position, or now for the last place) of SILENCE_MS — and twice the usual interval. The last
 * place, when a stop, is ongoing. Stops at the same place a short outing apart are one.
 */
export function buildJourney(points: readonly TracePoint[], places: readonly NamedPlace[] = [], now = Date.now()): Journey {
  const time = points.map((p) => Date.parse(p.ts));
  const usable = points.flatMap((p, i) => (usableFix(p) ? [i] : []));
  const clusters = clusterPlaces(points, usable);
  const silenceMs = Math.max(SILENCE_MS, SILENCE_CADENCE_FACTOR * cadence(usable.map((i) => time[i])));

  const drafts: Draft[] = [];
  clusters.forEach((c, k) => {
    const next = clusters[k + 1];
    const until = next ? time[next.first] : now;
    const silent = until - time[c.last] >= silenceMs;
    if (time[c.last] - time[c.first] < STOP_MIN_MS && !silent) return;
    const draft: Draft = { ...c, start: time[c.first], end: silent || !next ? until : time[c.last], ongoing: !next };
    const prev = drafts.at(-1);
    const a = prev && centre(prev);
    const b = centre(draft);
    if (prev && a && draft.start - prev.end < STOP_MIN_MS && haversineM(a.lat, a.lon, b.lat, b.lon) <= STOP_RADIUS_M) {
      prev.last = draft.last;
      prev.count += draft.count;
      prev.latSum += draft.latSum;
      prev.lonSum += draft.lonSum;
      prev.end = draft.end;
      prev.ongoing = draft.ongoing;
    } else {
      drafts.push(draft);
    }
  });

  const segments: Segment[] = [];
  let distanceM = 0;
  const addMove = (first: number, last: number, start: number, end: number) => {
    const fixes = usable.filter((i) => i >= first && i <= last);
    if (fixes.length < 2) return;
    let d = 0;
    for (let k = 1; k < fixes.length; k++) {
      const [p, q] = [points[fixes[k - 1]], points[fixes[k]]];
      d += haversineM(p.lat, p.lon, q.lat, q.lon);
    }
    distanceM += d;
    segments.push({ kind: "move", first, last, distanceM: d, start, end });
  };

  const stops: Stop[] = [];
  let prev: Stop | null = null;
  for (const d of drafts) {
    addMove(prev ? prev.last : 0, d.first, prev ? prev.end : time[0], d.start);
    const { lat, lon } = centre(d);
    const stop: Stop = {
      kind: "stop",
      first: d.first,
      last: d.last,
      lat,
      lon,
      start: d.start,
      end: d.end,
      ongoing: d.ongoing,
      place: placeAt(lat, lon, places),
      n: stops.length + 1,
    };
    stops.push(stop);
    segments.push(stop);
    prev = stop;
  }
  const lastIndex = points.length - 1;
  if (!prev) addMove(0, lastIndex, time[0], time[lastIndex]);
  else if (!prev.ongoing) addMove(prev.last, lastIndex, prev.end, time[lastIndex]);

  return { segments, stops, distanceM };
}

/** The segment a position belongs to: its stop, else the move it is on. */
export function segmentAt(segments: readonly Segment[], index: number): Segment | null {
  if (index < 0) return null;
  const within = (s: Segment) => s.first <= index && index <= s.last;
  return segments.find((s) => s.kind === "stop" && within(s)) ?? segments.find(within) ?? null;
}

/** The first position that belongs to a segment (a move shares its ends with the stops). */
export function firstPointOf(segments: readonly Segment[], seg: Segment): number {
  for (let i = seg.first; i <= seg.last; i++) if (segmentAt(segments, i) === seg) return i;
  return seg.first;
}

const NBSP = " ";

/** "12 min", "2 h 38", "3 j 4 h" (fr) / "3 d 4 h" (en). */
export function formatDuration(ms: number, locale: string): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return `<${NBSP}1${NBSP}min`;
  if (minutes < 60) return `${minutes}${NBSP}min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) {
    const unit = locale.startsWith("fr") ? "j" : "d";
    return hours ? `${days}${NBSP}${unit}${NBSP}${hours}${NBSP}h` : `${days}${NBSP}${unit}`;
  }
  const rest = minutes % 60;
  return rest ? `${hours}${NBSP}h${NBSP}${String(rest).padStart(2, "0")}` : `${hours}${NBSP}h`;
}

/** "450 m", "3,2 km" (fr) / "3.2 km" (en), "12 km". */
export function formatDistance(meters: number, locale: string): string {
  if (meters < 995) return `${meters < 100 ? Math.round(meters) : Math.round(meters / 10) * 10}${NBSP}m`;
  const km = meters / 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 9.95 ? 1 : 0 }).format(km)}${NBSP}km`;
}
