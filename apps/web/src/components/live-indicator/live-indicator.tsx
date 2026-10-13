import styles from "./live-indicator.module.css";

export type LiveState = "connecting" | "open" | "reconnecting" | "lost";

const LABEL: Record<LiveState, string> = {
  open: "Live",
  connecting: "Connecting to live updates…",
  reconnecting: "Reconnecting…",
  lost: "Live updates paused",
};

/**
 * Visible connection status for a screen that receives pushed updates.
 * The dot's color is reinforced by its shape (solid, ring, hollow) and by
 * the text, so the state never depends on color perception. This is the
 * visible half only; announcing changes is the caller's polite live region,
 * which is throttled and would be noisy if this element were live too.
 */
export function LiveIndicator({ state }: { state: LiveState }) {
  return (
    <span className={`${styles.indicator} ${styles[state]}`}>
      <span aria-hidden="true" className={styles.dot} />
      {LABEL[state]}
    </span>
  );
}
