import type { Fix } from "../api/types";

const R = 6_371_008.8;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type Platform = "ios" | "android" | "desktop";

export function detectPlatform(ua: string = navigator.userAgent, touchPoints = navigator.maxTouchPoints): Platform {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isApplePlatform(ua: string = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod|Macintosh/i.test(ua);
}

/** Link that opens turn-by-turn directions in the platform's maps app. */
export function directionsUrl(lat: number, lon: number, ua: string = navigator.userAgent): string {
  const dest = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (isApplePlatform(ua)) return `https://maps.apple.com/?daddr=${dest}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

export function guessDeviceName(ua: string = navigator.userAgent): { name: string; icon: "phone" | "tablet" | "laptop" | "desktop" } {
  if (/iPad/i.test(ua)) return { name: "iPad", icon: "tablet" };
  if (/iPhone/i.test(ua)) return { name: "iPhone", icon: "phone" };
  if (/Android/i.test(ua)) {
    const tablet = !/Mobile/i.test(ua);
    return { name: tablet ? "Android tablet" : "Android phone", icon: tablet ? "tablet" : "phone" };
  }
  if (/Macintosh/i.test(ua)) return { name: "Mac", icon: "laptop" };
  if (/Windows/i.test(ua)) return { name: "Windows PC", icon: "laptop" };
  if (/CrOS/i.test(ua)) return { name: "Chromebook", icon: "laptop" };
  if (/Linux/i.test(ua)) return { name: "Linux PC", icon: "desktop" };
  return { name: "Browser", icon: "desktop" };
}

/** When the position was last known to hold, for "updated … ago": a later check-in confirms it. */
export function updatedAt(fix: Fix): string {
  return fix.seen_at ?? fix.ts;
}
