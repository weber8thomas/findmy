import { useState } from "react";
import type { DeviceIcon, PublicUser } from "../api/types";

// Simple line icons drawn for Oukilé (24×24, stroke = currentColor).
const PATHS: Record<
  DeviceIcon | "person" | "pin" | "me" | "sound" | "route" | "lock" | "clock" | "refresh" | "bell" | "zone" | "locate" | "trash" | "edit" | "chevron",
  string
> = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 18.5h19"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  watch: '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5l.5-4h5l.5 4M9 17.5l.5 4h5l.5-4"/>',
  earbuds: '<circle cx="8" cy="8" r="3"/><path d="M8 11v8.5"/><circle cx="16" cy="8" r="3"/><path d="M16 11v8.5"/>',
  tag: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  car: '<path d="M5 11l1.5-4a2 2 0 011.9-1.5h7.2a2 2 0 011.9 1.5L19 11"/><rect x="3.5" y="11" width="17" height="6.5" rx="2"/><path d="M6.5 17.5v2M17.5 17.5v2M7 14.2h1.5M15.5 14.2H17"/>',
  backpack: '<path d="M6 11a6 6 0 0112 0v8.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19.5z"/><path d="M9.5 5.5V4.5a2.5 2.5 0 015 0v1M9 21v-5h6v5"/>',
  wallet: '<path d="M5.5 7.5l10.5-3 1 3"/><rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M20.5 11h-4a2.5 2.5 0 000 5h4"/>',
  suitcase: '<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9.5 7V4.5h5V7M9.5 10.5v6M14.5 10.5v6M8 20v1.5M16 20v1.5"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l3-6.5h6.5L18 16M6 16h5L8.6 7.5M11 16l4.5-6.5-.8-2.5h2M7 7.5h3"/>',
  pet: '<circle cx="6.5" cy="11" r="1.7"/><circle cx="10" cy="6.5" r="1.7"/><circle cx="14" cy="6.5" r="1.7"/><circle cx="17.5" cy="11" r="1.7"/><path d="M12 12.5c-2.4 0-5 3.3-5 5.4 0 1.6 1.4 2.4 2.7 2l2.3-.7 2.3.7c1.3.4 2.7-.4 2.7-2 0-2.1-2.6-5.4-5-5.4z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  me: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="2.8"/><path d="M7 18c1-2.2 2.8-3.3 5-3.3s4 1.1 5 3.3"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 000-6h-4a3 3 0 010-6h6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  zone: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.5"/><circle cx="12" cy="12" r="2"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.8"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20l1-4.5L15.5 5a2 2 0 013 3L8 18.5z"/>',
  chevron: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
};

export type IconName = keyof typeof PATHS;

export function iconSvg(name: IconName, size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <span
      className={`icon ${className ?? ""}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: iconSvg(name, size) }}
    />
  );
}

// Filled device drawings (32×32) for map pins and device avatars: dark bezel, colourful screen.
const SCREEN = "url(#locus-screen)";
const BEZEL = "#1f2937";
const METAL = "#a1a1aa";
const GLYPHS: Record<DeviceIcon, string> = {
  phone: `<rect x="10" y="4" width="12" height="24" rx="3" fill="${BEZEL}"/><rect x="11.2" y="5.2" width="9.6" height="21.6" rx="2" fill="${SCREEN}"/><rect x="14" y="6.2" width="4" height="1.3" rx=".65" fill="${BEZEL}"/>`,
  tablet: `<rect x="7.5" y="4.5" width="17" height="23" rx="2.5" fill="${BEZEL}"/><rect x="8.8" y="5.8" width="14.4" height="20.4" rx="1.4" fill="${SCREEN}"/>`,
  laptop: `<rect x="6" y="8" width="20" height="13.5" rx="1.6" fill="${BEZEL}"/><rect x="7.3" y="9.3" width="17.4" height="10.9" rx=".6" fill="${SCREEN}"/><path d="M3 21.5h26l-1.2 1.7a1.6 1.6 0 01-1.3.7h-21a1.6 1.6 0 01-1.3-.7z" fill="${METAL}"/>`,
  desktop: `<rect x="4" y="6" width="24" height="15" rx="1.8" fill="${BEZEL}"/><rect x="5.3" y="7.3" width="21.4" height="12.4" rx=".8" fill="${SCREEN}"/><path d="M13.5 21h5l1 4h-7z" fill="${METAL}"/><rect x="10.5" y="24.6" width="11" height="1.6" rx=".8" fill="${METAL}"/>`,
  watch: `<rect x="11.5" y="3.5" width="9" height="25" rx="3" fill="${METAL}"/><rect x="9.5" y="9" width="13" height="14" rx="3.6" fill="${BEZEL}"/><rect x="10.8" y="10.3" width="10.4" height="11.4" rx="2.6" fill="${SCREEN}"/>`,
  earbuds: `<g fill="#fff" stroke="${METAL}" stroke-width="1.1"><rect x="8.6" y="11" width="3.4" height="14.5" rx="1.7"/><circle cx="11" cy="10" r="4.4"/><rect x="20" y="11" width="3.4" height="14.5" rx="1.7"/><circle cx="21" cy="10" r="4.4"/></g><circle cx="12.4" cy="9.2" r="1.3" fill="${BEZEL}"/><circle cx="19.6" cy="9.2" r="1.3" fill="${BEZEL}"/>`,
  tag: `<circle cx="16" cy="16" r="10.5" fill="#fafafa" stroke="#d4d4d8" stroke-width="1.2"/><circle cx="16" cy="16" r="6.5" fill="#e4e4e7"/>`,
  // What a tag is attached to, drawn in the same palette.
  key: `<path d="M15.5 15.5l10 10M21.5 21.5l-2.6 2.6M24 24l-2 2" fill="none" stroke="${METAL}" stroke-width="3" stroke-linecap="round"/><path fill-rule="evenodd" d="M11.5 4.5a7 7 0 110 14 7 7 0 010-14zm-1.5 3.5a2 2 0 100 4 2 2 0 000-4z" fill="${SCREEN}"/>`,
  car: `<path d="M3.5 21v-3.6a2 2 0 011.6-2l3.4-.7 3.4-4.3a3 3 0 012.3-1.1h6.6a3 3 0 012.4 1.2l3 4 1.9.6a2 2 0 011.4 1.9V21a1 1 0 01-1 1H4.5a1 1 0 01-1-1z" fill="${SCREEN}"/><path d="M11.6 14.6l2.3-2.9a1.5 1.5 0 011.2-.5h2.4v3.4zM19.5 11.2h1.7a1.5 1.5 0 011.2.6l2.1 2.8h-5z" fill="${BEZEL}" opacity=".85"/><circle cx="9.5" cy="22" r="3.3" fill="${BEZEL}"/><circle cx="9.5" cy="22" r="1.3" fill="${METAL}"/><circle cx="23" cy="22" r="3.3" fill="${BEZEL}"/><circle cx="23" cy="22" r="1.3" fill="${METAL}"/>`,
  backpack: `<path d="M12.5 7.5V6a3.5 3.5 0 017 0v1.5" fill="none" stroke="${BEZEL}" stroke-width="1.8"/><path d="M8 14a8 8 0 0116 0v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 018 25z" fill="${SCREEN}"/><rect x="11" y="18" width="10" height="7" rx="1.8" fill="${BEZEL}" opacity=".85"/><path d="M11 20.5h10" stroke="${METAL}" stroke-width="1"/>`,
  wallet: `<path d="M7 9.5l13.5-4a1.5 1.5 0 011.9 1.1l.7 2.9z" fill="${SCREEN}"/><rect x="4.5" y="9" width="23" height="16.5" rx="3" fill="${BEZEL}"/><path d="M27.5 14h-5a3.2 3.2 0 000 6.4h5z" fill="${METAL}"/><circle cx="22.6" cy="17.2" r="1.3" fill="${BEZEL}"/>`,
  suitcase: `<path d="M12.5 8V5.8a1.8 1.8 0 011.8-1.8h3.4a1.8 1.8 0 011.8 1.8V8" fill="none" stroke="${BEZEL}" stroke-width="1.8"/><rect x="6.5" y="8" width="19" height="18" rx="3" fill="${SCREEN}"/><path d="M12 11v12M20 11v12" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/><circle cx="10.5" cy="27.5" r="1.5" fill="${BEZEL}"/><circle cx="21.5" cy="27.5" r="1.5" fill="${BEZEL}"/>`,
  bike: `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="5" stroke="${BEZEL}" stroke-width="2.2"/><circle cx="24" cy="21" r="5" stroke="${BEZEL}" stroke-width="2.2"/><path d="M8 21l4.5-9h8.5L24 21M8 21h7l-3.2-11.5M15 21l6-9-1-3.5h2.5" stroke="${SCREEN}" stroke-width="2.2"/><path d="M10 9.5h4" stroke="${BEZEL}" stroke-width="2.4"/></g>`,
  pet: `<g fill="${SCREEN}"><ellipse cx="8" cy="14.5" rx="2.6" ry="3.2" transform="rotate(-20 8 14.5)"/><ellipse cx="12.8" cy="9" rx="2.7" ry="3.4" transform="rotate(-8 12.8 9)"/><ellipse cx="19.2" cy="9" rx="2.7" ry="3.4" transform="rotate(8 19.2 9)"/><ellipse cx="24" cy="14.5" rx="2.6" ry="3.2" transform="rotate(20 24 14.5)"/><path d="M16 15c-3.6 0-7.5 5-7.5 8.2 0 2.3 2 3.5 4 3l3.5-.9 3.5.9c2 .5 4-.7 4-3 0-3.2-3.9-8.2-7.5-8.2z"/></g>`,
};

export function deviceGlyphSvg(icon: DeviceIcon, size = 28): string {
  // Gradients are looked up by id document-wide; every copy defines the same one.
  const defs =
    '<defs><linearGradient id="locus-screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset=".5" stop-color="#6366f1"/><stop offset="1" stop-color="#c026d3"/></linearGradient></defs>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${defs}${GLYPHS[icon] ?? GLYPHS.phone}</svg>`;
}

export function DeviceGlyph({ icon, size = 28 }: { icon: DeviceIcon; size?: number }) {
  return <span className="icon" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: deviceGlyphSvg(icon, size) }} />;
}

/** A stable colour per person (class `tone-1`…`tone-5`, or the default blue), shared by lists and map pins. */
export function avatarTone(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = h % 6;
  return n ? `tone-${n}` : "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

type AvatarUser = Pick<PublicUser, "id" | "display_name" | "avatar_url">;

/** A person's photo, or their initials on their colour when there is none or it does not load. */
export function Avatar({ user, size }: { user: AvatarUser; size?: "large" | "small" }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = user.avatar_url && user.avatar_url !== failed ? user.avatar_url : null;
  return (
    <span className={`row-avatar avatar-person ${avatarTone(user.id)}${size ? ` avatar-${size}` : ""}`} data-testid="avatar">
      {src ? <img className="avatar-img" src={src} alt="" decoding="async" onError={() => setFailed(src)} /> : initials(user.display_name)}
    </span>
  );
}
