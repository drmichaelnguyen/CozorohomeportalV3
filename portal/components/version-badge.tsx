"use client";

export function VersionBadge() {
  const version = "3.0.2";
  const buildTime = "2026-03-24 19:57"; // Manual build timestamp
  
  return (
    <div className="fixed bottom-2 right-4 z-[60] select-none pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
      <span className="text-[10px] font-medium text-slate-500 font-mono">
        v{version} ({buildTime})
      </span>
    </div>
  );
}
