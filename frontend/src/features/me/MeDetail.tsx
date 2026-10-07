import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError } from "../../api/client";
import { useDevices, useMyLocation, useSources } from "../../api/queries";
import type { User } from "../../api/types";
import { useI18n } from "../../i18n";
import { focusOn, patchMapUi, toast } from "../../lib/ui-state";
import { ActionButton, BatteryBadge, PanelHeader, Section } from "../../ui/components";
import { Avatar, Icon } from "../../ui/icons";
import { HistoryPanel } from "../devices/HistoryPanel";
import { Viewers } from "./MePanel";

/**
 * Me, like a device's page: where I am, from which source, its history, a refresh. The OwnTracks
 * phone has no page in Devices: this is it. Choosing the sources is in Settings.
 * Opened from People (`base` /people/me) and from Me (/me/location).
 */
export function MeDetail({ me, base, back }: { me: User; base: string; back: string }) {
  const { t, relTime } = useI18n();
  const navigate = useNavigate();
  const { data: mine } = useMyLocation();
  const { data: devices } = useDevices();
  const { data: sources } = useSources();
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const listed = (sources?.device_ids ?? []).flatMap((id) => byId.get(id) ?? []);
  const inUse = mine?.device_id ? byId.get(mine.device_id) : undefined;
  // Those that can be asked for a position (iCloud, Find My); a phone sends its own.
  const refreshable = listed.filter((d) => d.capabilities.includes("refresh"));
  const loc = mine?.location;

  // My face is the subject of the map here.
  useEffect(() => {
    patchMapUi({ selected: { kind: "person", id: me.id } });
    return () => patchMapUi({ selected: null });
  }, [me.id]);
  useEffect(() => {
    if (loc) focusOn(loc.lat, loc.lon);
    // Only on arrival, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc == null]);

  const refresh = useMutation({
    mutationFn: () => Promise.all(refreshable.map((d) => api(`/devices/${d.id}/refresh`, { method: "POST" }))),
    onError: (e) => toast(t("command.failed"), e instanceof ApiError ? e.detail : undefined, "error"),
  });

  return (
    <div data-testid="me-detail">
      <PanelHeader
        title={
          <span className="title-with-avatar">
            <Avatar user={me} size="small" />
            <span>{t("people.me")}</span>
          </span>
        }
        back={back}
        right={inUse && <BatteryBadge battery={inUse.battery} />}
      />
      <div className="detail-meta" data-testid="my-location">
        <span>{loc ? t("location.via", { device: mine?.device_name ?? "" }) : t("devices.noLocation")}</span>
        {loc && <span className="muted">· {relTime(loc.ts)}</span>}
      </div>
      {loc && (
        <p className="coords" data-testid="my-coords">
          {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
          {loc.accuracy != null && ` · ${t("devices.accuracy", { meters: Math.round(loc.accuracy) })}`}
        </p>
      )}
      <Viewers />

      <div className="actions">
        <ActionButton
          icon="clock"
          label={t("actions.history")}
          onClick={() => navigate(`${base}/history`)}
          disabled={!inUse}
          testId="btn-my-history"
        />
        <ActionButton
          icon="refresh"
          label={t("actions.refresh")}
          onClick={() => refresh.mutate()}
          disabled={refreshable.length === 0 || refresh.isPending}
          testId="btn-my-refresh"
        />
      </div>
      {refreshable.length === 0 && inUse && <p className="muted small">{t("location.noRefresh", { device: inUse.name })}</p>}

      <Section>
        <Link to="/settings/location" className="link-row" data-testid="link-sources">
          <Icon name="pin" />
          <span className="link-row-text">
            {t("location.sourcesTitle")}
            <span className="link-row-sub">{listed.map((d) => d.name).join(", ")}</span>
          </span>
          <Icon name="chevron" className="icon-flip link-row-chevron" />
        </Link>
      </Section>
    </div>
  );
}

/** The trace of the source my location comes from now. */
export function MeHistory({ back }: { back: string }) {
  const { t } = useI18n();
  const { data: mine } = useMyLocation();
  if (!mine?.device_id) return <PanelHeader title={t("history.title")} back={back} />;
  return <HistoryPanel deviceId={mine.device_id} back={back} />;
}
