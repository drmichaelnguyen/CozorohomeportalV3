"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const PORTAL_SESSION_STORAGE_KEY = "cozorohome-portal-session-email";
const PORTAL_PASSWORD_STORAGE_KEY = "cozorohome-portal-passwords";

type PortalPasswordMap = Record<string, string>;

type PortalSessionContextValue = {
  sessionEmail: string;
  isLoggedIn: boolean;
  login: (email: string) => void;
  logout: () => void;
  hasSavedPassword: (email: string) => boolean;
  savePassword: (email: string, password: string) => void;
  isPasswordMatch: (email: string, password: string) => boolean;
};

const PortalSessionContext = createContext<PortalSessionContextValue | null>(null);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function loadSavedPasswords(): PortalPasswordMap {
  if (typeof window === "undefined") {
    return {};
  }

  const rawValue = window.localStorage.getItem(PORTAL_PASSWORD_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as PortalPasswordMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function PortalSessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionEmail, setSessionEmail] = useState("");
  const [savedPasswords, setSavedPasswords] = useState<PortalPasswordMap>({});

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedEmail = window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY) ?? "";
    const storedPasswords = loadSavedPasswords();

    if (savedEmail) {
      setSessionEmail(savedEmail);
    }

    setSavedPasswords(storedPasswords);
  }, []);

  const value = useMemo<PortalSessionContextValue>(
    () => ({
      sessionEmail,
      isLoggedIn: Boolean(sessionEmail.trim()),
      login: (email) => {
        const normalizedEmail = normalizeEmail(email);
        setSessionEmail(normalizedEmail);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(PORTAL_SESSION_STORAGE_KEY, normalizedEmail);
        }
      },
      logout: () => {
        setSessionEmail("");
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
        }
      },
      hasSavedPassword: (email) => Boolean(savedPasswords[normalizeEmail(email)]),
      savePassword: (email, password) => {
        const normalizedEmail = normalizeEmail(email);
        const nextPasswords = {
          ...savedPasswords,
          [normalizedEmail]: password
        };

        setSavedPasswords(nextPasswords);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(PORTAL_PASSWORD_STORAGE_KEY, JSON.stringify(nextPasswords));
        }
      },
      isPasswordMatch: (email, password) => {
        const normalizedEmail = normalizeEmail(email);
        return savedPasswords[normalizedEmail] === password;
      }
    }),
    [savedPasswords, sessionEmail]
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
