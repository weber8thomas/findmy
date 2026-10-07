import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useDevices, useHistory } from "../../api/queries";
import type { LocationPoint } from "../../api/types";
import { useI18n } from "../../i18n";
import { useStore } from "../../lib/store";
import { mapUi, patchMapUi } from "../../lib/ui-state";
import { Empty, PanelHeader } from "../../ui/components";
import { Icon } from "../../ui/icons";

const RANGES = [
  { hours: 1, key: "history.last1h" },
  { hours: 24, key: "history.last24h" },
  { hours: 24 * 7, key: "history.last7d" },
] as const;

const accuracy = (p: LocationPoint) => (p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : "");

/** A device's trace; `deviceId` and `back` for a page that is not the device's own (Me). */
export function HistoryPanel({ deviceId, back }: { deviceId?: string; back?: string } = {}) {
  const params = useParams();
  const id = deviceId ?? params.id ?? "";
  const { t, dateTime } = useI18n();
  const [hours, setHours] = useState(24);
  const { data: devices } = useDevices();
  const { data, isLoading } = useHistory(id, hours);
  const { historyAt } = useStore(mapUi);
  const device = devices?.find((d) => d.id === id);

  useEffect(() => {
    patchMapUi({ history: data?.points ?? null });
  }, [data]);
  useEffect(() => () => patchMapUi({ history: null, historyAt: null }), []);

  const points = data?.points ?? [];
  const pick = (p: LocationPoint) => patchMapUi({ historyAt: p.ts });
  return (
    <div data-testid="history-panel">
      <PanelHeader title={`${t("history.title")} · ${device?.name ?? ""}`} back={back ?? `/devices/${id}`} />
      <div className="segmented" role="radiogroup">
        {RANGES.map((r) => (
          <button key={r.hours} role="radio" aria-checked={hours === r.hours} className={hours === r.hours ? "active" : ""} onClick={() => setHours(r.hours)}>
            {t(r.key)}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Empty>{t("common.loading")}</Empty>
      ) : points.length === 0 ? (
        <Empty>{t("history.empty")}</Empty>
      ) : (
        <>
          <p className="muted" data-testid="history-count">
            {t("history.points", { count: data?.total ?? points.length })}
          </p>
          <Scrubber points={points} picked={points.findIndex((p) => p.ts === historyAt)} onPick={(i) => pick(points[i])} />
          <ol className="timeline">
            {[...points].reverse().slice(0, 50).map((p) => (
              <li key={p.ts} className={p.ts === historyAt ? "is-picked" : undefined}>
                <button type="button" onClick={() => pick(p)} aria-pressed={p.ts === historyAt}>
                  <span>{dateTime(p.ts)}</span>
                  <span className="muted">
                    {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                    {accuracy(p)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** Picks a moment of the history; the map marks where the device was then. */
function Scrubber({ points, picked, onPick }: { points: LocationPoint[]; picked: number; onPick: (i: number) => void }) {
  const { t, dateTime, relTime } = useI18n();
  const p = points[picked];
  // Nothing picked yet: rest on "now", just after the latest position.
  const at = picked >= 0 ? picked : points.length;
  return (
    <div className="scrubber" data-testid="history-scrubber">
      <p className="scrubber-label" data-testid="history-picked">
        {p ? (
          <>
            <strong>{dateTime(p.ts)}</strong>
            <span className="muted">
              {relTime(p.ts)}
              {accuracy(p)}
            </span>
          </>
        ) : (
          <span className="muted">{t("history.pickHint")}</span>
        )}
      </p>
      <div className="scrubber-controls">
        <button className="btn-icon" onClick={() => onPick(at - 1)} disabled={at <= 0} aria-label={t("history.older")} data-testid="history-older">
          <Icon name="chevron" />
        </button>
        <input
          type="range"
          min={0}
          max={points.length - 1}
          step={1}
          value={Math.min(at, points.length - 1)}
          disabled={points.length < 2}
          onChange={(e) => onPick(Number(e.target.value))}
          aria-label={t("history.moment")}
          aria-valuetext={p ? dateTime(p.ts) : undefined}
          data-testid="history-slider"
        />
        <button
          className="btn-icon"
          onClick={() => onPick(at + 1)}
          disabled={at >= points.length - 1}
          aria-label={t("history.newer")}
          data-testid="history-newer"
        >
          <Icon name="chevron" className="icon-flip" />
        </button>
      </div>
    </div>
  );
}
