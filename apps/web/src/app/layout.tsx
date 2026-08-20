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
  title: "OpsLens",
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
        <nav className={styles.nav}>
          <Link href="/" className={styles.brand}>
            OpsLens
          </Link>
          <div className={styles.links}>
            <Link href="/">Fleet</Link>
            <Link href="/alerts">Alerts</Link>
            <Link href="/deployments">Deployments</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
