import { Link, useMatch } from "react-router";
import { useConfig } from "../../api/queries";
import { useI18n } from "../../i18n";
import { versionLabel } from "./about";

/** "Oukilé 0.2.0 (6aace8e) · Privacy", under the panels and on the sign-in page. */
export function AppFooter() {
  const { t } = useI18n();
  const { data: config } = useConfig();
  const onPrivacy = useMatch("/privacy");
  return (
    <p className="app-foot" data-testid="app-footer">
      <span>{versionLabel(t("app.name"), config)}</span>
      {!onPrivacy && (
        <>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy" data-testid="link-privacy">
            {t("privacy.title")}
          </Link>
        </>
      )}
    </p>
  );
}
