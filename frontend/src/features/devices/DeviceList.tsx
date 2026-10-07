import { Link } from "react-router";
import { useDevices, useMe } from "../../api/queries";
import type { Device } from "../../api/types";
import { useI18n } from "../../i18n";
import { haversineM } from "../../lib/geo";
import { useStore } from "../../lib/store";
import { localDeviceFor, localDeviceStore } from "../../reporter/storage";
import { reporterStatus } from "../../reporter/useReporter";
import { BatteryBadge, Empty, PanelHeader } from "../../ui/components";
import { DeviceGlyph } from "../../ui/icons";

export function DeviceRow({ device, isLocal, from }: { device: Device; isLocal: boolean; from: { lat: number; lon: number } | null }) {
  const { t, relTime, distance } = useI18n();
  const loc = device.location;
  const dist = from && loc && !isLocal ? haversineM(from.lat, from.lon, loc.lat, loc.lon) : null;
  return (
    <Link to={`/devices/${device.id}`} className="row" data-testid={`device-item-${device.id}`}>
      <span className={`row-avatar row-avatar-device${device.online ? " is-online" : ""}`}>
        <DeviceGlyph icon={device.icon} size={30} />
      </span>
      <span className="row-main">
        <span className="row-title">
          {device.name}
          {device.lost_mode.enabled && <span className="chip chip-danger">{t("devices.lost")}</span>}
        </span>
        <span className="row-sub">
          {isLocal ? t("devices.thisDevice") : loc ? t("devices.updated", { time: relTime(loc.ts) }) : t("devices.noLocation")}
          {dist != null && ` · ${t("devices.distance", { distance: distance(dist) })}`}
        </span>
      </span>
      <span className="row-end">
        <BatteryBadge battery={device.battery} />
      </span>
    </Link>
  );
}

export function DeviceList() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: devices, isLoading } = useDevices();
  useStore(localDeviceStore);
  const status = useStore(reporterStatus);
  const local = localDeviceFor(me?.id);
  const localDev = devices?.find((d) => d.id === local?.id);
  const from = status.lastFix ?? localDev?.location ?? null;
  const list = (devices ?? []).filter((d) => d.kind === "browser" || d.kind === "owntracks" || d.kind === "icloud");

  return (
    <div data-testid="devices-panel">
      <PanelHeader title={t("devices.title")} />
      {isLoading && <Empty>{t("common.loading")}</Empty>}
      {!isLoading && list.length === 0 && <Empty>{t("devices.empty")}</Empty>}
      <div className="list">
        {list.map((d) => (
          <DeviceRow key={d.id} device={d} isLocal={d.id === local?.id} from={from} />
        ))}
      </div>
    </div>
  );
}
