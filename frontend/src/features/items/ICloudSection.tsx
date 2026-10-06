import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { ICloudDevice } from "../../api/types";
import { useI18n } from "../../i18n";
import { Section } from "../../ui/components";
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
      {connected && (
        <ul className="list">
          {available?.map((d) => (
            <li key={d.icloud_device_id} className="row">
              <span className="row-main">
                <span className="row-title">{d.name}</span>
                <span className="row-sub">{d.model}</span>
              </span>
              {d.tracked_device_id ? (
                <span className="chip">{t("items.tracked")}</span>
              ) : (
                <button className="btn btn-small" onClick={() => track.mutate(d)} disabled={track.isPending}>
                  {t("items.track")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
