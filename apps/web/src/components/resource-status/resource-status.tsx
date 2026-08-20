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
  return (
    <div role="alert" className={styles.error}>
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
