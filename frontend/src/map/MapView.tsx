import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { useNavigate } from "react-router";
import type { Device, Fix, LocationPoint, PublicUser, Zone } from "../api/types";
import { useI18n } from "../i18n";
import { useStore } from "../lib/store";
import type { Journey, Move, Stop } from "../lib/journey";
import { bandColor, timeColor, traceBands } from "../lib/ramp";
import { arrowsAlong, pointAtTap } from "../lib/trace";
import { mapUi, patchMapUi } from "../lib/ui-state";
import { avatarTone, deviceGlyphSvg, initials } from "../ui/icons";

const ACCENT = "#0a66e8";
const ZONE = "#8e44d6";

/** A person on the map: their photo or initials where they are. */
export type Face = { user: Pick<PublicUser, "id" | "display_name" | "avatar_url">; location: Fix; isMe?: boolean };

type Props = {
  tileUrl: string;
  /** Draw the tile URL's (vector) style in night colours. */
  night: boolean;
  attribution: string;
  devices: Device[];
  faces: Face[];
  zones: Zone[];
  /** The page is about places: they are part of what the map frames. */
  frameZones: boolean;
  localDeviceId: string | null;
  /** The tab shown: the map frames what it shows again when it changes. */
  tab: string;
  /** The page focuses its own subject (a device, a person): no framing on arrival. */
  detail: boolean;
  /** Everything to show has loaded: frame only then, so late arrivals are not left out. */
  ready: boolean;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const PIN = 44;

function deviceIcon(d: Device, selected: boolean, local: boolean, offset: [number, number]) {
  const cls = ["pin", "pin-device", d.online ? "is-online" : "", selected ? "is-selected" : "", local ? "is-local" : "", d.lost_mode.enabled ? "is-lost" : ""]
    .filter(Boolean)
    .join(" ");
  return L.divIcon({
    className: "pin-wrap",
    html: `<div class="${cls}" data-testid="marker-device-${d.id}" title="${escapeHtml(d.name)}">${deviceGlyphSvg(d.icon, 30)}</div>`,
    iconSize: [PIN, PIN],
    iconAnchor: [PIN / 2 - offset[0], PIN / 2 - offset[1]],
  });
}

const FACE = 40;

function faceIcon({ user, isMe }: Face, selected: boolean, offset: [number, number]) {
  // The photo covers the initials, which still show if it cannot be loaded (no inline onerror
  // under the CSP). JSON quoting makes a CSS string, HTML escaping keeps it in the attribute.
  const photo = user.avatar_url
    ? `<span class="pin-photo" style="background-image:url(${escapeHtml(JSON.stringify(user.avatar_url))})"></span>`
    : "";
  const cls = ["pin", "pin-person", avatarTone(user.id), isMe ? "is-me" : "", selected ? "is-selected" : ""].filter(Boolean).join(" ");
  const testId = isMe ? "marker-me" : `marker-person-${user.id}`;
  return L.divIcon({
    className: "pin-wrap",
    html: `<div class="${cls}" data-testid="${testId}" title="${escapeHtml(user.display_name)}">${escapeHtml(initials(user.display_name))}${photo}</div>`,
    iconSize: [FACE, FACE],
    iconAnchor: [FACE / 2 - offset[0], FACE / 2 - offset[1]],
  });
}

type Placed = { id: string; location: { lat: number; lon: number } | null };

/** Pixel offsets that fan out markers overlapping on screen at the current zoom, so none hides another. */
function spreadOffsets(items: Placed[], project: (lat: number, lon: number) => L.Point): Map<string, [number, number]> {
  const clusters: { members: { id: string; p: L.Point }[]; center: L.Point }[] = [];
  for (const d of items) {
    if (!d.location) continue;
    const p = project(d.location.lat, d.location.lon);
    const hit = clusters.find((c) => c.center.distanceTo(p) < PIN);
    if (hit) {
      hit.members.push({ id: d.id, p });
      const n = hit.members.length;
      hit.center = hit.center.multiplyBy((n - 1) / n).add(p.divideBy(n));
    } else {
      clusters.push({ members: [{ id: d.id, p }], center: p });
    }
  }
  const out = new Map<string, [number, number]>();
  for (const { members, center } of clusters) {
    if (members.length < 2) continue;
    const r = PIN * (members.length > 4 ? 0.9 : 0.6);
    members.forEach(({ id, p }, i) => {
      const a = (2 * Math.PI * i) / members.length - Math.PI / 2;
      out.set(id, [Math.round(center.x + r * Math.cos(a) - p.x), Math.round(center.y + r * Math.sin(a) - p.y)]);
    });
  }
  return out;
}

/** Space covered by the side panel (desktop) or the bottom sheet + tab bar (mobile). */
function coveredArea(map: L.Map): { left: number; bottom: number } {
  const root = map.getContainer().closest(".shell");
  const panel = root?.querySelector<HTMLElement>(".panel");
  if (panel) return { left: panel.offsetLeft + panel.offsetWidth, bottom: 0 };
  const sheet = root?.querySelector<HTMLElement>(".sheet");
  const tabbar = root?.querySelector<HTMLElement>(".tabbar");
  return { left: 0, bottom: (sheet?.offsetHeight ?? 0) + (tabbar?.offsetHeight ?? 0) };
}

function fitOptions(map: L.Map, maxZoom: number): L.FitBoundsOptions {
  const c = coveredArea(map);
  return { paddingTopLeft: [c.left + 48, 72], paddingBottomRight: [48, c.bottom + 48], maxZoom };
}

/** Fly so that the point lands in the middle of the *visible* part of the map. */
function flyToVisible(map: L.Map, lat: number, lon: number, zoom: number) {
  const c = coveredArea(map);
  const target = map.project([lat, lon], zoom).subtract([c.left / 2, -c.bottom / 2]);
  map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.6 });
}

/** Pan just enough for the point to show in the visible part of the map, keeping the zoom. */
function panIntoView(map: L.Map, lat: number, lon: number) {
  const c = coveredArea(map);
  // A sheet pulled up high leaves little map: keep a band to pan into.
  const bottom = Math.max(0, Math.min(c.bottom + 24, map.getSize().y - 120));
  map.panInside([lat, lon], { paddingTopLeft: [c.left + 24, 72], paddingBottomRight: [24, bottom] });
}

function Controller({ points, tab, detail, ready }: { points: [number, number][]; tab: string; detail: boolean; ready: boolean }) {
  const map = useMap();
  const ui = useStore(mapUi);
  const framed = useRef<string | null>(null);
  const historyPoint = ui.history?.find((p) => p.ts === ui.historyAt);

  // Each tab frames what it shows: at once on opening, gently on a tab switch. Live updates never
  // move the map, and a page about one thing (a device, a person) focuses on it itself.
  useEffect(() => {
    if (!ready || points.length === 0 || framed.current === tab) return;
    const first = framed.current === null;
    framed.current = tab;
    if (detail) return;
    const bounds = L.latLngBounds(points);
    if (first) map.fitBounds(bounds, fitOptions(map, 18));
    else map.flyToBounds(bounds, { ...fitOptions(map, 16), duration: 0.6 });
  }, [points, tab, detail, ready, map]);

  useEffect(() => {
    if (!ui.history?.length) return;
    map.fitBounds(L.latLngBounds(ui.history.map((p) => [p.lat, p.lon] as [number, number])), fitOptions(map, 17));
  }, [ui.history, map]);

  // Follow the picked moment while scrubbing, without losing the zoom chosen on the trace.
  useEffect(() => {
    if (historyPoint) panIntoView(map, historyPoint.lat, historyPoint.lon);
  }, [historyPoint, map]);

  // After the pan above: a focus asked along with a pick (a stop of the history) flies there instead.
  useEffect(() => {
    if (ui.focus) flyToVisible(map, ui.focus.lat, ui.focus.lon, ui.focus.zoom ?? Math.max(map.getZoom(), 15));
  }, [ui.focus, map]);

  useMapEvents({
    click(e) {
      ui.pick?.(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle("is-picking", Boolean(ui.pick));
  }, [ui.pick, map]);

  return null;
}

/** Raster tiles for a {z}/{x}/{y} URL, otherwise a MapLibre vector style. */
function BaseLayer({ url, night }: { url: string; night: boolean }) {
  if (url.includes("{z}")) return <TileLayer url={url} maxZoom={19} />;
  return <VectorLayer styleUrl={url} night={night} />;
}

const NO_STYLE = { version: 8, sources: {}, layers: [] } as const;

function VectorLayer({ styleUrl, night }: { styleUrl: string; night: boolean }) {
  const map = useMap();
  useEffect(() => {
    let layer: L.MaplibreGL | null = null;
    let cancelled = false;
    // MapLibre is large: load it only when a vector map is used.
    void Promise.all([
      import("maplibre-gl"),
      import("@maplibre/maplibre-gl-leaflet"),
      // MapLibre looks for its worker next to its own module, which bundling moves: point to it.
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
      import("./night"),
    ]).then(([maplibre, { maplibreGL }, { default: workerUrl }, , { nightStyle }]) => {
      if (cancelled) return;
      maplibre.setWorkerUrl(workerUrl);
      // At night the style is recoloured between its download and its first drawing.
      layer = maplibreGL({ style: night ? NO_STYLE : styleUrl } as L.LeafletMaplibreGLOptions);
      layer.addTo(map);
      if (night) layer.getMaplibreMap().setStyle(styleUrl, { transformStyle: (_, next) => nightStyle(next) });
    });
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, styleUrl, night]);
  return null;
}

/** How long the map's credits show in full before folding into their ⓘ, as the OpenStreetMap
 * attribution guidelines allow (also when the map is first touched). */
const CREDITS_FOLD_MS = 5000;

/** The map's credits as an ⓘ in a corner, like Apple Maps: in full at first, then on a tap. */
function Credits({ html }: { html: string }) {
  const map = useMap();
  const { t } = useI18n();
  const label = t("map.credits");
  useEffect(() => {
    const control = new L.Control({ position: "bottomright" });
    const box = L.DomUtil.create("div", "map-credits is-open");
    box.dataset.testid = "map-credits";
    const button = L.DomUtil.create("button", "map-credits-btn", box);
    button.type = "button";
    button.textContent = "i";
    button.setAttribute("aria-label", label);
    // The server's setting, shown as Leaflet's own attribution control did.
    L.DomUtil.create("span", "map-credits-text", box).innerHTML = html;
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.on(box, "pointerdown", L.DomEvent.stopPropagation);
    L.DomEvent.on(button, "click", () => box.classList.toggle("is-open"));
    control.onAdd = () => box;
    control.addTo(map);

    // Not on the map's own moves (its framing on arrival): on a touch, a click or the wheel.
    const fold = () => box.classList.remove("is-open");
    const container = map.getContainer();
    const timer = window.setTimeout(fold, CREDITS_FOLD_MS);
    L.DomEvent.on(container, "pointerdown wheel", fold);
    return () => {
      window.clearTimeout(timer);
      L.DomEvent.off(container, "pointerdown wheel", fold);
      control.remove();
    };
  }, [map, html, label]);
  return null;
}

/** How close (px) a tap must land to the trace to pick one of its points: about a fingertip. */
const TAP_TOLERANCE = 24;

const PICK_ICON = L.divIcon({
  className: "pin-wrap",
  html: '<div class="history-pick" data-testid="history-pick"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** The history's panes, above the places and below the pins: the trace's casing, the coloured
 * trace, the positions with the direction marks. Created once and kept. */
const HISTORY_PANES: [string, number][] = [
  ["history-casing", 405],
  ["history-trace", 410],
  ["history-points", 420],
];

function ensureHistoryPanes(map: L.Map) {
  for (const [name, z] of HISTORY_PANES) if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z);
  return true;
}

const TRACE_WEIGHT = 6;
/** White on the day map, dark on the night map (CSS): the trace stands out from the roads. */
const CASING_WEIGHT = TRACE_WEIGHT + 3;
/** The positions: small white dots inside the line. */
const POINT_RADIUS = 1.8;
/** Direction marks on the moves: about this far apart (px), on moves at least this long on
 * screen, and no more than this many (they spread out instead). Recomputed on zoom. */
const ARROW_SPACING = 90;
const ARROW_MIN_MOVE = 28;
const MAX_ARROWS = 60;
const ARROW = 16;
const STOP_BADGE = 24;
/** Stops' badges closer than this (px) on screen are shown side by side, overlapping by it. */
const BADGE_OVERLAP = 5;
/** The ongoing stop's badge sits on the corner of the pin that is there. */
const PIN_CORNER = 20;

function arrowIcon(angle: number) {
  // Rotated in the SVG's own coordinates, around its centre.
  const c = ARROW / 2;
  const d = `M${c - 2} ${c - 4} ${c + 2} ${c} ${c - 2} ${c + 4}`;
  return L.divIcon({
    className: "pin-wrap",
    html: `<svg class="history-arrow" viewBox="0 0 ${ARROW} ${ARROW}" width="${ARROW}" height="${ARROW}"><g transform="rotate(${angle.toFixed(1)} ${c} ${c})"><path class="history-arrow-halo" d="${d}"/><path d="${d}"/></g></svg>`,
    iconSize: [ARROW, ARROW],
    iconAnchor: [c, c],
  });
}

type BadgeGroup = { stops: { stop: Stop; color: string; label: string }[]; at: [number, number]; onPin: boolean };

/** At most this many numbers at one place: the latest ones, after a "+n" for the others. */
const MAX_BADGES = 4;

/** Stops at one place (home in the morning and in the evening): their numbers side by side. */
function stopsIcon({ stops, onPin }: BadgeGroup) {
  const shown = stops.length > MAX_BADGES ? stops.slice(-(MAX_BADGES - 1)) : stops;
  const hidden = stops.length - shown.length;
  const count = shown.length + (hidden ? 1 : 0);
  const width = STOP_BADGE + (count - 1) * (STOP_BADGE - BADGE_OVERLAP);
  const half = STOP_BADGE / 2;
  const html =
    (hidden ? `<div class="history-stop is-more">+${hidden}</div>` : "") +
    shown
      .map(
        ({ stop, color, label }) =>
          `<div class="history-stop" style="border-color:${color}" data-n="${stop.n}" data-testid="history-stop-${stop.n}" title="${escapeHtml(label)}">${stop.n}</div>`,
      )
      .join("");
  return L.divIcon({
    className: "pin-wrap",
    html: `<div class="history-stops">${html}</div>`,
    iconSize: [width, STOP_BADGE],
    // On a pin: the last number on its corner, the others to its left.
    iconAnchor: onPin ? [width - half - PIN_CORNER, half + PIN_CORNER] : [width / 2, half],
  });
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

/** The trace coloured by time, with the direction of the moves and the numbered stops. */
function HistoryLayer({ points, journey, pickedTs }: { points: LocationPoint[]; journey: Journey | null; pickedTs: string | null }) {
  const map = useMap();
  const { t, dateTime } = useI18n();
  useState(() => ensureHistoryPanes(map));
  const [zoom, setZoom] = useState(() => map.getZoom());
  const handlers = useMemo(
    () => ({
      // Points are a few pixels wide: take any tap near the trace, and clear the pick elsewhere.
      click(e: L.LeafletMouseEvent) {
        const i = pointAtTap(
          points.map((p) => map.latLngToContainerPoint([p.lat, p.lon])),
          e.containerPoint,
          TAP_TOLERANCE,
        );
        patchMapUi({ historyAt: i >= 0 ? points[i].ts : null });
      },
      zoomend: () => setZoom(map.getZoom()),
    }),
    [points, map],
  );
  useMapEvents(handlers);
  // A fit made in the same commit as the trace, before this layer listened.
  useEffect(() => setZoom(map.getZoom()), [points, map]);

  const times = useMemo(() => points.map((p) => Date.parse(p.ts)), [points]);
  const [t0, t1] = [times[0], times[times.length - 1]];
  const line = useMemo(() => points.map((p) => [p.lat, p.lon] as [number, number]), [points]);
  const bands = useMemo(() => traceBands(times), [times]);

  const arrows = useMemo(() => {
    const moves = (journey?.segments ?? []).filter((s): s is Move => s.kind === "move");
    const lines = moves.map((m) => range(m.first, m.last).map((i) => map.project([points[i].lat, points[i].lon], zoom)));
    return arrowsAlong(lines, ARROW_SPACING, ARROW_MIN_MOVE, MAX_ARROWS).map((a) => ({
      at: map.unproject([a.x, a.y], zoom),
      icon: arrowIcon(a.angle),
    }));
  }, [journey, points, zoom, map]);

  const badges = useMemo(() => {
    const last = points[points.length - 1];
    const groups: (BadgeGroup & { px: L.Point })[] = [];
    for (const stop of journey?.stops ?? []) {
      // Still there: on the pin, which is at the latest position.
      const at: [number, number] = stop.ongoing ? [last.lat, last.lon] : [stop.lat, stop.lon];
      const px = map.project(at, zoom);
      const badge = { stop, color: timeColor(stop.start, t0, t1), label: stop.place ?? t("history.stopNumber", { n: stop.n }) };
      const group = groups.find((g) => g.px.distanceTo(px) < STOP_BADGE);
      if (!group) groups.push({ stops: [badge], at, px, onPin: stop.ongoing });
      else {
        group.stops.push(badge);
        if (stop.ongoing) Object.assign(group, { at, px, onPin: true });
      }
    }
    return groups.map((g) => ({ ...g, icon: stopsIcon(g) }));
  }, [journey, points, zoom, map, t0, t1, t]);

  // A tap on a number picks the start of that stop; on the group (keyboard), the next of its stops.
  const pickStop = (stops: BadgeGroup["stops"], e: L.LeafletMouseEvent) => {
    const n = Number((e.originalEvent?.target as HTMLElement | null)?.closest?.("[data-n]")?.getAttribute("data-n"));
    const at = points.findIndex((p) => p.ts === pickedTs);
    const current = stops.findIndex(({ stop }) => stop.first <= at && at <= stop.last);
    const next = stops.find(({ stop }) => stop.n === n) ?? stops[(current + 1) % stops.length];
    patchMapUi({ historyAt: points[next.stop.first].ts });
  };

  const picked = points.find((p) => p.ts === pickedTs);
  return (
    <>
      <Polyline
        pane="history-casing"
        positions={line}
        interactive={false}
        className="history-casing"
        pathOptions={{ color: "#fff", weight: CASING_WEIGHT, opacity: 0.9, lineCap: "round", lineJoin: "round" }}
      />
      {bands.map((b, k) => (
        <Polyline
          key={k}
          pane="history-trace"
          positions={line.slice(b.from, b.to + 1)}
          interactive={false}
          pathOptions={{ color: bandColor(b.band), weight: TRACE_WEIGHT, opacity: 1, lineCap: "round", lineJoin: "round" }}
        />
      ))}
      {points.map((p) => (
        <CircleMarker
          key={p.ts}
          pane="history-points"
          center={[p.lat, p.lon]}
          radius={POINT_RADIUS}
          className="history-point"
          pathOptions={{ stroke: false, fillColor: "#fff", fillOpacity: 0.95 }}
        />
      ))}
      {arrows.map((a, k) => (
        <Marker key={k} pane="history-points" position={a.at} icon={a.icon} interactive={false} keyboard={false} />
      ))}
      {badges.map(({ stops, at, icon }) => (
        <Marker key={stops[0].stop.n} position={at} icon={icon} zIndexOffset={1500} eventHandlers={{ click: (e) => pickStop(stops, e) }} />
      ))}
      {picked && (
        <Marker position={[picked.lat, picked.lon]} icon={PICK_ICON} interactive={false} keyboard={false} zIndexOffset={2000}>
          <Tooltip permanent direction="top" offset={[0, -14]} className="history-label">
            <span data-testid="history-label">
              <strong>{dateTime(picked.ts)}</strong>
              {picked.accuracy != null && <span className="history-label-accuracy"> · ±{Math.round(picked.accuracy)} m</span>}
            </span>
          </Tooltip>
        </Marker>
      )}
    </>
  );
}

export function MapView({ tileUrl, night, attribution, devices, faces, zones, frameZones, localDeviceId, tab, detail, ready }: Props) {
  const ui = useStore(mapUi);
  const navigate = useNavigate();

  // What the tab frames: the people or devices it is about; places only on their own pages.
  const points = useMemo(() => {
    const pts: [number, number][] = [];
    devices.forEach((d) => d.location && pts.push([d.location.lat, d.location.lon]));
    faces.forEach((f) => pts.push([f.location.lat, f.location.lon]));
    if (frameZones) zones.forEach((z) => pts.push([z.lat, z.lon]));
    return pts;
  }, [devices, faces, zones, frameZones]);

  return (
    <MapContainer
      center={[46.6, 2.4]}
      zoom={5}
      maxZoom={19}
      zoomControl={false}
      attributionControl={false}
      className={`map${night ? " is-night" : ""}`}
      worldCopyJump
    >
      <BaseLayer key={`${tileUrl} ${night}`} url={tileUrl} night={night} />
      <Credits html={attribution} />
      <Controller points={points} tab={tab} detail={detail} ready={ready} />

      {zones.map((z) => (
        // Filled only on the pages about places: elsewhere a tint over the whole street at home.
        <Circle
          key={z.id}
          center={[z.lat, z.lon]}
          radius={z.radius_m}
          pathOptions={{ color: ZONE, weight: 2, fillOpacity: frameZones ? 0.08 : 0, dashArray: "6 6" }}
        >
          {/* Below the centre, so a device at home does not hide the place's name. */}
          <Tooltip direction="center" offset={[0, 32]} permanent className="zone-label">
            {z.name}
          </Tooltip>
        </Circle>
      ))}
      {ui.draftZone && (
        <Circle center={[ui.draftZone.lat, ui.draftZone.lon]} radius={ui.draftZone.radius_m} pathOptions={{ color: "#f59e0b", weight: 2, fillOpacity: 0.15 }} />
      )}
      {ui.history && ui.history.length > 0 && <HistoryLayer points={ui.history} journey={ui.historyJourney} pickedTs={ui.historyAt} />}

      <DeviceLayer devices={devices} localDeviceId={localDeviceId} onOpen={(id) => navigate(`/devices/${id}`)} />
      {/* Mine opens my page, in the tab it is on; someone else's, theirs. */}
      <FaceLayer
        faces={faces}
        onOpen={(f) => navigate(f.isMe ? (tab === "/people" ? "/people/me" : "/me/location") : `/people/${f.user.id}`)}
      />
    </MapContainer>
  );
}

const NO_OFFSET: [number, number] = [0, 0];

/** Offsets that keep markers at the same place apart, recomputed on zoom. */
function useSpread(items: Placed[]) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  // Subscribed once: re-subscribing on each render missed the zoom of a fit made meanwhile.
  const handlers = useMemo(() => ({ zoomend: () => setZoom(map.getZoom()) }), [map]);
  useMapEvents(handlers);
  // A fit made in the same commit as new markers, before this layer subscribed.
  useEffect(() => setZoom(map.getZoom()), [items, map]);
  return useMemo(() => spreadOffsets(items, (lat, lon) => map.project([lat, lon], zoom)), [items, zoom, map]);
}

function FaceLayer({ faces, onOpen }: { faces: Face[]; onOpen: (face: Face) => void }) {
  const ui = useStore(mapUi);
  const placed = useMemo(() => faces.map((f) => ({ id: f.user.id, location: f.location })), [faces]);
  const offsets = useSpread(placed);
  return (
    <>
      {faces.map((f) => (
        <FaceMarker
          key={f.user.id}
          face={f}
          selected={ui.selected?.kind === "person" && ui.selected.id === f.user.id}
          offset={offsets.get(f.user.id) ?? NO_OFFSET}
          onClick={() => onOpen(f)}
        />
      ))}
    </>
  );
}

function FaceMarker({ face, selected, offset, onClick }: { face: Face; selected: boolean; offset: [number, number]; onClick: () => void }) {
  const { lat, lon } = face.location;
  const { id, display_name, avatar_url } = face.user;
  const [dx, dy] = offset;
  // A new icon replaces the pin's HTML: only on changes, so the photo does not flicker.
  const icon = useMemo(
    () => faceIcon(face, selected, [dx, dy]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, display_name, avatar_url, face.isMe, selected, dx, dy],
  );
  return <Marker position={[lat, lon]} icon={icon} eventHandlers={{ click: onClick }} zIndexOffset={selected ? 1000 : 0} />;
}

function DeviceLayer({ devices, localDeviceId, onOpen }: { devices: Device[]; localDeviceId: string | null; onOpen: (id: string) => void }) {
  const ui = useStore(mapUi);
  const offsets = useSpread(devices);
  return (
    <>
      {devices.map((d) =>
        d.location ? (
          <DeviceMarker
            key={d.id}
            device={d}
            selected={ui.selected?.kind === "device" && ui.selected.id === d.id}
            local={d.id === localDeviceId}
            offset={offsets.get(d.id) ?? NO_OFFSET}
            onClick={() => onOpen(d.id)}
          />
        ) : null,
      )}
    </>
  );
}

function DeviceMarker({
  device,
  selected,
  local,
  offset,
  onClick,
}: {
  device: Device;
  selected: boolean;
  local: boolean;
  offset: [number, number];
  onClick: () => void;
}) {
  const loc = device.location!;
  const [dx, dy] = offset;
  const icon = useMemo(
    () => deviceIcon(device, selected, local, [dx, dy]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device.id, device.icon, device.name, device.online, device.lost_mode.enabled, selected, local, dx, dy],
  );
  return (
    <>
      {loc.accuracy != null && loc.accuracy > 15 && (
        <Circle center={[loc.lat, loc.lon]} radius={loc.accuracy} pathOptions={{ color: ACCENT, weight: 1, fillOpacity: 0.1, interactive: false }} />
      )}
      <Marker position={[loc.lat, loc.lon]} icon={icon} eventHandlers={{ click: onClick }} zIndexOffset={selected ? 1000 : 0} />
    </>
  );
}
