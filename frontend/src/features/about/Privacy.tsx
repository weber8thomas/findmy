import { Link } from "react-router";
import { useConfig } from "../../api/queries";
import { useI18n } from "../../i18n";
import { PanelHeader, Section } from "../../ui/components";
import { Icon } from "../../ui/icons";
import { LandingMap } from "../auth/LandingMap";
import "../auth/landing.css";
import { mapHosts } from "./about";
import { AppFooter } from "./AppFooter";

/** What Oukilé keeps and who sees it, from this server's own settings (docs/privacy.md, short). */
export function PrivacyContent() {
  const { t } = useI18n();
  const { data: config } = useConfig();
  const apple = Boolean(config?.features.icloud || config?.features.findmy);
  const hosts = mapHosts(config?.map);
  const days = config?.retention_days;
  const sso = config?.auth?.oidc?.name;
  const geocoder = config?.features.geocode ? config.geocoder_host : null;
  return (
    <div className="privacy" data-testid="privacy">
      <p className="privacy-intro">{t("privacy.intro")}</p>
      <Section title={t("privacy.stored")}>
        <ul className="privacy-list">
          <li>{t("privacy.stored.account")}</li>
          <li>{t("privacy.stored.photo")}</li>
          <li>{t("privacy.stored.devices")}</li>
          <li data-testid="privacy-history">
            {days != null ? t("privacy.stored.history", { days }) : t("privacy.stored.historyKept")}
          </li>
          <li>{t("privacy.stored.places")}</li>
          {config?.features.owntracks && <li>{t("privacy.stored.placesPhone")}</li>}
          {apple && <li>{t("privacy.stored.apple")}</li>}
        </ul>
      </Section>
      <Section title={t("privacy.visible")}>
        <ul className="privacy-list">
          <li>{t("privacy.visible.share")}</li>
          <li>{t("privacy.visible.consent")}</li>
          <li>{t("privacy.visible.photo")}</li>
          <li>{t("privacy.visible.admin")}</li>
        </ul>
      </Section>
      <Section title={t("privacy.others")}>
        <ul className="privacy-list">
          {hosts.length > 0 && <li>{t("privacy.others.map", { hosts: hosts.join(", ") })}</li>}
          {geocoder && <li data-testid="privacy-geocode">{t("privacy.others.geocode", { host: geocoder })}</li>}
          {apple && <li>{t("privacy.others.apple")}</li>}
          {config?.features.push && <li>{t("privacy.others.push")}</li>}
          {sso && <li>{t("privacy.others.sso", { name: sso })}</li>}
          <li>{t("privacy.others.nothingElse")}</li>
        </ul>
      </Section>
      <p className="muted small privacy-law">{t("privacy.law")}</p>
    </div>
  );
}

/** Signed in: a panel, reached from Settings or the footer. */
export function PrivacyPanel() {
  const { t } = useI18n();
  return (
    <div data-testid="privacy-panel">
      <PanelHeader title={t("privacy.title")} back="/settings" />
      <PrivacyContent />
    </div>
  );
}

/** Signed out: the same text in the sign-in page's frame, readable before creating an account. */
export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <main className="landing">
      <LandingMap />
      <section className="landing-panel" aria-labelledby="privacy-title">
        <header>
          <Link to="/login" className="privacy-back" data-testid="back">
            <Icon name="chevron" size={18} />
            {t("privacy.backToSignIn")}
          </Link>
          <h1 className="privacy-title" id="privacy-title">
            {t("privacy.title")}
          </h1>
        </header>
        <PrivacyContent />
        <footer className="landing-foot">
          <AppFooter />
        </footer>
      </section>
    </main>
  );
}
