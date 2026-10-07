import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { useRealtime } from "../api/realtime";
import { useConfig, useDevices, useNotifications, useViewers } from "../api/queries";
import type { User } from "../api/types";
import { DeviceRuntime } from "../device-runtime/DeviceRuntime";
import { AppFooter } from "../features/about/AppFooter";
import { useI18n } from "../i18n";
import { useStore } from "../lib/store";
import { toasts } from "../lib/ui-state";
import { MapButtons, TabMap } from "../map/TabMap";
import { localDeviceFor, localDeviceStore } from "../reporter/storage";
import { reporterStatus } from "../reporter/useReporter";
import { Icon, type IconName } from "../ui/icons";
import { BottomSheet } from "./BottomSheet";
import { activeTab } from "./tabs";

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

function TabBar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { data: notes } = useNotifications();
  const { data: devices } = useDevices();
  const unread = notes?.filter((n) => !n.read_at).length ?? 0;
  const active = activeTab(pathname, devices);
  const tabs: { to: string; label: string; icon: IconName; badge?: number }[] = [
    { to: "/people", label: t("tabs.people"), icon: "person" },
    { to: "/devices", label: t("tabs.devices"), icon: "laptop" },
    { to: "/items", label: t("tabs.items"), icon: "tag" },
    { to: "/me", label: t("tabs.me"), icon: "me", badge: unread },
  ];
  return (
    <nav className="tabbar" aria-label={t("a11y.mainNav")}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={`tab${tab.to === active ? " active" : ""}`}
          aria-current={tab.to === active ? "page" : undefined}
          data-testid={`tab-${tab.to.slice(1)}`}
        >
          <Icon name={tab.icon} size={22} />
          <span>{tab.label}</span>
          {tab.badge ? <span className="badge">{tab.badge}</span> : null}
        </Link>
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
  useStore(localDeviceStore);
  const local = localDeviceFor(me.id);
  const [showOffline, setShowOffline] = useState(false);
  const { pathname } = useLocation();
  const scroller = useRef<HTMLDivElement>(null);

  // A new page starts at its top, not where the previous one was scrolled to.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Only show the banner if the socket stays down for a bit.
  useEffect(() => {
    if (connected || !client) return setShowOffline(false);
    const id = setTimeout(() => setShowOffline(true), 4000);
    return () => clearTimeout(id);
  }, [connected, client]);

  const panel = (
    <>
      {!mobile && <TabBar />}
      <div className="panel-scroll" ref={scroller}>
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
      <div className="safe-area" aria-hidden />
      {config && (
        <TabMap
          me={me}
          tileUrl={dark ? config.map.tile_url_dark : config.map.tile_url}
          // Without a map of its own for the night, the day map in night colours.
          night={dark && config.map.tile_url_dark === config.map.tile_url}
          attribution={config.map.attribution}
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
