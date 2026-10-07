import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../../api/client";
import { keys, useDevices } from "../../api/queries";
import type { Device } from "../../api/types";
import { useI18n } from "../../i18n";
import { toast } from "../../lib/ui-state";
import { Field, Section } from "../../ui/components";
import { AppleAccount, useProviderAccount } from "./AppleAccount";
import { SourcePage } from "./AppleSources";

type Mode = "import" | "generate" | "plist" | null;

function AddItem() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [advKey, setAdvKey] = useState<string | null>(null);
  // The new item is listed in Items, not here: say it was added.
  const done = (device: Device) => {
    toast(t("items.added"), device.name, "success");
    void qc.invalidateQueries({ queryKey: keys.devices });
  };
  const fail = (e: unknown) => toast(t("common.error"), e instanceof ApiError ? e.detail : undefined, "error");

  const add = useMutation({
    mutationFn: (form: FormData) => api<Device>("/items", { method: "POST", body: form }),
    onSuccess: (device) => {
      setMode(null);
      done(device);
    },
    onError: fail,
  });
  const generate = useMutation({
    mutationFn: (name: string) => api<{ device: Device; adv_key_b64: string }>("/items/generate", { method: "POST", body: { name } }),
    onSuccess: (res) => {
      setAdvKey(res.adv_key_b64);
      done(res.device);
    },
    onError: fail,
  });

  return (
    <div className="add-item">
      <div className="row-buttons wrap">
        <button className="btn btn-small" onClick={() => setMode("generate")}>{t("items.generateKey")}</button>
        <button className="btn btn-small" onClick={() => setMode("import")}>{t("items.importKey")}</button>
        <button className="btn btn-small" onClick={() => setMode("plist")}>{t("items.importPlist")}</button>
      </div>
      {mode === "generate" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            generate.mutate(String(new FormData(e.currentTarget).get("name")));
          }}
        >
          <Field label={t("items.name")}>
            <input name="name" required maxLength={80} />
          </Field>
          <button className="btn btn-primary btn-block" disabled={generate.isPending}>{t("items.add")}</button>
          {advKey && (
            <Field label={t("items.advKey")}>
              <input readOnly value={advKey} onFocus={(e) => e.target.select()} />
            </Field>
          )}
        </form>
      )}
      {(mode === "import" || mode === "plist") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            form.set("type", mode === "import" ? "haystack" : "airtag");
            add.mutate(form);
          }}
        >
          <Field label={t("items.name")}>
            <input name="name" required maxLength={80} />
          </Field>
          {mode === "import" ? (
            <Field label={t("items.privateKey")}>
              <input name="private_key_b64" required autoComplete="off" />
            </Field>
          ) : (
            <>
              <Field label={t("items.plist")}>
                <input name="plist" type="file" accept=".plist,application/xml" required />
              </Field>
              <Field label={`${t("items.alignmentPlist")} (${t("common.optional")})`}>
                <input name="alignment_plist" type="file" accept=".plist,application/xml" />
              </Field>
            </>
          )}
          <button className="btn btn-primary btn-block" disabled={add.isPending}>{t("items.add")}</button>
        </form>
      )}
    </div>
  );
}

function FindMySection() {
  const { t } = useI18n();
  const { data: account } = useProviderAccount("findmy");
  const { data: devices } = useDevices();
  const items = devices?.filter((d) => d.kind === "findmy").length ?? 0;
  return (
    <>
      <Section title={t("settings.appleAccount")} testId="findmy-section">
        <p className="muted small">{t("settings.findmyExplain")}</p>
        <AppleAccount provider="findmy" />
      </Section>
      {account?.state === "logged_in" && (
        <Section title={t("items.add")} testId="add-item">
          <AddItem />
          {items > 0 && <p className="muted small">{t("items.inItems", { count: String(items) })}</p>}
        </Section>
      )}
    </>
  );
}

/** Settings › Items (Find My network): the Apple account, and adding a tag or an AirTag. */
export function FindMySettings() {
  return (
    <SourcePage provider="findmy">
      <FindMySection />
    </SourcePage>
  );
}
