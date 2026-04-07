"use client";

export function VersionBadge() {
  const version = "3.5.11";
  const buildTime = "2026-04-07 20:35";
  return (
    <span className="text-[10px] font-medium text-slate-400 font-mono select-none" suppressHydrationWarning>
      v{version} ({buildTime})
    </span>
  );
}
