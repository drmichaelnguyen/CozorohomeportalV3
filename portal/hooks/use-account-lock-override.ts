"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import type { AccountLockOverride } from "../lib/account-lock-status";

export function useAccountLockOverride(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const [override, setOverride] = useState<AccountLockOverride | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!normalizedEmail) {
      setOverride(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetch(`${API_BASE_URL}/account-lock-override?email=${encodeURIComponent(normalizedEmail)}`)
      .then(async (response) => {
        const data = (await response.json()) as { override?: AccountLockOverride | null };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setOverride(null);
          return;
        }
        setOverride(data.override ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setOverride(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedEmail]);

  return { override, loading };
}
