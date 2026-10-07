import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { User } from "../../api/types";
import { useI18n } from "../../i18n";
import { toast } from "../../lib/ui-state";
import { Field, PanelHeader, Section } from "../../ui/components";
import { Avatar } from "../../ui/icons";
import { usePatchMe } from "./MePanel";
import { squarePhoto } from "./photo";

/** Me › Edit: photo and name, apart from Me so a stray tap changes nothing. Removing the photo
 * asks again; the name is only saved with Save. */
export function ProfileEdit({ me }: { me: User }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.display_name);
  const [removing, setRemoving] = useState(false);
  const patchMe = usePatchMe();
  const done = (u: User) => qc.setQueryData(keys.me, u);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", await squarePhoto(file), "photo.jpg");
      return api<User>("/me/avatar", { method: "PUT", body: form });
    },
    onSuccess: done,
    onError: () => toast(t("me.photoError"), undefined, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api<User>("/me/avatar", { method: "DELETE" }),
    onSuccess: (u) => {
      done(u);
      setRemoving(false);
    },
    onError: () => toast(t("common.error"), undefined, "error"),
  });
  const busy = upload.isPending || remove.isPending;
  const trimmed = name.trim();

  return (
    <div data-testid="profile-edit">
      <PanelHeader title={t("me.editProfile")} back="/me" />
      <Section title={t("me.photo")} testId="profile-photo">
        <div className="photo-edit">
          <Avatar user={me} size="large" />
          <div className="row-buttons wrap">
            {removing ? (
              <>
                <button className="btn btn-small btn-danger" onClick={() => remove.mutate()} disabled={busy} data-testid="btn-photo-remove-confirm">
                  {t("me.photoRemoveConfirm")}
                </button>
                <button className="btn btn-small" onClick={() => setRemoving(false)} disabled={busy}>
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-small" onClick={() => input.current?.click()} disabled={busy} data-testid="btn-photo-pick">
                  {me.avatar_url ? t("me.photoChange") : t("me.photoAdd")}
                </button>
                {me.avatar_url && (
                  <button className="btn btn-small" onClick={() => setRemoving(true)} disabled={busy} data-testid="btn-photo-remove">
                    {t("me.photoRemove")}
                  </button>
                )}
              </>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            data-testid="photo-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // picking the same file again still triggers a change
              if (file) upload.mutate(file);
            }}
          />
        </div>
        <p className="muted small">{t("me.photoHint")}</p>
      </Section>

      <Section title={t("me.name")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            patchMe.mutate(
              { display_name: trimmed },
              {
                onSuccess: () => navigate("/me"),
                onError: () => toast(t("common.error"), undefined, "error"),
              },
            );
          }}
        >
          <Field label={t("me.nameHint")}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-testid="display-name" />
          </Field>
          <div className="row-buttons">
            <button type="button" className="btn" onClick={() => navigate("/me")}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" disabled={!trimmed || trimmed === me.display_name || patchMe.isPending} data-testid="btn-save-name">
              {t("common.save")}
            </button>
          </div>
        </form>
      </Section>
    </div>
  );
}
