import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLink } from "@/components/nav-link/nav-link";
import "./globals.css";
import styles from "./layout.module.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "OpsLens", template: "%s · OpsLens" },
  description: "Investigate whether a recent deployment lines up with a real regression in a service.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* Visually hidden until focused — the first Tab stop on every page,
            per docs/spec/11-accessibility.md's keyboard-operability
            requirement. Jumps straight past the nav to each page's content. */}
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>
        <header className={styles.header}>
          <nav className={styles.nav} aria-label="Primary">
            <Link href="/" className={styles.brand}>
              {/* Decorative: the link's accessible name is the word next to it. */}
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" className={styles.logo}>
                <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
                <path d="M5 14h3l2-5 3 9 2-6 1.5 2H19" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              OpsLens
            </Link>
            <div className={styles.links}>
              <NavLink href="/" alsoMatches={["/services"]}>
                Fleet
              </NavLink>
              <NavLink href="/alerts">Alerts</NavLink>
              <NavLink href="/deployments">Deployments</NavLink>
            </div>
          </nav>
        </header>
        {/* tabIndex={-1}: a plain <main> isn't natively focusable, so
            without it the skip link above would move the URL hash but not
            actually move keyboard focus. Not added to the normal Tab
            order; only reachable via the skip link's programmatic focus(). */}
        <main id="main-content" tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </body>
    </html>
  );
}
