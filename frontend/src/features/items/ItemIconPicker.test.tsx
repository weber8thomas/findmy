import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeviceIcon } from "../../api/types";
import { I18nProvider, type Locale } from "../../i18n";
import { ITEM_ICONS, ItemIconPicker } from "./ItemIconPicker";

function render(value: DeviceIcon, locale: Locale = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <ItemIconPicker value={value} onPick={() => {}} />
    </I18nProvider>,
  );
}

describe("item icon picker", () => {
  it("offers one button per item icon, the current one pressed", () => {
    const html = render("car");
    expect(html.match(/<button /g)).toHaveLength(ITEM_ICONS.length);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="item-icon-car"/);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("Keys");
  });

  it("keeps device icons out: a tag is never AirPods or a phone", () => {
    expect(ITEM_ICONS).not.toContain("earbuds");
    expect(ITEM_ICONS).not.toContain("phone");
    expect(render("tag")).not.toContain("item-icon-earbuds");
  });

  it("presses nothing for an icon it doesn't offer", () => {
    expect(render("phone")).not.toContain('aria-pressed="true"');
  });

  it("is translated", () => {
    const html = render("key", "fr");
    expect(html).toContain("Clés");
    expect(html).toContain("Voiture");
    expect(html).toContain('aria-label="Changer l’icône"');
  });
});
