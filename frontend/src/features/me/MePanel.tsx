import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../api/client";
import { keys, useConfig, useDevices, useNotifications, useViewers } from "../../api/queries";
import type { Device, User } from "../../api/types";
import { useI18n, type Locale } from "../../i18n";
import { currentSubscription, enablePush, pushSupport } from "../../lib/push";
import { useStore } from "../../lib/store";
import { toast } from "../../lib/ui-state";
import { localDeviceFor, localDeviceStore } from "../../reporter/storage";
import { Empty, Field, PanelHeader, Section } from "../../ui/components";
import { Icon } from "../../ui/icons";
import { QrCode } from "../../ui/QrCode";
import { owntracksConfigUrl, owntracksDeviceId, trackerId } from "./owntracks";
import { ThisDevice } from "./ThisDevice";

export function Viewers() {
  const { t } = useI18n();
  const { data: viewers } = useViewers();
  const names = viewers?.map((v) => v.recipient.display_name) ?? [];
  return (
    <p className="muted" data-testid="viewers">
      {names.length ? t("me.sharedWith", { names: names.join(", ") }) : t("me.sharedWithOnlyYou")}
    </p>
  );
}

function Notifications({ me }: { me: User }) {
  const { t, relTime } = useI18n();
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const { data: notes } = useNotifications();
  useStore(localDeviceStore);
  const local = localDeviceFor(me.id);
  const [subscribed, setSubscribed] = useState(false);
  const support = pushSupport();

  useEffect(() => {
    currentSubscription()
      .then((s) => setSubscribed(Boolean(s) && Notification.permission === "granted"))
      .catch(() => undefined);
  }, []);

  const enable = useMutation({
    mutationFn: () => enablePush(config!.vapid_public_key!, local?.id ?? null),
    onSuccess: (ok) => setSubscribed(ok),
    onError: () => toast(t("common.error"), undefined, "error"),
  });
  const test = useMutation({ mutationFn: () => api("/push/test", { method: "POST" }) });
  const markAll = useMutation({
    mutationFn: () => api("/notifications/read", { method: "POST", body: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  const unread = notes?.filter((n) => !n.read_at).length ?? 0;

  return (
    <Section title={t("me.notifications")} testId="notifications">
      {!config?.features.push ? null : support === "needs-install" ? (
        <p className="muted small">{t("me.iosInstall")}</p>
      ) : support === "unsupported" ? (
        <p className="muted small">{t("me.notificationsUnsupported")}</p>
      ) : support === "denied" ? (
        <p className="muted small">{t("me.notificationsDenied")}</p>
      ) : subscribed ? (
        <div className="row-buttons">
          <span className="muted small">✓ {t("me.notificationsOn")}</span>
          <button className="btn btn-small" onClick={() => test.mutate()}>
            {t("me.testNotification")}
          </button>
        </div>
      ) : (
        <button className="btn btn-block" onClick={() => enable.mutate()} disabled={enable.isPending} data-testid="btn-enable-push">
          <Icon name="bell" /> {t("me.enableNotifications")}
        </button>
      )}
      {notes && notes.length === 0 && <Empty>{t("notifications.empty")}</Empty>}
      <ul className="notes">
        {notes?.slice(0, 10).map((n) => (
          <li key={n.id} className={n.read_at ? "" : "unread"} data-testid="notification-item">
            <strong>{n.payload.title}</strong>
            <span>{n.payload.body}</span>
            <span className="muted small">{relTime(n.created_at)}</span>
          </li>
        ))}
      </ul>
      {unread > 0 && (
        <button className="link-row" onClick={() => markAll.mutate()}>
          {t("notifications.markAll")}
        </button>
      )}
    </Section>
  );
}

function OwnTracksSetup({ me }: { me: User }) {
  const { t, relTime } = useI18n();
  const qc = useQueryClient();
  const { data: devices } = useDevices();
  const [created, setCreated] = useState<{ token: string } | null>(null);
  // The server keeps one OwnTracks device, the phone: this gives it a new password.
  const create = useMutation({
    mutationFn: () =>
      api<{ device: Device; device_token: string }>("/devices", {
        method: "POST",
        body: { name: t("owntracks.deviceName"), kind: "owntracks", icon: "phone" },
      }),
    onSuccess: (res) => {
      setCreated({ token: res.device_token });
      void qc.invalidateQueries({ queryKey: keys.devices });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
  // The one the server reuses: the latest position wins.
  const phone = devices
    ?.filter((d) => d.kind === "owntracks")
    .sort((a, b) => (b.location?.ts ?? "").localeCompare(a.location?.ts ?? ""))[0];
  const url = `${location.origin}/api/owntracks`;
  const configUrl =
    created &&
    owntracksConfigUrl({
      url,
      username: me.email,
      password: created.token,
      deviceId: owntracksDeviceId(me.display_name),
      tid: trackerId(me.display_name),
    });
  return (
    <Section title={t("me.owntracks")} testId="owntracks">
      <p className="muted small">{t("owntracks.explain")}</p>
      {created && configUrl ? (
        <div className="credentials">
          <div className="owntracks-qr">
            <QrCode value={configUrl} label={t("owntracks.qrLabel")} testId="owntracks-qr" />
            <p className="muted small">{t("owntracks.qr")}</p>
            <a className="btn btn-block" href={configUrl} data-testid="owntracks-open">
              {t("owntracks.open")}
            </a>
          </div>
          <p className="muted small">{t("owntracks.manual")}</p>
          <Field label={t("owntracks.url")}>
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </Field>
          <Field label={t("owntracks.username")}>
            <input readOnly value={me.email} onFocus={(e) => e.target.select()} />
          </Field>
          <Field label={t("owntracks.password")} hint={t("owntracks.once")}>
            <input readOnly value={created.token} onFocus={(e) => e.target.select()} data-testid="owntracks-token" />
          </Field>
        </div>
      ) : (
        <>
          {phone && (
            <p className="muted small" data-testid="owntracks-phone">
              {phone.name} · {phone.location ? t("devices.updated", { time: relTime(phone.location.ts) }) : t("devices.noLocation")}
            </p>
          )}
          <button className="btn btn-block" onClick={() => create.mutate()} disabled={create.isPending}>
            {phone ? t("owntracks.recreate") : t("owntracks.create")}
          </button>
          {phone && <p className="muted small">{t("owntracks.recreateHint")}</p>}
        </>
      )}
    </Section>
  );
}

function LanguageSwitch({ value, onChange }: { value: Locale; onChange: (l: Locale) => void }) {
  const { t } = useI18n();
  return (
    <div className="segmented" role="radiogroup" aria-label={t("me.language")}>
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          lang={l}
          aria-checked={value === l}
          className={value === l ? "active" : ""}
          onClick={() => onChange(l)}
          data-testid={`lang-${l}`}
        >
          {l === "fr" ? "Français" : "English"}
        </button>
      ))}
    </div>
  );
}

export function MePanel({ me }: { me: User }) {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const [name, setName] = useState(me.display_name);

  const patchMe = useMutation({
    mutationFn: (body: Partial<User>) => api<User>("/me", { method: "PATCH", body }),
    onSuccess: (u) => qc.setQueryData(keys.me, u),
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.setQueryData(keys.me, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "config" && q.queryKey[0] !== "me" });
      navigate("/login");
    },
  });

  const changeLocale = (l: Locale) => {
    setLocale(l);
    patchMe.mutate({ locale: l });
  };

  return (
    <div data-testid="me-panel">
      <PanelHeader title={t("me.title")} />
      <ThisDevice me={me} />
      <Viewers />
      <Section>
        <Link to="/me/zones" className="link-row" data-testid="link-zones">
          <Icon name="zone" /> {t("me.zones")}
        </Link>
      </Section>
      <Notifications me={me} />
      {config?.features.owntracks && <OwnTracksSetup me={me} />}
      <Section title={t("me.language")}>
        <LanguageSwitch value={locale} onChange={changeLocale} />
      </Section>
      <Section title={t("me.account")}>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            patchMe.mutate({ display_name: name });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={t("me.name")} />
          <button className="btn" disabled={name === me.display_name}>
            {t("common.save")}
          </button>
        </form>
        <p className="muted small">{me.email}</p>
        <button className="link-row danger" onClick={() => logout.mutate()} data-testid="btn-logout">
          {t("auth.logout")}
        </button>
      </Section>
    </div>
  );
}
