import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError } from "../../api/client";
import { keys, useConfig } from "../../api/queries";
import type { AppConfig, User } from "../../api/types";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n";
import { DeviceGlyph, Icon, iconSvg, type IconName } from "../../ui/icons";
import { AppFooter } from "../about/AppFooter";
import { LandingMap } from "./LandingMap";
import "./landing.css";

export type AuthMethods = { password: boolean; oidc: { name: string; login_url: string } | null };

/** Sign-in methods offered by the server; servers that predate SSO only have passwords. */
export function authMethods(config: AppConfig | undefined): AuthMethods {
  const oidc = config?.auth?.oidc ?? null;
  // Never leave the page without a way in: no SSO means the password form stays.
  const password = (config?.auth?.password ?? true) || !oidc;
  return { password, oidc };
}

const SSO_ERRORS = ["denied", "failed", "no_account", "disabled"] as const;

/** Message for `/login?sso_error=<code>`, set by the backend after a failed SSO sign-in. */
export function ssoErrorKey(code: string | null): MessageKey | null {
  if (!code) return null;
  const known = (SSO_ERRORS as readonly string[]).includes(code) ? code : "failed";
  return `auth.sso.${known}` as MessageKey;
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const { data: config } = useConfig();
  const [params] = useSearchParams();
  const methods = authMethods(config);
  const ssoError = ssoErrorKey(params.get("sso_error"));
  const providerName = methods.oidc?.name ?? t("auth.sso.provider");
  const registering = mode === "register" && methods.password;

  return (
    <main className="landing">
      <LandingMap />
      <section className="landing-panel" aria-labelledby="landing-title">
        <header className="landing-head">
          <Wordmark name={t("app.name")} />
          <p className="landing-pun">{t("landing.pun")}</p>
          <p className="landing-lede">{t("landing.lede")}</p>
        </header>

        <div className="landing-auth">
          {ssoError && (
            <p className="banner banner-danger" role="alert" data-testid="sso-error">
              {t(ssoError, { name: providerName })}
            </p>
          )}
          {methods.oidc && (
            <a className="btn btn-block btn-sso" href={methods.oidc.login_url} data-testid="sso-login">
              <Icon name="key" size={20} />
              {t("auth.sso.continue", { name: methods.oidc.name })}
            </a>
          )}
          {methods.oidc && methods.password && (
            <p className="auth-or">
              <span>{t("auth.or")}</span>
            </p>
          )}
          {methods.password && <PasswordForm mode={registering ? "register" : "login"} />}
          {methods.password &&
            (registering ? (
              <p className="auth-switch">
                {t("auth.haveAccount")} <Link to="/login">{t("auth.login")}</Link>
              </p>
            ) : (
              config?.registration_open !== false && (
                <p className="auth-switch">
                  {t("auth.noAccount")} <Link to="/register">{t("auth.register")}</Link>
                </p>
              )
            ))}
        </div>

        <FeatureList />

        <footer className="landing-foot">
          <div className="landing-private">
            <span className="feature-icon feature-icon-private" aria-hidden="true">
              <Icon name="lock" size={18} />
            </span>
            <p>
              <strong>{t("landing.private.title")}</strong>
              <span>{t("landing.private.body")}</span>
            </p>
          </div>
          <AppFooter />
        </footer>
      </section>
    </main>
  );
}

/** "Oukilé", with the accent on the é drawn as a location pin. */
function Wordmark({ name }: { name: string }) {
  const stem = name.endsWith("é") ? name.slice(0, -1) : null;
  return (
    <h1 className="wordmark" id="landing-title">
      {stem == null ? (
        name
      ) : (
        <>
          <span className="sr-only">{name}</span>
          <span aria-hidden="true">
            {stem}
            <span className="wm-e">
              e
              <svg className="wm-pin" viewBox="-48 -140 96 142" focusable="false">
                <path
                  fillRule="evenodd"
                  d="M0 0C-14-22-46-52-46-92A46 46 0 1 1 46-92C46-52 14-22 0 0ZM0-111A19 19 0 1 0 0-73A19 19 0 1 0 0-111Z"
                />
              </svg>
            </span>
          </span>
        </>
      )}
    </h1>
  );
}

function PasswordForm({ mode }: { mode: "login" | "register" }) {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "login" ? { email, password } : { email, password, display_name: name, locale };
      const res = await api<{ user: User }>(`/auth/${mode}`, { method: "POST", body });
      qc.setQueryData(keys.me, res.user);
      if (res.user.locale !== locale) setLocale(res.user.locale);
      navigate("/devices", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t("auth.invalid"));
      else if (err instanceof ApiError && err.status === 409) setError(t("auth.emailTaken"));
      else if (err instanceof ApiError && err.status === 403) setError(t("auth.closed"));
      else if (err instanceof ApiError) setError(err.detail);
      else setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} aria-label={mode === "login" ? t("auth.login") : t("auth.register")}>
      <div className="form-group">
        {mode === "register" && (
          <GroupField label={t("auth.displayName")}>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" name="display_name" />
          </GroupField>
        )}
        <GroupField label={t("auth.email")}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === "register" ? "email" : "username"}
            autoCapitalize="none"
            spellCheck={false}
            name="email"
          />
        </GroupField>
        <GroupField label={t("auth.password")}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 8 : undefined}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            name="password"
          />
        </GroupField>
      </div>
      {mode === "register" && <p className="form-hint">{t("auth.passwordHint")}</p>}
      {error && (
        <p className="banner banner-danger" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" disabled={busy} type="submit" data-testid="auth-submit">
        {mode === "login" ? t("auth.login") : t("auth.register")}
      </button>
    </form>
  );
}

function GroupField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="gfield">
      <span className="gfield-label">{label}</span>
      {children}
    </label>
  );
}

const FEATURES: { title: MessageKey; body: MessageKey; icon: ReactNode }[] = [
  { title: "landing.devices.title", body: "landing.devices.body", icon: <DeviceGlyph icon="laptop" size={28} /> },
  { title: "landing.people.title", body: "landing.people.body", icon: <FeatureIcon name="person" /> },
  { title: "me.zones", body: "landing.places.body", icon: <FeatureIcon name="zone" /> },
  { title: "actions.playSound", body: "landing.sound.body", icon: <FeatureIcon name="sound" /> },
];

function FeatureIcon({ name }: { name: IconName }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: iconSvg(name, 20) }} />;
}

/** What Oukilé does, as a list: shown where the map is too small to carry it. */
function FeatureList() {
  const { t } = useI18n();
  return (
    <ul className="landing-features" aria-label={t("landing.features")}>
      {FEATURES.map((f, i) => (
        <li key={f.title}>
          <span className={`feature-icon feature-icon-${i}`} aria-hidden="true">
            {f.icon}
          </span>
          <p>
            <strong>{t(f.title)}</strong>
            <span>{t(f.body)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
