import { getPing } from "@/lib/api-client";
import styles from "./page.module.css";

// Phase 0 verification page: proves web -> shared-types -> api round-trips
// through one real HTTP call, typed end-to-end. Fleet Overview replaces
// this route in Phase 3.
export default async function Home() {
  const result = await getPing();
  const isError = "kind" in result;

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <span
          className={`${styles.status} ${isError ? styles.err : styles.ok}`}
        >
          {isError ? `api: ${result.kind}` : "api: connected"}
        </span>
        <h1>OpsLens</h1>
        <p>
          {isError
            ? `Could not reach the API — ${result.message}. Run "pnpm dev:api" in another terminal.`
            : result.message}
        </p>
        {!isError && (
          <p>
            <code>{result.timestamp}</code>
          </p>
        )}
      </main>
    </div>
  );
}
