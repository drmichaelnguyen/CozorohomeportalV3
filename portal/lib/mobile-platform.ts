export type MobileOsKind = "ios" | "android" | "other";

export function detectMobileOs(): MobileOsKind {
  if (typeof navigator === "undefined") {
    return "other";
  }
  const ua = navigator.userAgent || "";
  const isIOSDevice = /iPad|iPhone|iPod/i.test(ua);
  const isIPadOS13Plus = navigator.platform === "MacIntel" && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1;
  if (isIOSDevice || isIPadOS13Plus) {
    return "ios";
  }
  if (/Android/i.test(ua)) {
    return "android";
  }
  return "other";
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}
