import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { keys, useDevices } from "../../api/queries";
import type { ICloudDevice } from "../../api/types";
import { useI18n } from "../../i18n";
import { Section } from "../../ui/components";
import { DeviceRow } from "../devices/DeviceList";
import { AppleAccount, useProviderAccount } from "./AppleAccount";

export function ICloudSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: account } = useProviderAccount("icloud");
  const connected = account?.state === "logged_in";
  const { data: available } = useQuery({
    queryKey: ["icloud-devices"],
    queryFn: () => api<ICloudDevice[]>("/providers/icloud/devices"),
    enabled: connected,
  });
  const { data: devices } = useDevices();
  const untracked = available?.filter((d) => !d.tracked_device_id) ?? [];
  const trackAll = useMutation({
    mutationFn: async () => {
      for (const d of untracked) {
        await api("/providers/icloud/devices", { method: "POST", body: { icloud_device_id: d.icloud_device_id, name: d.name } });
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["icloud-devices"] });
      void qc.invalidateQueries({ queryKey: keys.devices });
    },
  });
  const track = useMutation({
    mutationFn: (d: ICloudDevice) =>
      api("/providers/icloud/devices", { method: "POST", body: { icloud_device_id: d.icloud_device_id, name: d.name } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["icloud-devices"] });
      void qc.invalidateQueries({ queryKey: keys.devices });
    },
  });

  return (
    <Section title={t("items.icloud")} testId="icloud-section">
      <AppleAccount provider="icloud" />
      {connected && !available && <p className="muted small">{t("common.loading")}</p>}
      {connected && available?.length === 0 && <p className="banner banner-warning small">{t("items.noAppleDevices")}</p>}
      {connected && untracked.length > 1 && (
        <button className="btn btn-small" onClick={() => trackAll.mutate()} disabled={trackAll.isPending}>
          {t("items.trackAll", { count: String(untracked.length) })}
        </button>
      )}
      {connected && (
        <div className="list">
          {available?.map((d) => {
            const tracked = devices?.find((x) => x.id === d.tracked_device_id);
            if (tracked) return <DeviceRow key={d.icloud_device_id} device={tracked} isLocal={false} from={null} />;
            return (
              <div key={d.icloud_device_id} className="row">
                <span className="row-main">
                  <span className="row-title">{d.name}</span>
                  <span className="row-sub">{d.model}</span>
                </span>
                <button className="btn btn-small" onClick={() => track.mutate(d)} disabled={track.isPending}>
                  {t("items.track")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
