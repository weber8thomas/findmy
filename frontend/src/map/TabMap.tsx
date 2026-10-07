import { useMemo } from "react";
import { useLocation } from "react-router";
import { useDevices, useMyLocation, usePeople, useZones } from "../api/queries";
import type { Device, Person, User, Zone } from "../api/types";
import { useI18n } from "../i18n";
import { useStore } from "../lib/store";
import { focusOn } from "../lib/ui-state";
import { reporterStatus } from "../reporter/useReporter";
import { Icon } from "../ui/icons";
import { MapView, type Face } from "./MapView";
import { mapScope, visibleDevices } from "./scope";

const NO_DEVICES: Device[] = [];
const NO_PEOPLE: Person[] = [];
const NO_ZONES: Zone[] = [];

/** The map of the current tab: faces on People, devices on Devices, items on Items, me on Me. */
export function TabMap({
  me,
  tileUrl,
  attribution,
  localDeviceId,
}: {
  me: User;
  tileUrl: string;
  attribution: string;
  localDeviceId: string | null;
}) {
  const { pathname } = useLocation();
  const devices = useDevices();
  const people = usePeople();
  const zones = useZones();
  const mine = useMyLocation();
  const scope = mapScope(pathname, devices.data);
  const all = devices.data ?? NO_DEVICES;

  const shown = useMemo(
    () => visibleDevices(scope, all),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, scope.tab, scope.deviceId],
  );
  const myLocation = mine.data?.location;
  const faces = useMemo(() => {
    const out: Face[] = [];
    if (scope.me && myLocation) out.push({ user: me, location: myLocation, isMe: true });
    if (scope.people)
      for (const p of people.data ?? NO_PEOPLE) if (p.location) out.push({ user: p.user, location: p.location });
    return out;
  }, [scope.me, scope.people, myLocation, me, people.data]);

  return (
    <MapView
      tileUrl={tileUrl}
      attribution={attribution}
      devices={shown}
      faces={faces}
      zones={scope.zones ? (zones.data ?? NO_ZONES) : NO_ZONES}
      localDeviceId={localDeviceId}
      tab={scope.tab}
      detail={scope.detail}
      ready={devices.isFetched && people.isFetched && zones.isFetched && mine.isFetched}
    />
  );
}

export function MapButtons({ localDeviceId }: { localDeviceId: string | null }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const status = useStore(reporterStatus);
  const { data: devices } = useDevices();
  const { data: mine } = useMyLocation();
  const locate = () => {
    // Where this tab shows me: my face on People and Me, this browser elsewhere.
    const face = mapScope(pathname, devices).me ? mine?.location : null;
    const fix = face ?? status.lastFix ?? devices?.find((d) => d.id === localDeviceId)?.location;
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
