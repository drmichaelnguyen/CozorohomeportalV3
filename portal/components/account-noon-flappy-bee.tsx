"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

/** Local clock: noon through 12:10 inclusive (first eleven minutes of the hour). */
export function isAccountNoonFlappyBeeWindow(d: Date): boolean {
  return d.getHours() === 12 && d.getMinutes() <= 10;
}

const W = 360;
const H = 480;
const BEE_X = 76;
const BEE_R = 15;
const GRAVITY = 0.38;
const FLAP_VY = -7.4;
const PIPE_W = 48;
const GAP_H = 128;
const PIPE_SPEED = 2.65;
const PIPE_SPAWN_MS = 2000;

type Pipe = { x: number; gapCenter: number; scored: boolean };
type GamePhase = "intro" | "playing" | "dead";

function randomGapCenter(): number {
  const margin = 100;
  return margin + Math.random() * (H - margin * 2);
}

function drawBee(ctx: CanvasRenderingContext2D, x: number, y: number, wingT: number) {
  const flap = Math.sin(wingT * 0.018) * 0.35;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.08);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(-10 - flap * 8, 2, 10, 6, -0.5, 0, Math.PI * 2);
  ctx.ellipse(10 + flap * 8, 2, 10, 6, 0.5, 0, Math.PI * 2);
  ctx.fill();

  const grd = ctx.createLinearGradient(-12, -14, 12, 14);
  grd.addColorStop(0, "#FEF9C3");
  grd.addColorStop(0.5, "#FDE047");
  grd.addColorStop(1, "#F59E0B");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(0, 2, 14, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#B45309";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(8, -4);
  ctx.moveTo(-9, 2);
  ctx.lineTo(9, 2);
  ctx.moveTo(-8, 8);
  ctx.lineTo(8, 8);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(-4, -2, 2.2, 0, Math.PI * 2);
  ctx.arc(5, -2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-3.3, -2.4, 0.7, 0, Math.PI * 2);
  ctx.arc(5.7, -2.4, 0.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function BeeGameCanvas({
  tapLabel,
  gameOverLabel,
  scoreTemplate
}: {
  tapLabel: string;
  gameOverLabel: string;
  scoreTemplate: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showIntroOverlay, setShowIntroOverlay] = useState(true);
  const [showDeadOverlay, setShowDeadOverlay] = useState(false);
  const [deadScore, setDeadScore] = useState(0);

  const phaseRef = useRef<GamePhase>("intro");
  const beeYRef = useRef(H * 0.42);
  const beeVyRef = useRef(0);
  const pipesRef = useRef<Pipe[]>([]);
  const scoreRef = useRef(0);
  const lastPipeMsRef = useRef(0);
  const wingTRef = useRef(0);
  const rafRef = useRef(0);

  const onFlap = useCallback(() => {
    if (phaseRef.current === "intro") {
      phaseRef.current = "playing";
      beeVyRef.current = FLAP_VY;
      pipesRef.current = [{ x: W + 24, gapCenter: randomGapCenter(), scored: false }];
      lastPipeMsRef.current = performance.now();
      scoreRef.current = 0;
      setShowIntroOverlay(false);
      setShowDeadOverlay(false);
    } else if (phaseRef.current === "playing") {
      beeVyRef.current = FLAP_VY;
    } else {
      phaseRef.current = "intro";
      beeYRef.current = H * 0.42;
      beeVyRef.current = 0;
      pipesRef.current = [];
      scoreRef.current = 0;
      setShowDeadOverlay(false);
      setShowIntroOverlay(true);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    function hitTest(): boolean {
      const y = beeYRef.current;
      if (y < BEE_R + 8 || y > H - BEE_R - 8) return true;
      const bx0 = BEE_X - BEE_R + 4;
      const bx1 = BEE_X + BEE_R - 2;
      const by0 = y - BEE_R + 2;
      const by1 = y + BEE_R - 2;
      for (const p of pipesRef.current) {
        if (bx1 < p.x || bx0 > p.x + PIPE_W) continue;
        const g0 = p.gapCenter - GAP_H / 2;
        const g1 = p.gapCenter + GAP_H / 2;
        if (by0 < g0 || by1 > g1) return true;
      }
      return false;
    }

    let last = performance.now();
    function frame(now: number) {
      const dt = Math.min(40, now - last);
      last = now;
      wingTRef.current += dt;

      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#38bdf8");
      sky.addColorStop(0.55, "#0369a1");
      sky.addColorStop(1, "#0c4a6e");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.ellipse(80 + Math.sin(now * 0.0003) * 10, 90, 48, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(260 + Math.cos(now * 0.00025) * 8, 130, 42, 15, 0, 0, Math.PI * 2);
      ctx.fill();

      if (phaseRef.current === "playing") {
        beeVyRef.current += GRAVITY * (dt / 16.67);
        beeYRef.current += beeVyRef.current * (dt / 16.67);

        for (const p of pipesRef.current) {
          p.x -= PIPE_SPEED * (dt / 16.67);
        }
        pipesRef.current = pipesRef.current.filter((p) => p.x > -PIPE_W - 10);

        if (now - lastPipeMsRef.current >= PIPE_SPAWN_MS) {
          lastPipeMsRef.current = now;
          pipesRef.current.push({ x: W + 8, gapCenter: randomGapCenter(), scored: false });
        }

        for (const p of pipesRef.current) {
          if (!p.scored && p.x + PIPE_W < BEE_X - BEE_R) {
            p.scored = true;
            scoreRef.current += 1;
          }
        }

        if (hitTest() && phaseRef.current === "playing") {
          phaseRef.current = "dead";
          setDeadScore(scoreRef.current);
          setShowDeadOverlay(true);
        }
      }

      for (const p of pipesRef.current) {
        ctx.fillStyle = "#b45309";
        ctx.strokeStyle = "#78350f";
        ctx.lineWidth = 3;
        const g0 = p.gapCenter - GAP_H / 2;
        const g1 = p.gapCenter + GAP_H / 2;
        ctx.fillRect(p.x, 0, PIPE_W, Math.max(0, g0));
        ctx.strokeRect(p.x, 0, PIPE_W, Math.max(0, g0));
        ctx.fillRect(p.x, g1, PIPE_W, H - g1);
        ctx.strokeRect(p.x, g1, PIPE_W, H - g1);
        ctx.fillStyle = "rgba(254, 243, 199, 0.35)";
        ctx.fillRect(p.x + 6, 0, PIPE_W - 12, Math.max(0, g0));
        ctx.fillRect(p.x + 6, g1, PIPE_W - 12, H - g1);
      }

      drawBee(ctx, BEE_X, beeYRef.current, wingTRef.current);

      if (phaseRef.current === "playing") {
        const label = String(scoreRef.current);
        ctx.font = "bold 28px system-ui,Segoe UI,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = "rgba(15,23,42,0.5)";
        ctx.lineWidth = 4;
        ctx.strokeText(label, W / 2, 36);
        ctx.fillText(label, W / 2, 36);
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="relative touch-manipulation">
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="Cozoro noon bee mini-game"
        className="mx-auto block cursor-pointer rounded-xl border-2 border-amber-700/40 bg-sky-900 shadow-inner"
        onClick={() => onFlap()}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onFlap();
          }
        }}
        tabIndex={0}
      />
      {showIntroOverlay ? (
        <button
          type="button"
          onClick={() => onFlap()}
          className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-slate-900/40 px-6 text-center transition hover:bg-slate-900/50"
        >
          <span className="text-sm font-bold text-white drop-shadow-md">{tapLabel}</span>
        </button>
      ) : null}
      {showDeadOverlay ? (
        <button
          type="button"
          onClick={() => onFlap()}
          className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-slate-950/60 px-4 text-center transition hover:bg-slate-950/70"
        >
          <span className="text-lg font-bold text-amber-200 drop-shadow">{gameOverLabel}</span>
          <span className="mt-1 text-2xl font-black text-white">{scoreTemplate.replace("{score}", String(deadScore))}</span>
          <span className="mt-3 text-xs font-medium text-amber-100/90">{tapLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

function GameModal({
  onClose,
  title,
  tapLabel,
  gameOverLabel,
  scoreLabel,
  closeLabel
}: {
  onClose: () => void;
  title: string;
  tapLabel: string;
  gameOverLabel: string;
  scoreLabel: string;
  closeLabel: string;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="max-h-[92vh] w-full max-w-[min(400px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-2xl dark:border-amber-800 dark:bg-amber-950/95">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-base font-bold text-amber-950 dark:text-amber-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200/80 dark:text-amber-100 dark:hover:bg-amber-800/80"
          >
            {closeLabel}
          </button>
        </div>
        <BeeGameCanvas tapLabel={tapLabel} gameOverLabel={gameOverLabel} scoreTemplate={scoreLabel} />
      </div>
    </div>,
    document.body
  );
}

/** Easter egg: resident account page, local 12:00–12:10 — tiny Flappy-style bee. */
export function AccountNoonFlappyBee() {
  const { t } = usePortalLanguage();
  const { isLoggedIn, sessionRole, isSessionLoaded } = usePortalSession();
  const [windowOk, setWindowOk] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function tick() {
      setWindowOk(isAccountNoonFlappyBeeWindow(new Date()));
    }
    tick();
    const id = window.setInterval(tick, 30_000);
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!windowOk && open) setOpen(false);
  }, [windowOk, open]);

  const showFab = isSessionLoaded && isLoggedIn && sessionRole === "user" && windowOk;

  if (!showFab) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("accountNoonBeeFabTitle")}
        aria-label={t("accountNoonBeeFabTitle")}
        className="fixed bottom-28 right-4 z-[45] flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-500 bg-gradient-to-b from-amber-200 to-amber-400 text-2xl shadow-lg ring-2 ring-amber-200/80 animate-[pulse_2.2s_ease-in-out_infinite] hover:scale-105 active:scale-95 motion-reduce:animate-none dark:from-amber-700 dark:to-amber-900 dark:ring-amber-700/50"
      >
        <span className="select-none drop-shadow-sm" aria-hidden>
          🐝
        </span>
      </button>
      {open ? (
        <GameModal
          onClose={() => setOpen(false)}
          title={t("accountNoonBeeTitle")}
          tapLabel={t("accountNoonBeeTap")}
          gameOverLabel={t("accountNoonBeeGameOver")}
          scoreLabel={t("accountNoonBeeScore")}
          closeLabel={t("accountNoonBeeClose")}
        />
      ) : null}
    </>
  );
}
