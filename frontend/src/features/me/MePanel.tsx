import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api/client";
import { keys, useMyLocation, useNotifications, useViewers } from "../../api/queries";
import type { User } from "../../api/types";
import { useI18n } from "../../i18n";
import { Empty, PanelHeader, Section } from "../../ui/components";
import { Avatar, Icon } from "../../ui/icons";

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

/** PATCH /api/me; the answer replaces the cached account. */
export function usePatchMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<User>) => api<User>("/me", { method: "PATCH", body }),
    onSuccess: (u) => qc.setQueryData(keys.me, u),
  });
}

/** The notifications received (the tab's badge counts the unread ones); push is set up in Settings. */
function Notifications() {
  const { t, relTime } = useI18n();
  const qc = useQueryClient();
  const { data: notes } = useNotifications();
  const markAll = useMutation({
    mutationFn: () => api("/notifications/read", { method: "POST", body: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  const unread = notes?.filter((n) => !n.read_at).length ?? 0;

  return (
    <Section title={t("me.notifications")} testId="notifications">
      {notes && notes.length === 0 ? (
        <Empty>{t("notifications.empty")}</Empty>
      ) : (
        <ul className="notes">
          {notes?.slice(0, 10).map((n) => (
            <li key={n.id} className={n.read_at ? "" : "unread"} data-testid="notification-item">
              <strong>{n.payload.title}</strong>
              <span>{n.payload.body}</span>
              <span className="muted small">{relTime(n.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {unread > 0 && (
        <button className="link-row" onClick={() => markAll.mutate()}>
          {t("notifications.markAll")}
        </button>
      )}
    </Section>
  );
}

/** Photo and name, as the people you share with see you; changed on their own page. */
function ProfileCard({ me }: { me: User }) {
  const { t } = useI18n();
  return (
    <div className="profile-card" data-testid="profile">
      <Avatar user={me} size="large" />
      <span className="row-main">
        <span className="row-title profile-name">{me.display_name}</span>
        <span className="row-sub">{me.email}</span>
      </span>
      <Link to="/me/profile" className="btn btn-small" data-testid="btn-edit-profile">
        {t("me.edit")}
      </Link>
    </div>
  );
}

/** Where people see me, and from which device: its page orders the sources. */
function MyLocationRow() {
  const { t } = useI18n();
  const { data: mine } = useMyLocation();
  return (
    <Link to="/me/location" className="link-row" data-testid="link-location">
      <Icon name="pin" />
      <span className="link-row-text">
        {t("location.title")}
        <span className="link-row-sub">
          {mine?.device_name ? t("location.via", { device: mine.device_name }) : t("devices.noLocation")}
        </span>
      </span>
      <Icon name="chevron" className="icon-flip link-row-chevron" />
    </Link>
  );
}

export function MePanel({ me }: { me: User }) {
  const { t } = useI18n();
  return (
    <div data-testid="me-panel">
      <PanelHeader
        title={t("me.title")}
        right={
          <Link to="/settings" className="btn-icon" aria-label={t("settings.title")} title={t("settings.title")} data-testid="btn-settings">
            <Icon name="gear" />
          </Link>
        }
      />
      <ProfileCard me={me} />
      <Viewers />
      <Section>
        <MyLocationRow />
        <Link to="/me/zones" className="link-row" data-testid="link-zones">
          <Icon name="zone" /> {t("me.zones")}
        </Link>
        <Link to="/settings" className="link-row" data-testid="link-settings">
          <Icon name="gear" /> {t("settings.title")}
        </Link>
      </Section>
      <Notifications />
    </div>
  );
}
