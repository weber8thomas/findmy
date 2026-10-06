import { createStore } from "../lib/store";

/** The device record of *this* browser, created from the "Me" tab. */
export type LocalDevice = { id: string; token: string; name: string; userId: string };

export type ReporterPrefs = { sharing: boolean; highAccuracy: boolean; keepAwake: boolean };

const DEVICE_KEY = "locus.device";
const PREFS_KEY = "locus.reporter";
const QUEUE_KEY = "locus.queue";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: keep in memory only */
  }
}

export const localDeviceStore = createStore<LocalDevice | null>(read<LocalDevice>(DEVICE_KEY));
localDeviceStore.subscribe(() => write(DEVICE_KEY, localDeviceStore.get()));

export const prefsStore = createStore<ReporterPrefs>({
  sharing: false,
  highAccuracy: true,
  keepAwake: false,
  ...(read<ReporterPrefs>(PREFS_KEY) ?? {}),
});
prefsStore.subscribe(() => write(PREFS_KEY, prefsStore.get()));

export type QueuedFix = {
  ts: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
};

export const queueStorage = {
  load: (): QueuedFix[] => read<QueuedFix[]>(QUEUE_KEY) ?? [],
  save: (q: QueuedFix[]) => write(QUEUE_KEY, q.length ? q : null),
};

/** The local device, if it belongs to the signed-in user. */
export function localDeviceFor(userId: string | undefined): LocalDevice | null {
  const d = localDeviceStore.get();
  return d && userId && d.userId === userId ? d : null;
}
