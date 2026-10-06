import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../../api/client";
import { keys, useDevices, useMe, usePeople, useZoneEvents, useZones } from "../../api/queries";
import type { Zone } from "../../api/types";
import { useI18n } from "../../i18n";
import { useStore } from "../../lib/store";
import { focusOn, patchMapUi, toast } from "../../lib/ui-state";
import { reporterStatus } from "../../reporter/useReporter";
import { Empty, Field, PanelHeader, Section, Toggle } from "../../ui/components";
import { Icon } from "../../ui/icons";

export function ZonesList() {
  const { t, relTime, distance } = useI18n();
  const { data: zones, isLoading } = useZones();
  const { data: events } = useZoneEvents();
  return (
    <div data-testid="zones-panel">
      <PanelHeader
        title={t("zones.title")}
        back="/me"
        right={
          <Link to="/me/zones/new" className="btn btn-small" data-testid="btn-add-zone">
            {t("zones.add")}
          </Link>
        }
      />
      {isLoading && <Empty>{t("common.loading")}</Empty>}
      {!isLoading && !zones?.length && <Empty>{t("zones.empty")}</Empty>}
      <div className="list">
        {zones?.map((z) => (
          <Link key={z.id} to={`/me/zones/${z.id}`} className="row" data-testid={`zone-item-${z.id}`} onClick={() => focusOn(z.lat, z.lon, 15)}>
            <span className="row-avatar">
              <Icon name="zone" />
            </span>
            <span className="row-main">
              <span className="row-title">{z.name}</span>
              <span className="row-sub">{distance(z.radius_m)}</span>
            </span>
          </Link>
        ))}
      </div>
      {events && events.length > 0 && (
        <Section title={t("zones.events")}>
          <ul className="notes">
            {events.map((e) => (
              <li key={e.id} data-testid="zone-event">
                <span>{t(e.type === "enter" ? "zones.arrived" : "zones.left", { who: e.device_name, zone: e.zone_name })}</span>
                <span className="muted small">{relTime(e.ts)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function ZoneEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: zones } = useZones();
  const { data: devices } = useDevices();
  const { data: people } = usePeople();
  const status = useStore(reporterStatus);
  const existing = zones?.find((z) => z.id === id);

  const [name, setName] = useState("");
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(200);
  const [enter, setEnter] = useState(true);
  const [exit, setExit] = useState(true);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (existing && !loaded) {
      setName(existing.name);
      setCenter({ lat: existing.lat, lon: existing.lon });
      setRadius(existing.radius_m);
      setEnter(existing.notify_enter);
      setExit(existing.notify_exit);
      setLoaded(true);
      focusOn(existing.lat, existing.lon, 15);
    }
  }, [existing, loaded]);

  // Map clicks place the center while the editor is open.
  useEffect(() => {
    patchMapUi({ pick: (lat, lon) => setCenter({ lat, lon }) });
    return () => patchMapUi({ pick: null, draftZone: null });
  }, []);
  useEffect(() => {
    patchMapUi({ draftZone: center ? { ...center, radius_m: radius } : null });
  }, [center, radius]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, lat: center!.lat, lon: center!.lon, radius_m: radius, notify_enter: enter, notify_exit: exit };
      return isNew
        ? api<Zone>("/zones", { method: "POST", body: { ...body, device_ids: null } })
        : api<Zone>(`/zones/${id}`, { method: "PATCH", body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.zones });
      navigate("/me/zones");
    },
    onError: (e) => toast(t("common.error"), e instanceof ApiError ? e.detail : undefined, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/zones/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.zones });
      navigate("/me/zones");
    },
  });

  const myPosition =
    status.lastFix ?? devices?.find((d) => d.id === me?.primary_device_id)?.location ?? null;
  const watched = (devices?.length ?? 0) + (people?.filter((p) => p.location).length ?? 0);

  return (
    <div data-testid="zone-editor">
      <PanelHeader title={isNew ? t("zones.add") : t("zones.edit")} back="/me/zones" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (center) save.mutate();
        }}
      >
        <Field label={t("zones.name")}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} name="zone-name" />
        </Field>
        <p className={`banner${center ? "" : " banner-info"}`} data-testid="zone-center">
          {center ? `${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}` : t("zones.pickOnMap")}
        </p>
        {myPosition && (
          <button type="button" className="btn btn-block" onClick={() => setCenter({ lat: myPosition.lat, lon: myPosition.lon })} data-testid="zone-use-position">
            {t("zones.useMyPosition")}
          </button>
        )}
        <Field label={`${t("zones.radius")} · ${radius} m`}>
          <input type="range" min={50} max={5000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} name="zone-radius" />
        </Field>
        <Toggle label={t("zones.notifyEnter")} checked={enter} onChange={setEnter} />
        <Toggle label={t("zones.notifyExit")} checked={exit} onChange={setExit} />
        <p className="muted small">
          {t("zones.devices")}: {t("zones.allDevices")} ({watched})
        </p>
        <button className="btn btn-primary btn-block" disabled={!center || save.isPending} data-testid="zone-save">
          {t("common.save")}
        </button>
        {!isNew && (
          <button type="button" className="link-row danger" onClick={() => remove.mutate()}>
            {t("common.delete")}
          </button>
        )}
      </form>
    </div>
  );
}
