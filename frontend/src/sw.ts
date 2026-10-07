/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
// App shell only; /api is never cached.
precacheAndRoute(self.__WB_MANIFEST);

type PushPayload = {
  kind?: string;
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  require_interaction?: boolean;
  command?: { id: string; type: string; payload: unknown };
};

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: "Oukilé", body: event.data?.text() };
  }
  event.waitUntil(
    (async () => {
      // Let an open app react immediately (e.g. play the sound).
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      windows.forEach((c) => c.postMessage({ type: "push", payload }));
      await self.registration.showNotification(payload.title ?? "Oukilé", {
        body: payload.body,
        tag: payload.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: payload.url ?? "/" },
        requireInteraction: Boolean(payload.require_interaction),
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
