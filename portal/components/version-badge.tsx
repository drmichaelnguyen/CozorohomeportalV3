"use client";

export function VersionBadge() {
  const version = "3.3.4";
  const buildTime = "2026-03-31 22:00";
  return (
    <span className="text-[10px] font-medium text-slate-400 font-mono select-none" suppressHydrationWarning>
      v{version} ({buildTime})
    </span>
  );
}
