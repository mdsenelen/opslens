import type { ReactNode } from "react";
import styles from "./stat-tile.module.css";

/**
 * A row of headline numbers. Rendered as a <dl> so each value is read with
 * its label ("Healthy: 3"), never as a bare number. `icon` is decorative
 * and hidden from assistive tech; the label carries the meaning.
 */
export function StatGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className={styles.group} aria-label={label}>
      {children}
    </dl>
  );
}

export function StatTile({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  icon?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className={`${styles.tile} ${styles[tone]}`}>
      <dt className={styles.label}>
        {icon && (
          <span aria-hidden="true" className={styles.icon}>
            {icon}
          </span>
        )}
        {label}
      </dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}
