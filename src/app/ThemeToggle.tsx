"use client";

import { useEffect, useState } from "react";

/**
 * Floating light/dark switch, shown on every page (rendered once in layout.tsx). The actual theme is
 * always driven by the data-theme attribute on <html> — see the inline script in layout.tsx, which sets
 * it before first paint (from localStorage "theme", or the OS preference the first time someone visits)
 * so there is no flash of the wrong theme. This component only reflects and changes that attribute.
 */
export default function ThemeToggle() {
  // Starts null so the button doesn't render a guess during hydration that might not match what the
  // inline script already put on <html> (would briefly show the wrong icon). Filled in from the DOM
  // right after mount, which by then always has the real value.
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  if (!theme) return null;

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing / storage blocked: the choice just won't be remembered next visit.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        width: 40,
        height: 40,
        borderRadius: "50%",
        border: "1px solid var(--muted-text)",
        background: "var(--background)",
        color: "var(--foreground)",
        fontSize: "1.1rem",
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
      }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}