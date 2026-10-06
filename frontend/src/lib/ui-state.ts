import { createStore } from "./store";
import type { LocationPoint } from "../api/types";

export type Focus = { lat: number; lon: number; zoom?: number; seq: number };
export type DraftZone = { lat: number; lon: number; radius_m: number } | null;

export type MapUiState = {
  focus: Focus | null;
  /** When set, the next map click is sent here (zone editor "pick a center"). */
  pick: ((lat: number, lon: number) => void) | null;
  draftZone: DraftZone;
  history: LocationPoint[] | null;
  selected: { kind: "device" | "person"; id: string } | null;
};

export const mapUi = createStore<MapUiState>({
  focus: null,
  pick: null,
  draftZone: null,
  history: null,
  selected: null,
});

let seq = 0;
export function focusOn(lat: number, lon: number, zoom?: number) {
  mapUi.set((s) => ({ ...s, focus: { lat, lon, zoom, seq: ++seq } }));
}

export function patchMapUi(patch: Partial<MapUiState>) {
  mapUi.set((s) => ({ ...s, ...patch }));
}

export type Toast = { id: number; title: string; body?: string; tone?: "info" | "success" | "error" };
export const toasts = createStore<Toast[]>([]);
let toastSeq = 0;

export function toast(title: string, body?: string, tone: Toast["tone"] = "info") {
  const id = ++toastSeq;
  toasts.set((list) => [...list.slice(-3), { id, title, body, tone }]);
  setTimeout(() => toasts.set((list) => list.filter((t) => t.id !== id)), 6000);
}
