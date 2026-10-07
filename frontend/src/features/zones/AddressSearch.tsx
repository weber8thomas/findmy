import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { Place } from "../../api/types";
import { useI18n } from "../../i18n";
import { Icon } from "../../ui/icons";
import { splitLabel } from "./address";

/**
 * Find a place by its address (the server asks OpenStreetMap Nominatim). Searches when asked,
 * never while typing: Nominatim's usage policy forbids search-as-you-type.
 */
export function AddressSearch({ onPick }: { onPick: (place: Place) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const search = useMutation({
    mutationFn: (q: string) => api<Place[]>(`/geocode?${new URLSearchParams({ q })}`),
  });
  const ready = query.trim().length >= 2 && !search.isPending;

  const submit = () => {
    if (!ready) return;
    // On a phone or a tablet, close the on-screen keyboard: it would hide the results.
    if (window.matchMedia("(pointer: coarse)").matches) input.current?.blur();
    search.mutate(query.trim());
  };

  // Bring the field and its answer into view in a half-open sheet or a short panel: all of it
  // when it fits, else from the field down.
  useEffect(() => {
    if (search.data || search.isError) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [search.data, search.isError]);

  const failure =
    search.error instanceof ApiError && search.error.status === 429 ? t("zones.addressTooMany") : t("zones.addressError");

  return (
    <div ref={box} className="address-search" data-testid="zone-address">
      <div className="field">
        <label className="field-label" htmlFor={id}>
          {t("zones.address")}
        </label>
        <div className="inline-form">
          <input
            ref={input}
            id={id}
            type="search"
            name="zone-address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter searches; it must not save the place (this sits inside the place's form).
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("zones.addressPlaceholder")}
            enterKeyHint="search"
            autoComplete="off"
            maxLength={200}
            data-testid="zone-address-input"
          />
          <button type="button" className="btn" onClick={submit} disabled={!ready} data-testid="zone-address-search">
            {search.isPending ? t("zones.addressSearching") : t("zones.addressSearch")}
          </button>
        </div>
      </div>
      <div className="address-results" aria-live="polite">
        {search.isError && (
          <p className="banner banner-danger" data-testid="zone-address-error">
            {failure}
          </p>
        )}
        {search.data?.length === 0 && (
          <p className="banner" data-testid="zone-address-none">
            {t("zones.addressNone", { query: search.variables ?? "" })}
          </p>
        )}
        {search.data && search.data.length > 0 && (
          <>
            <div className="list" role="group" aria-label={t("zones.addressResults")}>
              {search.data.map((place, i) => {
                const { title, detail } = splitLabel(place.label);
                return (
                  <button
                    key={`${i}-${place.lat},${place.lon}`}
                    type="button"
                    className="row"
                    onClick={() => {
                      onPick(place);
                      search.reset();
                    }}
                    data-testid="zone-address-result"
                  >
                    <span className="row-avatar row-avatar-zone">
                      <Icon name="pin" />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{title}</span>
                      {detail && <span className="row-sub">{detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="field-hint address-credit">
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                {t("zones.addressCredit")}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
