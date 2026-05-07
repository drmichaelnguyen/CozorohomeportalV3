"use client";

import { useEffect } from "react";
import { StandardRouteError } from "../../components/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const chunkMatch = typeof error?.message === "string" ? error.message.match(/chunks\/([^.]+)\.js/i) : null;
    // #region agent log
    fetch("http://127.0.0.1:7334/ingest/99499d10-2452-43bb-b244-1ba866840dd1", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "47d366" },
      body: JSON.stringify({
        sessionId: "47d366",
        runId: "pre-fix",
        hypothesisId: "H1",
        location: "portal/app/manager/error.tsx:7",
        message: "Manager route error boundary caught",
        data: {
          name: error?.name ?? null,
          digest: error?.digest ?? null,
          message: error?.message ?? null,
          chunkId: chunkMatch?.[1] ?? null,
          path: typeof window !== "undefined" ? window.location.pathname : null,
          href: typeof window !== "undefined" ? window.location.href : null
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
  }, [error]);

  return <StandardRouteError error={error} reset={reset} serviceName="Manager workspace" />;
}
