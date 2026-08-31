type PurgePortalCacheResult =
  | { ok: true; host: string; skipped?: string; error?: undefined }
  | { ok: false; host?: string; skipped?: string; error: string };

let lastPortalCachePurgeAt = 0;

export function getPortalCloudflareHost(): string {
  return process.env.CLOUDFLARE_PORTAL_HOST?.trim() || "app.cozorohome.com";
}

export function canPurgePortalCloudflareCache(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim() && process.env.CLOUDFLARE_ZONE_ID?.trim());
}

export async function purgePortalCloudflareCache(options?: {
  respectCooldown?: boolean;
  cooldownMs?: number;
}): Promise<PurgePortalCacheResult> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
  const host = getPortalCloudflareHost();

  if (!token || !zoneId) {
    return { ok: false, skipped: "not_configured", error: "Cloudflare purge is not configured." };
  }

  const respectCooldown = options?.respectCooldown ?? true;
  const cooldownMs = options?.cooldownMs ?? 5 * 60 * 1000;
  const now = Date.now();

  if (respectCooldown && lastPortalCachePurgeAt && now - lastPortalCachePurgeAt < cooldownMs) {
    return { ok: true, host, skipped: "cooldown" };
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ hosts: [host] })
  });

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; errors?: Array<{ message?: string }> }
    | null;

  if (!response.ok || !payload?.success) {
    const message =
      payload?.errors?.map((entry) => entry.message).filter(Boolean).join("; ") ||
      `Cloudflare purge failed with HTTP ${response.status}`;
    return { ok: false, host, error: message };
  }

  lastPortalCachePurgeAt = now;
  return { ok: true, host };
}
