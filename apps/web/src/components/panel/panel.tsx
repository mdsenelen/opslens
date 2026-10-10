import { useId, type ReactNode } from "react";
import styles from "./panel.module.css";

/**
 * A bordered surface. With a title it becomes a labelled <section> (its
 * h2 names the region for screen-reader landmark navigation); without one
 * it is a plain container, so a panel never adds an empty landmark.
 * `flush` drops the inner padding for content that brings its own, such
 * as a full-width table.
 */
export function Panel({
  title,
  description,
  actions,
  flush = false,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  const body = <div className={flush ? styles.flushBody : styles.body}>{children}</div>;

  if (!title) return <div className={styles.panel}>{body}</div>;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.head}>
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {body}
    </section>
  );
}
