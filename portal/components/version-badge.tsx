"use client";

export function VersionBadge() {
  const version = "0.0.1"; // Hardcoded for now, could be imported from a config
  
  return (
    <div className="fixed bottom-2 right-4 z-[60] select-none pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
      <span className="text-[10px] font-medium text-slate-500 font-mono">
        v{version}
      </span>
    </div>
  );
}
