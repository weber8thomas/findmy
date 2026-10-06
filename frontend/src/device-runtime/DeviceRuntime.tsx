import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useRealtime } from "../api/realtime";
import type { Command, LostMode } from "../api/types";
import { useI18n } from "../i18n";
import type { LocalDevice } from "../reporter/storage";
import { playSound, stopSound } from "./sound";

type IncomingCommand = Pick<Command, "id" | "type" | "payload">;

/**
 * Runs on a browser registered as a device: executes commands sent by the owner
 * (play a sound, lost mode) and shows the corresponding full-screen overlays.
 */
export function DeviceRuntime({ device }: { device: LocalDevice }) {
  const { client } = useRealtime();
  const [lost, setLost] = useState<LostMode | null>(null);
  const [sound, setSound] = useState<{ id: string; blocked: boolean } | null>(null);
  const handled = useRef(new Set<string>());

  const ack = useCallback(
    (id: string, status: "acked" | "failed" = "acked") =>
      api(`/report/commands/${id}/ack`, { method: "POST", token: device.token, body: { status } }).catch(() => undefined),
    [device.token],
  );

  const handle = useCallback(
    async (cmd: IncomingCommand) => {
      if (handled.current.has(cmd.id)) return;
      handled.current.add(cmd.id);
      if (cmd.type === "play_sound") {
        const ok = await playSound();
        setSound({ id: cmd.id, blocked: !ok });
        void ack(cmd.id);
      } else if (cmd.type === "lost_mode_on") {
        const p = cmd.payload as { message?: string; phone?: string; owner_name?: string };
        setLost({ enabled: true, message: p.message ?? null, phone: p.phone ?? null, owner_name: p.owner_name ?? null, since: null });
        void ack(cmd.id);
      } else if (cmd.type === "lost_mode_off") {
        setLost(null);
        void ack(cmd.id);
      }
    },
    [ack],
  );

  // Initial state: lost mode + commands that arrived while the app was closed.
  useEffect(() => {
    let cancelled = false;
    api<{ lost_mode: LostMode; pending_commands: Command[] }>("/report/state", { token: device.token })
      .then((state) => {
        if (cancelled) return;
        setLost(state.lost_mode.enabled ? state.lost_mode : null);
        state.pending_commands.forEach((c) => void handle(c));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [device.token, handle]);

  useEffect(() => {
    if (!client) return;
    return client.subscribe((msg) => {
      if (msg.type === "command") void handle(msg.data as IncomingCommand);
      else if (msg.type === "welcome" && msg.data.device_id === device.id) {
        const lm = msg.data.lost_mode as LostMode | undefined;
        if (lm) setLost(lm.enabled ? lm : null);
      }
    });
  }, [client, device.id, handle]);

  // Commands relayed by the service worker when a push arrives while the app is open.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "push" && ev.data.payload?.kind === "command") void handle(ev.data.payload.command);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [handle]);

  return (
    <>
      {lost && <LostModeOverlay lost={lost} />}
      {sound && (
        <SoundOverlay
          blocked={sound.blocked}
          onPlay={async () => setSound({ ...sound, blocked: !(await playSound()) })}
          onStop={() => {
            stopSound();
            setSound(null);
          }}
        />
      )}
    </>
  );
}

function SoundOverlay({ blocked, onPlay, onStop }: { blocked: boolean; onPlay: () => void; onStop: () => void }) {
  const { t } = useI18n();
  return (
    <div className="overlay overlay-sound" data-testid="sound-overlay" role="alertdialog" aria-live="assertive">
      <div className="pulse-ring" aria-hidden />
      <h1>{t("sound.title")}</h1>
      {blocked && (
        <button className="btn btn-primary btn-large" onClick={onPlay}>
          {t("sound.tapToPlay")}
        </button>
      )}
      <button className="btn btn-light btn-large" onClick={onStop} data-testid="sound-stop">
        {t("sound.stop")}
      </button>
    </div>
  );
}

function LostModeOverlay({ lost }: { lost: LostMode }) {
  const { t } = useI18n();
  return (
    <div className="overlay overlay-lost" data-testid="lost-overlay" role="alertdialog">
      <h1>{t("lost.overlayTitle")}</h1>
      {lost.message && <p className="lost-message">{lost.message}</p>}
      {lost.owner_name && <p>{t("lost.overlayOwner", { name: lost.owner_name })}</p>}
      {lost.phone && (
        <a className="btn btn-light btn-large" href={`tel:${lost.phone.replace(/[^\d+]/g, "")}`} data-testid="lost-call">
          {t("lost.call")} · {lost.phone}
        </a>
      )}
    </div>
  );
}
