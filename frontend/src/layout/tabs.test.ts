import { describe, expect, it } from "vitest";
import { activeTab, deviceTab } from "./tabs";

const DEVICES = [
  { id: "mac", kind: "icloud" as const },
  { id: "keys", kind: "findmy" as const },
];

describe("tabs", () => {
  it("lists Find My network items under Items, every other device under Devices", () => {
    expect(deviceTab({ kind: "findmy" })).toBe("/items");
    expect(deviceTab({ kind: "icloud" })).toBe("/devices");
    expect(deviceTab({ kind: "browser" })).toBe("/devices");
  });

  it("highlights the tab of the page, sub-pages included", () => {
    expect(activeTab("/people", DEVICES)).toBe("/people");
    expect(activeTab("/people/u1", DEVICES)).toBe("/people");
    expect(activeTab("/items", DEVICES)).toBe("/items");
    expect(activeTab("/me/zones/new", DEVICES)).toBe("/me");
  });

  it("keeps Me highlighted in Settings, its pages and Privacy", () => {
    expect(activeTab("/settings", DEVICES)).toBe("/me");
    expect(activeTab("/settings/icloud", DEVICES)).toBe("/me");
    expect(activeTab("/settings/findmy", DEVICES)).toBe("/me");
    expect(activeTab("/privacy", DEVICES)).toBe("/me");
  });

  it("highlights Items on an item's pages, Devices on a device's", () => {
    expect(activeTab("/devices/keys", DEVICES)).toBe("/items");
    expect(activeTab("/devices/keys/history", DEVICES)).toBe("/items");
    expect(activeTab("/devices/mac", DEVICES)).toBe("/devices");
    expect(activeTab("/devices/mac/history", DEVICES)).toBe("/devices");
    // Not loaded yet, or gone: Devices, where the URL points.
    expect(activeTab("/devices/keys", undefined)).toBe("/devices");
    expect(activeTab("/devices/gone", DEVICES)).toBe("/devices");
  });
});
