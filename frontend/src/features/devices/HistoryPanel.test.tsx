import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { LocationPoint } from "../../api/types";
import { I18nProvider } from "../../i18n";
import { patchMapUi } from "../../lib/ui-state";
import { HistoryPanel } from "./HistoryPanel";

const fix = (minutesAgo: number, accuracy: number | null): LocationPoint => ({
  ts: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  lat: 48.85,
  lon: 2.35,
  accuracy,
  speed: null,
  battery_level: null,
  source: "browser",
});
const POINTS = [fix(30, 12), fix(20, 8), fix(10, null)];

function render() {
  const qc = new QueryClient();
  qc.setQueryData(keys.devices, []);
  qc.setQueryData(keys.history("d1", "24"), { device_id: "d1", points: POINTS, total: POINTS.length });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale="en">
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

afterEach(() => patchMapUi({ historyAt: null }));

describe("history time picker", () => {
  it("nothing picked: rests after the latest position", () => {
    const html = render();
    expect(html).toContain("Slide to see where the device was");
    expect(attrs(html, "history-slider")).toContain('value="2"');
    expect(attrs(html, "history-newer")).toContain("disabled");
    expect(attrs(html, "history-older")).not.toContain("disabled");
    expect(html).not.toContain("is-picked");
  });

  it("shows the picked moment with its accuracy, on the slider and in the list", () => {
    patchMapUi({ historyAt: POINTS[1].ts });
    const html = render();
    expect(html).toContain("20 minutes ago · ±8 m");
    expect(attrs(html, "history-slider")).toContain('value="1"');
    expect(html.match(/class="is-picked"/g)).toHaveLength(1);
    expect(html).toContain('aria-pressed="true"');
    expect(attrs(html, "history-newer")).not.toContain("disabled");
  });
});
