/** OwnTracks settings for the HTTP mode, as an `owntracks:///config?inline=` link.
 * Opening it (tap, or scanning a QR code with the camera) starts OwnTracks and imports
 * the settings, on iOS and Android. */
export type OwnTracksSettings = {
  url: string;
  username: string;
  password: string;
  deviceId: string;
  tid: string;
};

export function owntracksConfigUrl(s: OwnTracksSettings): string {
  const config = {
    _type: "configuration",
    mode: 3, // HTTP
    url: s.url,
    auth: true,
    username: s.username,
    password: s.password,
    deviceId: s.deviceId,
    tid: s.tid,
    monitoring: 1, // significant changes: battery friendly, the app's default
    // The app's default is 500 m: coming home from 400 m away was never reported.
    locatorDisplacement: 100,
    locatorInterval: 60, // seconds, at most one position a minute on the move
  };
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  const b64 = btoa(String.fromCharCode(...bytes));
  // Percent-encoded: Android reads "+" in a query as a space.
  return `owntracks:///config?inline=${encodeURIComponent(b64)}`;
}

/** Two-letter tracker id shown on the OwnTracks map, from the person's name. */
export function trackerId(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return (letters || "ok").toUpperCase();
}

/** Device id for OwnTracks: the person's name in plain ASCII, e.g. "lucia-phone". */
export function owntracksDeviceId(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "oukile"}-phone`;
}
