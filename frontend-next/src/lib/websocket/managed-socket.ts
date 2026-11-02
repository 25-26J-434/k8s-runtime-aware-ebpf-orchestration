export type SocketStatus = "connecting" | "live" | "offline";

type Options = {
  /** Same-origin path, e.g. /ws/node-health. */
  path: string;
  onMessage: (data: unknown) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Close and reconnect if no frame arrives within this window. 0 disables. */
  silenceMs?: number;
  maxBackoffMs?: number;
};

export function wsUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_WS_ORIGIN;
  if (origin) return `${origin.replace(/\/$/, "")}${path}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

/**
 * A reconnecting WebSocket with exponential backoff and silence detection. It parses JSON
 * safely and never throws into the caller; malformed frames are dropped.
 */
export class ManagedSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly opts: Options) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.watchdog);
    this.ws?.close();
    this.ws = null;
  }

  private arm() {
    const ms = this.opts.silenceMs ?? 0;
    if (!ms) return;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.ws?.close(), ms);
  }

  private connect() {
    this.opts.onStatus?.("connecting");
    const ws = new WebSocket(wsUrl(this.opts.path));
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.opts.onStatus?.("live");
      this.arm();
    };
    ws.onmessage = (event) => {
      this.arm();
      try {
        this.opts.onMessage(JSON.parse(String(event.data)));
      } catch {
        // malformed frame: drop it
      }
    };
    ws.onclose = () => {
      clearTimeout(this.watchdog);
      if (this.closed) return;
      this.opts.onStatus?.("offline");
      const delay = Math.min(1000 * 2 ** this.attempts++, this.opts.maxBackoffMs ?? 15_000);
      this.retry = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }
}
