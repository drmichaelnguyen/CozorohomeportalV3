"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Star = { left: number; top: number; size: number; delay: number; dur: number; hue: number };

function makeStars(seed: number, count: number): Star[] {
  const rnd = mulberry32(seed >>> 0);
  return Array.from({ length: count }, () => ({
    left: rnd() * 100,
    top: rnd() * 100,
    size: rnd() * 2.4 + 0.35,
    delay: rnd() * 3.5,
    dur: rnd() * 1.8 + 1.1,
    hue: rnd() > 0.92 ? 48 + rnd() * 24 : 210 + rnd() * 80
  }));
}

/**
 * Full-viewport decorative star sky for ~5s (pointer-events none). Bump `burstKey` to replay.
 */
export function CozoroStarfieldBurst({ burstKey }: { burstKey: number }) {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (burstKey <= 0 || !mounted) return;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), 5000);
    return () => window.clearTimeout(t);
  }, [burstKey, mounted]);

  const stars = useMemo(() => makeStars((burstKey || 1) * 2654435761, 130), [burstKey]);

  if (!mounted || !active || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[10050] overflow-hidden"
      style={{ animation: "cozoro-starfield-veil 5s ease-in-out forwards" }}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% 0%, rgba(56, 189, 248, 0.18) 0%, transparent 55%), radial-gradient(ellipse 90% 60% at 80% 100%, rgba(129, 140, 248, 0.22) 0%, transparent 50%), linear-gradient(180deg, #020617 0%, #0f172a 45%, #020617 100%)"
        }}
      />
      {stars.map((s, i) => (
        <span
          key={`${burstKey}-${i}`}
          className="absolute rounded-full"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            background: `hsla(${s.hue}, 85%, 78%, 0.95)`,
            boxShadow: `0 0 ${s.size * 2.2}px hsla(${s.hue}, 90%, 70%, 0.55)`,
            animation: `cozoro-star-twinkle ${s.dur}s ease-in-out infinite`,
            animationDelay: `${s.delay}s`
          }}
        />
      ))}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px"
        }}
      />
    </div>,
    document.body
  );
}
