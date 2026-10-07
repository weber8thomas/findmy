import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { keys, useDevices, useMyLocation, useSources } from "../../api/queries";
import type { Device, User } from "../../api/types";
import { useI18n } from "../../i18n";
import { focusOn, patchMapUi, toast } from "../../lib/ui-state";
import { Empty, PanelHeader, Section } from "../../ui/components";
import { Avatar, DeviceGlyph, Icon } from "../../ui/icons";
import { Viewers } from "./MePanel";

// Same limit as the server (schemas.MAX_SOURCES).
const MAX_SOURCES = 5;

type Sources = { device_ids: string[] };

/** PUT /api/me/sources, shown at once; the first source becomes the primary device. */
function useSaveSources() {
  const { t } = useI18n();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (device_ids: string[]) => api<Sources>("/me/sources", { method: "PUT", body: { device_ids } }),
    onMutate: (device_ids) => qc.setQueryData<Sources>(keys.sources, { device_ids }),
    onSuccess: (saved) => qc.setQueryData(keys.sources, saved),
    onError: () => {
      toast(t("common.error"), undefined, "error");
      void qc.invalidateQueries({ queryKey: keys.sources });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.myLocation });
      void qc.invalidateQueries({ queryKey: keys.devices });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

function SourceItem({
  device,
  rank,
  count,
  inUse,
  busy,
  onMove,
  onRemove,
}: {
  device: Device;
  rank: number;
  count: number;
  inUse: boolean;
  busy: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t, relTime } = useI18n();
  const loc = device.location;
  const name = device.name;
  return (
    <li className={`source${inUse ? " is-in-use" : ""}`} data-testid={`source-${device.id}`} data-in-use={inUse}>
      <div className="source-main">
        <span className="source-rank" aria-hidden="true">
          {rank + 1}
        </span>
        <span className="row-avatar row-avatar-device">
          <DeviceGlyph icon={device.icon} size={30} />
        </span>
        <span className="row-main">
          <span className="row-title">{name}</span>
          <span className="row-sub">
            {t(`devices.kind.${device.kind}`)} · {loc ? t("devices.updated", { time: relTime(loc.ts) }) : t("devices.noLocation")}
          </span>
        </span>
      </div>
      <div className="source-bar">
        {inUse && (
          <span className="chip chip-success" data-testid="source-in-use">
            {t("location.inUse")}
          </span>
        )}
        <span className="source-buttons">
          <button
            type="button"
            className="source-btn"
            onClick={() => onMove(-1)}
            disabled={busy || rank === 0}
            aria-label={t("location.moveUp", { name })}
            title={t("location.moveUp", { name })}
            data-testid="source-up"
          >
            <Icon name="chevron" className="icon-up" />
          </button>
          <button
            type="button"
            className="source-btn"
            onClick={() => onMove(1)}
            disabled={busy || rank === count - 1}
            aria-label={t("location.moveDown", { name })}
            title={t("location.moveDown", { name })}
            data-testid="source-down"
          >
            <Icon name="chevron" className="icon-down" />
          </button>
          {/* One source at least: without any, the primary device would be used anyway. */}
          <button
            type="button"
            className="source-btn danger"
            onClick={onRemove}
            disabled={busy || count === 1}
            aria-label={t("location.remove", { name })}
            title={t("location.remove", { name })}
            data-testid="source-remove"
          >
            <Icon name="trash" />
          </button>
        </span>
      </div>
    </li>
  );
}

function AddSource({ devices, onAdd, busy }: { devices: Device[]; onAdd: (id: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState("");
  const choice = devices.some((d) => d.id === picked) ? picked : "";
  return (
    <form
      className="inline-form source-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!choice) return;
        onAdd(choice);
        setPicked("");
      }}
    >
      <select value={choice} onChange={(e) => setPicked(e.target.value)} aria-label={t("location.pick")} name="source-device">
        <option value="">{t("location.pick")}…</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {t(`devices.kind.${d.kind}`)}
          </option>
        ))}
      </select>
      <button className="btn" disabled={!choice || busy} data-testid="source-add">
        {t("location.add")}
      </button>
    </form>
  );
}

/** Me › My location: where the people I share with see me, and the devices it is taken from. */
export function MyLocationPanel({ me }: { me: User }) {
  const { t, relTime } = useI18n();
  const { data: devices, isLoading } = useDevices();
  const { data: sources } = useSources();
  const { data: mine } = useMyLocation();
  const save = useSaveSources();

  // My face is the subject of the map here.
  useEffect(() => {
    patchMapUi({ selected: { kind: "person", id: me.id } });
    return () => patchMapUi({ selected: null });
  }, [me.id]);
  const loc = mine?.location;
  useEffect(() => {
    if (loc) focusOn(loc.lat, loc.lon);
    // Only on arrival, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc == null]);

  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const list = (sources?.device_ids ?? []).flatMap((id) => byId.get(id) ?? []);
  const ids = list.map((d) => d.id);
  const others = (devices ?? []).filter((d) => !ids.includes(d.id));
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    save.mutate(next);
  };

  return (
    <div data-testid="my-location-panel">
      <PanelHeader title={t("location.title")} back="/me" />
      <div className="my-location" data-testid="my-location">
        <Avatar user={me} />
        <span className="row-main">
          <span className="row-title">{loc ? t("location.via", { device: mine?.device_name ?? "" }) : t("devices.noLocation")}</span>
          <span className="row-sub">{loc ? relTime(loc.ts) : t("location.explain")}</span>
        </span>
      </div>
      <Viewers />

      <Section title={t("location.sources")} testId="sources">
        <p className="muted small">{t("location.rule")}</p>
        {isLoading ? (
          <Empty>{t("common.loading")}</Empty>
        ) : !devices?.length ? (
          <p className="muted">{t("location.noDevices")}</p>
        ) : (
          <>
            {list.length === 0 && <p className="muted">{t("location.none")}</p>}
            <ol className="sources" data-testid="source-list">
              {list.map((d, i) => (
                <SourceItem
                  key={d.id}
                  device={d}
                  rank={i}
                  count={list.length}
                  inUse={d.id === mine?.device_id}
                  busy={save.isPending}
                  onMove={(by) => move(i, by)}
                  onRemove={() => save.mutate(ids.filter((id) => id !== d.id))}
                />
              ))}
            </ol>
            {others.length > 0 &&
              (list.length < MAX_SOURCES ? (
                <AddSource devices={others} busy={save.isPending} onAdd={(id) => save.mutate([...ids, id])} />
              ) : (
                <p className="muted small">{t("location.max", { count: MAX_SOURCES })}</p>
              ))}
          </>
        )}
        <p className="muted small">{t("location.zones")}</p>
      </Section>
    </div>
  );
}
