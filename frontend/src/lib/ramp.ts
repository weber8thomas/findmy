/*
 * The colours of time on a trace: older positions green, recent ones the app's blue. Saturated and
 * of middle lightness, so that over the trace's casing they read on the day map and the night map.
 */

/** Older → more recent. The legend's CSS gradient uses the same stops. */
export const RAMP = ["#12b07c", "#0aa5c8", "#0a66e8"] as const;
export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.join(", ")})`;
/** The trace is drawn in this many colour bands. */
export const TRACE_BANDS = 20;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const STOPS = RAMP.map(rgb);

/** The ramp's colour at `f` (0: oldest, 1: latest), as #rrggbb. */
export function rampColor(f: number): string {
  const x = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 1)) * (STOPS.length - 1);
  const k = Math.min(STOPS.length - 2, Math.floor(x));
  const [a, b] = [STOPS[k], STOPS[k + 1]];
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * (x - k)).toString(16).padStart(2, "0")).join("")}`;
}

/** Where `t` falls between `t0` and `t1` (0 to 1); 1 when they are the same moment. */
export function timeFraction(t: number, t0: number, t1: number): number {
  if (!(t1 > t0)) return 1;
  return Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
}

/** The band a fraction of the time range falls in. */
export const bandOf = (f: number, bands = TRACE_BANDS) => Math.min(bands - 1, Math.max(0, Math.floor(f * bands)));
/** A band's colour: the first band is the ramp's first colour, the last band its last. */
export const bandColor = (band: number, bands = TRACE_BANDS) => rampColor(bands > 1 ? band / (bands - 1) : 1);
/** The colour of a moment of the trace, quantised like the trace's bands. */
export const timeColor = (t: number, t0: number, t1: number) => bandColor(bandOf(timeFraction(t, t0, t1)));

export type Band = { band: number; from: number; to: number };

/**
 * Runs of the trace (indices `from`..`to`, sharing their ends) of one colour band: each step
 * between two positions takes the band of its middle time.
 */
export function traceBands(times: readonly number[], bands = TRACE_BANDS): Band[] {
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const out: Band[] = [];
  for (let i = 1; i < times.length; i++) {
    const band = bandOf(timeFraction((times[i - 1] + times[i]) / 2, t0, t1), bands);
    const run = out.at(-1);
    if (run && run.band === band) run.to = i;
    else out.push({ band, from: i - 1, to: i });
  }
  return out;
}
