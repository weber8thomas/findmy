import { describe, expect, it } from "vitest";
import { locationSources, mapHosts, versionLabel } from "./about";

describe("version label", () => {
  it("name, version and revision", () => {
    expect(versionLabel("Oukilé", { version: "0.2.0", revision: "6aace8e" })).toBe("Oukilé 0.2.0 (6aace8e)");
    expect(versionLabel("Oukilé", { version: "0.2.0", revision: "dev" })).toBe("Oukilé 0.2.0 (dev)");
    expect(versionLabel("Oukilé", { version: "0.2.0" })).toBe("Oukilé 0.2.0");
  });

  it("older servers without a version: the name only", () => {
    expect(versionLabel("Oukilé", {})).toBe("Oukilé");
    expect(versionLabel("Oukilé", undefined)).toBe("Oukilé");
  });
});

describe("map hosts", () => {
  it("vector styles on one host are named once", () => {
    expect(
      mapHosts({
        tile_url: "https://tiles.openfreemap.org/styles/liberty",
        tile_url_dark: "https://tiles.openfreemap.org/styles/dark",
        attribution: "",
      }),
    ).toEqual(["tiles.openfreemap.org"]);
  });

  it("raster templates, subdomains and odd values", () => {
    expect(
      mapHosts({
        tile_url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        tile_url_dark: "https://tiles.example.net/dark/{z}/{x}/{y}.png",
        attribution: "",
      }),
    ).toEqual(["tile.openstreetmap.org", "tiles.example.net"]);
    expect(mapHosts({ tile_url: "/tiles/{z}/{x}/{y}.png", tile_url_dark: "", attribution: "" })).toEqual([]);
    expect(mapHosts(undefined)).toEqual([]);
  });
});

describe("location sources", () => {
  it("known kinds in a fixed order", () => {
    expect(locationSources({ providers: ["findmy", "owntracks", "browser", "other"] })).toEqual(["browser", "owntracks", "findmy"]);
    expect(locationSources(undefined)).toEqual([]);
  });
});
