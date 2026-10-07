/** Where the bottom sheet rests: at one of its stops, or at the height (px) it was left at. */
export type Rest = "peek" | "half" | "full" | number;

/** Low enough to show only the handle and the page's title. */
export const PEEK = 80;
/** A sheet let go this close (px) to a stop lands on it. */
export const MAGNET = 32;
/** A sheet let go faster than this (px/ms) carries on to the next stop that way. */
export const FLICK = 0.5;

const STOPS = ["peek", "half", "full"] as const;

/** The sheet's height for a rest, within the `room` it has (from the tab bar to the top). */
export function heightOf(rest: Rest, room: number): number {
  const h = rest === "peek" ? PEEK : rest === "half" ? Math.round(room / 2) : rest === "full" ? room : rest;
  return clampHeight(h, room);
}

export function clampHeight(h: number, room: number): number {
  return Math.max(Math.min(PEEK, room), Math.min(room, h));
}

/** The next stop above (1) or below (-1) a height; at the end, the end. */
export function step(h: number, dir: 1 | -1, room: number): Rest {
  const order = dir > 0 ? STOPS : [...STOPS].reverse();
  return order.find((s) => dir * (heightOf(s, room) - h) > 1) ?? order[order.length - 1];
}

/** Where a sheet let go at `h`, moving at `v` px/ms (up is positive), comes to rest. */
export function settle(h: number, v: number, room: number): Rest {
  if (Math.abs(v) >= FLICK) return step(h, v > 0 ? 1 : -1, room);
  return STOPS.find((s) => Math.abs(heightOf(s, room) - h) <= MAGNET) ?? Math.round(h);
}

/** A tap on the handle: up to the next stop, and from the top back down to the title. */
export function cycle(h: number, room: number): Rest {
  return STOPS.find((s) => heightOf(s, room) > h + 1) ?? "peek";
}
