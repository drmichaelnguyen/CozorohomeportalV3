"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

const PORTAL_SESSION_STORAGE_KEY = "cozorohome-portal-session-email";
const PORTAL_SESSION_ROLE_STORAGE_KEY = "cozorohome-portal-session-role";
export type PortalSessionRole = "user" | "manager" | "owner" | "app_admin" | "mechanic";

type PortalSessionContextValue = {
  sessionEmail: string;
  sessionRole: PortalSessionRole | null;
  isLoggedIn: boolean;
  isSessionLoaded: boolean;
  login: (email: string, role?: PortalSessionRole) => void;
  logout: () => void;
};

const PortalSessionContext = createContext<PortalSessionContextValue | null>(null);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function PortalSessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionEmail, setSessionEmail] = useState("");
  const [sessionRole, setSessionRole] = useState<PortalSessionRole | null>(null);
  const [isSessionLoaded, setIsSessionLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedEmail = window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY) ?? "";
    const savedRole = window.localStorage.getItem(PORTAL_SESSION_ROLE_STORAGE_KEY);

    if (savedEmail) {
      setSessionEmail(savedEmail);
    }

    if (savedRole === "user" || savedRole === "manager" || savedRole === "owner" || savedRole === "app_admin" || savedRole === "mechanic") {
      setSessionRole(savedRole);
    }

    setIsSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionEmail) {
      return;
    }

    let cancelled = false;

    async function refreshSessionRole() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/auth/resolve-login?email=${encodeURIComponent(sessionEmail)}`
        );
        const data = (await response.json()) as { allowed?: boolean; role?: PortalSessionRole | null };

        if (cancelled || !response.ok || !data.allowed || !data.role) {
          return;
        }

        if (data.role !== sessionRole) {
          setSessionRole(data.role);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(PORTAL_SESSION_ROLE_STORAGE_KEY, data.role);
          }
        }
      } catch {
        // Keep the saved session when the API is temporarily unavailable.
      }
    }

    void refreshSessionRole();

    return () => {
      cancelled = true;
    };
  }, [sessionEmail, sessionRole]);

  const value = useMemo<PortalSessionContextValue>(
    () => ({
      sessionEmail,
      sessionRole,
      isLoggedIn: Boolean(sessionEmail.trim()),
      isSessionLoaded,
      login: (email, role = "user") => {
        const normalizedEmail = normalizeEmail(email);
        setSessionEmail(normalizedEmail);
        setSessionRole(role);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(PORTAL_SESSION_STORAGE_KEY, normalizedEmail);
          window.localStorage.setItem(PORTAL_SESSION_ROLE_STORAGE_KEY, role);
        }
      },
      logout: () => {
        setSessionEmail("");
        setSessionRole(null);
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
          window.localStorage.removeItem(PORTAL_SESSION_ROLE_STORAGE_KEY);
        }
      }
    }),
    [sessionEmail, sessionRole, isSessionLoaded]
  );

  return <PortalSessionContext.Provider value={value}>{children}</PortalSessionContext.Provider>;
}

export function usePortalSession() {
  const context = useContext(PortalSessionContext);
  if (!context) {
    throw new Error("usePortalSession must be used inside PortalSessionProvider");
  }

  return context;
}
