"use client";

import { useEffect } from "react";

import { isChunkLoadFailure, isChunkScriptTarget, reloadForStaleChunks } from "../lib/chunk-load-recovery";

export function ChunkLoadRecovery() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      if (!isChunkScriptTarget(event.target)) {
        return;
      }

      event.preventDefault();
      reloadForStaleChunks();
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (!isChunkLoadFailure(event.reason)) {
        return;
      }

      event.preventDefault();
      reloadForStaleChunks();
    }

    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
