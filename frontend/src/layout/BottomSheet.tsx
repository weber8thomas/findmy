import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useI18n } from "../i18n";
import { useStore } from "../lib/store";
import { mapUi } from "../lib/ui-state";
import { clampHeight, cycle, heightOf, settle, step, type Rest } from "./sheet";

type Drag = { kind: "pointer" | "touch"; id: number; y: number; h: number; last: number; moved: boolean; samples: { y: number; t: number }[] };

// What a finger on these does stays theirs: typing, picking, sliding.
const OWN_GESTURES = "input, textarea, select, [contenteditable]";
const GRIP = ".sheet-handle, .panel-header";

/**
 * The page over the map, on a phone. It stays where it's let go: low on just its title, over the
 * whole map, or anywhere between. Close to the title, half way or the top, it lands on them, and a
 * flick carries it to the next one. It moves by its handle and title bar, and by the page itself
 * pulled down from its top (or pushed up, when it has nothing to scroll).
 */
export function BottomSheet({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const self = useRef<HTMLElement>(null);
  const roomProbe = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(() => window.innerHeight - 60);
  const [rest, setRest] = useState<Rest>("half");
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const { pathname } = useLocation();
  const { focus } = useStore(mapUi);

  // A new page shows from a sheet left on its title; the map shows what a page points it to from
  // under a sheet over all of it. Settled in the same render, so the map frames for the new height.
  const [seen, setSeen] = useState({ pathname, focus });
  if (seen.pathname !== pathname || seen.focus !== focus) {
    setSeen({ pathname, focus });
    if (rest === "peek" && seen.pathname !== pathname) setRest("half");
    if (rest === "full" && focus && seen.focus !== focus) setRest("half");
  }

  const height = dragH ?? heightOf(rest, room);
  const live = useRef({ height, room });
  live.current = { height, room };

  // The room from the tab bar up to the top of the screen, kept as the screen turns or the
  // keyboard comes and goes.
  useLayoutEffect(() => {
    const probe = roomProbe.current;
    if (!probe) return;
    const measure = () => setRoom(probe.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  // The map's corner controls (its credits) sit just above the sheet, wherever it is.
  useEffect(() => {
    const shell = self.current?.parentElement;
    shell?.style.setProperty("--sheet-h", `${height}px`);
    return () => {
      shell?.style.removeProperty("--sheet-h");
    };
  }, [height]);

  // Times are the events' own (`timeStamp`): when the finger moved, even if a busy page handles it late.
  const [gesture] = useState(() => ({
    begin(kind: Drag["kind"], id: number, y: number, t: number) {
      const h = live.current.height;
      drag.current = { kind, id, y, h, last: h, moved: false, samples: [{ y, t }] };
    },
    move(y: number, now: number) {
      const d = drag.current!;
      d.samples = [...d.samples.filter((s) => now - s.t < 80), { y, t: now }];
      d.last = clampHeight(d.h + d.y - y, live.current.room);
      setDragH(d.last);
    },
    end(now: number) {
      const d = drag.current;
      drag.current = null;
      if (!d?.moved) return;
      // The speed over the last moments before letting go: a finger held still has none.
      const recent = d.samples.filter((s) => now - s.t < 80);
      const v = recent.length < 2 ? 0 : (recent[0].y - recent[recent.length - 1].y) / Math.max(now - recent[0].t, 16);
      setRest(settle(d.last, v, live.current.room));
      setDragH(null);
    },
  }));

  // The page itself: pulled down from its top, or pushed up when it has nothing to scroll, it
  // moves the sheet instead. Touch events, since only they can keep the page from scrolling.
  useEffect(() => {
    const el = self.current!;
    let x0 = 0;
    const start = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (e.touches.length !== 1 || target.closest(`${GRIP}, ${OWN_GESTURES}`)) return;
      x0 = e.touches[0].clientX;
      gesture.begin("touch", e.touches[0].identifier, e.touches[0].clientY, e.timeStamp);
    };
    const move = (e: TouchEvent) => {
      const d = drag.current;
      if (d?.kind !== "touch") return;
      const p = [...e.touches].find((p) => p.identifier === d.id);
      if (!p || e.touches.length !== 1) return void (drag.current = null);
      if (!d.moved) {
        const dy = p.clientY - d.y;
        const dx = p.clientX - x0;
        if (dy === 0 && dx === 0) return;
        const page = el.querySelector<HTMLElement>(".panel-scroll");
        const atTop = !page || page.scrollTop <= 0;
        const still = !page || page.scrollHeight <= page.clientHeight + 1;
        // Decided on the first move: past it, the browser has started scrolling.
        if (Math.abs(dy) < Math.abs(dx) || !((dy > 0 && atTop) || (dy < 0 && still))) return void (drag.current = null);
        d.moved = true;
      }
      e.preventDefault();
      gesture.move(p.clientY, e.timeStamp);
    };
    const end = (e: TouchEvent) => {
      if (drag.current?.kind === "touch") gesture.end(e.timeStamp);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [gesture]);

  const snap = typeof rest === "number" ? "free" : rest;
  return (
    <>
      <div className="sheet-room" ref={roomProbe} aria-hidden />
      <section
        ref={self}
        className={`sheet${dragH != null ? " is-dragging" : ""}${height >= room - 0.5 ? " is-top" : ""}`}
        style={{ height }}
        data-testid="bottom-sheet"
        data-snap={snap}
        // The handle and the title bar: a pointer, mouse or finger (they don't scroll). Followed on
        // the whole window: a quick mouse is off the handle before the sheet moves.
        onPointerDown={(e) => {
          justDragged.current = false;
          const target = e.target as HTMLElement;
          if (!e.isPrimary || !target.closest(GRIP) || target.closest(OWN_GESTURES)) return;
          const id = e.pointerId;
          gesture.begin("pointer", id, e.clientY, e.timeStamp);
          const move = (ev: PointerEvent) => {
            const d = drag.current;
            if (d?.kind !== "pointer" || d.id !== ev.pointerId) return;
            if (!d.moved) {
              if (Math.abs(ev.clientY - d.y) < 4) return;
              d.moved = justDragged.current = true;
              // Captured only now: a tap still clicks the button it's on.
              self.current?.setPointerCapture(ev.pointerId);
            }
            gesture.move(ev.clientY, ev.timeStamp);
          };
          const end = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            if (drag.current?.kind === "pointer" && drag.current.id === id) gesture.end(ev.timeStamp);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", end);
          window.addEventListener("pointercancel", end);
        }}
        onClickCapture={(e) => {
          if (!justDragged.current) return;
          justDragged.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <div
          className="sheet-handle"
          role="slider"
          tabIndex={0}
          aria-label={t("a11y.resizePanel")}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((height / room) * 100)}
          onClick={() => setRest(cycle(height, room))}
          onKeyDown={(e) => {
            const dir = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            setRest(step(height, dir, room));
          }}
        >
          <span />
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}
