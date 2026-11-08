"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A one-time "Happy Diwali" greeting with a cracker/fireworks animation, shown once per browser tab
 * session the first time someone opens the site. Click anywhere, or wait ~6s, to dismiss. Purely
 * decorative — no data, no store calls — so it's safe to mount at the very top of every page.
 */
export default function DiwaliGreeting() {
  const [show, setShow] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // sessionStorage so it greets again next visit/tab but not on every single page nav within one visit.
    let seen = false;
    try {
      seen = sessionStorage.getItem("diwaliGreetingShown") === "1";
    } catch {
      // ignore — if storage is unavailable, just show it every load
    }
    if (seen) return;
    try {
      sessionStorage.setItem("diwaliGreetingShown", "1");
    } catch {
      // ignore
    }
    setShow(true);
    const t = setTimeout(() => setShow(false), 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!show) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    const colors = ["#ff5e5e", "#ffd34d", "#4dd2ff", "#8aff8a", "#ff8ad1", "#ffa94d"];
    type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
    let particles: Particle[] = [];

    function burst(x: number, y: number) {
      const count = 40;
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const speed = 2 + Math.random() * 3;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color,
        });
      }
    }

    const burstTimer = setInterval(
      () => burst(w * (0.15 + Math.random() * 0.7), h * (0.15 + Math.random() * 0.5)),
      450,
    );
    // A couple right away so it doesn't start empty.
    burst(w * 0.3, h * 0.3);
    burst(w * 0.7, h * 0.35);

    let raf: number;
    function tick() {
      ctx!.clearRect(0, 0, w, h);
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03; // gravity
        p.life -= 0.016;
        ctx!.globalAlpha = Math.max(0, p.life);
        ctx!.fillStyle = p.color;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      clearInterval(burstTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      onClick={() => setShow(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(10, 10, 20, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div
        style={{
          position: "relative",
          textAlign: "center",
          color: "#fff",
          textShadow: "0 2px 18px rgba(255,180,60,0.6)",
          padding: "0 20px",
        }}
      >
        <div style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: 0.5 }}>🪔 Happy Diwali 🪔</div>
        <div style={{ fontSize: "1.05rem", marginTop: 8, opacity: 0.9 }}>Wishing you a bright and prosperous year ahead</div>
        <div style={{ fontSize: "0.8rem", marginTop: 18, opacity: 0.65 }}>(tap anywhere to continue)</div>
      </div>
    </div>
  );
}