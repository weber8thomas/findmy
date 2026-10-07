import type { DeviceIcon } from "../../api/types";
import { useI18n } from "../../i18n";
import { DeviceGlyph } from "../../ui/icons";

/** What a Find My network tag can be attached to (earbuds are iCloud devices, not tags). */
export const ITEM_ICONS = ["tag", "key", "car", "backpack", "wallet", "suitcase", "bike", "pet"] as const satisfies readonly DeviceIcon[];

export function ItemIconPicker({ value, onPick }: { value: DeviceIcon; onPick: (icon: DeviceIcon) => void }) {
  const { t } = useI18n();
  return (
    <div className="icon-picker" role="group" aria-label={t("items.changeIcon")} data-testid="item-icon-picker">
      {ITEM_ICONS.map((icon) => (
        <button key={icon} type="button" className="icon-choice" aria-pressed={icon === value} onClick={() => onPick(icon)} data-testid={`item-icon-${icon}`}>
          <span className="row-avatar row-avatar-device">
            <DeviceGlyph icon={icon} size={30} />
          </span>
          <span className="icon-choice-label">{t(`items.icon.${icon}`)}</span>
        </button>
      ))}
    </div>
  );
}
