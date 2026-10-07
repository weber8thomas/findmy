export type Fix = { lat: number; lon: number; accuracy: number | null; ts: string };
export type Battery = { level: number | null; charging: boolean | null; label: string | null };

export type User = {
  id: string;
  email: string;
  display_name: string;
  locale: "en" | "fr";
  primary_device_id: string | null;
  is_admin: boolean;
  /** Profile photo (same-origin, versioned); null: initials. Older servers omit it. */
  avatar_url?: string | null;
};

export type PublicUser = { id: string; email: string; display_name: string; avatar_url?: string | null };

export type LostMode = {
  enabled: boolean;
  message: string | null;
  phone: string | null;
  since: string | null;
  owner_name: string | null;
};

export type DeviceKind = "browser" | "owntracks" | "findmy" | "icloud";
export type DeviceIcon =
  | "phone"
  | "tablet"
  | "laptop"
  | "desktop"
  | "watch"
  | "earbuds"
  | "tag"
  // What a Find My network tag is attached to.
  | "key"
  | "car"
  | "backpack"
  | "wallet"
  | "suitcase"
  | "bike"
  | "pet";

export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  icon: DeviceIcon;
  online: boolean;
  capabilities: string[];
  is_primary: boolean;
  location: Fix | null;
  last_seen_at: string | null;
  battery: Battery | null;
  lost_mode: LostMode;
  created_at: string;
  provider_info: Record<string, string>;
};

export type CommandStatus = "pending" | "delivered" | "acked" | "failed" | "expired";
export type Command = {
  id: string;
  device_id: string;
  type: "play_sound" | "lost_mode_on" | "lost_mode_off";
  payload: Record<string, unknown>;
  status: CommandStatus;
  channel: string | null;
  error: string | null;
  created_at: string;
  expires_at: string;
};

export type LocationPoint = {
  ts: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  battery_level: number | null;
  source: string;
};

export type Share = {
  id: string;
  owner: PublicUser;
  recipient: PublicUser;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expires_at: string | null;
  created_at: string;
  responded_at: string | null;
};

export type Person = {
  user: PublicUser;
  sharing_with_me: Share | null;
  i_share_with: Share | null;
  location: Fix | null;
  device_name: string | null;
};

export type Zone = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  notify_enter: boolean;
  notify_exit: boolean;
  device_ids: string[] | null;
  created_at: string;
};

export type ZoneEvent = {
  id: string;
  zone_id: string;
  zone_name: string;
  device_id: string;
  device_name: string;
  type: "enter" | "exit";
  ts: string;
  lat: number;
  lon: number;
};

export type AppNotification = {
  id: string;
  kind: string;
  payload: Record<string, string> & { title?: string; body?: string };
  created_at: string;
  read_at: string | null;
};

export type AppConfig = {
  app_name: string;
  registration_open: boolean;
  /** Language of the sign-in page (DEFAULT_LOCALE); null: the browser's. */
  default_locale?: "en" | "fr" | null;
  providers: string[];
  features: { owntracks: boolean; findmy: boolean; icloud: boolean; push: boolean };
  map: { tile_url: string; tile_url_dark: string; attribution: string };
  vapid_public_key: string | null;
  /** Sign-in methods. Older servers omit it: password only. */
  auth?: { password: boolean; oidc: { name: string; login_url: string } | null };
};

export type ProviderAccount = {
  state: "logged_in" | "reauth_required" | "error" | "none";
  display: string | null;
  last_poll_at: string | null;
  last_error: string | null;
};

export type TwoFactorMethod = { id: string; type: string; label: string };

export type LoginResult = { state: "logged_in" | "require_2fa"; methods?: TwoFactorMethod[] };

export type ICloudDevice = {
  icloud_device_id: string;
  name: string;
  model: string;
  tracked_device_id: string | null;
};
