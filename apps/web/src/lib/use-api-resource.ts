"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isApiError, type ApiError } from "./api-client";

export type ResourceState<T> = { status: "loading" } | { status: "error"; error: ApiError } | { status: "ready"; data: T };

/**
 * The loading/error/ready lifecycle every feature's fetch needs
 * (docs/spec/02-user-journeys.md's state table), backed by the existing
 * ApiError union. `initial`, when given, seeds state from the server
 * component's own fetch (docs/spec/04-frontend-architecture.md's
 * "server fetch feeds a client island" pattern) so there's no loading
 * flash on first paint — the effect only re-fetches when `fetcher`
 * changes identity (the caller should useCallback it on its filter
 * dependencies) or when the returned retry function is called directly.
 *
 * The third element, refresh, re-fetches in the background for live views
 * (the metric chart's relative time ranges): the current data stays on
 * screen with no loading state in between, and a failed refresh keeps the
 * last good data rather than replacing it with an error. Only the newest
 * request's response is applied, so a slow older one can't overwrite it.
 */
export function useApiResource<T>(fetcher: () => Promise<T | ApiError>, initial?: T | ApiError): [ResourceState<T>, () => void, () => void] {
  const [state, setState] = useState<ResourceState<T>>(() =>
    initial === undefined ? { status: "loading" } : isApiError(initial) ? { status: "error", error: initial } : { status: "ready", data: initial },
  );
  const skipNextEffect = useRef(initial !== undefined);
  const latestRequest = useRef(0);

  const load = useCallback(() => {
    const request = ++latestRequest.current;
    setState({ status: "loading" });
    void fetcher().then((result) => {
      if (request !== latestRequest.current) return;
      setState(isApiError(result) ? { status: "error", error: result } : { status: "ready", data: result });
    });
  }, [fetcher]);

  const refresh = useCallback(() => {
    const request = ++latestRequest.current;
    void fetcher().then((result) => {
      if (request !== latestRequest.current || isApiError(result)) return;
      setState({ status: "ready", data: result });
    });
  }, [fetcher]);

  useEffect(() => {
    if (skipNextEffect.current) {
      skipNextEffect.current = false;
      return;
    }
    load();
  }, [load]);

  return [state, load, refresh];
}
