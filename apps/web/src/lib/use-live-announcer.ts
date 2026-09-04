"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_THROTTLE_MS = 1500;

/**
 * A polite aria-live announcer that coalesces messages arriving within a
 * short window into one utterance, instead of replacing the live region's
 * text once per event. Without this, a burst of alert transitions (or a
 * flapping connection) can overwrite one announcement with the next before
 * a screen reader finishes speaking it — the region's text changes, but
 * only the last change is ever heard. docs/spec/11-accessibility.md calls
 * for polite, not assertive, announcements on status changes; this is the
 * shared mechanism alerts-list.tsx and alert-detail.tsx both build their
 * live regions on.
 */
export function useLiveAnnouncer(throttleMs: number = DEFAULT_THROTTLE_MS): [string, (message: string) => void] {
  const [announcement, setAnnouncement] = useState("");
  const pendingRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const announce = useCallback(
    (message: string) => {
      pendingRef.current.push(message);
      if (timerRef.current) return; // a flush is already scheduled — this message rides along with it
      timerRef.current = setTimeout(() => {
        const batch = pendingRef.current;
        pendingRef.current = [];
        timerRef.current = null;
        setAnnouncement(batch.join(" "));
      }, throttleMs);
    },
    [throttleMs],
  );

  return [announcement, announce];
}
