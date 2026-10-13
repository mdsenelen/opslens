import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./page-header.module.css";

/**
 * The top of every screen: an optional back link, the page's single h1,
 * and optional supporting text, metadata (badges, chips) and actions. One
 * component so heading order and spacing are identical across routes.
 */
export function PageHeader({
  back,
  title,
  description,
  meta,
  actions,
}: {
  back?: { href: string; label: string };
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      {back && (
        <Link href={back.href} className={styles.back}>
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className={styles.row}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          {meta && <div className={styles.meta}>{meta}</div>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
