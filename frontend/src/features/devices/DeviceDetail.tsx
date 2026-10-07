import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../../api/client";
import { keys, useCommands, useDevices, useMe } from "../../api/queries";
import type { Command, Device } from "../../api/types";
import { useI18n } from "../../i18n";
import { directionsUrl } from "../../lib/geo";
import { focusOn, patchMapUi, toast } from "../../lib/ui-state";
import { useStore } from "../../lib/store";
import { localDeviceFor, localDeviceStore } from "../../reporter/storage";
import { ActionButton, BatteryBadge, Empty, Field, PanelHeader, Section } from "../../ui/components";
import { DeviceGlyph } from "../../ui/icons";
import { ItemIconPicker } from "../items/ItemIconPicker";

function CommandStatus({ cmd }: { cmd: Command | undefined }) {
  const { t } = useI18n();
  if (!cmd || cmd.type !== "play_sound") return null;
  const text = {
    pending: t("command.pending"),
    delivered: t("command.delivered"),
    acked: t("command.acked"),
    failed: cmd.error ? `${t("command.failed")}: ${cmd.error}` : t("command.failed"),
    expired: t("command.expired"),
  }[cmd.status];
  return (
    <p className={`command-status status-${cmd.status}`} data-testid="command-status" data-status={cmd.status}>
      {text}
    </p>
  );
}

function LostModeForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const native = device.kind === "icloud";
  const [message, setMessage] = useState(device.lost_mode.message ?? "");
  const [phone, setPhone] = useState(device.lost_mode.phone ?? "");
  const send = useMutation({
    mutationFn: (type: "lost_mode_on" | "lost_mode_off") =>
      api<Command>(`/devices/${device.id}/commands`, { method: "POST", body: { type, message, phone } }),
    onSuccess: (cmd) => {
      void qc.invalidateQueries({ queryKey: keys.devices });
      if (cmd.status === "failed") toast(t("command.failed"), cmd.error ?? undefined, "error");
      else toast(cmd.type === "lost_mode_on" ? t("command.lostOn") : t("command.lostOff"), undefined, "success");
      onDone();
    },
  });
  return (
    <Section title={t("lost.title")} testId="lost-form">
      <p className="muted">{native ? t("lost.explainNative") : t("lost.explain")}</p>
      {!device.lost_mode.enabled ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (native && !window.confirm(t("lost.confirmNative"))) return;
            send.mutate("lost_mode_on");
          }}
        >
          <Field label={t("lost.message")}>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder={t("lost.messagePlaceholder")} name="lost-message" />
          </Field>
          <Field label={t("lost.phone")}>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} name="lost-phone" />
          </Field>
          <button className="btn btn-danger btn-block" disabled={send.isPending} data-testid="lost-enable">
            {t("lost.enable")}
          </button>
        </form>
      ) : (
        <>
          {native && <p className="muted small">{t("lost.disableNative")}</p>}
          <button className="btn btn-block" onClick={() => send.mutate("lost_mode_off")} disabled={send.isPending} data-testid="lost-disable">
            {t("lost.disable")}
          </button>
        </>
      )}
    </Section>
  );
}

export function DeviceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t, relTime } = useI18n();
  const { data: me } = useMe();
  const { data: devices, isLoading } = useDevices();
  const { data: commands } = useCommands(id);
  useStore(localDeviceStore);
  const [showLost, setShowLost] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const device = devices?.find((d) => d.id === id);
  const local = localDeviceFor(me?.id);

  useEffect(() => {
    patchMapUi({ selected: { kind: "device", id } });
    return () => patchMapUi({ selected: null });
  }, [id]);

  const lat = device?.location?.lat;
  const lon = device?.location?.lon;
  useEffect(() => {
    if (lat != null && lon != null) focusOn(lat, lon);
    // Only when opening the device, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lat == null]);

  const command = useMutation({
    mutationFn: (type: "play_sound") => api<Command>(`/devices/${id}/commands`, { method: "POST", body: { type } }),
    onSuccess: (cmd) => qc.setQueryData<Command[]>(keys.commands(id), (l) => [cmd, ...(l ?? []).filter((c) => c.id !== cmd.id)]),
    onError: (e) => toast(t("command.failed"), e instanceof ApiError ? e.detail : undefined, "error"),
  });
  const refresh = useMutation({
    mutationFn: () => api(`/devices/${id}/refresh`, { method: "POST" }),
    onError: (e) => toast(t("command.failed"), e instanceof ApiError ? e.detail : undefined, "error"),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/devices/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.devices }),
    onError: (e) => toast(t("common.error"), e instanceof ApiError ? e.detail : undefined, "error"),
  });
  const setPrimary = useMutation({
    mutationFn: () => api("/me", { method: "PATCH", body: { primary_device_id: id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.devices });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/devices/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      if (local?.id === id) localDeviceStore.set(null);
      void qc.invalidateQueries({ queryKey: keys.devices });
      navigate("/devices");
    },
  });

  if (isLoading) return <Empty>{t("common.loading")}</Empty>;
  if (!device) return <PanelHeader title={t("common.error")} back="/devices" />;

  const loc = device.location;
  const can = (c: string) => device.capabilities.includes(c);
  const last = commands?.[0];

  return (
    <div data-testid="device-detail">
      <PanelHeader
        title={
          <span className="detail-title">
            <span className="row-avatar row-avatar-device">
              <DeviceGlyph icon={device.icon} size={26} />
            </span>
            <span>{device.name}</span>
          </span>
        }
        back="/devices"
        right={<BatteryBadge battery={device.battery} />}
      />
      <div className="detail-meta">
        <span className={`dot${device.online ? " on" : ""}`} />
        <span>
          {device.online
            ? t("devices.online")
            : device.last_seen_at
              ? t("devices.lastSeen", { time: relTime(device.last_seen_at) })
              : t("devices.neverSeen")}
        </span>
        <span className="muted">· {t(`devices.kind.${device.kind}`)}</span>
        {device.is_primary && <span className="chip">{t("devices.primary")}</span>}
      </div>
      {loc ? (
        <p className="coords" data-testid="device-coords">
          {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
          {loc.accuracy != null && ` · ${t("devices.accuracy", { meters: Math.round(loc.accuracy) })}`}
          <span className="muted"> · {relTime(loc.ts)}</span>
        </p>
      ) : (
        <p className="muted">{t("devices.noLocation")}</p>
      )}
      {device.kind === "findmy" && <p className="muted small">{t("items.delay")}</p>}

      <div className="actions">
        <ActionButton
          icon="sound"
          label={t("actions.playSound")}
          onClick={() => command.mutate("play_sound")}
          disabled={!can("play_sound") || command.isPending}
          title={can("play_sound") ? undefined : t("actions.unsupported")}
          testId="btn-play-sound"
        />
        <ActionButton icon="route" label={t("actions.directions")} href={loc ? directionsUrl(loc.lat, loc.lon) : undefined} disabled={!loc} testId="btn-directions" />
        <ActionButton
          icon="lock"
          label={t("actions.lostMode")}
          onClick={() => setShowLost((v) => !v)}
          disabled={!can("lost_mode")}
          title={can("lost_mode") ? undefined : t("actions.unsupported")}
          testId="btn-lost-mode"
        />
        <ActionButton icon="clock" label={t("actions.history")} onClick={() => navigate(`/devices/${id}/history`)} testId="btn-history" />
        {can("refresh") && <ActionButton icon="refresh" label={t("actions.refresh")} onClick={() => refresh.mutate()} disabled={refresh.isPending} />}
      </div>
      <CommandStatus cmd={last} />
      {device.lost_mode.enabled && !showLost && (
        <p className="banner banner-danger" data-testid="lost-banner">
          {t("command.lostOn")}
          {device.lost_mode.message ? ` — “${device.lost_mode.message}”` : ""}
        </p>
      )}
      {showLost && <LostModeForm device={device} onDone={() => setShowLost(false)} />}

      <Section>
        {renaming ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name") as string;
              patch.mutate({ name });
              setRenaming(false);
            }}
          >
            <input name="name" defaultValue={device.name} maxLength={80} autoFocus />
            <button className="btn btn-primary">{t("common.save")}</button>
          </form>
        ) : (
          <button className="link-row" onClick={() => setRenaming(true)}>
            {t("actions.rename")}
          </button>
        )}
        {/* Only tags: on iCloud devices the icon decides between the Devices and Items tabs. */}
        {device.kind === "findmy" && (
          <>
            <button className="link-row" onClick={() => setPickingIcon((v) => !v)} aria-expanded={pickingIcon} data-testid="btn-item-icon">
              {t("items.changeIcon")}
            </button>
            {pickingIcon && (
              <ItemIconPicker
                value={device.icon}
                onPick={(icon) => {
                  patch.mutate({ icon });
                  setPickingIcon(false);
                }}
              />
            )}
          </>
        )}
        {!device.is_primary && (device.kind === "browser" || device.kind === "owntracks" || device.kind === "icloud") && (
          <button className="link-row" onClick={() => setPrimary.mutate()}>
            {t("actions.setPrimary")}
          </button>
        )}
        <button
          className="link-row danger"
          onClick={() => window.confirm(t("actions.removeConfirm", { name: device.name })) && remove.mutate()}
          data-testid="btn-remove-device"
        >
          {t("actions.remove")}
        </button>
      </Section>
    </div>
  );
}
