import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./client";
import type {
  AppConfig,
  AppNotification,
  Command,
  Device,
  LocationPoint,
  MyLocation,
  Person,
  Share,
  User,
  Zone,
  ZoneEvent,
} from "./types";

export const keys = {
  config: ["config"] as const,
  me: ["me"] as const,
  devices: ["devices"] as const,
  commands: (id: string) => ["commands", id] as const,
  history: (id: string, range: string) => ["history", id, range] as const,
  people: ["people"] as const,
  shares: ["shares"] as const,
  viewers: ["viewers"] as const,
  myLocation: ["myLocation"] as const,
  sources: ["sources"] as const,
  zones: ["zones"] as const,
  zoneEvents: ["zoneEvents"] as const,
  notifications: ["notifications"] as const,
  prefs: ["prefs"] as const,
};

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => api<AppConfig>("/config"), staleTime: Infinity });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<User>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useDevices(enabled = true) {
  return useQuery({ queryKey: keys.devices, queryFn: () => api<Device[]>("/devices"), enabled });
}

export function useCommands(deviceId: string) {
  return useQuery({
    queryKey: keys.commands(deviceId),
    queryFn: () => api<Command[]>(`/devices/${deviceId}/commands?limit=5`),
  });
}

export function useHistory(deviceId: string, hours: number) {
  return useQuery({
    queryKey: keys.history(deviceId, String(hours)),
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 3_600_000);
      const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), max_points: "1500" });
      return api<{ device_id: string; points: LocationPoint[]; total: number }>(
        `/devices/${deviceId}/locations?${q}`,
      );
    },
  });
}

export function usePeople(enabled = true) {
  return useQuery({ queryKey: keys.people, queryFn: () => api<Person[]>("/people"), enabled });
}

export function useShares() {
  return useQuery({
    queryKey: keys.shares,
    queryFn: () => api<{ incoming: Share[]; outgoing: Share[] }>("/shares"),
  });
}

export function useViewers() {
  return useQuery({ queryKey: keys.viewers, queryFn: () => api<Share[]>("/me/viewers") });
}

/** My location as the people I share with see it (pushed live as `me.location`). */
export function useMyLocation() {
  return useQuery({ queryKey: keys.myLocation, queryFn: () => api<MyLocation>("/me/location") });
}

/** The devices my location is taken from, first choice first. */
export function useSources() {
  return useQuery({ queryKey: keys.sources, queryFn: () => api<{ device_ids: string[] }>("/me/sources") });
}

export type Prefs = { battery_alerts: boolean };

export function usePrefs() {
  return useQuery({ queryKey: keys.prefs, queryFn: () => api<Prefs>("/me/prefs") });
}

export function useZones(enabled = true) {
  return useQuery({ queryKey: keys.zones, queryFn: () => api<Zone[]>("/zones"), enabled });
}

export function useZoneEvents() {
  return useQuery({ queryKey: keys.zoneEvents, queryFn: () => api<ZoneEvent[]>("/zones/events?limit=20") });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api<AppNotification[]>("/notifications?limit=30"),
  });
}
