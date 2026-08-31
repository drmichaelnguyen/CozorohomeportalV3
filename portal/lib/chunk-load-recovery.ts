import { API_BASE_URL } from "./api-base-url";

const CHUNK_RELOAD_KEY = "cozorohome-chunk-reload";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

export function isChunkLoadFailure(reason: unknown): boolean {
  if (!reason) {
    return false;
  }

  const message =
    reason instanceof Error
      ? `${reason.name} ${reason.message}`
      : typeof reason === "string"
        ? reason
        : String(reason);

  return (
    /chunkloaderror/i.test(message) ||
    /loading chunk [\w-]+ failed/i.test(message) ||
    /failed to fetch dynamically imported module/i.test(message) ||
    /\/_next\/static\/chunks\/[\w-]+\.js/i.test(message)
  );
}

export function isChunkScriptTarget(target: EventTarget | null): target is HTMLScriptElement {
  return (
    target instanceof HTMLScriptElement &&
    typeof target.src === "string" &&
    /\/_next\/static\/chunks\/[\w-]+\.js/i.test(target.src)
  );
}

async function requestPortalCacheRefresh(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/portal/cache-refresh`, {
      method: "POST",
      cache: "no-store"
    });
  } catch {
    // Reload even if the purge request fails.
  }
}

export function reloadForStaleChunks(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const lastReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
  const now = Date.now();
  if (lastReloadAt && now - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) {
    return false;
  }

  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));

  void requestPortalCacheRefresh().finally(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("_cv", String(now));
    window.location.replace(url.toString());
  });

  return true;
}
