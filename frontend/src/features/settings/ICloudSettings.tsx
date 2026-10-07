import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { keys, useDevices } from "../../api/queries";
import type { ICloudDevice } from "../../api/types";
import { useI18n } from "../../i18n";
import { Section } from "../../ui/components";
import { AppleAccount, useProviderAccount } from "./AppleAccount";
import { SourcePage } from "./AppleSources";

function ICloudSection() {
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
  const inDevices = available?.filter((d) => devices?.some((x) => x.id === d.tracked_device_id)).length ?? 0;
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
    <>
      <Section title={t("settings.appleAccount")} testId="icloud-section">
        <p className="muted small">{t("settings.icloudExplain")}</p>
        <AppleAccount provider="icloud" />
      </Section>
      {connected && (
        <Section title={t("settings.icloudDevices")} testId="icloud-devices">
          {!available && <p className="muted small">{t("common.loading")}</p>}
          {available?.length === 0 && <p className="banner banner-warning small">{t("items.noAppleDevices")}</p>}
          {untracked.length > 1 && (
            <button className="btn btn-small" onClick={() => trackAll.mutate()} disabled={trackAll.isPending}>
              {t("items.trackAll", { count: String(untracked.length) })}
            </button>
          )}
          {inDevices > 0 && <p className="muted small">{t("items.inDevices", { count: String(inDevices) })}</p>}
          <div className="list">
            {available?.map((d) => {
              if (d.tracked_device_id) return null; // listed under Devices
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
        </Section>
      )}
    </>
  );
}

/** Settings › Apple devices (iCloud): the Apple account, and the devices not tracked yet. */
export function ICloudSettings() {
  return (
    <SourcePage provider="icloud">
      <ICloudSection />
    </SourcePage>
  );
}
