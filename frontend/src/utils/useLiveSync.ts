import { useEffect, useRef } from "react";

type EventCallback = (payload: any) => void;

class LiveSyncManager {
  private static instance: LiveSyncManager;
  private eventSource: EventSource | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;

  private constructor() {
    this.connect();
  }

  public static getInstance(): LiveSyncManager {
    if (!LiveSyncManager.instance) {
      LiveSyncManager.instance = new LiveSyncManager();
    }
    return LiveSyncManager.instance;
  }

  private connect() {
    if (typeof window === "undefined") return;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      this.eventSource = new EventSource("/api/events");

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.type) {
            this.dispatch(data.type, data.payload);
            this.dispatch("*", data);
          }
        } catch {
          // Ignore malformed JSON or heartbeat pings
        }
      };

      this.eventSource.onerror = () => {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        // Exponential backoff reconnect: 1s, 2s, 4s, max 10s
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
        this.reconnectAttempts++;
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = window.setTimeout(() => this.connect(), delay);
      };
    } catch {
      // Reconnect on initial setup failure
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = window.setTimeout(() => this.connect(), 3000);
    }
  }

  private dispatch(type: string, payload: any) {
    const set = this.listeners.get(type);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`Error in live sync listener for event "${type}":`, err);
        }
      });
    }
  }

  public subscribe(type: string, cb: EventCallback): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(cb);

    return () => {
      const set = this.listeners.get(type);
      if (set) {
        set.delete(cb);
        if (set.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }
}

/**
 * useLiveEvent listens for one or more real-time backend events.
 *
 * Example:
 *   useLiveEvent(["QUEUE_UPDATED", "TRANSACTIONS_UPDATED"], () => refresh());
 */
export function useLiveEvent(
  events: string | string[],
  callback: (payload: any) => void
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const manager = LiveSyncManager.getInstance();
    const eventList = Array.isArray(events) ? events : [events];

    const unsubs = eventList.map((type) =>
      manager.subscribe(type, (payload) => {
        cbRef.current(payload);
      })
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [Array.isArray(events) ? events.join(",") : events]);
}
