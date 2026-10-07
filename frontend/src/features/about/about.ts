import type { AppConfig, DeviceKind } from "../../api/types";

/** "Oukilé 0.2.0 (6aace8e)"; the name alone for servers that don't say their version. */
export function versionLabel(name: string, config?: Pick<AppConfig, "version" | "revision">): string {
  if (!config?.version) return name;
  return config.revision ? `${name} ${config.version} (${config.revision})` : `${name} ${config.version}`;
}

/** Hosts the map is loaded from (light and dark styles), for the privacy page. */
export function mapHosts(map: AppConfig["map"] | undefined): string[] {
  const hosts = new Set<string>();
  for (const url of [map?.tile_url, map?.tile_url_dark]) {
    if (!url) continue;
    try {
      // Raster URLs spread tiles over {s}.host subdomains: name the host itself.
      hosts.add(new URL(url.replace("{s}.", "")).hostname);
    } catch {
      /* not an absolute URL */
    }
  }
  return [...hosts];
}

const KINDS: readonly DeviceKind[] = ["browser", "owntracks", "icloud", "findmy"];

/** Where positions can come from on this server, in a fixed order. */
export function locationSources(config: Pick<AppConfig, "providers"> | undefined): DeviceKind[] {
  return KINDS.filter((k) => config?.providers.includes(k));
}
