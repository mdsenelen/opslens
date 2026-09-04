import { useEffect, useRef } from "react";
import styles from "./resource-status.module.css";

// Takes plain strings, not the ApiError type — components/ (the "ui"
// boundary layer) may depend on other "ui" only, never on lib/
// (apps/web/eslint.config.mjs). Features compute the message via
// lib/api-client.ts's describeApiError and pass the string down.
export function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" className={styles.loading}>
      {label}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  // role="alert" gets this announced, but a keyboard user still has to tab
  // from the top of the page to reach Retry — focusing it on mount
  // (docs/spec/11-accessibility.md's focus-management requirement) puts
  // Retry one Tab away instead. tabIndex={-1} allows the programmatic
  // focus() without adding the div to the normal Tab order.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div ref={ref} role="alert" tabIndex={-1} className={styles.error}>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className={styles.empty}>{message}</p>;
}
