const DEFAULT_SITE_URL = "https://hostel.cozorohome.com";

export function getSiteUrl() {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/+$/, "");
    }
  }

  return DEFAULT_SITE_URL;
}
