import { haversineM } from "../lib/geo";

export type SimpleFix = { lat: number; lon: number; accuracy: number | null; time: number };

export const HEARTBEAT_MS = 60_000;
export const MIN_MOVE_M = 25;

/** Decide whether a new fix is worth sending, given the last one sent. */
export function shouldSend(last: SimpleFix | null, next: SimpleFix): boolean {
  if (!last) return true;
  if (next.time - last.time >= HEARTBEAT_MS) return true;
  const moved = haversineM(last.lat, last.lon, next.lat, next.lon);
  if (moved >= Math.max(MIN_MOVE_M, next.accuracy ?? 0)) return true;
  if (last.accuracy != null && next.accuracy != null && next.accuracy <= last.accuracy * 0.5) return true;
  return false;
}
