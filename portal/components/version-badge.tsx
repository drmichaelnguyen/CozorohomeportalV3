"use client";

export function VersionBadge() {
  const version = "3.2.2"; // v3.2.2 Nav badges, cleaning schedule fixes, iMessage UI
  const buildTime = "2026-03-25 23:00"; // Manual build timestamp
  
  return (
    <div className="fixed bottom-2 right-4 z-[60] select-none pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
      <span className="text-[10px] font-medium text-slate-500 font-mono">
        v{version} ({buildTime})
      </span>
    </div>
  );
}
