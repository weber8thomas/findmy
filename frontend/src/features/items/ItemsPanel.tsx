import { useConfig } from "../../api/queries";
import { useI18n } from "../../i18n";
import { Empty, PanelHeader, Section } from "../../ui/components";
import { FindMySection } from "./FindMySection";
import { ICloudSection } from "./ICloudSection";

export function ItemsPanel() {
  const { t } = useI18n();
  const { data: config } = useConfig();
  if (!config) return <Empty>{t("common.loading")}</Empty>;
  const { findmy, icloud } = config.features;
  return (
    <div data-testid="items-panel">
      <PanelHeader title={t("items.title")} />
      {!findmy && !icloud && (
        <Section>
          <p>{t("items.disabled")}</p>
          <p className="muted small">{t("items.disabledHelp")}</p>
        </Section>
      )}
      {icloud && <ICloudSection />}
      {findmy && <FindMySection />}
    </div>
  );
}
