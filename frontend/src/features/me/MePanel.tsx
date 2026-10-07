import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api/client";
import { keys, useNotifications, useViewers } from "../../api/queries";
import type { User } from "../../api/types";
import { useI18n } from "../../i18n";
import { toast } from "../../lib/ui-state";
import { Empty, PanelHeader, Section } from "../../ui/components";
import { Avatar, Icon } from "../../ui/icons";
import { squarePhoto } from "./photo";

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

/** Photo and name: what the people you share with see of you. */
function Profile({ me }: { me: User }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.display_name);
  const patchMe = usePatchMe();
  const done = (u: User) => qc.setQueryData(keys.me, u);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", await squarePhoto(file), "photo.jpg");
      return api<User>("/me/avatar", { method: "PUT", body: form });
    },
    onSuccess: done,
    onError: () => toast(t("me.photoError"), undefined, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api<User>("/me/avatar", { method: "DELETE" }),
    onSuccess: done,
    onError: () => toast(t("common.error"), undefined, "error"),
  });
  const busy = upload.isPending || remove.isPending;
  return (
    <Section title={t("me.profile")} testId="profile-photo">
      <div className="photo-edit">
        <Avatar user={me} size="large" />
        <div className="row-buttons wrap">
          <button className="btn btn-small" onClick={() => input.current?.click()} disabled={busy} data-testid="btn-photo-pick">
            {me.avatar_url ? t("me.photoChange") : t("me.photoAdd")}
          </button>
          {me.avatar_url && (
            <button className="btn btn-small" onClick={() => remove.mutate()} disabled={busy} data-testid="btn-photo-remove">
              {t("me.photoRemove")}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          data-testid="photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // picking the same file again still triggers a change
            if (file) upload.mutate(file);
          }}
        />
      </div>
      <p className="muted small">{t("me.photoHint")}</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          patchMe.mutate({ display_name: name });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={t("me.name")} data-testid="display-name" />
        <button className="btn" disabled={name === me.display_name}>
          {t("common.save")}
        </button>
      </form>
    </Section>
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
      <Profile me={me} />
      <Viewers />
      <Section>
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
