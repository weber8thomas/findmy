import type { Device } from "../api/types";
import { activeTab, deviceTab, listedInDevices } from "../layout/tabs";

/** What the map shows on a page: what its tab is about, like Find My. */
export type MapScope = {
  /** The tab of the page (see activeTab): framing the map again when it changes. */
  tab: string;
  /** The device the page is about, shown whatever its tab (the OwnTracks phone opened from People). */
  deviceId: string | null;
  /** Faces of the people sharing with me. */
  people: boolean;
  /** My own face, where my location is. */
  me: boolean;
  /** A page about places, which the map then frames. They show on every tab. */
  zones: boolean;
  /** A page about one thing (a device, a person, a place) moves the map itself. */
  detail: boolean;
};

export function mapScope(pathname: string, devices: Pick<Device, "id" | "kind">[] | undefined): MapScope {
  const tab = activeTab(pathname, devices);
  const [, root = "", id, sub] = pathname.split("/");
  return {
    tab,
    deviceId: root === "devices" && id ? id : null,
    people: tab === "/people",
    me: tab === "/people" || tab === "/me",
    zones: root === "me" && id === "zones",
    detail:
      ((root === "devices" || root === "people") && Boolean(id)) ||
      (root === "me" && (id === "location" || (id === "zones" && Boolean(sub) && sub !== "new"))),
  };
}

/** The devices on the map: those of the Devices or Items tab, and the one the page is about. */
export function visibleDevices<D extends Pick<Device, "id" | "kind">>(scope: MapScope, devices: D[]): D[] {
  return devices.filter(
    (d) =>
      d.id === scope.deviceId ||
      (scope.tab === "/devices" && listedInDevices(d)) ||
      (scope.tab === "/items" && deviceTab(d) === "/items"),
  );
}
