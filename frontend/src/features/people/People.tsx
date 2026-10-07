import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../../api/client";
import { keys, useMe, useMyLocation, usePeople, useShares } from "../../api/queries";
import type { Person } from "../../api/types";
import { useI18n } from "../../i18n";
import { directionsUrl } from "../../lib/geo";
import { focusOn, patchMapUi, toast } from "../../lib/ui-state";
import { ActionButton, Empty, Field, PanelHeader, Section } from "../../ui/components";
import { Avatar } from "../../ui/icons";

function useInvalidatePeople() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.people });
    void qc.invalidateQueries({ queryKey: keys.shares });
    void qc.invalidateQueries({ queryKey: keys.viewers });
  };
}

function endOfDay(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

export function ShareForm({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const invalidate = useInvalidatePeople();
  const [email, setEmail] = useState("");
  const [duration, setDuration] = useState<"1h" | "eod" | "forever">("forever");
  const create = useMutation({
    mutationFn: () => {
      const expires_at =
        duration === "1h" ? new Date(Date.now() + 3_600_000).toISOString() : duration === "eod" ? endOfDay() : null;
      return api("/shares", { method: "POST", body: { recipient_email: email, expires_at } });
    },
    onSuccess: () => {
      toast(t("people.pending"), email, "success");
      setEmail("");
      invalidate();
      onDone?.();
    },
    onError: (e) => {
      const msg =
        e instanceof ApiError && e.status === 404
          ? t("people.noUser")
          : e instanceof ApiError && e.status === 409
            ? t("people.already")
            : e instanceof ApiError && e.status === 400
              ? t("people.self")
              : t("common.error");
      toast(msg, undefined, "error");
    },
  });
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
      data-testid="share-form"
    >
      <Field label={t("people.shareWith")}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="share-email" />
      </Field>
      <Field label={t("people.duration")}>
        <select value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)} name="share-duration">
          <option value="1h">{t("people.duration.1h")}</option>
          <option value="eod">{t("people.duration.eod")}</option>
          <option value="forever">{t("people.duration.forever")}</option>
        </select>
      </Field>
      <button className="btn btn-primary btn-block" disabled={create.isPending} data-testid="share-submit">
        {t("people.send")}
      </button>
    </form>
  );
}

function Invitations() {
  const { t } = useI18n();
  const { data } = useShares();
  const invalidate = useInvalidatePeople();
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api(`/shares/${id}/${accept ? "accept" : "decline"}`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const pending = data?.incoming.filter((s) => s.status === "pending") ?? [];
  if (!pending.length) return null;
  return (
    <Section title={t("people.invitations")} testId="invitations">
      {pending.map((s) => (
        <div key={s.id} className="invite">
          <div className="invite-from">
            <Avatar user={s.owner} size="small" />
            <p>{t("people.invitesYou", { name: s.owner.display_name })}</p>
          </div>
          <div className="row-buttons">
            <button className="btn btn-primary" onClick={() => respond.mutate({ id: s.id, accept: true })} data-testid="invite-accept">
              {t("people.accept")}
            </button>
            <button className="btn" onClick={() => respond.mutate({ id: s.id, accept: false })}>
              {t("people.decline")}
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}

function PersonRow({ person }: { person: Person }) {
  const { t, relTime } = useI18n();
  const sub = person.location
    ? `${person.device_name ?? ""} · ${relTime(person.location.ts)}`
    : person.sharing_with_me?.status === "accepted"
      ? t("devices.noLocation")
      : person.i_share_with?.status === "pending"
        ? t("people.pending")
        : person.i_share_with
          ? t("people.youShare")
          : t("people.notSharingWithYou");
  return (
    <Link to={`/people/${person.user.id}`} className="row" data-testid={`person-item-${person.user.id}`}>
      <Avatar user={person.user} />
      <span className="row-main">
        <span className="row-title">{person.user.display_name}</span>
        <span className="row-sub">{sub}</span>
      </span>
    </Link>
  );
}

/** You, as the people you share with see you: the first fresh of your sources, else the latest. */
function MeRow() {
  const { t, relTime } = useI18n();
  const { data: me } = useMe();
  const { data: mine } = useMyLocation();
  // No device yet, so nothing to show.
  if (!me?.primary_device_id) return null;
  const loc = mine?.location;
  return (
    <Link to="/me/location" className="row" data-testid="person-me">
      <Avatar user={me} />
      <span className="row-main">
        <span className="row-title">{t("people.me")}</span>
        <span className="row-sub">
          {loc ? `${t("location.via", { device: mine?.device_name ?? "" })} · ${relTime(loc.ts)}` : t("devices.noLocation")}
        </span>
      </span>
    </Link>
  );
}

export function PeopleList() {
  const { t } = useI18n();
  const { data: people, isLoading } = usePeople();
  const [sharing, setSharing] = useState(false);
  return (
    <div data-testid="people-panel">
      <PanelHeader
        title={t("people.title")}
        right={
          <button className="btn btn-small" onClick={() => setSharing((v) => !v)} data-testid="btn-share-location">
            {t("people.share")}
          </button>
        }
      />
      {sharing && (
        <Section>
          <ShareForm onDone={() => setSharing(false)} />
        </Section>
      )}
      <Invitations />
      {isLoading && <Empty>{t("common.loading")}</Empty>}
      {!isLoading && !people?.length && <Empty>{t("people.empty")}</Empty>}
      <div className="list">
        <MeRow />
        {people?.map((p) => (
          <PersonRow key={p.user.id} person={p} />
        ))}
      </div>
    </div>
  );
}

export function PersonDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t, relTime, dateTime } = useI18n();
  const { data: me } = useMe();
  const { data: people } = usePeople();
  const invalidate = useInvalidatePeople();
  const person = people?.find((p) => p.user.id === id);

  useEffect(() => {
    patchMapUi({ selected: { kind: "person", id } });
    return () => patchMapUi({ selected: null });
  }, [id]);
  const hasLoc = Boolean(person?.location);
  useEffect(() => {
    if (person?.location) focusOn(person.location.lat, person.location.lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasLoc]);

  const stop = useMutation({
    mutationFn: (shareId: string) => api(`/shares/${shareId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
    },
  });

  if (!person) return <PanelHeader title="" back="/people" />;
  const loc = person.location;
  const mine = person.i_share_with;
  const theirs = person.sharing_with_me;

  return (
    <div data-testid="person-detail">
      <PanelHeader
        title={
          <span className="title-with-avatar">
            <Avatar user={person.user} size="small" />
            <span>{person.user.display_name}</span>
          </span>
        }
        back="/people"
      />
      {loc ? (
        <p className="coords" data-testid="person-coords">
          {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)} <span className="muted">· {relTime(loc.ts)}</span>
        </p>
      ) : (
        <p className="muted">{theirs?.status === "accepted" ? t("devices.noLocation") : t("people.notSharingWithYou")}</p>
      )}
      <div className="actions">
        <ActionButton icon="route" label={t("actions.directions")} href={loc ? directionsUrl(loc.lat, loc.lon) : undefined} disabled={!loc} />
      </div>
      <Section>
        {theirs && (
          <p className="kv">
            {t("people.sharesWithYou")}
            {theirs.expires_at && ` (${t("people.until", { time: dateTime(theirs.expires_at) })})`}
          </p>
        )}
        {mine && (
          <p className="kv">
            {mine.status === "pending" ? t("people.pending") : t("people.youShare")}
            {mine.expires_at && ` (${t("people.until", { time: dateTime(mine.expires_at) })})`}
          </p>
        )}
        {mine && (
          <button className="link-row danger" onClick={() => stop.mutate(mine.id)} data-testid="btn-stop-sharing">
            {t("people.stopSharing")}
          </button>
        )}
        {!mine && me && (
          <ShareFormFor email={person.user.email} />
        )}
        {theirs && (
          <button
            className="link-row danger"
            onClick={() => {
              stop.mutate(theirs.id);
              navigate("/people");
            }}
          >
            {t("people.remove")}
          </button>
        )}
      </Section>
    </div>
  );
}

function ShareFormFor({ email }: { email: string }) {
  const { t } = useI18n();
  const invalidate = useInvalidatePeople();
  const share = useMutation({
    mutationFn: () => api("/shares", { method: "POST", body: { recipient_email: email, expires_at: null } }),
    onSuccess: invalidate,
  });
  return (
    <button className="link-row" onClick={() => share.mutate()} disabled={share.isPending}>
      {t("people.share")}
    </button>
  );
}
