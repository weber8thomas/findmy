import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { keys } from "../../api/queries";
import type { AppConfig } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { AuthPage, authMethods, ssoErrorKey } from "./AuthPage";

const BASE: AppConfig = {
  app_name: "Oukilé",
  registration_open: true,
  providers: ["browser"],
  features: { owntracks: false, findmy: false, icloud: false, push: false },
  map: { tile_url: "", tile_url_dark: "", attribution: "" },
  vapid_public_key: null,
};
const SSO = { name: "Authentik", login_url: "/api/auth/oidc/login" };

function render(config: AppConfig, { url = "/login", locale = "en" as Locale, mode = "login" as "login" | "register" } = {}) {
  const qc = new QueryClient();
  qc.setQueryData(keys.config, config);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider initialLocale={locale}>
        <MemoryRouter initialEntries={[url]}>
          <AuthPage mode={mode} />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("sign-in methods", () => {
  it("older servers without `auth` keep the password form only", () => {
    expect(authMethods(BASE)).toEqual({ password: true, oidc: null });
    expect(authMethods(undefined)).toEqual({ password: true, oidc: null });
    const html = render(BASE);
    expect(html).toContain('name="password"');
    expect(html).not.toContain('data-testid="sso-login"');
    // The language is picked in Me after sign-in (or DEFAULT_LOCALE), not here.
    expect(html).not.toContain('data-testid="lang-fr"');
  });

  it("SSO and password: a full-page link to the login URL, then the form", () => {
    const html = render({ ...BASE, auth: { password: true, oidc: SSO } });
    expect(html).toMatch(/<a [^>]*href="\/api\/auth\/oidc\/login"[^>]*data-testid="sso-login"/);
    expect(html).toContain("Continue with Authentik");
    expect(html).toContain('name="password"');
    expect(html).toContain('href="/register"');
  });

  it("SSO only: no password form and no account creation", () => {
    const html = render({ ...BASE, auth: { password: false, oidc: SSO } });
    expect(html).toContain('data-testid="sso-login"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('href="/register"');
    expect(render({ ...BASE, auth: { password: false, oidc: SSO } }, { url: "/register", mode: "register" })).not.toContain(
      'name="display_name"',
    );
  });

  it("never locks everyone out: password off without SSO still shows the form", () => {
    expect(authMethods({ ...BASE, auth: { password: false, oidc: null } }).password).toBe(true);
  });

  it("is translated", () => {
    const html = render({ ...BASE, auth: { password: true, oidc: SSO } }, { locale: "fr" });
    expect(html).toContain("Continuer avec Authentik");
  });
});

describe("SSO errors", () => {
  it("maps every backend code, and unknown ones to a generic failure", () => {
    expect(ssoErrorKey(null)).toBeNull();
    expect(ssoErrorKey("denied")).toBe("auth.sso.denied");
    expect(ssoErrorKey("failed")).toBe("auth.sso.failed");
    expect(ssoErrorKey("no_account")).toBe("auth.sso.no_account");
    expect(ssoErrorKey("disabled")).toBe("auth.sso.disabled");
    expect(ssoErrorKey("weird")).toBe("auth.sso.failed");
  });

  it("shows a friendly message from ?sso_error=", () => {
    const html = render({ ...BASE, auth: { password: true, oidc: SSO } }, { url: "/login?sso_error=no_account" });
    expect(html).toMatch(/role="alert"[^>]*data-testid="sso-error"/);
    expect(html).toContain("Ask the family admin");
    const fr = render({ ...BASE, auth: { password: true, oidc: SSO } }, { url: "/login?sso_error=denied", locale: "fr" });
    expect(fr).toContain("refusée par Authentik");
  });

  it("no message without an error", () => {
    expect(render({ ...BASE, auth: { password: true, oidc: SSO } })).not.toContain('data-testid="sso-error"');
  });
});
