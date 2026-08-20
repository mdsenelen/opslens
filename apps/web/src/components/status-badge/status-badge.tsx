import type { AlertSeverity, AlertStatus } from "@opslens/shared-types";
import styles from "./status-badge.module.css";

// Color must never be the only signal here (docs/spec/11-accessibility.md
// flags this explicitly) — every status/severity pairs a color with both
// an icon and a text label, so it survives grayscale, color-blindness, and
// a screen reader equally.
const STATUS_LABEL: Record<AlertStatus, string> = {
  firing: "Firing",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};
const STATUS_ICON: Record<AlertStatus, string> = {
  firing: "●",
  acknowledged: "◐",
  resolved: "✓",
};

export function StatusBadge({ status }: { status: AlertStatus }) {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};
const SEVERITY_ICON: Record<AlertSeverity, string> = {
  info: "ⓘ",
  warning: "▲",
  critical: "⬢",
};

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span className={`${styles.badge} ${styles[severity]}`}>
      <span aria-hidden="true">{SEVERITY_ICON[severity]}</span>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
