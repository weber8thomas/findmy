import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { toast } from "../lib/ui-state";
import { useStore } from "../lib/store";
import { localDeviceStore } from "../reporter/storage";
import { keys } from "./queries";
import type { Command, Device, MyLocation, Person } from "./types";
import { RealtimeClient, type WsMessage } from "./ws";

type Ctx = { client: RealtimeClient | null; connected: boolean };
const RealtimeContext = createContext<Ctx>({ client: null, connected: false });

function patchDevices(qc: QueryClient, id: string, patch: (d: Device) => Device): boolean {
  let found = false;
  qc.setQueryData<Device[]>(keys.devices, (list) =>
    list?.map((d) => {
      if (d.id !== id) return d;
      found = true;
      return patch(d);
    }),
  );
  return found;
}

export function applyMessage(qc: QueryClient, msg: WsMessage) {
  const { type, data } = msg;
  switch (type) {
    case "device.location":
      if (!patchDevices(qc, data.device_id, (d) => ({ ...d, location: data.location, battery: data.battery ?? d.battery, last_seen_at: data.last_seen_at })))
        void qc.invalidateQueries({ queryKey: keys.devices });
      break;
    case "device.status":
      patchDevices(qc, data.device_id, (d) => ({ ...d, online: data.online, last_seen_at: data.last_seen_at ?? d.last_seen_at }));
      break;
    case "device.updated":
      if (!patchDevices(qc, data.id, () => data as Device)) void qc.invalidateQueries({ queryKey: keys.devices });
      break;
    case "device.removed":
      qc.setQueryData<Device[]>(keys.devices, (list) => list?.filter((d) => d.id !== data.device_id));
      // It may have been one of my sources.
      void qc.invalidateQueries({ queryKey: keys.sources });
      break;
    case "person.location":
      qc.setQueryData<Person[]>(keys.people, (list) =>
        list?.map((p) => (p.user.id === data.user_id ? { ...p, location: data.location, device_name: data.device_name } : p)),
      );
      break;
    case "me.location":
      qc.setQueryData<MyLocation>(keys.myLocation, data);
      break;
    case "share.updated":
      void qc.invalidateQueries({ queryKey: keys.people });
      void qc.invalidateQueries({ queryKey: keys.shares });
      void qc.invalidateQueries({ queryKey: keys.viewers });
      break;
    case "command.updated": {
      const cmd = data as Command;
      qc.setQueryData<Command[]>(keys.commands(cmd.device_id), (list) => [cmd, ...(list ?? []).filter((c) => c.id !== cmd.id)]);
      break;
    }
    case "zone.event":
      void qc.invalidateQueries({ queryKey: keys.zoneEvents });
      break;
    case "notification":
      void qc.invalidateQueries({ queryKey: keys.notifications });
      break;
  }
}

export function RealtimeProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const [connected, setConnected] = useState(false);
  const local = useStore(localDeviceStore);
  const deviceToken = local && local.userId === userId ? local.token : null;

  useEffect(() => {
    if (!userId) return;
    const c = new RealtimeClient();
    c.deviceToken = localDeviceStore.get()?.userId === userId ? localDeviceStore.get()!.token : null;
    const unsub = c.subscribe((msg) => {
      if (msg.type === "_open") {
        setConnected(true);
        if (msg.data.reconnected) void qc.invalidateQueries({ predicate: (q) => !["config", "me"].includes(String(q.queryKey[0])) });
        return;
      }
      if (msg.type === "_close") {
        setConnected(false);
        return;
      }
      applyMessage(qc, msg);
      if (msg.type === "zone.event") {
        const key = msg.data.type === "enter" ? "zones.arrived" : "zones.left";
        toast(t(key, { who: msg.data.device_name, zone: msg.data.zone_name }));
      } else if (msg.type === "notification" && !String(msg.data.kind).startsWith("zone_")) {
        toast(msg.data.payload?.title ?? "", msg.data.payload?.body);
      }
    });
    c.connect();
    setClient(c);
    return () => {
      unsub();
      c.close();
      setClient(null);
      setConnected(false);
    };
    // t only changes with locale; reconnecting for that is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, qc]);

  useEffect(() => {
    client?.setDeviceToken(deviceToken);
  }, [client, deviceToken]);

  const value = useMemo(() => ({ client, connected }), [client, connected]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): Ctx {
  return useContext(RealtimeContext);
}
