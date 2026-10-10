"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./nav-link.module.css";

/**
 * A primary-nav link that marks itself as the current section. aria-current
 * carries the state for assistive tech; the underline carries it visually,
 * so the active item is not signalled by color alone. A link matches its
 * own path and anything nested under it ("/alerts/123" keeps "Alerts"
 * current), except "/", which only matches itself. `alsoMatches` lets a
 * section claim routes that live outside its own prefix.
 */
function isUnder(pathname: string, prefix: string): boolean {
  return prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function NavLink({ href, alsoMatches = [], children }: { href: string; alsoMatches?: string[]; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isCurrent = [href, ...alsoMatches].some((prefix) => isUnder(pathname, prefix));
  return (
    <Link href={href} className={styles.link} aria-current={isCurrent ? "page" : undefined}>
      {children}
    </Link>
  );
}
