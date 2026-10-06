export type WsMessage = { type: string; data: any };
type Listener = (msg: WsMessage) => void;

/** Reconnecting WebSocket with a tiny pub/sub on top. */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private everOpened = false;
  deviceToken: string | null = null;
  connected = false;

  connect() {
    this.closed = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.send("hello", { device_token: this.deviceToken });
      this.pingTimer = setInterval(() => this.send("ping", {}), 25_000);
      this.emit({ type: "_open", data: { reconnected: this.everOpened } });
      this.everOpened = true;
    };
    ws.onmessage = (ev) => {
      try {
        this.emit(JSON.parse(ev.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = (ev) => {
      this.cleanupTimers();
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.emit({ type: "_close", data: {} });
      if (this.closed || ev.code === 4401) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry) * (0.8 + Math.random() * 0.4);
      this.retry += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  setDeviceToken(token: string | null) {
    if (token === this.deviceToken) return;
    this.deviceToken = token;
    if (this.connected) this.send("hello", { device_token: token });
  }

  send(type: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, data }));
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close() {
    this.closed = true;
    this.cleanupTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private cleanupTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private emit(msg: WsMessage) {
    this.listeners.forEach((l) => l(msg));
  }
}
