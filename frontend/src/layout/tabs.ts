import type { Device } from "../api/types";

/** The tab a device is listed under: Find My network items have their own. */
export function deviceTab(device: Pick<Device, "kind">): "/devices" | "/items" {
  return device.kind === "findmy" ? "/items" : "/devices";
}

// Pages reached from a tab without living under its path (Settings is opened from Me).
const ALSO: Record<string, string> = { "/settings": "/me", "/privacy": "/me" };

/** The tab to highlight for a path, sub-pages included. */
export function activeTab(pathname: string, devices: Pick<Device, "id" | "kind">[] | undefined): string {
  const [, root = "", id] = pathname.split("/");
  // Every device opens under /devices, but an item belongs to Items.
  const device = root === "devices" && id ? devices?.find((d) => d.id === id) : undefined;
  if (device) return deviceTab(device);
  return ALSO[`/${root}`] ?? `/${root}`;
}
