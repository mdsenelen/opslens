"use client";

import { realtimeAlertStatusEventSchema, type Alert } from "@opslens/shared-types";
import { useEffect, useRef, useState } from "react";

// EventSource runs in the browser, so this must be the NEXT_PUBLIC_-prefixed
// var (the plain OPSLENS_API_URL api-client.ts uses is server-only and
// never reaches the client bundle).
const REALTIME_BASE_URL = process.env.NEXT_PUBLIC_OPSLENS_API_URL ?? "http://localhost:4000";

export type RealtimeConnectionState = "connecting" | "open" | "reconnecting" | "lost";

/**
 * Subscribes to GET /api/realtime/stream's alert-status events, scoped to
 * serviceId when given. EventSource's built-in retry handles a momentary
 * drop with no code here — this hook adds only what the browser doesn't
 * provide: a user-visible "lost" state after repeated consecutive
 * failures (not the first blip), and a resync-from-REST call on every
 * reconnect (not just the first connect) rather than trying to replay
 * events that arrived while disconnected. See
 * docs/spec/06-realtime-architecture.md for the full reasoning.
 */
export function useRealtimeAlerts(serviceId: string | undefined, onAlertChange: (alert: Alert) => void, onResync: () => void): RealtimeConnectionState {
  const [state, setState] = useState<RealtimeConnectionState>("connecting");
  const failureCountRef = useRef(0);
  const onAlertChangeRef = useRef(onAlertChange);
  const onResyncRef = useRef(onResync);

  // Refs may only be written in an effect or event handler, not during
  // render. No deps array: this should re-sync after every render so the
  // EventSource's listeners (set up once below) always call the latest
  // closures instead of ones captured from the first render.
  useEffect(() => {
    onAlertChangeRef.current = onAlertChange;
    onResyncRef.current = onResync;
  });

  useEffect(() => {
    const qs = serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : "";
    const source = new EventSource(`${REALTIME_BASE_URL}/api/realtime/stream${qs}`);
    let hasConnectedOnce = false;

    source.addEventListener("open", () => {
      if (hasConnectedOnce) onResyncRef.current();
      hasConnectedOnce = true;
      failureCountRef.current = 0;
      setState("open");
    });

    source.addEventListener("alert-status", (event) => {
      const raw: unknown = JSON.parse((event as MessageEvent<string>).data);
      const parsed = realtimeAlertStatusEventSchema.safeParse(raw);
      // Apply idempotently: patching to the event's payload is safe to
      // repeat if the same transition is delivered twice (e.g. once via a
      // live event and once via a resync-triggered refetch).
      if (parsed.success) onAlertChangeRef.current(parsed.data.alert);
    });

    source.onerror = () => {
      failureCountRef.current += 1;
      setState(failureCountRef.current >= 3 ? "lost" : "reconnecting");
    };

    return () => source.close();
  }, [serviceId]);

  return state;
}
