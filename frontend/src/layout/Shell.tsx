import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useRealtime } from "../api/realtime";
import { useConfig, useDevices, useNotifications, usePeople, useViewers, useZones } from "../api/queries";
import type { User } from "../api/types";
import { DeviceRuntime } from "../device-runtime/DeviceRuntime";
import { AppFooter } from "../features/about/AppFooter";
import { useI18n } from "../i18n";
import { useStore } from "../lib/store";
import { focusOn, toasts } from "../lib/ui-state";
import { MapView } from "../map/MapView";
import { localDeviceFor, localDeviceStore } from "../reporter/storage";
import { reporterStatus } from "../reporter/useReporter";
import { Icon, type IconName } from "../ui/icons";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

// Tablets get the side panel in both orientations, like Find My on iPad (an 11" iPad is 834px wide).
const useIsMobile = () => useMediaQuery("(max-width: 767px)");

const SNAPS = [0.18, 0.5, 0.88];

function BottomSheet({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [snap, setSnap] = useState(1);
  const [dragH, setDragH] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);
  const location = useLocation();

  // Opening a detail view raises the sheet so actions are visible.
  useEffect(() => {
    setSnap((s) => (s === 0 ? 1 : s));
  }, [location.pathname]);

  const vh = window.innerHeight;
  const height = dragH ?? SNAPS[snap] * vh;

  return (
    <section className="sheet" style={{ height }} data-testid="bottom-sheet" data-snap={snap}>
      <div
        className="sheet-handle"
        role="slider"
        aria-label={t("a11y.resizePanel")}
        aria-valuenow={snap}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const h = Math.min(vh * 0.95, Math.max(80, start.current.h + start.current.y - e.clientY));
          setDragH(h);
        }}
        onPointerUp={() => {
          if (!start.current) return;
          const h = dragH ?? start.current.h;
          let best = 0;
          SNAPS.forEach((s, i) => {
            if (Math.abs(s * vh - h) < Math.abs(SNAPS[best] * vh - h)) best = i;
          });
          start.current = null;
          setDragH(null);
          setSnap(best);
        }}
        onClick={() => !dragH && setSnap((s) => (s + 1) % SNAPS.length)}
      >
        <span />
      </div>
      <div className="sheet-body">{children}</div>
    </section>
  );
}

function TabBar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { data: notes } = useNotifications();
  const unread = notes?.filter((n) => !n.read_at).length ?? 0;
  // `also`: pages reached from a tab without living under its path (Settings is opened from Me).
  const tabs: { to: string; label: string; icon: IconName; badge?: number; also?: string[] }[] = [
    { to: "/people", label: t("tabs.people"), icon: "person" },
    { to: "/devices", label: t("tabs.devices"), icon: "laptop" },
    { to: "/items", label: t("tabs.items"), icon: "tag" },
    { to: "/me", label: t("tabs.me"), icon: "me", badge: unread, also: ["/settings", "/privacy"] },
  ];
  return (
    <nav className="tabbar" aria-label={t("a11y.mainNav")}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => `tab${isActive || tab.also?.includes(pathname) ? " active" : ""}`}
          data-testid={`tab-${tab.to.slice(1)}`}
        >
          <Icon name={tab.icon} size={22} />
          <span>{tab.label}</span>
          {tab.badge ? <span className="badge">{tab.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

function Toasts() {
  const list = useStore(toasts);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone ?? "info"}`} data-testid="toast">
          <strong>{t.title}</strong>
          {t.body && <span>{t.body}</span>}
        </div>
      ))}
    </div>
  );
}

function MapButtons({ localDeviceId }: { localDeviceId: string | null }) {
  const { t } = useI18n();
  const status = useStore(reporterStatus);
  const { data: devices } = useDevices();
  const locate = () => {
    const fix = status.lastFix ?? devices?.find((d) => d.id === localDeviceId)?.location;
    if (fix) focusOn(fix.lat, fix.lon, 16);
    else
      navigator.geolocation?.getCurrentPosition(
        (p) => focusOn(p.coords.latitude, p.coords.longitude, 16),
        () => undefined,
      );
  };
  return (
    <div className="map-buttons">
      <button className="map-btn" onClick={locate} title={t("map.locateMe")} aria-label={t("map.locateMe")}>
        <Icon name="locate" />
      </button>
    </div>
  );
}

/** Always-visible reminder that this browser is sharing its location, and with whom. */
function SharingIndicator() {
  const { t } = useI18n();
  const status = useStore(reporterStatus);
  const { data: viewers } = useViewers();
  if (status.state === "idle") return null;
  const names = viewers?.map((v) => v.recipient.display_name) ?? [];
  return (
    <div className="sharing-indicator" data-testid="sharing-indicator">
      <span className={`dot${status.state === "active" ? " on" : ""}`} />
      <span>
        {t("me.sharingOn")}
        {names.length > 0 && ` · ${t("me.sharedWith", { names: names.join(", ") })}`}
      </span>
    </div>
  );
}

export function Shell({ me }: { me: User }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const { connected, client } = useRealtime();
  const { data: config } = useConfig();
  const { data: devices = [] } = useDevices();
  const { data: people = [] } = usePeople();
  const { data: zones = [] } = useZones();
  useStore(localDeviceStore);
  const local = localDeviceFor(me.id);
  const [showOffline, setShowOffline] = useState(false);

  // Only show the banner if the socket stays down for a bit.
  useEffect(() => {
    if (connected || !client) return setShowOffline(false);
    const id = setTimeout(() => setShowOffline(true), 4000);
    return () => clearTimeout(id);
  }, [connected, client]);

  const panel = (
    <>
      {!mobile && <TabBar />}
      <div className="panel-scroll">
        <div className="panel-content">
          <Outlet />
        </div>
        <footer className="panel-foot">
          <AppFooter />
        </footer>
      </div>
    </>
  );

  return (
    <div className={`shell ${mobile ? "is-mobile" : "is-desktop"}`}>
      {config && (
        <MapView
          tileUrl={dark ? config.map.tile_url_dark : config.map.tile_url}
          attribution={config.map.attribution}
          devices={devices}
          people={people}
          zones={zones}
          localDeviceId={local?.id ?? null}
        />
      )}
      <MapButtons localDeviceId={local?.id ?? null} />
      <SharingIndicator />
      {mobile ? <BottomSheet>{panel}</BottomSheet> : <aside className="panel">{panel}</aside>}
      {mobile && <TabBar />}
      {showOffline && <div className="offline-banner">{t("common.offlineBanner")}</div>}
      <Toasts />
      {local && <DeviceRuntime device={local} />}
    </div>
  );
}
