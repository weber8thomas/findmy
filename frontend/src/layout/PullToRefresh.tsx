import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../ui/icons";

/** Pulled this far (px, once slowed down), letting go refreshes. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
/** The indicator moves this much slower than the finger. */
const RESISTANCE = 0.5;
/** Shown at least this long, so a quick refresh still reads as one. */
const MIN_BUSY_MS = 600;
// A finger on these is theirs (typing, sliding), or the sheet's (its handle and title bar).
const NOT_HERE = "input, textarea, select, [contenteditable], .sheet-handle, .panel-header";

/** Fresh data, and the app's new version if there is one: it reloads the page as it takes over. */
async function refreshAll(qc: QueryClient) {
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  await Promise.all([qc.refetchQueries({ type: "active" }), reg?.update().catch(() => undefined)]);
}

/**
 * Pull to refresh, the page pulled down from its top. Installed apps never get the browser's
 * own (and Oukilé turns it off in a tab, for the map's sake). The indicator comes out from under
 * the title bar.
 */
export function PullToRefresh({ scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const self = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [top, setTop] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const page = scroller.current;
    if (!page) return;
    let start: { id: number; x: number; y: number } | null = null;
    let claimed: boolean | null = null;
    let distance = 0;

    const onStart = (e: TouchEvent) => {
      claimed = null;
      distance = 0;
      const target = e.target as HTMLElement;
      start = e.touches.length === 1 && !busyRef.current && !target.closest(NOT_HERE) ? { id: e.touches[0].identifier, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || claimed === false) return;
      const p = [...e.touches].find((p) => p.identifier === start!.id);
      if (!p || e.touches.length !== 1) return void (claimed = false);
      const dy = p.clientY - start.y;
      if (claimed === null) {
        const dx = p.clientX - start.x;
        if (dy === 0 && dx === 0) return;
        // Decided on the first move: past it, the browser has started scrolling.
        claimed = dy > 0 && dy >= Math.abs(dx) && page.scrollTop <= 0;
        if (!claimed) return;
        const header = page.querySelector<HTMLElement>(".panel-header");
        const box = (self.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect();
        const from = header ? header.getBoundingClientRect().bottom : page.getBoundingClientRect().top;
        setTop(from - (box?.top ?? 0));
        setPulling(true);
      }
      e.preventDefault();
      const next = Math.min(PULL_MAX, Math.max(0, dy) * RESISTANCE);
      if (distance < PULL_THRESHOLD && next >= PULL_THRESHOLD) navigator.vibrate?.(8);
      distance = next;
      setPull(distance);
    };
    const onEnd = () => {
      if (!claimed) return;
      claimed = null;
      setPulling(false);
      if (distance < PULL_THRESHOLD) return setPull(0);
      busyRef.current = true;
      setBusy(true);
      setPull(PULL_THRESHOLD);
      Promise.all([refreshAll(qc), new Promise((r) => setTimeout(r, MIN_BUSY_MS))]).finally(() => {
        busyRef.current = false;
        setBusy(false);
        setPull(0);
      });
    };
    page.addEventListener("touchstart", onStart, { passive: true });
    page.addEventListener("touchmove", onMove, { passive: false });
    page.addEventListener("touchend", onEnd);
    page.addEventListener("touchcancel", onEnd);
    return () => {
      page.removeEventListener("touchstart", onStart);
      page.removeEventListener("touchmove", onMove);
      page.removeEventListener("touchend", onEnd);
      page.removeEventListener("touchcancel", onEnd);
    };
  }, [scroller, qc]);

  const shown = pull > 0 || busy;
  return (
    <div
      ref={self}
      className={`ptr${pulling ? " is-pulling" : ""}${busy ? " is-busy" : ""}`}
      style={{ top }}
      role="status"
      aria-label={busy ? t("common.refreshing") : undefined}
      data-testid="pull-to-refresh"
      data-state={busy ? "busy" : pull >= PULL_THRESHOLD ? "ready" : shown ? "pulling" : "idle"}
    >
      <span className="ptr-spinner" style={{ transform: `translateY(${pull - 44}px)`, opacity: shown ? Math.min(1, pull / PULL_THRESHOLD + 0.2) : 0 }}>
        <span className="ptr-icon" style={busy ? undefined : { transform: `rotate(${pull * 4}deg)` }}>
          <Icon name="refresh" size={20} />
        </span>
      </span>
    </div>
  );
}
