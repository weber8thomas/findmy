import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { keys, useDevices } from "../../api/queries";
import type { Device, User } from "../../api/types";
import { unlockAudio } from "../../device-runtime/sound";
import { useI18n } from "../../i18n";
import { detectPlatform, guessDeviceName } from "../../lib/geo";
import { rebindPush } from "../../lib/push";
import { useStore } from "../../lib/store";
import { localDeviceFor, localDeviceStore, prefsStore } from "../../reporter/storage";
import { getReporter, reporterStatus } from "../../reporter/useReporter";
import { Field, Section, Toggle } from "../../ui/components";

function ReporterStatusView() {
  const { t, relTime } = useI18n();
  const s = useStore(reporterStatus);
  const platform = detectPlatform();
  return (
    <div className="reporter-status" data-testid="reporter-status" data-state={s.state}>
      <p className={`status-line state-${s.state}`}>
        <span className={`dot${s.state === "active" ? " on" : ""}`} /> {t(`me.status.${s.state}`)}
      </p>
      {s.lastFix && (
        <p className="muted small" data-testid="reporter-last-fix">
          {t("me.lastFix", { time: relTime(s.lastFix.time), meters: Math.round(s.lastFix.accuracy ?? 0) })}
          {s.lastSentAt && ` · ${t("me.lastSent", { time: relTime(s.lastSentAt) })}`}
        </p>
      )}
      {s.queued > 0 && <p className="muted small">{t("me.queued", { count: s.queued })}</p>}
      {s.state === "denied" && (
        <div className="banner banner-danger">
          <p>{t("me.permissionDenied")}</p>
          <p className="small">{t(`me.permissionHelp.${platform}`)}</p>
        </div>
      )}
    </div>
  );
}

export function ThisDevice({ me }: { me: User }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  useStore(localDeviceStore);
  const prefs = useStore(prefsStore);
  const { data: devices, isFetching } = useDevices();
  const local = localDeviceFor(me.id);
  const guess = guessDeviceName();
  const [name, setName] = useState(guess.name);

  // The device was removed from another browser: forget it here too.
  useEffect(() => {
    if (local && devices && !isFetching && !devices.some((d) => d.id === local.id)) {
      localDeviceStore.set(null);
      prefsStore.set((p) => ({ ...p, sharing: false }));
    }
  }, [local, devices, isFetching]);

  const register = useMutation({
    mutationFn: () =>
      api<{ device: Device; device_token: string }>("/devices", {
        method: "POST",
        body: { name: name.trim() || guess.name, kind: "browser", icon: guess.icon },
      }),
    onSuccess: (res) => {
      qc.setQueryData<Device[]>(keys.devices, (list) => [...(list ?? []), res.device]);
      localDeviceStore.set({ id: res.device.id, token: res.device_token, name: res.device.name, userId: me.id });
      prefsStore.set((p) => ({ ...p, sharing: true }));
      void qc.invalidateQueries({ queryKey: keys.devices });
      void qc.invalidateQueries({ queryKey: keys.me });
      void rebindPush(res.device.id).catch(() => undefined);
    },
  });

  const forget = useMutation({
    mutationFn: () => api(`/devices/${local!.id}`, { method: "DELETE" }),
    onSettled: () => {
      prefsStore.set((p) => ({ ...p, sharing: false }));
      localDeviceStore.set(null);
      void qc.invalidateQueries({ queryKey: keys.devices });
    },
  });

  if (!local) {
    return (
      <Section title={t("me.thisDevice")} testId="this-device">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            unlockAudio();
            register.mutate();
          }}
        >
          <Field label={t("me.deviceName")}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} name="device-name" />
          </Field>
          <button className="btn btn-primary btn-block" disabled={register.isPending} data-testid="btn-register-device">
            {t("me.register")}
          </button>
        </form>
        <p className="muted small">{t("me.backgroundWarning")}</p>
      </Section>
    );
  }

  return (
    <Section title={`${t("me.thisDevice")} · ${local.name}`} testId="this-device">
      <Toggle
        label={t("me.sharing")}
        checked={prefs.sharing}
        onChange={(v) => {
          unlockAudio();
          prefsStore.set((p) => ({ ...p, sharing: v }));
        }}
        testId="toggle-sharing"
      />
      <ReporterStatusView />
      {prefs.sharing && (
        <>
          <button className="btn btn-block" onClick={() => getReporter()?.requestNow(true)} data-testid="btn-update-now">
            {t("me.updateNow")}
          </button>
          <Toggle label={t("me.keepAwake")} checked={prefs.keepAwake} onChange={(v) => prefsStore.set((p) => ({ ...p, keepAwake: v }))} />
          <Toggle label={t("me.highAccuracy")} checked={prefs.highAccuracy} onChange={(v) => prefsStore.set((p) => ({ ...p, highAccuracy: v }))} />
        </>
      )}
      <p className="muted small">{t("me.backgroundWarning")}</p>
      <button className="link-row danger" onClick={() => window.confirm(t("me.unregisterConfirm")) && forget.mutate()}>
        {t("me.unregister")}
      </button>
    </Section>
  );
}
