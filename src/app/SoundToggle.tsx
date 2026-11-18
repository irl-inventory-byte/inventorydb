"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ui-sound-enabled";

/**
 * Drop this ONCE in the root layout (src/app/layout.tsx, inside <body>, alongside your other
 * top-level content) and it does two things for the whole app:
 *
 * 1. Plays a short click sound whenever the user clicks any button, link, or submit input,
 *    anywhere in the app — no changes needed to individual buttons/links.
 * 2. Renders a small floating speaker icon (bottom-right) that toggles the sound on/off. The
 *    choice is remembered (localStorage) across visits and tabs.
 *
 * No audio file needed — the "click" is synthesized with the Web Audio API, so there's nothing
 * to upload or host.
 */
export default function SoundToggle() {
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load the saved preference once, on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setEnabled(saved === "1");
    } catch {
      // localStorage unavailable (private mode, etc.) — just use the default.
    }
    setReady(true);
  }, []);

  // Keep every tab/page in sync if the user flips the toggle elsewhere.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) setEnabled(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The actual click-sound listener. Delegated on document so it covers every button/link that
  // exists now or gets added later, on every page, without touching those components.
  useEffect(() => {
    const playClick = () => {
      if (!enabled) return;
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } catch {
        // Ignore — a missing/blocked AudioContext should never break a click.
      }
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const clickable = target.closest('button, a, input[type="submit"], input[type="button"], [role="button"]');
      if (clickable) playClick();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Best-effort only — the toggle still works for the rest of this page load either way.
    }
  };

  if (!ready) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={enabled ? "Mute click sounds" : "Enable click sounds"}
      title={enabled ? "Click sounds: on" : "Click sounds: off"}
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        width: 40,
        height: 40,
        borderRadius: "50%",
        border: "1px solid var(--border, #e2e8f0)",
        background: "var(--card, #ffffff)",
        color: "var(--fg, #0f172a)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        cursor: "pointer",
      }}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}