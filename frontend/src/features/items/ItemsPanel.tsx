import { Link } from "react-router";
import { useConfig, useDevices } from "../../api/queries";
import { useI18n } from "../../i18n";
import { Empty, PanelHeader, Section } from "../../ui/components";
import { DeviceRow } from "../devices/DeviceList";
import { useProviderAccount } from "../settings/AppleAccount";

/** The Find My network items; their Apple account and adding one are in Settings. */
function ItemList() {
  const { t } = useI18n();
  const { data: account } = useProviderAccount("findmy");
  const { data: devices, isLoading } = useDevices();
  const items = devices?.filter((d) => d.kind === "findmy") ?? [];
  const signedOut = account?.state === "none" || account?.state === "error";
  // Without a working account the positions stop updating: say so where the items are.
  const warning =
    account?.state === "reauth_required" ? "items.reauthBanner" : signedOut && items.length > 0 ? "items.signedOutBanner" : null;
  return (
    <>
      {warning && (
        <div className="banner banner-danger" data-testid="findmy-warning">
          <p>{t(warning)}</p>
          <Link to="/settings/findmy" className="banner-link">
            {account?.state === "reauth_required" ? t("items.reconnect") : t("items.connectInSettings")}
          </Link>
        </div>
      )}
      {isLoading && <Empty>{t("common.loading")}</Empty>}
      {!isLoading && items.length === 0 && (
        <Empty>
          <span>{signedOut ? t("items.signedOut") : t("items.empty")}</span>
          <Link to="/settings/findmy" className="btn btn-small" data-testid="link-add-item">
            {t("items.addInSettings")}
          </Link>
        </Empty>
      )}
      {items.length > 0 && <p className="muted small">{t("items.delay")}</p>}
      <div className="list">
        {items.map((d) => (
          <DeviceRow key={d.id} device={d} isLocal={false} from={null} />
        ))}
      </div>
    </>
  );
}

export function ItemsPanel() {
  const { t } = useI18n();
  const { data: config } = useConfig();
  if (!config) return <Empty>{t("common.loading")}</Empty>;
  return (
    <div data-testid="items-panel">
      <PanelHeader title={t("items.title")} />
      {config.features.findmy ? (
        <ItemList />
      ) : (
        <Section>
          <p>{t("items.disabled")}</p>
          <p className="muted small">{t("items.disabledHelp")}</p>
        </Section>
      )}
    </div>
  );
}
