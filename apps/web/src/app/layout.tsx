import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
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
  description: "Real-time technical analytics for a small service fleet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* Visually hidden until focused — the first Tab stop on every page,
            per docs/spec/11-accessibility.md's keyboard-operability
            requirement. Jumps straight past the nav to each page's content. */}
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>
        <nav className={styles.nav} aria-label="Primary">
          <Link href="/" className={styles.brand}>
            OpsLens
          </Link>
          <div className={styles.links}>
            <Link href="/">Fleet</Link>
            <Link href="/alerts">Alerts</Link>
            <Link href="/deployments">Deployments</Link>
          </div>
        </nav>
        {/* tabIndex={-1} — a plain <main> isn't natively focusable, so
            without it the skip link above would move the URL hash but not
            actually move keyboard focus. Not added to the normal Tab
            order; only reachable via the skip link's programmatic focus(). */}
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
