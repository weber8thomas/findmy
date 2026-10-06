import { useEffect } from "react";
import { createStore, useStore } from "../lib/store";
import { Reporter, type ReporterStatus } from "./reporter";
import { localDeviceStore, prefsStore } from "./storage";

const idle: ReporterStatus = {
  state: "idle",
  lastFix: null,
  lastSentAt: null,
  queued: 0,
  battery: null,
  error: null,
};

export const reporterStatus = createStore<ReporterStatus>(idle);
let current: Reporter | null = null;

export function getReporter(): Reporter | null {
  return current;
}

/**
 * Keeps a single Reporter running while this browser is registered as a device of the
 * signed-in user and sharing is on. Mounted once at the app root.
 */
export function useReporterLifecycle(userId: string | undefined) {
  const device = useStore(localDeviceStore);
  const prefs = useStore(prefsStore);
  const token = device && device.userId === userId ? device.token : null;
  const active = Boolean(token && prefs.sharing);

  useEffect(() => {
    if (!active || !token) {
      reporterStatus.set(idle);
      return;
    }
    const r = new Reporter(token, (s) => reporterStatus.set(s), prefsStore.get().highAccuracy);
    current = r;
    r.start();
    return () => {
      r.stop();
      if (current === r) current = null;
    };
  }, [active, token]);

  useEffect(() => {
    current?.setHighAccuracy(prefs.highAccuracy);
  }, [prefs.highAccuracy]);

  // Screen wake lock keeps the page (and thus geolocation) alive on phones.
  useEffect(() => {
    if (!active || !prefs.keepAwake) return;
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState === "visible")
        nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, [active, prefs.keepAwake]);
}
