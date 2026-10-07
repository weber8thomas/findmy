import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * The day map in night colours, like Apple Maps at night: dark grey land, blue water, green
 * parks, roads lighter than the land, light labels. OpenFreeMap's own dark style is near black
 * and hides the water, the parks and the buildings.
 *
 * The layers are those of OpenMapTiles styles (OpenFreeMap Liberty); a layer it does not know
 * keeps its hue with its lightness turned over.
 */
export const NIGHT = {
  land: "#1f2023",
  water: "#22426a",
  waterLine: "#2a4d78",
  green: "#20382a",
  building: "#2a2b30",
  buildingEdge: "#232428",
  casing: "#16171a",
  minor: "#3b3c42",
  major: "#4d4e55",
  motorway: "#6b5b3e",
  rail: "#34353a",
  halo: "#1f2023",
  waterLabel: "#7fa3cf",
};

type Paint = Record<string, unknown>;

// First match wins. Colours replace the layer's own; other properties are added.
const RULES: [RegExp, Paint][] = [
  [/^background$/, { "background-color": NIGHT.land }],
  [/^water$/, { "fill-color": NIGHT.water }],
  [/^waterway_(tunnel|river|other)$/, { "line-color": NIGHT.waterLine }],
  [/^(park|landcover_(wood|grass|wetland))/, { "fill-color": NIGHT.green, "fill-outline-color": NIGHT.green, "line-color": NIGHT.green }],
  [/^building/, { "fill-color": NIGHT.building, "fill-outline-color": NIGHT.buildingEdge, "fill-extrusion-color": NIGHT.building }],
  // Pedestrian areas: a white hatching image that colours cannot change.
  [/^road_area_pattern$/, { "fill-opacity": 0.06 }],
  // The shaded relief of the world at low zoom.
  [/^natural_earth$/, { "raster-brightness-max": 0.3 }],
  [/_casing$/, { "line-color": NIGHT.casing }],
  [/rail/, { "line-color": NIGHT.rail }],
  [/motorway/, { "line-color": NIGHT.motorway }],
  [/(trunk_primary|secondary_tertiary)$/, { "line-color": NIGHT.major }],
  [/^(road|tunnel|bridge)_/, { "line-color": NIGHT.minor }],
];

const WATER_LABEL = /^water(way)?_.*label$/;

export function nightStyle(style: StyleSpecification): StyleSpecification {
  return { ...style, layers: style.layers.map(nightLayer) };
}

function nightLayer(layer: LayerSpecification): LayerSpecification {
  if (!("paint" in layer) || !layer.paint) return layer;
  const own = layer.paint as Paint;
  const rule = RULES.find(([re]) => re.test(layer.id))?.[1] ?? {};
  const paint: Paint = {};
  for (const [key, value] of Object.entries(own)) {
    if (key in rule) paint[key] = rule[key];
    else if (key === "text-color") paint[key] = WATER_LABEL.test(layer.id) ? NIGHT.waterLabel : mapColors(value, textColor);
    else if (key === "text-halo-color") paint[key] = NIGHT.halo;
    else if (key.endsWith("-color")) paint[key] = mapColors(value, areaColor);
    else paint[key] = value;
  }
  for (const [key, value] of Object.entries(rule)) {
    if (!key.endsWith("-color") && !(key in own)) paint[key] = value;
  }
  return { ...layer, paint } as LayerSpecification;
}

/** Every colour in a value, expressions included. */
function mapColors(value: unknown, f: (c: Hsla) => Hsla): unknown {
  if (typeof value === "string") {
    const c = parseColor(value);
    return c ? formatColor(f(c)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapColors(v, f));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapColors(v, f)]));
  return value;
}

// Dark text turns light, keeping the order: the darkest labels (cities) stay the brightest.
const textColor = ({ h, s, l, a }: Hsla): Hsla => ({ h, s: s * 0.6, l: 0.9 - 0.45 * l, a });
// Pale areas (residential, schools, sand) turn dark, a little above the land.
const areaColor = ({ h, s, l, a }: Hsla): Hsla => ({ h, s: s * 0.25, l: 0.08 + (1 - l) * 0.45, a });

export type Hsla = { h: number; s: number; l: number; a: number };

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000" };

/** CSS colours as styles write them: #rgb, #rrggbb(aa), rgb(a)(), hsl(a)(). Anything else: null. */
export function parseColor(input: string): Hsla | null {
  const c = NAMED[input.trim().toLowerCase()] ?? input.trim().toLowerCase();
  let m = c.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    const hex = m[1].length <= 4 ? [...m[1]].map((x) => x + x).join("") : m[1];
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return rgbToHsla(n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1);
  }
  m = c.match(/^(rgb|hsl)a?\(([^)]*)\)$/);
  if (!m) return null;
  const p = m[2].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
  if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
  const a = p[3] ?? 1;
  return m[1] === "rgb" ? rgbToHsla(p[0], p[1], p[2], a) : { h: p[0] / 360, s: p[1] / 100, l: p[2] / 100, a };
}

export function formatColor({ h, s, l, a }: Hsla): string {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const pct = (x: number) => `${Math.round(clamp(x) * 1000) / 10}%`;
  return `hsla(${Math.round((((h % 1) + 1) % 1) * 360)}, ${pct(s)}, ${pct(l)}, ${Math.round(clamp(a) * 1000) / 1000})`;
}

function rgbToHsla(r: number, g: number, b: number, a: number): Hsla {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l, a };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l, a };
}
