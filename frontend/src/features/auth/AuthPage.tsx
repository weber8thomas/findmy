import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError } from "../../api/client";
import { keys, useConfig } from "../../api/queries";
import type { User } from "../../api/types";
import { useI18n, type Locale } from "../../i18n";
import { Field } from "../../ui/components";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: config } = useConfig();
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
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <img src="/icons/icon.svg" alt="" width={64} height={64} />
        <h1>{t("app.name")}</h1>
        <p className="muted">{t("auth.tagline")}</p>
        {mode === "register" && (
          <Field label={t("auth.displayName")}>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" name="display_name" />
          </Field>
        )}
        <Field label={t("auth.email")}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" name="email" />
        </Field>
        <Field label={t("auth.password")} hint={mode === "register" ? t("auth.passwordHint") : undefined}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 8 : undefined}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            name="password"
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy} type="submit" data-testid="auth-submit">
          {mode === "login" ? t("auth.login") : t("auth.register")}
        </button>
        {mode === "login" ? (
          config?.registration_open !== false && (
            <p className="muted">
              {t("auth.noAccount")} <Link to="/register">{t("auth.register")}</Link>
            </p>
          )
        ) : (
          <p className="muted">
            {t("auth.haveAccount")} <Link to="/login">{t("auth.login")}</Link>
          </p>
        )}
        <LanguageSwitch value={locale} onChange={setLocale} />
      </form>
    </main>
  );
}

export function LanguageSwitch({ value, onChange }: { value: Locale; onChange: (l: Locale) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Language">
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          className={value === l ? "active" : ""}
          onClick={() => onChange(l)}
          data-testid={`lang-${l}`}
        >
          {l === "fr" ? "Français" : "English"}
        </button>
      ))}
    </div>
  );
}
