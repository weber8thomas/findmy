import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useDevices, useHistory } from "../../api/queries";
import { useI18n } from "../../i18n";
import { patchMapUi } from "../../lib/ui-state";
import { Empty, PanelHeader } from "../../ui/components";

const RANGES = [
  { hours: 1, key: "history.last1h" },
  { hours: 24, key: "history.last24h" },
  { hours: 24 * 7, key: "history.last7d" },
] as const;

export function HistoryPanel() {
  const { id = "" } = useParams();
  const { t, dateTime } = useI18n();
  const [hours, setHours] = useState(24);
  const { data: devices } = useDevices();
  const { data, isLoading } = useHistory(id, hours);
  const device = devices?.find((d) => d.id === id);

  useEffect(() => {
    patchMapUi({ history: data?.points ?? null });
  }, [data]);
  useEffect(() => () => patchMapUi({ history: null }), []);

  const points = data?.points ?? [];
  return (
    <div data-testid="history-panel">
      <PanelHeader title={`${t("history.title")} · ${device?.name ?? ""}`} back={`/devices/${id}`} />
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
          <ol className="timeline">
            {[...points].reverse().slice(0, 50).map((p) => (
              <li key={p.ts}>
                <span>{dateTime(p.ts)}</span>
                <span className="muted">
                  {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                  {p.accuracy != null && ` · ±${Math.round(p.accuracy)} m`}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
