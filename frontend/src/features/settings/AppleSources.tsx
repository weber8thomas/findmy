import type { ReactNode } from "react";
import { Link, Navigate } from "react-router";
import { useConfig } from "../../api/queries";
import { useI18n } from "../../i18n";
import { Empty, PanelHeader, Section } from "../../ui/components";
import { Icon, type IconName } from "../../ui/icons";
import { useProviderAccount, type AppleProvider } from "./AppleAccount";

/** One Apple source and its account state at a glance; its page connects it and adds devices or items. */
function AppleSourceRow({ provider, icon }: { provider: AppleProvider; icon: IconName }) {
  const { t } = useI18n();
  const { data: account } = useProviderAccount(provider);
  const reauth = account?.state === "reauth_required";
  const state = !account
    ? t("common.loading")
    : account.state === "logged_in"
      ? t("items.connected", { account: account.display ?? "" })
      : reauth
        ? t("items.reauth")
        : t("settings.notConnected");
  return (
    <Link to={`/settings/${provider}`} className="link-row" data-testid={`link-${provider}`}>
      <Icon name={icon} />
      <span className="link-row-text">
        {t(`settings.${provider}`)}
        <span className={`link-row-sub${reauth ? " is-danger" : ""}`} data-testid={`${provider}-state`}>
          {state}
        </span>
      </span>
      <Icon name="chevron" className="icon-flip link-row-chevron" />
    </Link>
  );
}

/** The Apple sources this server enables, in Settings. */
export function AppleSources() {
  const { t } = useI18n();
  const { data: config } = useConfig();
  const { icloud, findmy } = config?.features ?? {};
  if (!icloud && !findmy) return null;
  return (
    <Section title={t("settings.apple")} testId="apple-sources">
      {icloud && <AppleSourceRow provider="icloud" icon="laptop" />}
      {findmy && <AppleSourceRow provider="findmy" icon="tag" />}
    </Section>
  );
}

/** A page of Settings for one Apple source; back to Settings when the server has it off. */
export function SourcePage({ provider, children }: { provider: AppleProvider; children: ReactNode }) {
  const { t } = useI18n();
  const { data: config } = useConfig();
  if (!config) return <Empty>{t("common.loading")}</Empty>;
  if (!config.features[provider]) return <Navigate to="/settings" replace />;
  return (
    <div data-testid={`${provider}-settings`}>
      <PanelHeader title={t(`settings.${provider}`)} back="/settings" />
      {children}
    </div>
  );
}
