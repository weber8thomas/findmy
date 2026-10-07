import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { AppConfig, ICloudDevice, ProviderAccount } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { FindMySettings } from "./FindMySettings";
import { ICloudSettings } from "./ICloudSettings";
import { AppleSources } from "./AppleSources";

const features = (icloud: boolean, findmy: boolean) => ({ features: { owntracks: true, push: false, icloud, findmy } }) as AppConfig;

const account = (state: ProviderAccount["state"]): ProviderAccount => ({
  state,
  display: state === "none" ? null : "w***@example.com",
  last_poll_at: null,
  last_error: null,
});

function render(
  ui: ReactNode,
  {
    config = features(true, true),
    icloud = "none",
    findmy = "none",
    icloudDevices,
    locale = "en",
  }: {
    config?: AppConfig;
    icloud?: ProviderAccount["state"];
    findmy?: ProviderAccount["state"];
    icloudDevices?: ICloudDevice[];
    locale?: Locale;
  } = {},
) {
  const qc = new QueryClient();
  qc.setQueryData(keys.config, config);
  qc.setQueryData(keys.devices, []);
  qc.setQueryData(["provider", "icloud"], account(icloud));
  qc.setQueryData(["provider", "findmy"], account(findmy));
  if (icloudDevices) qc.setQueryData(["icloud-devices"], icloudDevices);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale={locale}>
        <MemoryRouter initialEntries={["/settings"]}>{ui}</MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("Apple sources in Settings", () => {
  it("one row per source, with its account state, opening its page", () => {
    const html = render(<AppleSources />, { icloud: "logged_in", findmy: "reauth_required", locale: "fr" });
    expect(html).toMatch(/href="\/settings\/icloud"[^>]*>.*Appareils Apple \(iCloud\)/);
    expect(html).toMatch(/href="\/settings\/findmy"[^>]*>.*Objets \(réseau Localiser\)/);
    expect(html).toMatch(/data-testid="icloud-state">Connecté en tant que w\*\*\*@example\.com</);
    expect(html).toMatch(/class="link-row-sub is-danger" data-testid="findmy-state">Apple demande de se reconnecter</);
    expect(render(<AppleSources />, { findmy: "none" })).toMatch(/data-testid="findmy-state">Not connected</);
  });

  it("only the sources this server enables", () => {
    const html = render(<AppleSources />, { config: features(false, true) });
    expect(html).not.toContain("/settings/icloud");
    expect(html).toContain("/settings/findmy");
    expect(render(<AppleSources />, { config: features(false, false) })).toBe("");
  });

  it("Find My network page: the account, then adding items once connected", () => {
    const signedOut = render(<FindMySettings />);
    expect(signedOut).toContain("Items (Find My network)");
    expect(signedOut).toContain('data-testid="back"');
    expect(signedOut).toContain("Apple ID");
    expect(signedOut).toContain("Use a dedicated Apple ID");
    expect(signedOut).not.toContain('data-testid="add-item"');

    const connected = render(<FindMySettings />, { findmy: "logged_in" });
    expect(connected).toContain('data-testid="findmy-account"');
    expect(connected).toContain("Connected as w***@example.com");
    expect(connected).toContain("Disconnect");
    expect(connected).toContain("Generate a DIY tag key");
    expect(connected).toContain("Import a private key (OpenHaystack)");
    expect(connected).toContain("Import an AirTag (.plist)");
  });

  it("iCloud page: the account, then the devices not tracked yet", () => {
    const html = render(<ICloudSettings />, {
      icloud: "logged_in",
      icloudDevices: [
        { icloud_device_id: "a", name: "iPad", model: "iPad Air", tracked_device_id: null },
        { icloud_device_id: "b", name: "Watch", model: "Apple Watch", tracked_device_id: null },
        { icloud_device_id: "c", name: "Mac", model: "MacBook Air", tracked_device_id: "dev-mac" },
      ],
    });
    expect(html).toContain("Apple devices (iCloud)");
    expect(html).toContain('data-testid="icloud-account"');
    expect(html).toContain("Track all (2)");
    expect(html).toContain("iPad Air");
    expect(html).not.toContain("MacBook Air");
  });

  it("nothing when the server has the source off", () => {
    expect(render(<ICloudSettings />, { config: features(false, true) })).toBe("");
    expect(render(<FindMySettings />, { config: features(true, false) })).toBe("");
  });
});
