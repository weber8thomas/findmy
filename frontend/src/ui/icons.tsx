import type { DeviceIcon } from "../api/types";

// Simple line icons drawn for Oukilé (24×24, stroke = currentColor).
const PATHS: Record<DeviceIcon | "person" | "pin" | "me" | "sound" | "route" | "lock" | "clock" | "refresh" | "bell" | "zone" | "locate" | "trash" | "edit", string> = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 18.5h19"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  watch: '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5l.5-4h5l.5 4M9 17.5l.5 4h5l.5-4"/>',
  earbuds: '<circle cx="8" cy="8" r="3"/><path d="M8 11v8.5"/><circle cx="16" cy="8" r="3"/><path d="M16 11v8.5"/>',
  tag: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/>',
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

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
