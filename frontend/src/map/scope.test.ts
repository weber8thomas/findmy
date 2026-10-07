import { describe, expect, it } from "vitest";
import { mapScope, visibleDevices } from "./scope";

const DEVICES = [
  { id: "browser", kind: "browser" as const },
  { id: "mac", kind: "icloud" as const },
  { id: "phone", kind: "owntracks" as const },
  { id: "keys", kind: "findmy" as const },
];
const ids = (pathname: string) => visibleDevices(mapScope(pathname, DEVICES), DEVICES).map((d) => d.id);

describe("map scope", () => {
  it("shows faces on People: the people sharing with me and me, no device", () => {
    for (const path of ["/people", "/people/u1"]) {
      expect(mapScope(path, DEVICES)).toMatchObject({ people: true, me: true, zones: false });
      expect(ids(path)).toEqual([]);
    }
  });

  it("shows the devices of the Devices tab there, and no face", () => {
    expect(ids("/devices")).toEqual(["browser", "mac"]);
    expect(ids("/devices/mac")).toEqual(["browser", "mac"]);
    expect(ids("/devices/mac/history")).toEqual(["browser", "mac"]);
    expect(mapScope("/devices", DEVICES)).toMatchObject({ people: false, me: false });
  });

  it("shows items only on Items and on an item's pages", () => {
    expect(ids("/items")).toEqual(["keys"]);
    expect(ids("/devices/keys")).toEqual(["keys"]);
    expect(mapScope("/devices/keys", DEVICES).tab).toBe("/items");
  });

  it("keeps the device a page is about, whatever its tab", () => {
    expect(ids("/devices/phone")).toEqual(["browser", "mac", "phone"]);
  });

  it("shows only me on Me, Settings and Privacy, and the places on Places", () => {
    for (const path of ["/me", "/me/location", "/settings", "/settings/icloud", "/privacy"]) {
      expect(mapScope(path, DEVICES)).toMatchObject({ tab: "/me", people: false, me: true, zones: false });
      expect(ids(path)).toEqual([]);
    }
    expect(mapScope("/me/zones", DEVICES).zones).toBe(true);
    expect(mapScope("/me/zones/z1", DEVICES).zones).toBe(true);
  });

  it("lets pages about one thing move the map themselves", () => {
    const detail = (path: string) => mapScope(path, DEVICES).detail;
    expect(["/devices/mac", "/devices/mac/history", "/people/u1", "/me/location", "/me/zones/z1"].map(detail)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(["/devices", "/items", "/people", "/me", "/me/zones", "/me/zones/new", "/settings"].map(detail)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
