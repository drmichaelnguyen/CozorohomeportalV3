"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type Phase = "play" | "redeeming" | "result";

function randomPercentPos() {
  return { x: 16 + Math.random() * 68, y: 18 + Math.random() * 62 };
}

export function VentHammerGameModal({
  open,
  onOpenChange,
  email
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  const { t, language } = usePortalLanguage();
  const [phase, setPhase] = useState<Phase>("play");
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [hits, setHits] = useState(0);
  const [target, setTarget] = useState(() => randomPercentPos());
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [avatarSrc, setAvatarSrc] = useState("/vent-game/trong-avatar.png");
  const [coinsCredited, setCoinsCredited] = useState(0);
  const [redeemError, setRedeemError] = useState("");
  const [resultNote, setResultNote] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redeemRequestStarted = useRef(false);

  const reset = useCallback(() => {
    redeemRequestStarted.current = false;
    setPhase("play");
    setSecondsLeft(30);
    setHits(0);
    setTarget(randomPercentPos());
    setCoinsCredited(0);
    setRedeemError("");
    setResultNote("");
    setAvatarSrc("/vent-game/trong-avatar.png");
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || phase !== "play") return;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      setTarget(randomPercentPos());
      jumpTimerRef.current = setTimeout(loop, 360 + Math.random() * 520);
    };
    loop();
    return () => {
      alive = false;
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    };
  }, [open, phase]);

  useEffect(() => {
    if (!open || phase !== "play") return;
    if (secondsLeft > 0) {
      const id = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
      return () => window.clearTimeout(id);
    }
    setPhase("redeeming");
  }, [open, phase, secondsLeft]);

  useEffect(() => {
    if (!open || phase !== "redeeming" || redeemRequestStarted.current) return;
    redeemRequestStarted.current = true;
    const normalized = email.trim().toLowerCase();
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/resident/vent-hammer-redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalized, hits })
        });
        const data = (await res.json()) as {
          ok?: boolean;
          coinsCredited?: number;
          alreadyRedeemed?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || data.error) {
          setRedeemError(data.error ?? t("ventHammerRedeemFail"));
          setCoinsCredited(0);
          setResultNote("");
        } else {
          setCoinsCredited(data.coinsCredited ?? 0);
          setResultNote(data.alreadyRedeemed ? t("ventHammerAlreadyRedeemed") : "");
          setRedeemError("");
        }
      } catch {
        if (!cancelled) {
          setRedeemError(t("ventHammerRedeemFail"));
          setResultNote("");
        }
      } finally {
        if (!cancelled) setPhase("result");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, phase, email, hits, t]);

  const tryHit = useCallback(
    (clientX: number, clientY: number) => {
      const el = boardRef.current;
      if (!el || phase !== "play") return;
      const r = el.getBoundingClientRect();
      const x = (target.x / 100) * r.width;
      const y = (target.y / 100) * r.height;
      const px = clientX - r.left;
      const py = clientY - r.top;
      const dist = Math.hypot(px - x, py - y);
      if (dist < 52) {
        setHits((h) => h + 1);
        setTarget(randomPercentPos());
      }
    },
    [phase, target.x, target.y]
  );

  async function sendSatisfaction(satisfied: boolean) {
    try {
      await fetch(`${API_BASE_URL}/resident/vent-hammer-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), satisfied, language })
      });
    } catch {
      // ignore
    }
    onOpenChange(false);
  }

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  /* z must stay above resident-portal-ai-bee (z-200) and rent-due overlay (z-220). */
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-3 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={t("ventHammerTitle")}
    >
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-amber-900/30 shadow-2xl">
        {/* Guest-booking–style hero gradient */}
        <div
          className="relative shrink-0 px-4 pb-3 pt-4 text-white"
          style={{
            background: "linear-gradient(160deg, #10242c 0%, #126154 55%, #0d4a40 100%)"
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-100/90">
                CozoroHome
              </p>
              <h2 className="text-lg font-bold leading-tight">{t("ventHammerTitle")}</h2>
              <p className="mt-1 text-xs text-emerald-50/90">{t("ventHammerSubtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/20"
            >
              {t("ventHammerClose")}
            </button>
          </div>
          {phase === "play" ? (
            <div className="mt-3 flex justify-between text-sm font-bold tabular-nums">
              <span className="rounded-full bg-black/20 px-3 py-1">{t("ventHammerTime", undefined, { s: String(secondsLeft) })}</span>
              <span className="rounded-full bg-black/20 px-3 py-1">{t("ventHammerHits", undefined, { n: String(hits) })}</span>
            </div>
          ) : null}
        </div>

        <div className="relative min-h-[280px] flex-1 bg-slate-900">
          {phase === "play" ? (
            <div
              ref={boardRef}
              className="relative h-[min(52vh,400px)] w-full cursor-none touch-none select-none"
              onPointerMove={(e) => {
                const r = boardRef.current?.getBoundingClientRect();
                if (!r) return;
                setPointer({ x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onPointerDown={(e) => tryHit(e.clientX, e.clientY)}
            >
              <div
                className="pointer-events-none absolute z-20 h-16 w-16 rounded-full border-4 border-amber-200 bg-slate-800 shadow-xl ring-2 ring-amber-400/50"
                style={{
                  left: `${target.x}%`,
                  top: `${target.y}%`,
                  transform: "translate(-50%, -50%)"
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarSrc}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                  draggable={false}
                  onError={() => setAvatarSrc("/cozorohome-logo.png")}
                />
              </div>
              <div
                className="pointer-events-none absolute z-30 text-4xl drop-shadow-lg"
                style={{
                  left: pointer.x,
                  top: pointer.y,
                  transform: "translate(-40%, -70%) rotate(-25deg)"
                }}
                aria-hidden
              >
                🔨
              </div>
              <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] font-medium text-slate-400">
                {t("ventHammerHint")}
              </p>
            </div>
          ) : null}

          {phase === "redeeming" ? (
            <div className="flex h-[min(52vh,400px)] flex-col items-center justify-center gap-2 text-white">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
              <p className="text-sm">{t("ventHammerCrediting")}</p>
            </div>
          ) : null}

          {phase === "result" ? (
            <div className="flex h-[min(52vh,400px)] flex-col items-center justify-center gap-3 px-6 text-center text-white">
              <p className="text-lg font-bold text-amber-200">{t("ventHammerRoundDone")}</p>
              {resultNote ? <p className="text-sm text-amber-200">{resultNote}</p> : null}
              {redeemError ? <p className="text-sm text-rose-300">{redeemError}</p> : null}
              <p className="text-2xl font-black tabular-nums">{t("ventHammerCoinsLine", undefined, { c: String(coinsCredited) })}</p>
              <p className="text-sm text-slate-300">{t("ventHammerAvatarNote")}</p>
              <p className="text-sm font-semibold text-emerald-100">{t("ventHammerSatisfactionAsk")}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void sendSatisfaction(true)}
                  className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-400"
                >
                  {t("ventHammerSatYes")}
                </button>
                <button
                  type="button"
                  onClick={() => void sendSatisfaction(false)}
                  className="rounded-full border border-white/30 bg-white/10 px-5 py-2 text-sm font-semibold text-white hover:bg-white/20"
                >
                  {t("ventHammerSatNo")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
