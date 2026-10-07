import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { AppConfig } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { ZoneEditor } from "./Zones";

const features = { owntracks: true, findmy: false, icloud: false, push: true };

function render(config: Partial<AppConfig>, locale: Locale = "fr") {
  const qc = new QueryClient();
  qc.setQueryData(keys.config, config);
  qc.setQueryData(keys.me, null);
  qc.setQueryData(keys.zones, []);
  qc.setQueryData(keys.devices, []);
  qc.setQueryData(keys.people, []);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale={locale}>
        <MemoryRouter initialEntries={["/me/zones/new"]}>
          <ZoneEditor />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("zone editor address search", () => {
  it("sits above the coordinates when the server has it", () => {
    const html = render({ features: { ...features, geocode: true } });
    expect(html).toMatch(/<label class="field-label" for="[^"]+">Adresse<\/label>/);
    expect(html).toContain('placeholder="Numéro, rue, ville"');
    expect(html).toContain('enterKeyHint="search"');
    // Nothing typed yet: nothing to search.
    expect(html).toMatch(/<button type="button" class="btn" disabled="" data-testid="zone-address-search">Rechercher<\/button>/);
    expect(html.indexOf('data-testid="zone-address"')).toBeLessThan(html.indexOf('data-testid="zone-center"'));
  });

  it("is hidden when address search is off, or unknown to an older server", () => {
    expect(render({ features: { ...features, geocode: false } })).not.toContain("zone-address");
    expect(render({ features })).not.toContain("zone-address");
    expect(render({ features }, "en")).toContain("Tap the map to place the center");
  });
});
