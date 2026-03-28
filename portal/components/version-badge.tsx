"use client";

export function VersionBadge() {
  const version = "3.3.1"; // v3.3.1 Payment receipt fix, manager self-name edit, cleaning open slots panel
  const buildTime = "2026-03-28 22:00"; // Manual build timestamp
  
  return (
    <div className="fixed bottom-2 right-4 z-[60] select-none pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
      <span className="text-[10px] font-medium text-slate-500 font-mono" suppressHydrationWarning>
        v{version} ({buildTime})
      </span>
    </div>
  );
}
