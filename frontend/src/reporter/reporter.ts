import { api, ApiError } from "../api/client";
import { queueStorage, type QueuedFix } from "./storage";
import { HEARTBEAT_MS, shouldSend, type SimpleFix } from "./throttle";

export type ReporterState = "idle" | "starting" | "active" | "paused" | "denied" | "unavailable" | "error";

export type ReporterStatus = {
  state: ReporterState;
  lastFix: (SimpleFix & { ts: string }) | null;
  lastSentAt: number | null;
  queued: number;
  battery: { level: number; charging: boolean } | null;
  error: string | null;
};

type BatteryManager = EventTarget & { level: number; charging: boolean };
const MAX_QUEUE = 500;

/**
 * Watches the browser's position and sends it to the server with a device token.
 * Framework-agnostic; React binds to it through `onStatus`.
 */
export class Reporter {
  private watchId: number | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private queue: QueuedFix[] = queueStorage.load();
  private lastSent: SimpleFix | null = null;
  private flushing = false;
  private backoffUntil = 0;
  private batteryMgr: BatteryManager | null = null;
  private onBattery = () => this.readBattery(true);
  private onVisibility = () => this.handleVisibility();
  private onOnline = () => void this.flush();
  status: ReporterStatus = {
    state: "idle",
    lastFix: null,
    lastSentAt: null,
    queued: this.queue.length,
    battery: null,
    error: null,
  };

  constructor(
    private token: string,
    private onStatus: (s: ReporterStatus) => void,
    private highAccuracy = true,
  ) {}

  private update(patch: Partial<ReporterStatus>) {
    this.status = { ...this.status, ...patch, queued: this.queue.length };
    this.onStatus(this.status);
  }

  start() {
    if (!("geolocation" in navigator)) {
      this.update({ state: "unavailable" });
      return;
    }
    if (this.watchId !== null) return;
    this.update({ state: this.status.lastFix ? "active" : "starting", error: null });
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos, false),
      (err) => this.onError(err),
      { enableHighAccuracy: this.highAccuracy, maximumAge: 10_000, timeout: 60_000 },
    );
    this.heartbeat = setInterval(() => this.requestNow(false), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("online", this.onOnline);
    void this.initBattery();
    void this.flush();
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.onOnline);
    this.batteryMgr?.removeEventListener("levelchange", this.onBattery);
    this.batteryMgr?.removeEventListener("chargingchange", this.onBattery);
    this.update({ state: "idle" });
  }

  setHighAccuracy(value: boolean) {
    if (value === this.highAccuracy) return;
    this.highAccuracy = value;
    if (this.watchId !== null) {
      this.stop();
      this.start();
    }
  }

  /** One-shot position request; `force` sends it even if it didn't move. */
  requestNow(force = true) {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => this.onPosition(pos, force),
      (err) => this.onError(err, true),
      { enableHighAccuracy: this.highAccuracy, maximumAge: force ? 0 : 30_000, timeout: 30_000 },
    );
  }

  private handleVisibility() {
    if (document.visibilityState === "hidden") {
      this.update({ state: "paused" });
    } else if (this.watchId !== null) {
      this.update({ state: this.status.lastFix ? "active" : "starting" });
      this.requestNow(true);
    }
  }

  private onPosition(pos: GeolocationPosition, force: boolean) {
    const c = pos.coords;
    const fix: SimpleFix & { ts: string } = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
      time: Date.now(),
      ts: new Date().toISOString(),
    };
    this.update({ state: document.visibilityState === "hidden" ? "paused" : "active", lastFix: fix, error: null });
    if (!force && !shouldSend(this.lastSent, fix)) return;
    this.lastSent = fix;
    this.queue.push({
      ts: fix.ts,
      lat: fix.lat,
      lon: fix.lon,
      accuracy: fix.accuracy,
      altitude: c.altitude ?? null,
      speed: c.speed != null && Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
      heading: c.heading != null && Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null,
    });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    queueStorage.save(this.queue);
    void this.flush();
  }

  private onError(err: GeolocationPositionError, oneShot = false) {
    if (err.code === err.PERMISSION_DENIED) this.update({ state: "denied", error: err.message });
    else if (err.code === err.POSITION_UNAVAILABLE && !oneShot && !this.status.lastFix)
      this.update({ state: "unavailable", error: err.message });
    // TIMEOUT, or a failed one-shot request: keep the current state, the watch keeps running.
  }

  private async initBattery() {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) return;
    try {
      this.batteryMgr = await nav.getBattery();
      this.batteryMgr.addEventListener("levelchange", this.onBattery);
      this.batteryMgr.addEventListener("chargingchange", this.onBattery);
      this.readBattery(false);
    } catch {
      /* not allowed */
    }
  }

  private readBattery(sendNow: boolean) {
    if (!this.batteryMgr) return;
    this.update({ battery: { level: this.batteryMgr.level, charging: this.batteryMgr.charging } });
    if (sendNow) void this.flush(true);
  }

  async flush(batteryOnly = false): Promise<void> {
    if (this.flushing || Date.now() < this.backoffUntil) return;
    if (!this.queue.length && !batteryOnly) return;
    this.flushing = true;
    const batch = this.queue.slice(0, MAX_QUEUE);
    let sent = false;
    try {
      await api("/report/locations", {
        method: "POST",
        token: this.token,
        body: { fixes: batch, battery: this.status.battery },
      });
      this.queue.splice(0, batch.length);
      queueStorage.save(this.queue);
      this.update({ lastSentAt: Date.now() });
      sent = true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) this.backoffUntil = Date.now() + 10_000;
      else if (e instanceof ApiError && e.status === 401) this.update({ state: "error", error: "device token rejected" });
      else if (e instanceof ApiError && e.status === 422) {
        this.queue.splice(0, batch.length); // drop invalid data instead of retrying forever
        queueStorage.save(this.queue);
      }
      this.update({});
    } finally {
      this.flushing = false;
    }
    // Fixes queued while this request was in flight go out right away.
    if (sent && this.queue.length) void this.flush();
  }
}
