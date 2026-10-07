import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { AppConfig } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { PrivacyContent, PrivacyPage } from "./Privacy";

const BASE: AppConfig = {
  app_name: "Oukilé",
  version: "0.2.0",
  revision: "6aace8e",
  registration_open: true,
  providers: ["browser", "owntracks"],
  features: { owntracks: true, findmy: false, icloud: false, push: true, geocode: true },
  geocoder_host: "nominatim.openstreetmap.org",
  map: {
    tile_url: "https://tiles.openfreemap.org/styles/liberty",
    tile_url_dark: "https://tiles.openfreemap.org/styles/dark",
    attribution: "",
  },
  vapid_public_key: null,
  retention_days: 30,
  auth: { password: true, oidc: null },
};

function render(config: AppConfig, locale: Locale = "en", page = false) {
  const qc = new QueryClient();
  qc.setQueryData(keys.config, config);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale={locale}>
        <MemoryRouter initialEntries={["/privacy"]}>{page ? <PrivacyPage /> : <PrivacyContent />}</MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("privacy page", () => {
  it("says what this server keeps and who else is involved", () => {
    const html = render(BASE);
    expect(html).toContain("deleted after 30 days");
    expect(html).toContain("loads the map from tiles.openfreemap.org");
    expect(html).toContain("push service");
    expect(html).toContain("your places are also sent to its app on your phone");
    expect(html).toContain("sends the text you typed to nominatim.openstreetmap.org for you: your IP address is not passed on.");
    // Apple and SSO only when this server uses them.
    expect(html).not.toContain("Apple account");
    expect(html).not.toContain("asks Apple");
    expect(html).not.toContain("to sign in.");
  });

  it("names Apple and the SSO provider when they are on", () => {
    const html = render({
      ...BASE,
      retention_days: 7,
      features: { ...BASE.features, icloud: true, push: false, owntracks: false, geocode: false },
      geocoder_host: null,
      auth: { password: true, oidc: { name: "Authentik", login_url: "/api/auth/oidc/login" } },
    });
    expect(html).toContain("deleted after 7 days");
    expect(html).toContain("If you connect an Apple account");
    expect(html).toContain("asks Apple");
    expect(html).toContain("Authentik, if you use it to sign in.");
    expect(html).not.toContain("push service");
    expect(html).not.toContain("OwnTracks"); // off on this server
    expect(html).not.toContain("look up an address");
  });

  it("in French, readable signed out with a way back to sign in", () => {
    const html = render(BASE, "fr", true);
    expect(html).toContain("Confidentialité");
    expect(html).toContain("effacé au bout de 30 jours");
    expect(html).toContain("transmet le texte tapé à nominatim.openstreetmap.org à votre place");
    expect(html).toMatch(/<a [^>]*href="\/login"/);
    expect(html).toContain("Oukilé 0.2.0 (6aace8e)");
    // Already on the privacy page: the footer does not link to itself.
    expect(html).not.toContain('href="/privacy"');
  });
});
