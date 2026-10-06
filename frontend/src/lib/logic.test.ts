import { describe, expect, it } from "vitest";
import en from "../i18n/en";
import fr from "../i18n/fr";
import { format } from "../i18n";
import { shouldSend } from "../reporter/throttle";
import { detectPlatform, directionsUrl, guessDeviceName, haversineM } from "./geo";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";

describe("throttle", () => {
  const base = { lat: 48.8584, lon: 2.2945, accuracy: 10, time: 0 };
  it("sends the first fix", () => expect(shouldSend(null, base)).toBe(true));
  it("skips jitter", () => expect(shouldSend(base, { ...base, lat: base.lat + 0.00005, time: 5_000 })).toBe(false));
  it("sends after moving", () => expect(shouldSend(base, { ...base, lat: base.lat + 0.001, time: 5_000 })).toBe(true));
  it("needs to move more than the accuracy", () =>
    expect(shouldSend(base, { ...base, lat: base.lat + 0.0005, accuracy: 100, time: 5_000 })).toBe(false));
  it("sends a heartbeat", () => expect(shouldSend(base, { ...base, time: 61_000 })).toBe(true));
  it("sends a much better fix", () =>
    expect(shouldSend({ ...base, accuracy: 100 }, { ...base, accuracy: 20, time: 1_000 })).toBe(true));
});

describe("geo", () => {
  it("haversine", () => expect(haversineM(0, 0, 0, 1)).toBeCloseTo(111_195, -2));
  it("directions per platform", () => {
    expect(directionsUrl(1.5, 2.25, IPHONE)).toBe("https://maps.apple.com/?daddr=1.500000,2.250000");
    expect(directionsUrl(1.5, 2.25, ANDROID)).toContain("google.com/maps/dir/?api=1&destination=1.500000,2.250000");
  });
  it("platform and device name", () => {
    expect(detectPlatform(IPHONE, 5)).toBe("ios");
    expect(detectPlatform(ANDROID, 5)).toBe("android");
    expect(detectPlatform(WINDOWS, 0)).toBe("desktop");
    expect(guessDeviceName(ANDROID)).toEqual({ name: "Android phone", icon: "phone" });
    expect(guessDeviceName(WINDOWS).icon).toBe("laptop");
  });
});

describe("i18n", () => {
  it("fr has every en key and the same placeholders", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fr[key], key).toBeTruthy();
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(fr[key]), key).toBe(ph(en[key]));
    }
  });
  it("formats placeholders", () => {
    expect(format("{who} left {zone}", { who: "Bob", zone: "Home" })).toBe("Bob left Home");
    expect(format("{missing}", {})).toBe("{missing}");
  });
});
