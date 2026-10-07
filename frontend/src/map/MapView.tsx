import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { useNavigate } from "react-router";
import type { Device, LocationPoint, Person, Zone } from "../api/types";
import { useI18n } from "../i18n";
import { useStore } from "../lib/store";
import { pointAtTap } from "../lib/trace";
import { mapUi, patchMapUi } from "../lib/ui-state";
import { avatarTone, deviceGlyphSvg, initials } from "../ui/icons";

const ACCENT = "#0a66e8";
const ZONE = "#8e44d6";

type Props = {
  tileUrl: string;
  attribution: string;
  devices: Device[];
  people: Person[];
  zones: Zone[];
  localDeviceId: string | null;
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

function personIcon(p: Person, selected: boolean) {
  // The photo covers the initials, which still show if it cannot be loaded (no inline onerror
  // under the CSP). JSON quoting makes a CSS string, HTML escaping keeps it in the attribute.
  const photo = p.user.avatar_url
    ? `<span class="pin-photo" style="background-image:url(${escapeHtml(JSON.stringify(p.user.avatar_url))})"></span>`
    : "";
  return L.divIcon({
    className: "pin-wrap",
    html: `<div class="pin pin-person ${avatarTone(p.user.id)}${selected ? " is-selected" : ""}" data-testid="marker-person-${p.user.id}" title="${escapeHtml(p.user.display_name)}">${escapeHtml(initials(p.user.display_name))}${photo}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/** Pixel offsets that fan out markers overlapping on screen at the current zoom, so none hides another. */
function spreadOffsets(devices: Device[], project: (lat: number, lon: number) => L.Point): Map<string, [number, number]> {
  const clusters: { members: { id: string; p: L.Point }[]; center: L.Point }[] = [];
  for (const d of devices) {
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

function Controller({ points }: { points: [number, number][] }) {
  const map = useMap();
  const ui = useStore(mapUi);
  const didFit = useRef(false);
  const historyPoint = ui.history?.find((p) => p.ts === ui.historyAt);

  useEffect(() => {
    if (ui.focus) flyToVisible(map, ui.focus.lat, ui.focus.lon, ui.focus.zoom ?? Math.max(map.getZoom(), 15));
  }, [ui.focus, map]);

  useEffect(() => {
    if (didFit.current || points.length === 0) return;
    didFit.current = true;
    map.fitBounds(L.latLngBounds(points), fitOptions(map, 18));
  }, [points, map]);

  useEffect(() => {
    if (!ui.history?.length) return;
    map.fitBounds(L.latLngBounds(ui.history.map((p) => [p.lat, p.lon] as [number, number])), fitOptions(map, 17));
  }, [ui.history, map]);

  // Follow the picked moment while scrubbing, without losing the zoom chosen on the trace.
  useEffect(() => {
    if (historyPoint) panIntoView(map, historyPoint.lat, historyPoint.lon);
  }, [historyPoint, map]);

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
function BaseLayer({ url, attribution }: { url: string; attribution: string }) {
  if (url.includes("{z}")) return <TileLayer url={url} attribution={attribution} maxZoom={19} />;
  return <VectorLayer styleUrl={url} attribution={attribution} />;
}

function VectorLayer({ styleUrl, attribution }: { styleUrl: string; attribution: string }) {
  const map = useMap();
  useEffect(() => {
    let layer: L.Layer | null = null;
    let cancelled = false;
    // MapLibre is large: load it only when a vector map is used.
    void Promise.all([
      import("maplibre-gl"),
      import("@maplibre/maplibre-gl-leaflet"),
      // MapLibre looks for its worker next to its own module, which bundling moves: point to it.
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([maplibre, { maplibreGL }, { default: workerUrl }]) => {
      if (cancelled) return;
      maplibre.setWorkerUrl(workerUrl);
      layer = maplibreGL({ style: styleUrl, attribution } as L.LeafletMaplibreGLOptions);
      layer.addTo(map);
    });
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, styleUrl, attribution]);
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

function HistoryLayer({ points, pickedTs }: { points: LocationPoint[]; pickedTs: string | null }) {
  const map = useMap();
  const { dateTime } = useI18n();
  // Points are a few pixels wide: take any tap near the trace, and clear the pick elsewhere.
  useMapEvents({
    click(e) {
      const i = pointAtTap(
        points.map((p) => map.latLngToContainerPoint([p.lat, p.lon])),
        e.containerPoint,
        TAP_TOLERANCE,
      );
      patchMapUi({ historyAt: i >= 0 ? points[i].ts : null });
    },
  });
  const line = points.map((p) => [p.lat, p.lon] as [number, number]);
  const picked = points.find((p) => p.ts === pickedTs);
  return (
    <>
      <Polyline positions={line} pathOptions={{ color: ACCENT, weight: 4, opacity: 0.8 }} />
      {points.map((p, i) => (
        <CircleMarker
          key={p.ts}
          center={[p.lat, p.lon]}
          radius={i === points.length - 1 ? 7 : 4}
          className="history-point"
          pathOptions={{ color: "#fff", weight: 1.5, fillColor: i === 0 ? "#30b350" : ACCENT, fillOpacity: 1 }}
        />
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

export function MapView({ tileUrl, attribution, devices, people, zones, localDeviceId }: Props) {
  const ui = useStore(mapUi);
  const navigate = useNavigate();

  const points = useMemo(() => {
    const pts: [number, number][] = [];
    devices.forEach((d) => d.location && pts.push([d.location.lat, d.location.lon]));
    people.forEach((p) => p.location && pts.push([p.location.lat, p.location.lon]));
    return pts;
  }, [devices, people]);

  return (
    <MapContainer center={[46.6, 2.4]} zoom={5} maxZoom={19} zoomControl={false} className="map" worldCopyJump>
      <BaseLayer key={tileUrl} url={tileUrl} attribution={attribution} />
      <Controller points={points} />

      {zones.map((z) => (
        <Circle key={z.id} center={[z.lat, z.lon]} radius={z.radius_m} pathOptions={{ color: ZONE, weight: 2, fillOpacity: 0.08, dashArray: "6 6" }}>
          {/* Below the centre, so a device at home does not hide the place's name. */}
          <Tooltip direction="center" offset={[0, 32]} permanent className="zone-label">
            {z.name}
          </Tooltip>
        </Circle>
      ))}
      {ui.draftZone && (
        <Circle center={[ui.draftZone.lat, ui.draftZone.lon]} radius={ui.draftZone.radius_m} pathOptions={{ color: "#f59e0b", weight: 2, fillOpacity: 0.15 }} />
      )}
      {ui.history && ui.history.length > 0 && <HistoryLayer points={ui.history} pickedTs={ui.historyAt} />}

      <DeviceLayer devices={devices} localDeviceId={localDeviceId} onOpen={(id) => navigate(`/devices/${id}`)} />
      {people.map((p) =>
        p.location ? (
          <PersonMarker
            key={p.user.id}
            person={p}
            selected={ui.selected?.kind === "person" && ui.selected.id === p.user.id}
            onClick={() => navigate(`/people/${p.user.id}`)}
          />
        ) : null,
      )}
    </MapContainer>
  );
}

function PersonMarker({ person, selected, onClick }: { person: Person; selected: boolean; onClick: () => void }) {
  const loc = person.location!;
  const { id, display_name, avatar_url } = person.user;
  // A new icon replaces the pin's HTML: only on changes, so the photo does not flicker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const icon = useMemo(() => personIcon(person, selected), [id, display_name, avatar_url, selected]);
  return <Marker position={[loc.lat, loc.lon]} icon={icon} eventHandlers={{ click: onClick }} />;
}

const NO_OFFSET: [number, number] = [0, 0];

function DeviceLayer({ devices, localDeviceId, onOpen }: { devices: Device[]; localDeviceId: string | null; onOpen: (id: string) => void }) {
  const map = useMap();
  const ui = useStore(mapUi);
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const offsets = useMemo(() => spreadOffsets(devices, (lat, lon) => map.project([lat, lon], zoom)), [devices, zoom, map]);
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
