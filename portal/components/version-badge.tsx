"use client";

import { APP_BUILD_TIME, APP_VERSION } from "../lib/app-version";

export function VersionBadge() {
  return (
    <span className="text-[10px] font-medium text-slate-400 font-mono select-none" suppressHydrationWarning>
      v{APP_VERSION} ({APP_BUILD_TIME})
    </span>
  );
}
