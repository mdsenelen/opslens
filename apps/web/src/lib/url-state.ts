"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Filter/time-range/pagination state lives in the URL, not React state —
 * every one of these values is already a query param the corresponding API
 * endpoint accepts (serviceListQuerySchema, alertListQuerySchema, etc, in
 * packages/shared-types/src/api.ts), so this makes a filtered view
 * bookmarkable and shareable for free (docs/spec/04-frontend-architecture.md).
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback((key: string) => searchParams.get(key) ?? undefined, [searchParams]);

  const set = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return { searchParams, get, set };
}
