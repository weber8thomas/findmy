/** A house number on its own, as Nominatim puts it before the street: 1, 12bis, 3 A, 10-12, 4/6. */
const HOUSE_NUMBER = /^\d+\s?[a-z]{0,3}(?:\s?[-/]\s?\d+\s?[a-z]{0,3})?$/i;

/**
 * A search result's label as a title and a line of detail.
 * "1, Stephansplatz, Innere Stadt, Wien, …" gives "1 Stephansplatz" and "Innere Stadt, Wien, …".
 */
export function splitLabel(label: string): { title: string; detail: string } {
  const parts = label
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { title: label.trim(), detail: "" };
  const n = parts.length > 1 && HOUSE_NUMBER.test(parts[0]) ? 2 : 1;
  return { title: parts.slice(0, n).join(" "), detail: parts.slice(n).join(", ") };
}

// Metres per pixel at zoom 0 on the equator (256 px tiles).
const METRES_PER_PX = 156_543.034;

/** The closest zoom at which a zone circle fits in `viewPx` pixels (a phone's half sheet of map). */
export function zoomForRadius(radiusM: number, lat: number, viewPx = 240): number {
  const z = Math.log2((METRES_PER_PX * Math.cos((lat * Math.PI) / 180) * viewPx) / (2 * Math.max(radiusM, 1)));
  return Math.max(3, Math.min(17, Math.floor(z)));
}
