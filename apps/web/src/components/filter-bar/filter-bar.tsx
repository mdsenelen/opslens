import type { ReactNode } from "react";
import styles from "./filter-bar.module.css";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className={styles.bar} role="search">
      {children}
    </div>
  );
}

export function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
