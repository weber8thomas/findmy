import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { LoginResult, ProviderAccount, TwoFactorMethod } from "../../api/types";
import { useI18n } from "../../i18n";
import { toast } from "../../lib/ui-state";
import { Field } from "../../ui/components";

export type AppleProvider = "icloud" | "findmy";

export function useProviderAccount(provider: AppleProvider) {
  return useQuery({
    queryKey: ["provider", provider],
    queryFn: () => api<ProviderAccount>(`/providers/${provider}/account`),
  });
}

/** Apple ID sign-in with optional two-factor step, shared by the iCloud and Find My providers. */
export function AppleAccount({ provider }: { provider: AppleProvider }) {
  const { t, relTime } = useI18n();
  const qc = useQueryClient();
  const { data: account } = useProviderAccount(provider);
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [methods, setMethods] = useState<TwoFactorMethod[] | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["provider", provider] });
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => {
    const detail = e instanceof ApiError ? e.detail : e instanceof Error ? e.message : undefined;
    setError(detail ?? t("common.error"));
    toast(t("common.error"), detail, "error");
  };

  const login = useMutation({
    mutationFn: () => {
      setError(null);
      return api<LoginResult>(`/providers/${provider}/login`, { method: "POST", body: { apple_id: appleId, password } });
    },
    onSuccess: (res) => {
      if (res.state === "require_2fa") {
        setMethods(res.methods ?? []);
        setMethod(res.methods?.[0]?.id ?? null);
      } else {
        setPassword("");
        void refresh();
      }
    },
    onError: fail,
  });
  const request = useMutation({
    mutationFn: (methodId: string) =>
      api(`/providers/${provider}/2fa/request`, { method: "POST", body: { method_id: methodId } }),
    onError: fail,
  });
  const submit = useMutation({
    mutationFn: () => {
      setError(null);
      return api<LoginResult>(`/providers/${provider}/2fa/submit`, { method: "POST", body: { method_id: method, code } });
    },
    onSuccess: () => {
      setMethods(null);
      setCode("");
      setPassword("");
      void refresh();
    },
    onError: fail,
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/providers/${provider}/account`, { method: "DELETE" }),
    onSuccess: () => {
      void refresh();
      void qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  if (account && account.state === "logged_in") {
    return (
      <div className="apple-account" data-testid={`${provider}-account`}>
        <p>✓ {t("items.connected", { account: account.display ?? "" })}</p>
        {account.last_poll_at && <p className="muted small">{relTime(account.last_poll_at)}</p>}
        <button className="link-row danger" onClick={() => disconnect.mutate()}>
          {t("items.disconnect")}
        </button>
      </div>
    );
  }

  if (methods) {
    return (
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        {methods.length > 1 && (
          <Field label={t("items.chooseMethod")}>
            <select
              value={method ?? ""}
              onChange={(e) => {
                setMethod(e.target.value);
                request.mutate(e.target.value);
              }}
            >
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("items.twoFactor")} hint={t("items.twoFactorHelp")}>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required pattern="[0-9]{6}" />
        </Field>
        {error && <p className="banner banner-danger" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={submit.isPending}>
          {submit.isPending ? t("items.connecting") : t("common.save")}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        login.mutate();
      }}
    >
      {account?.state === "reauth_required" && <p className="banner banner-danger">{t("items.reauth")}</p>}
      <p className="banner banner-warning small">{t("items.warning")}</p>
      <Field label={t("items.appleId")}>
        <input type="text" inputMode="email" value={appleId} onChange={(e) => setAppleId(e.target.value)} required autoComplete="off" />
      </Field>
      <Field label={t("items.applePassword")}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
      </Field>
      {error && <p className="banner banner-danger" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={login.isPending}>
        {login.isPending ? t("items.connecting") : t("items.connect")}
      </button>
    </form>
  );
}
