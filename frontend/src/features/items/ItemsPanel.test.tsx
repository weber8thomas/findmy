import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { AppConfig, Device, ProviderAccount } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { ItemsPanel } from "./ItemsPanel";

const CONFIG = {
  features: { owntracks: true, findmy: true, icloud: true, push: false },
} as AppConfig;

const account = (state: ProviderAccount["state"]): ProviderAccount => ({
  state,
  display: state === "none" ? null : "w***@example.com",
  last_poll_at: null,
  last_error: null,
});

const device = (id: string, kind: Device["kind"], name: string): Device => ({
  id,
  name,
  kind,
  icon: "tag",
  online: false,
  capabilities: [],
  is_primary: false,
  location: null,
  last_seen_at: null,
  battery: null,
  lost_mode: { enabled: false, message: null, phone: null, since: null, owner_name: null },
  created_at: "2026-10-01T00:00:00Z",
  provider_info: {},
});

function render({
  config = CONFIG,
  state = "logged_in",
  devices = [],
  locale = "en",
}: { config?: AppConfig; state?: ProviderAccount["state"]; devices?: Device[]; locale?: Locale } = {}) {
  const qc = new QueryClient();
  qc.setQueryData(keys.config, config);
  qc.setQueryData(keys.devices, devices);
  qc.setQueryData(["provider", "findmy"], account(state));
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale={locale}>
        <MemoryRouter initialEntries={["/items"]}>
          <ItemsPanel />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("items tab", () => {
  it("lists the Find My network items only, without the Apple account or the add forms", () => {
    const html = render({ devices: [device("k", "findmy", "Keys"), device("m", "icloud", "Mac")] });
    expect(html).toContain('data-testid="device-item-k"');
    expect(html).not.toContain("device-item-m");
    expect(html).not.toContain("findmy-account");
    expect(html).not.toContain("Apple ID");
    expect(html).not.toContain("Generate a DIY tag key");
    expect(html).not.toContain("findmy-warning");
  });

  it("points to Settings when there is nothing to show", () => {
    const empty = render();
    expect(empty).toContain("No items yet.");
    expect(empty).toMatch(/<a [^>]*data-testid="link-add-item" href="\/settings\/findmy"/);

    const signedOut = render({ state: "none" });
    expect(signedOut).toContain("Connect an Apple account to the Find My network");
    expect(signedOut).toContain('data-testid="link-add-item"');
    expect(signedOut).not.toContain("findmy-warning");
  });

  it("warns when the items stop updating, with a link to sign in again", () => {
    const reauth = render({ state: "reauth_required", devices: [device("k", "findmy", "Keys")], locale: "fr" });
    expect(reauth).toContain('data-testid="findmy-warning"');
    expect(reauth).toContain("Apple demande de se reconnecter au réseau Localiser");
    expect(reauth).toMatch(/href="\/settings\/findmy"[^>]*>Se reconnecter dans Réglages</);

    const signedOut = render({ state: "none", devices: [device("k", "findmy", "Keys")] });
    expect(signedOut).toContain("No Apple account is connected to the Find My network");
    expect(signedOut).toContain("Connect an account in Settings");
  });

  it("says the feature is off on this server", () => {
    const html = render({ config: { features: { ...CONFIG.features, findmy: false } } as AppConfig });
    expect(html).toContain("disabled on this server");
    expect(html).toContain("FEATURE_FINDMY");
    expect(html).not.toContain("link-add-item");
  });
});
