import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useDevices, useHistory, useZones } from "../../api/queries";
import type { LocationPoint } from "../../api/types";
import { useI18n, type Locale } from "../../i18n";
import { buildJourney, firstPointOf, formatDistance, formatDuration, segmentAt, type Journey, type Segment } from "../../lib/journey";
import { RAMP_CSS, timeColor } from "../../lib/ramp";
import { useStore } from "../../lib/store";
import { focusOn, mapUi, patchMapUi } from "../../lib/ui-state";
import { Empty, PanelHeader } from "../../ui/components";
import { Icon } from "../../ui/icons";

const RANGES = [
  { hours: 1, key: "history.last1h" },
  { hours: 24, key: "history.last24h" },
  { hours: 24 * 7, key: "history.last7d" },
] as const;

const NO_POINTS: LocationPoint[] = [];

const accuracy = (p: LocationPoint) => (p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : "");

/** A device's trace; `deviceId` and `back` for a page that is not the device's own (Me). */
export function HistoryPanel({ deviceId, back }: { deviceId?: string; back?: string } = {}) {
  const params = useParams();
  const id = deviceId ?? params.id ?? "";
  const { t, locale, dateTime } = useI18n();
  const [hours, setHours] = useState(24);
  const [allOpen, setAllOpen] = useState(false);
  const { data: devices } = useDevices();
  const { data, isLoading } = useHistory(id, hours);
  const { data: zones } = useZones();
  const { historyAt } = useStore(mapUi);
  const device = devices?.find((d) => d.id === id);
  const points = data?.points ?? NO_POINTS;
  const journey = useMemo(() => buildJourney(points, zones ?? []), [points, zones]);

  useEffect(() => {
    patchMapUi({ history: data?.points ?? null, historyJourney: data ? journey : null });
  }, [data, journey]);
  useEffect(() => () => patchMapUi({ history: null, historyJourney: null, historyAt: null }), []);

  const pick = (p: LocationPoint) => patchMapUi({ historyAt: p.ts });
  const picked = points.findIndex((p) => p.ts === historyAt);
  const plural = new Intl.PluralRules(locale);
  const count = data?.total ?? points.length;
  const stops = journey.stops.length;
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
          <p className="history-summary" data-testid="history-summary">
            <span data-testid="history-count">{t(plural.select(count) === "one" ? "history.pointsOne" : "history.points", { count })}</span>
            {journey.distanceM > 0 && <span>{formatDistance(journey.distanceM, locale)}</span>}
            <span>{t(plural.select(stops) === "one" ? "history.stopsOne" : "history.stops", { count: stops })}</span>
          </p>
          <Legend points={points} />
          <Scrubber points={points} picked={picked} onPick={(i) => pick(points[i])} />
          {journey.segments.length > 0 && (
            <JourneyList points={points} journey={journey} current={segmentAt(journey.segments, picked)} onPick={pick} />
          )}
          <details className="history-all" data-testid="history-all" onToggle={(e) => setAllOpen(e.currentTarget.open)}>
            <summary>{t("history.allPositions", { count: points.length })}</summary>
            {allOpen && (
              <ol className="timeline">
                {[...points].reverse().map((p) => (
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
            )}
          </details>
        </>
      )}
    </div>
  );
}

const DAY_MS = 86_400_000;
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** Times as a timeline says them: the time alone within a day, with the day otherwise. */
function clock(locale: Locale, now = Date.now()) {
  // "07:16" in French, "7:16 AM" in English, with or without the day.
  const hour = locale === "fr" ? "2-digit" : "numeric";
  const time = new Intl.DateTimeFormat(locale, { hour, minute: "2-digit" });
  const weekdayTime = new Intl.DateTimeFormat(locale, { weekday: "short", hour, minute: "2-digit" });
  const dateTime = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour, minute: "2-digit" });
  const longDay = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const today = startOfDay(now);
  const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  return {
    time: (ms: number) => time.format(ms),
    /** The time, with the day when it is not today (or not `sameDayAs`). */
    when: (ms: number, sameDayAs = now) => {
      if (startOfDay(ms) === startOfDay(sameDayAs)) return time.format(ms);
      return today - startOfDay(ms) < 6 * DAY_MS ? weekdayTime.format(ms) : dateTime.format(ms);
    },
    /** "Today", "Yesterday", "Monday 5 October". */
    day: (ms: number) => {
      const ago = Math.round((today - startOfDay(ms)) / DAY_MS);
      return capitalise(ago <= 1 ? rtf.format(-ago, "day") : longDay.format(ms));
    },
  };
}

/** The trace's colours, explained: oldest on the left, latest on the right. */
function Legend({ points }: { points: LocationPoint[] }) {
  const { t, locale } = useI18n();
  const { when } = clock(locale);
  const [t0, t1] = [Date.parse(points[0].ts), Date.parse(points[points.length - 1].ts)];
  return (
    <div className="history-legend" data-testid="history-legend" title={t("history.legend")}>
      <span>{when(t0)}</span>
      <span className="history-legend-bar" style={{ background: RAMP_CSS }} aria-hidden="true" />
      <span>{when(t1)}</span>
    </div>
  );
}

/** Stops and moves in time order; a tap marks where it starts on the map. */
function JourneyList({
  points,
  journey,
  current,
  onPick,
}: {
  points: LocationPoint[];
  journey: Journey;
  current: Segment | null;
  onPick: (p: LocationPoint) => void;
}) {
  const { t, locale } = useI18n();
  const { time, when, day } = clock(locale);
  const [t0, t1] = [Date.parse(points[0].ts), Date.parse(points[points.length - 1].ts)];
  const colorAt = (ms: number) => timeColor(ms, t0, t1);
  const { segments } = journey;
  // Day headings unless it is all today.
  const days = new Set(segments.map((s) => startOfDay(s.start)));
  const headings = days.size > 1 || !days.has(startOfDay(Date.now()));
  const pickSegment = (s: Segment) => {
    onPick(points[firstPointOf(segments, s)]);
    if (s.kind === "stop") focusOn(s.lat, s.lon);
  };

  let lastDay: number | null = null;
  return (
    <ol className="journey" data-testid="history-journey" aria-label={t("history.journey")}>
      {segments.flatMap((s) => {
        const rows = [];
        const sDay = startOfDay(s.start);
        if (headings && sDay !== lastDay) {
          rows.push(
            <li key={`day-${sDay}`} className="journey-day">
              {day(s.start)}
            </li>,
          );
        }
        lastDay = sDay;
        const isCurrent = s === current;
        if (s.kind === "stop") {
          const span = s.ongoing ? t("history.since", { time: time(s.start) }) : `${time(s.start)} – ${when(s.end, s.start)}`;
          rows.push(
            <li key={`stop-${s.n}`} className={`journey-stop${isCurrent ? " is-current" : ""}`} data-testid={`journey-stop-${s.n}`}>
              <button type="button" onClick={() => pickSegment(s)} aria-current={isCurrent || undefined}>
                <span className="journey-badge" style={{ borderColor: colorAt(s.start) }}>
                  {s.n}
                </span>
                <span className="journey-text">
                  <strong>{s.place ?? t("history.stop")}</strong>
                  <span className="muted">
                    {span} · {formatDuration(s.end - s.start, locale)}
                  </span>
                </span>
              </button>
            </li>,
          );
        } else {
          const lasted = s.end - s.start >= 60_000 ? ` · ${formatDuration(s.end - s.start, locale)}` : "";
          rows.push(
            <li key={`move-${s.first}`} className={`journey-move${isCurrent ? " is-current" : ""}`} data-testid="journey-move">
              <button type="button" onClick={() => pickSegment(s)} aria-current={isCurrent || undefined}>
                <span className="journey-connector" style={{ background: `linear-gradient(${colorAt(s.start)}, ${colorAt(s.end)})` }} />
                <span className="journey-text">
                  {t("history.move")} · {formatDistance(s.distanceM, locale)}
                  {lasted}
                </span>
              </button>
            </li>,
          );
        }
        return rows;
      })}
    </ol>
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
