import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { LocationPoint, Zone } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { patchMapUi } from "../../lib/ui-state";
import { HistoryPanel } from "./HistoryPanel";

const fix = (minutesAgo: number, accuracy: number | null, lat = 48.85): LocationPoint => ({
  ts: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  lat,
  lon: 2.35,
  accuracy,
  speed: null,
  battery_level: null,
  source: "browser",
});
const POINTS = [fix(30, 12), fix(20, 8), fix(10, null)];

// At home for half an hour, 2.2 km north, at work since 40 minutes ago.
const DAY = [
  ...[100, 90, 80, 70].map((m) => fix(m, 10)),
  ...[65, 60, 55, 50, 45].map((m, k) => fix(m, 10, 48.85 + (k + 1) * 0.0035)),
  ...[40, 30, 20, 10, 5].map((m) => fix(m, 10, 48.87)),
];
const HOME: Zone = {
  id: "z1",
  name: "Home",
  lat: 48.85,
  lon: 2.35,
  radius_m: 100,
  notify_enter: false,
  notify_exit: false,
  device_ids: null,
  created_at: "2026-01-01T00:00:00Z",
};

function render(points = POINTS, { zones = [] as Zone[], locale = "en" as Locale } = {}) {
  const qc = new QueryClient();
  qc.setQueryData(keys.devices, []);
  qc.setQueryData(keys.zones, zones);
  qc.setQueryData(keys.history("d1", "24"), { device_id: "d1", points, total: points.length });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale={locale}>
        <MemoryRouter initialEntries={["/devices/d1/history"]}>
          <Routes>
            <Route path="/devices/:id/history" element={<HistoryPanel />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const attrs = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
/** The text of the element with that test id (up to its first nested closing tag pair). */
const text = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) return "";
  const tag = html.lastIndexOf("<", start);
  const name = html.slice(tag + 1).match(/^\w+/)![0];
  let depth = 0;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
  re.lastIndex = tag;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(tag, m.index).replace(/<[^>]+>/g, "").replace(/\u00a0/g, " ");
  }
  return "";
};

afterEach(() => patchMapUi({ historyAt: null }));

describe("history time picker", () => {
  it("nothing picked: rests after the latest position", () => {
    const html = render();
    expect(html).toContain("Slide to see where the device was");
    expect(attrs(html, "history-slider")).toContain('value="2"');
    expect(attrs(html, "history-newer")).toContain("disabled");
    expect(attrs(html, "history-older")).not.toContain("disabled");
    expect(html).not.toContain("is-current");
  });

  it("shows the picked moment with its accuracy, on the slider and in the journey", () => {
    patchMapUi({ historyAt: POINTS[1].ts });
    const html = render();
    expect(html).toContain("20 minutes ago · ±8 m");
    expect(attrs(html, "history-slider")).toContain('value="1"');
    expect(attrs(html, "journey-stop-1")).toContain("is-current");
    expect(html).toContain('aria-current="true"');
    expect(attrs(html, "history-newer")).not.toContain("disabled");
  });
});

describe("history journey", () => {
  it("sums up the positions, the distance and the stops", () => {
    expect(text(render(), "history-summary")).toBe("3 positions1 stop");
    expect(text(render([POINTS[2]]), "history-count")).toBe("1 position");
    expect(text(render(DAY), "history-summary")).toBe("14 positions2.2 km2 stops");
    expect(text(render(DAY, { locale: "fr" }), "history-summary")).toBe("14 positions2,2 km2 arrêts");
  });

  it("explains the colours with the first and latest times", () => {
    const legend = attrs(render(), "history-legend");
    expect(legend).toContain('title="Colours of the trace, from the oldest position to the latest"');
    expect(render()).toContain("history-legend-bar");
  });

  it("lists the stops, named after places, and the moves between them in time order", () => {
    const html = render(DAY, { zones: [HOME] });
    const journey = text(html, "history-journey");
    expect(journey.indexOf("Home")).toBeLessThan(journey.indexOf("Move"));
    expect(text(html, "journey-stop-1")).toMatch(/^1Home\d.* – .* · 30 min$/);
    expect(text(html, "journey-move")).toBe("Move · 2.2 km · 30 min");
    expect(text(html, "journey-stop-2")).toMatch(/^2Stopsince .* · 40 min$/);
  });

  it("in French", () => {
    const html = render(DAY, { locale: "fr" });
    // The end has its day only past midnight.
    expect(text(html, "journey-stop-1")).toMatch(/^1Arrêt\d{1,2}:\d\d – (\S+ )?\d{1,2}:\d\d · 30 min$/);
    expect(text(html, "journey-move")).toBe("Déplacement · 2,2 km · 30 min");
    expect(text(html, "journey-stop-2")).toMatch(/^2Arrêtdepuis \d{1,2}:\d\d · 40 min$/);
    expect(html).toContain("Toutes les positions (14)");
  });

  it("keeps every position, folded", () => {
    const html = render();
    expect(html).toMatch(/<details[^>]*data-testid="history-all"/);
    expect(html).toContain("All positions (3)");
    // Listed once unfolded.
    expect(html).not.toContain('class="timeline"');
  });
});
