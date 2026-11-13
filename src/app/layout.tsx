import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import NavProgress from "./NavProgress";
import ThemeToggle from "./ThemeToggle";
import "./globals.css";

// Runs synchronously before <body> paints anything, so the page never flashes the wrong theme then
// flips. Picks up a saved choice (ThemeToggle writes to localStorage "theme"); the very first visit,
// with nothing saved yet, falls back to the OS preference. See globals.css's THEME comment — every
// theme-aware CSS rule keys off this data-theme attribute alone, never a media query.
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    // localStorage/matchMedia unavailable (very old browser, blocked storage): leave the default theme.
  }
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inventory",
  description: "Track SD cards across hubs",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
        <ThemeToggle />
        <Analytics />
      </body>
    </html>
  );
}